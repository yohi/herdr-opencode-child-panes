import type { Event } from "@opencode-ai/sdk";
import { createAsyncQueue } from "./async-queue.js";
import type { AttachLauncher } from "./attach-launcher.js";
import type { ChildSession, ChildSessionRegistry } from "./child-session.js";
import { resolveSessionId } from "./event-resolver.js";
import type { Logger } from "./logger.js";
import type { ChildOwnershipResolver } from "./ownership-resolver.js";
import { sessionCreatedPropertiesSchema, sessionStatusPropertiesSchema } from "./schemas.js";
import type {
  HerdrChildPanesConfig,
  HerdrClient,
  PaneLayoutDirection,
  ResizePaneInput,
} from "./types.js";

const MEANINGFUL_ACTIVITY_EVENTS = new Set<string>([
  "message.updated",
  "message.part.updated",
  "message.part.delta",
]);
const ACTIVE_STATUS_TYPES = new Set<string>(["active", "working", "busy", "running", "streaming"]);

type WorkSignalKind = "active_status" | "meaningful_activity";
type SpawnKind = "initial" | "reopen";

/**
 * Backoff delays between close retries; the last value is reused when more
 * retries are configured than there are entries.
 */
const CLOSE_RETRY_BACKOFF_MS: readonly number[] = [500, 1000, 2000];
const MAIN_PANE_RATIO = 2 / 3;
const CHILD_PANE_RATIO = 0.5;

interface ChildPaneSplitPlan {
  readonly targetPaneId: string;
  readonly direction: PaneLayoutDirection;
  readonly ratio: number;
  readonly resizeTargets: readonly ResizePaneInput[];
}

function createChildPaneSplitPlan(
  childPaneIds: readonly string[],
  callerPaneId: string,
): ChildPaneSplitPlan {
  if (childPaneIds.length === 0) {
    return {
      targetPaneId: callerPaneId,
      direction: "right",
      ratio: MAIN_PANE_RATIO,
      resizeTargets: [],
    };
  }

  const childCount = childPaneIds.length + 1;
  const resizeTargets: ResizePaneInput[] = [];
  for (let splitIndex = childCount - 3; splitIndex >= 0; splitIndex -= 1) {
    const lowerPaneCount = childCount - 1 - splitIndex;
    const amount = 1 / (lowerPaneCount * (lowerPaneCount + 1));
    const targetPaneId = childPaneIds[splitIndex + 1];
    if (targetPaneId !== undefined && amount > 0 && Number.isFinite(amount)) {
      resizeTargets.push({
        paneId: targetPaneId,
        direction: "up",
        amount,
      });
    }
  }

  const targetPaneId = childPaneIds[childPaneIds.length - 1];
  return {
    targetPaneId,
    direction: "down",
    ratio: CHILD_PANE_RATIO,
    resizeTargets,
  };
}

/**
 * Drives the child pane lifecycle from OpenCode events: registers owned child
 * sessions, splits the caller pane on the first meaningful activity, attaches
 * the child session into the new pane, and closes panes when sessions die.
 *
 * Pane splits and closes are serialized through an async queue so concurrent
 * events cannot interleave Herdr mutations, and a failed mutation never
 * blocks the mutations queued behind it.
 */
