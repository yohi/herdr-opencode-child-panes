import type { Event } from "@opencode-ai/sdk";
import type { AttachLauncher } from "./attach-launcher.js";
import type { ChildSession, ChildSessionRegistry } from "./child-session.js";
import { resolvePaneLayoutDirection } from "./direction-policy.js";
import { resolveSessionId } from "./event-resolver.js";
import type { Logger } from "./logger.js";
import type { ChildOwnershipResolver } from "./ownership-resolver.js";
import { sessionCreatedPropertiesSchema, sessionStatusPropertiesSchema } from "./schemas.js";
import type { HerdrChildPanesConfig, HerdrClient } from "./types.js";

const MEANINGFUL_ACTIVITY_EVENTS = new Set<string>([
  "message.updated",
  "message.part.updated",
  "message.part.delta",
]);
const ACTIVE_STATUS_TYPES = new Set<string>(["active", "working", "busy", "running", "streaming"]);

/**
 * Drives the child pane lifecycle from OpenCode events: registers owned child
 * sessions, splits the caller pane on the first meaningful activity, attaches
 * the child session into the new pane, and closes panes when sessions die.
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
  /** Clock source; wired into PR3 idle timers. */
  readonly now?: () => number;
  /** Timer creation; wired into PR3 idle timers. */
  readonly setTimeout?: typeof globalThis.setTimeout;
  /** Timer cancellation; wired into PR3 idle timers. */
  readonly clearTimeout?: typeof globalThis.clearTimeout;
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
  const spawnReservations = new Set<string>();

  function fail(sessionId: string, reason: string): void {
    registry.setFailureReason(sessionId, reason);
    registry.transitionTo(sessionId, "failed");
    logger.warn("Child pane lifecycle failure", { sessionId, reason });
  }

  function reserveSpawn(sessionId: string): boolean {
    if (spawnReservations.has(sessionId)) {
      return true;
    }
    const paneCount = registry
      .listActive()
      .filter((session) => session.paneId !== undefined).length;
    if (paneCount + spawnReservations.size >= config.maxPanes) {
      registry.setFailureReason(sessionId, "capacity_limit");
      registry.transitionTo(sessionId, "ignored");
      logger.warn("Child pane capacity reached", { sessionId });
      return false;
    }
    spawnReservations.add(sessionId);
    return true;
  }

  async function closeSpawnedPane(sessionId: string, childPaneId: string): Promise<void> {
    registry.setPaneId(sessionId, childPaneId);
    const closed = await herdrClient.closePane(childPaneId);
    if (closed) {
      registry.transitionTo(sessionId, "closed");
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
   * The `spawning` transition happens synchronously before any `await`, so a
   * second activity event racing the split observes `spawning` and skips.
   */
  async function spawnChild(session: ChildSession): Promise<void> {
    if (!reserveSpawn(session.sessionId)) {
      return;
    }

    try {
      const transitioned = registry.transitionTo(session.sessionId, "spawning");
      if (!transitioned) {
        return;
      }

      const layout = config.direction === "auto" ? await herdrClient.getPaneLayout(paneId) : null;
      const direction = resolvePaneLayoutDirection({ direction: config.direction, layout });
      const environment = attachLauncher.environment;
      const newPaneId = await herdrClient.splitPane({
        paneId,
        direction,
        noFocus: true,
        ...(environment !== undefined && Object.keys(environment).length > 0
          ? { env: environment }
          : {}),
      });
      if (newPaneId === null) {
        fail(session.sessionId, "split_failed");
        return;
      }

      if (registry.get(session.sessionId)?.state === "closing") {
        await closeSpawnedPane(session.sessionId, newPaneId);
        return;
      }

      const attached = await attachLauncher.attach({
        paneId: newPaneId,
        sessionId: session.sessionId,
        serverUrl,
        directory,
      });
      if (!attached) {
        // Only the freshly created pane may be rolled back; the child session
        // itself is never touched.
        await herdrClient.closePane(newPaneId);
        fail(session.sessionId, "attach_failed");
        return;
      }

      if (registry.get(session.sessionId)?.state === "closing") {
        await closeSpawnedPane(session.sessionId, newPaneId);
        return;
      }

      registry.setPaneId(session.sessionId, newPaneId);
      registry.transitionTo(session.sessionId, "attached");
      logger.info("Child pane attached", { sessionId: session.sessionId, paneId: newPaneId });
    } finally {
      spawnReservations.delete(session.sessionId);
    }
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

  async function spawnIfWaiting(sessionId: string | undefined): Promise<void> {
    if (!sessionId) {
      return;
    }
    const session = registry.get(sessionId);
    if (session?.state !== "waiting_activity") {
      return;
    }
    await spawnChild(session);
  }

  async function handleActivity(event: Event): Promise<void> {
    if (!MEANINGFUL_ACTIVITY_EVENTS.has(event.type)) {
      return;
    }
    await spawnIfWaiting(resolveSessionId(event));
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
    await spawnIfWaiting(sessionId);
  }

  async function handleSessionIdle(event: Event): Promise<void> {
    const sessionId = resolveSessionId(event);
    if (!sessionId) {
      return;
    }
    const session = registry.get(sessionId);
    // Only attached sessions go idle; duplicate idles are no-ops. Timer
    // scheduling for the grace period lands in PR3.
    if (session?.state !== "attached") {
      return;
    }
    registry.transitionTo(sessionId, "idle_pending");
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
    const wasSpawning = session.state === "spawning";
    // A rejected transition means the session is already closing/closed or
    // terminal, which keeps duplicate delete events idempotent.
    if (!registry.transitionTo(sessionId, "closing")) {
      return;
    }

    const childPaneId = session.paneId;
    if (childPaneId === undefined || childPaneId === paneId) {
      // A spawning session has not reported its newly created pane yet. Leave
      // it closing so spawnChild can close that pane after split completes.
      if (!wasSpawning) {
        // Nothing to clean up, or the only known pane is the caller pane itself.
        registry.transitionTo(sessionId, "closed");
      }
      return;
    }

    const closed = await herdrClient.closePane(childPaneId);
    if (closed) {
      registry.transitionTo(sessionId, "closed");
      logger.info("Child pane closed", { sessionId, paneId: childPaneId });
      return;
    }
    fail(sessionId, "close_failed");
  }

  async function handleEvent(event: Event): Promise<void> {
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
      // Idle-timer teardown lands in PR3; nothing to release yet.
    },
  };
}
