import type { Event } from "@opencode-ai/sdk";
import { createAsyncQueue } from "./async-queue.js";
import type { AttachLauncher } from "./attach-launcher.js";
import type { ChildSession, ChildSessionRegistry } from "./child-session.js";
import { resolvePaneLayoutDirection } from "./direction-policy.js";
import { resolveSessionId } from "./event-resolver.js";
import type { Logger } from "./logger.js";
import type { ChildOwnershipResolver } from "./ownership-resolver.js";
import { sessionCreatedPropertiesSchema, sessionStatusPropertiesSchema } from "./schemas.js";
import type { HerdrChildPanesConfig, HerdrClient } from "./types.js";

const MEANINGFUL_ACTIVITY_EVENTS = new Set<string>(["message.updated", "message.part.updated"]);
const ACTIVE_STATUS_TYPES = new Set<string>(["active", "working", "busy", "running", "streaming"]);

/**
 * Backoff delays between close retries; the last value is reused when more
 * retries are configured than there are entries.
 */
const CLOSE_RETRY_BACKOFF_MS: readonly number[] = [500, 1000, 2000];

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

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeoutFn(resolve, ms);
    });
  }

  function fail(sessionId: string, reason: string): void {
    registry.setFailureReason(sessionId, reason);
    registry.transitionTo(sessionId, "failed");
    logger.warn("Child pane lifecycle failure", { sessionId, reason });
  }

  /**
   * Split the caller pane, attach the child session, and record the new pane.
   * Runs inside the serialized queue; the `spawning` transition happened
   * synchronously at enqueue time, so this only mutates Herdr when the
   * session is still claimed by this spawn.
   */
  async function runSpawn(sessionId: string): Promise<void> {
    const layout = config.direction === "auto" ? await herdrClient.getPaneLayout(paneId) : null;
    const direction = resolvePaneLayoutDirection({ direction: config.direction, layout });
    const newPaneId = await herdrClient.splitPane({ paneId, direction, noFocus: true });
    if (newPaneId === null) {
      fail(sessionId, "split_failed");
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

    registry.setPaneId(sessionId, newPaneId);
    registry.transitionTo(sessionId, "attached");
    logger.info("Child pane attached", { sessionId, paneId: newPaneId });
  }

  /**
   * Count the panes the bridge currently owns: sessions in an occupied
   * state that carry a recorded pane. Closed, ignored and failed sessions
   * release capacity, and because panes are only created on the serialized
   * spawn path below, no in-flight pane can escape this count.
   */
  function countBridgeOwnedPanes(): number {
    let count = 0;
    for (const state of ["attached", "idle_pending"] as const) {
      for (const session of registry.listByState(state)) {
        if (session.paneId !== undefined) {
          count += 1;
        }
      }
    }
    return count;
  }

  /**
   * Claim the session for a spawn and queue the Herdr work. The synchronous
   * `spawning` transition is the idempotency gate: concurrent activity events
   * observe it and skip, so at most one split is ever queued per session.
   */
  function enqueueSpawn(session: ChildSession): Promise<void> {
    return queue
      .enqueue(async () => {
        const current = registry.get(session.sessionId);
        if (!current || current.state !== "waiting_activity") {
          return;
        }
        // Capacity is checked on the serialized spawn path, so concurrent
        // activity events cannot oversubscribe the caller pane.
        if (countBridgeOwnedPanes() >= config.maxPanes) {
          registry.setFailureReason(current.sessionId, "capacity_limit");
          registry.transitionTo(current.sessionId, "ignored");
          logger.info("Child pane skipped: capacity limit reached", {
            sessionId: current.sessionId,
            maxPanes: config.maxPanes,
          });
          return;
        }
        if (!registry.transitionTo(current.sessionId, "spawning")) {
          return;
        }
        await runSpawn(current.sessionId);
      })
      .catch((error: unknown) => {
        logger.error("Unhandled error while spawning child pane", {
          sessionId: session.sessionId,
          error,
        });
        const current = registry.get(session.sessionId);
        if (current?.state === "spawning") {
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
        registry.transitionTo(sessionId, "closed");
        logger.info("Child pane closed", { sessionId, paneId: childPaneId });
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
      // Nothing to clean up, or the only known pane is the caller pane itself.
      registry.transitionTo(session.sessionId, "closed");
      return Promise.resolve();
    }
    return enqueueCloseTask(session, childPaneId, 0);
  }

  async function handleSessionCreated(event: Event): Promise<void> {
    const sessionId = resolveSessionId(event);
    if (!sessionId || registry.has(sessionId)) {
      return;
    }
    const parsed = sessionCreatedPropertiesSchema.safeParse(event.properties);
    if (!parsed.success) {
      return;
    }
    const parentId = parsed.data.info.parentID;
    if (!parentId) {
      return;
    }

    const owned = await ownershipResolver.isOwnedChild({ sessionId, parentId });
    if (!owned) {
      logger.debug("Child session not owned", { sessionId, parentId });
      return;
    }
    const registered = registry.register(sessionId, parentId);
    if (!registered) {
      logger.debug("Child session already registered", { sessionId, parentId });
      return;
    }
    logger.info("Child session registered", { sessionId, parentId });
  }

  function resumeFromIdlePending(sessionId: string): void {
    registry.clearTimer(sessionId);
    registry.transitionTo(sessionId, "attached");
    logger.debug("Child session resumed from idle", { sessionId });
  }

  /**
   * Route a work signal (message activity or an active status) to the session:
   * waiting sessions get spawned, idle_pending sessions resume before the
   * grace timer fires.
   */
  async function resumeOrSpawn(sessionId: string | undefined): Promise<void> {
    if (!sessionId) {
      return;
    }
    const session = registry.get(sessionId);
    if (!session) {
      return;
    }
    if (session.state === "waiting_activity") {
      await enqueueSpawn(session);
      return;
    }
    if (session.state === "idle_pending") {
      resumeFromIdlePending(sessionId);
    }
  }

  async function handleActivity(event: Event): Promise<void> {
    if (!MEANINGFUL_ACTIVITY_EVENTS.has(event.type)) {
      return;
    }
    await resumeOrSpawn(resolveSessionId(event));
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
    // Unknown status values are ignored on purpose; only clearly active
    // statuses prove the child started working.
    if (!isActiveStatus(parsed.data.status)) {
      return;
    }
    await resumeOrSpawn(sessionId);
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
   * pane with bounded retries. `closing -> closed` on success,
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
    const childPaneId = session.paneId;
    if (childPaneId === undefined || childPaneId === paneId) {
      // Nothing to clean up, or the only known pane is the caller pane itself.
      registry.transitionTo(sessionId, "closed");
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
    // Only attached sessions go idle. The transition doubles as the
    // idempotency gate, so duplicate idle events never arm a second timer.
    if (!session || session.state !== "attached") {
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
      return;
    }
    // Cancel a pending idle-close timer, if any.
    registry.clearTimer(sessionId);
    // A rejected transition means the session is already closing/closed or
    // terminal, which keeps duplicate delete events idempotent.
    if (!registry.transitionTo(sessionId, "closing")) {
      return;
    }
    await enqueueClose(session);
  }

  async function handleEvent(event: Event): Promise<void> {
    switch (event.type) {
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
      // Cancel idle timers without force-closing attached panes, then reject
      // any newly queued pane work.
      registry.clearAllTimers();
      queue.dispose();
    },
  };
}