export interface PaneOrchestrator {
  handleEvent(event: Event): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreatePaneOrchestratorOptions {
  /** The caller Herdr pane that hosts the OpenCode root session. */
  readonly paneId: string;
  /** OpenCode server URL; forwarded to the attach launcher. */
  readonly serverUrl: URL;
  /** Working directory forwarded to the attach launcher. */
  readonly directory: string;
  /** Parsed plugin configuration. */
  readonly config: HerdrChildPanesConfig;
  /** Adapter for invoking Herdr CLI commands. */
  readonly herdrClient: HerdrClient;
  /** Decides whether a created session belongs to this pane. */
  readonly ownershipResolver: ChildOwnershipResolver;
  /** Registry tracking child session lifecycle state. */
  readonly registry: ChildSessionRegistry;
  /** Runs `opencode attach` inside the freshly split pane. */
  readonly attachLauncher: AttachLauncher;
  /** Structured logger. */
  readonly logger: Logger;
  /** Timer creation for the idle grace period and close-retry backoff. */
  readonly setTimeout?: typeof globalThis.setTimeout;
}

function isActiveStatus(status: unknown): boolean {
  if (typeof status !== "object" || status === null) {
    return false;
  }
  return (
    "type" in status && typeof status.type === "string" && ACTIVE_STATUS_TYPES.has(status.type)
  );
}

function isIdleStatus(status: unknown): boolean {
  if (typeof status !== "object" || status === null) {
    return false;
  }
  return "type" in status && status.type === "idle";
}

export function createPaneOrchestrator(options: CreatePaneOrchestratorOptions): PaneOrchestrator {
  const paneId = options.paneId;
  const serverUrl = options.serverUrl;
  const directory = options.directory;
  const config = options.config;
  const herdrClient = options.herdrClient;
  const ownershipResolver = options.ownershipResolver;
  const registry = options.registry;
  const attachLauncher = options.attachLauncher;
  const logger = options.logger;
  const setTimeoutFn = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const queue = createAsyncQueue();
  const spawnReservations = new Set<string>();
  const idleDuringSpawn = new Set<string>();
  const pendingSpawnRequests = new Set<string>();
  /**
   * Sessions whose ownership resolution is currently in flight. Duplicate
   * created events and pre-registration deletions during this window must
   * not start a second resolution or repopulate pending spawn state.
   */
  const ownershipPending = new Set<string>();
  /**
   * Deletion tombstones for sessions deleted while their ownership
   * resolution was pending. They make the deletion irreversible: neither a
   * late work signal nor a duplicate create may resurrect the child.
   * Cleared on dispose, so a restart starts with clean bookkeeping.
   */
  const deletedBeforeRegistration = new Set<string>();

  const childPaneIds: string[] = [];
  let disposed = false;

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeoutFn(resolve, ms);
    });
  }

  function fail(sessionId: string, reason: string): void {
    idleDuringSpawn.delete(sessionId);
    // A failure finalizes the session; stale close metadata must not survive.
    registry.clearCloseMetadata(sessionId);
    registry.setFailureReason(sessionId, reason);
    registry.transitionTo(sessionId, "failed");
    logger.warn("Child pane lifecycle failure", { sessionId, reason });
  }

  function removeChildPaneId(childPaneId: string): void {
    const index = childPaneIds.indexOf(childPaneId);
    if (index >= 0) {
      childPaneIds.splice(index, 1);
    }
  }

  /**
   * Finalize a successful Herdr close by rereading the live close metadata:
   * work, a later idle, or deletion may have changed it while `closePane()`
   * was in flight. Delete closes end in terminal `closed`; idle closes end in
   * `reopenable` and return the `reopenRequested` snapshot observed at success
   * time, which the reopen handoff consumes.
   */
  function finalizeSuccessfulClose(sessionId: string, childPaneId?: string): boolean {
    if (childPaneId !== undefined) {
      removeChildPaneId(childPaneId);
    }
    registry.clearPaneId(sessionId);
    const current = registry.get(sessionId);
    if (current?.closeReason === "deleted") {
      registry.transitionTo(sessionId, "closed");
      registry.clearCloseMetadata(sessionId);
      return false;
    }
    const reopenRequested = current?.reopenRequested ?? false;
    registry.transitionTo(sessionId, "reopenable");
    registry.clearCloseMetadata(sessionId);
    logger.info("idle-closed child became reopenable", { sessionId });
    return reopenRequested;
  }

  function reserveSpawn(sessionId: string, kind: SpawnKind): boolean {
    if (spawnReservations.has(sessionId)) {
      return true;
    }
    const paneCount = registry
      .listActive()
      .filter((session) => session.paneId !== undefined).length;
    if (paneCount + spawnReservations.size >= config.maxPanes) {
      if (kind === "reopen") {
        logger.warn("Reopen deferred because capacity was full", { sessionId });
        return false;
      }
      registry.setFailureReason(sessionId, "capacity_limit");
      registry.transitionTo(sessionId, "ignored");
      logger.warn("Child pane capacity reached", { sessionId });
      return false;
    }
    spawnReservations.add(sessionId);
    return true;
  }

  async function closeSpawnedPane(sessionId: string, childPaneId: string): Promise<void> {
    idleDuringSpawn.delete(sessionId);
    registry.setPaneId(sessionId, childPaneId);
    const closed = await herdrClient.closePane(childPaneId);
    if (closed) {
      // Deletion closes are terminal; no handoff is possible.
      finalizeSuccessfulClose(sessionId, childPaneId);
      logger.info("Child pane closed after session deletion", {
        sessionId,
        paneId: childPaneId,
      });
      return;
    }
    fail(sessionId, "close_failed");
  }

  /**
   * Split the caller pane, attach the child session, and record the new pane.
   * Runs inside the serialized queue; the `spawning` transition happened
   * synchronously at enqueue time, so this only mutates Herdr when the
   * session is still claimed by this spawn.
   */
  async function runSpawn(sessionId: string, kind: SpawnKind): Promise<void> {
    const plan = createChildPaneSplitPlan(childPaneIds, paneId);
    const environment = attachLauncher.environment;
    const newPaneId = await herdrClient.splitPane({
      paneId: plan.targetPaneId,
      direction: plan.direction,
      ratio: plan.ratio,
      noFocus: true,
      ...(environment !== undefined && Object.keys(environment).length > 0
        ? { env: environment }
        : {}),
    });
    if (newPaneId === null) {
      fail(sessionId, "split_failed");
      return;
    }

    // Deletion can arrive while splitPane is in flight. The new pane is the
    // only resource created by this operation, so close it without attaching.
    if (registry.get(sessionId)?.state === "closing") {
      await closeSpawnedPane(sessionId, newPaneId);
      return;
    }

    const attached = await attachLauncher.attach({
      paneId: newPaneId,
      sessionId,
      serverUrl,
      directory,
    });
    if (!attached) {
      // Only the freshly created pane may be rolled back; the child session
      // itself is never touched.
      await herdrClient.closePane(newPaneId);
      fail(sessionId, "attach_failed");
      return;
    }

    if (registry.get(sessionId)?.state === "closing") {
      await closeSpawnedPane(sessionId, newPaneId);
      return;
    }

    registry.setPaneId(sessionId, newPaneId);
    childPaneIds.push(newPaneId);
    registry.transitionTo(sessionId, "attached");
    if (kind === "reopen") {
      logger.info("Child reopened and attached", { sessionId, paneId: newPaneId });
    } else {
      logger.info("Child pane attached", { sessionId, paneId: newPaneId });
    }
    for (const resize of plan.resizeTargets) {
      if (await herdrClient.resizePane(resize)) {
        continue;
      }
      logger.warn("Child pane layout resize failed", {
        paneId: resize.paneId,
        direction: resize.direction,
        amount: resize.amount,
      });
    }

    if (idleDuringSpawn.delete(sessionId)) {
      if (registry.transitionTo(sessionId, "idle_pending")) {
        scheduleIdleTimer(sessionId);
        logger.debug("Child session was idle during attach: close scheduled", {
          sessionId,
          graceMs: config.idleGraceMs,
        });
      }
    }
  }

  /**
   * Claim the session before enqueueing the Herdr work. The synchronous
   * `spawning` transition is the idempotency gate, while the reservation
   * prevents concurrent children from exceeding the pane limit.
   */
  function enqueueSpawn(session: ChildSession, kind: SpawnKind): Promise<void> {
    if (!reserveSpawn(session.sessionId, kind)) {
      return Promise.resolve();
    }
    if (!registry.transitionTo(session.sessionId, "spawning")) {
      spawnReservations.delete(session.sessionId);
      return Promise.resolve();
    }

    let taskStarted = false;
    return queue
      .enqueue(async () => {
        taskStarted = true;
        const current = registry.get(session.sessionId);
        if (!current || current.state !== "spawning") {
          if (current?.state === "closing" && current.paneId === undefined) {
            finalizeSuccessfulClose(current.sessionId);
          }
          return;
        }
        await runSpawn(current.sessionId, kind);
      })
      .finally(() => {
        spawnReservations.delete(session.sessionId);
      })
      .catch((error: unknown) => {
        if (!taskStarted && kind === "reopen") {
          logger.warn("reopen enqueue failed because the serialized queue was unavailable", {
            sessionId: session.sessionId,
          });
        } else {
          logger.error("Unhandled error while spawning child pane", {
            sessionId: session.sessionId,
            error,
          });
        }
        const current = registry.get(session.sessionId);
        if (current?.state === "spawning" || current?.state === "closing") {
          fail(current.sessionId, "spawn_failed");
        }
      });
  }

  /**
   * Close an already-`closing` session's pane, retrying up to `retries` times
   * with exponential-ish backoff. Each attempt re-checks the lifecycle state
   * so a close taken over by another path stops without touching Herdr again.
   */
  async function closePaneUntilClosed(
    sessionId: string,
    childPaneId: string,
    retries: number,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const current = registry.get(sessionId);
      if (!current || current.state !== "closing") {
        return;
      }
      if (await herdrClient.closePane(childPaneId)) {
        const reopenRequested = finalizeSuccessfulClose(sessionId, childPaneId);
        logger.info("Child pane closed", { sessionId, paneId: childPaneId });
        if (reopenRequested) {
          const reopenableSession = registry.get(sessionId);
          if (reopenableSession) {
            void enqueueSpawn(reopenableSession, "reopen");
          }
        }
        return;
      }
      if (attempt >= retries) {
        fail(sessionId, "close_failed");
        return;
      }
      await delay(CLOSE_RETRY_BACKOFF_MS[Math.min(attempt, CLOSE_RETRY_BACKOFF_MS.length - 1)]);
    }
  }

  /**
   * Queue the Herdr close for a `closing` session that owns a child pane.
   */
  function enqueueCloseTask(
    session: ChildSession,
    childPaneId: string,
    retries: number,
  ): Promise<void> {
    return queue
      .enqueue(() => closePaneUntilClosed(session.sessionId, childPaneId, retries))
      .catch((error: unknown) => {
        logger.error("Unhandled error while closing child pane", {
          sessionId: session.sessionId,
          paneId: childPaneId,
          error,
        });
        const current = registry.get(session.sessionId);
        if (current?.state === "closing") {
          fail(current.sessionId, "close_failed");
        }
      });
  }

  /**
   * Queue the Herdr close for an already-`closing` session. Sessions without
   * an owned pane transition straight to `closed` without touching Herdr.
   * Delete-triggered closes are single-attempt; only the idle-timeout close
   * retries.
   */
  function enqueueClose(session: ChildSession): Promise<void> {
    const childPaneId = session.paneId;
    if (childPaneId === undefined || childPaneId === paneId) {
      // A spawning session may report a pane after deletion. Leave it closing
      // until the queued spawn observes the state and cleans up that pane.
      if (session.state !== "spawning") {
        const reopenRequested = finalizeSuccessfulClose(session.sessionId);
        if (reopenRequested) {
          const reopenableSession = registry.get(session.sessionId);
          if (reopenableSession) {
            void enqueueSpawn(reopenableSession, "reopen");
          }
        }
      }
      return Promise.resolve();
    }
    return enqueueCloseTask(session, childPaneId, 0);
  }

  async function handleSessionCreated(event: Event): Promise<void> {
    const sessionId = resolveSessionId(event);
    if (
      !sessionId ||
      registry.has(sessionId) ||
      ownershipPending.has(sessionId) ||
      deletedBeforeRegistration.has(sessionId) ||
      disposed
    ) {
      return;
    }
    const parsed = sessionCreatedPropertiesSchema.safeParse(event.properties);
    if (!parsed.success) {
      return;
    }
    const parentId = parsed.data.info.parentID;
    if (!parentId) {
      pendingSpawnRequests.delete(sessionId);
      return;
    }

    // Claimed before the await so a delete or duplicate create arriving
    // while ownership resolves is recorded against the in-flight attempt.
    ownershipPending.add(sessionId);
    try {
      const owned = await ownershipResolver.isOwnedChild({ sessionId, parentId });
      if (disposed || registry.has(sessionId) || deletedBeforeRegistration.has(sessionId)) {
        // Tombstones live until dispose: a pre-registration deletion stays
        // irreversible even for duplicate created events. The dispose and
        // registry checks keep the tombstone intact for those reasons.
        if (!disposed && !registry.has(sessionId)) {
          logger.info("Pre-registration deletion prevented child registration", {
            sessionId,
          });
        }
        return;
      }
      if (!owned) {
        pendingSpawnRequests.delete(sessionId);
        logger.debug("Child session not owned", { sessionId, parentId });
        return;
      }
      const registered = registry.register(sessionId, parentId);
      if (!registered) {
        logger.debug("Child session already registered", { sessionId, parentId });
        return;
      }
      logger.info("Child session registered", { sessionId, parentId });

      if (pendingSpawnRequests.delete(sessionId)) {
        const registeredSession = registry.get(sessionId);
        if (registeredSession) {
          await enqueueSpawn(registeredSession, "initial");
        }
      }
    } finally {
      ownershipPending.delete(sessionId);
    }
  }

  function resumeFromIdlePending(sessionId: string): void {
    registry.clearTimer(sessionId);
    registry.transitionTo(sessionId, "attached");
    logger.debug("Child session resumed from idle", { sessionId });
  }

  async function handleWorkSignal(
    sessionId: string | undefined,
    signalKind: WorkSignalKind,
  ): Promise<void> {
    if (!sessionId) {
      return;
    }
    const session = registry.get(sessionId);
    if (!session) {
      if (deletedBeforeRegistration.has(sessionId)) {
        // The child was deleted before registration: its work is dead.
        return;
      }
      pendingSpawnRequests.add(sessionId);
      return;
    }

    switch (session.state) {
      case "waiting_activity": {
        await enqueueSpawn(session, "initial");
        return;
      }
      case "spawning": {
        if (signalKind === "active_status") {
          idleDuringSpawn.delete(sessionId);
        }
        return;
      }
      case "attached": {
        return;
      }
      case "idle_pending": {
        if (signalKind === "active_status") {
          resumeFromIdlePending(sessionId);
        }
        return;
      }
      case "reopenable": {
        await enqueueSpawn(session, "reopen");
        return;
      }
      case "closing": {
        // Work during an idle close demands the pane be reopened once the
        // close finishes; work during a delete close is ignored.
        if (session.closeReason === "idle" && !session.reopenRequested) {
          registry.setReopenRequested(sessionId, true);
          logger.debug("work requested reopen while idle close was in progress", { sessionId });
        }
        return;
      }
      case "closed":
      case "ignored":
      case "failed": {
        return;
      }
    }
  }

  async function handleActivity(event: Event): Promise<void> {
    if (!MEANINGFUL_ACTIVITY_EVENTS.has(event.type)) {
      return;
    }
    await handleWorkSignal(resolveSessionId(event), "meaningful_activity");
  }

  async function handleSessionStatus(event: Event): Promise<void> {
    const sessionId = resolveSessionId(event);
    if (!sessionId) {
      return;
    }
    const parsed = sessionStatusPropertiesSchema.safeParse(event.properties);
    if (!parsed.success) {
      return;
    }
    if (isActiveStatus(parsed.data.status)) {
      await handleWorkSignal(sessionId, "active_status");
      return;
    }
    if (isIdleStatus(parsed.data.status)) {
      await handleSessionIdle(event);
    }
  }

  /**
   * Arm the one-shot grace timer for an idle_pending session. The callback
   * re-checks the state, so a stale timer that fires after a resume (or a
   * racing delete) is a harmless no-op.
   */
  function scheduleIdleTimer(sessionId: string): void {
    const timer = setTimeoutFn(() => {
      void closeAfterIdleGrace(sessionId);
    }, config.idleGraceMs);
    registry.setTimer(sessionId, timer);
  }

  /**
   * Grace period elapsed: transition the session to `closing` and close its
   * pane with bounded retries. `closing -> reopenable` on success,
   * `closing -> failed(close_failed)` when every attempt fails.
   */
  function closeAfterIdleGrace(sessionId: string): void {
    registry.clearTimer(sessionId);
    const session = registry.get(sessionId);
    if (!session || session.state !== "idle_pending") {
      // Activity resumed or the session was deleted first; timer is stale.
      logger.debug("Stale idle timer ignored", { sessionId });
      return;
    }
    if (!registry.transitionTo(sessionId, "closing")) {
      return;
    }
    // The close reason is decided up front so work and later idle signals can
    // flip `reopenRequested` while the Herdr close is in flight.
    registry.setCloseReason(sessionId, "idle");
    registry.setReopenRequested(sessionId, false);
    const childPaneId = session.paneId;
    if (childPaneId === undefined || childPaneId === paneId) {
      // Nothing to clean up, or the only known pane is the caller pane itself.
      const reopenRequested = finalizeSuccessfulClose(sessionId);
      if (reopenRequested) {
        const reopenableSession = registry.get(sessionId);
        if (reopenableSession) {
          void enqueueSpawn(reopenableSession, "reopen");
        }
      }
      return;
    }
    void enqueueCloseTask(session, childPaneId, config.closeRetries);
  }

  async function handleSessionIdle(event: Event): Promise<void> {
    const sessionId = resolveSessionId(event);
    if (!sessionId) {
      return;
    }
    const session = registry.get(sessionId);
    if (!session) {
      return;
    }
    if (session.state === "spawning") {
      idleDuringSpawn.add(sessionId);
      logger.debug("Child session idle during attach: close deferred", { sessionId });
      return;
    }
    if (session.state === "closing") {
      // A later idle while the idle close is in flight cancels a pending
      // reopen demand; idle during a delete close is ignored.
      if (session.closeReason === "idle" && session.reopenRequested) {
        registry.setReopenRequested(sessionId, false);
        logger.debug("later idle cancelled pending reopen", { sessionId });
      }
      return;
    }
    // Only attached sessions go idle. The transition doubles as the
    // idempotency gate, so duplicate idle events never arm a second timer.
    if (session.state !== "attached") {
      return;
    }
    if (!registry.transitionTo(sessionId, "idle_pending")) {
      return;
    }
    scheduleIdleTimer(sessionId);
    logger.debug("Child session idle: close scheduled", {
      sessionId,
      graceMs: config.idleGraceMs,
    });
  }

  async function handleSessionDeleted(event: Event): Promise<void> {
    const sessionId = resolveSessionId(event);
    if (!sessionId) {
      return;
    }
    const session = registry.get(sessionId);
    if (!session) {
      pendingSpawnRequests.delete(sessionId);
      if (ownershipPending.has(sessionId)) {
        // The session died while its ownership resolution was in flight:
        // tombstone it so the resolver outcome can never resurrect it.
        deletedBeforeRegistration.add(sessionId);
      }
      return;
    }
    idleDuringSpawn.delete(sessionId);
    // Cancel a pending idle-close timer, if any.
    registry.clearTimer(sessionId);
    if (session.state === "closing") {
      // An idle close is already in flight: promote it to a permanent delete
      // close and let the queued close task observe the new metadata.
      if (session.closeReason === "idle") {
        const pendingReopen = session.reopenRequested;
        registry.setCloseReason(sessionId, "deleted");
        registry.setReopenRequested(sessionId, false);
        if (pendingReopen) {
          logger.debug("pending reopen cancelled because session.deleted arrived", { sessionId });
        }
      }
      return;
    }
    // A rejected transition means the session is already terminal, which
    // keeps duplicate delete events idempotent.
    if (!registry.transitionTo(sessionId, "closing")) {
      return;
    }
    registry.setCloseReason(sessionId, "deleted");
    registry.setReopenRequested(sessionId, false);
    await enqueueClose(session);
  }

  async function handleEvent(event: Event): Promise<void> {
    if (disposed) {
      return;
    }
    const eventType: string = event.type;
    switch (eventType) {
      case "session.created":
        await handleSessionCreated(event);
        return;
      case "session.status":
        await handleSessionStatus(event);
        return;
      case "session.idle":
        await handleSessionIdle(event);
        return;
      case "session.deleted":
        await handleSessionDeleted(event);
        return;
      case "message.updated":
      case "message.part.updated":
      case "message.part.delta":
        await handleActivity(event);
        return;
      default:
        // Unrelated event types are intentionally ignored.
        return;
    }
  }

  return {
    handleEvent,
    dispose: async () => {
      disposed = true;
      // Cancel idle timers without force-closing attached panes, then reject
      // any newly queued pane work.
      idleDuringSpawn.clear();
      pendingSpawnRequests.clear();
      // Tombstones and ownership claims exist only for this orchestrator
      // instance's lifetime; a restart starts with clean bookkeeping.
      ownershipPending.clear();
      deletedBeforeRegistration.clear();
      registry.clearAllTimers();
      queue.dispose();
    },
  };
}
