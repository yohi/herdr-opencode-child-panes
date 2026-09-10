import type { Plugin } from "@opencode-ai/plugin";
import { createChildSessionRegistry } from "./child-session-registry.js";
import type { ChildSessionRegistry } from "./child-session.js";
import { parseConfig } from "./config.js";
import { resolveSessionId } from "./event-resolver.js";
import { createHerdrClient } from "./herdr-client.js";
import { createLogger } from "./logger.js";
import { createChildOwnershipResolver } from "./ownership-resolver.js";
import { createRootSessionResolver } from "./root-session-resolver.js";
import { sessionCreatedPropertiesSchema, sessionStatusPropertiesSchema } from "./schemas.js";
import type { HerdrClient, RuntimePrerequisites } from "./types.js";

export type { HerdrChildPanesConfig, Direction, RuntimePrerequisites } from "./types.js";
export type { PaneInfo, PaneLayout, SplitPaneInput, HerdrClient } from "./types.js";
export { parseConfig, DEFAULT_CONFIG } from "./config.js";
export { createLogger } from "./logger.js";
export { createHerdrClient } from "./herdr-client.js";
export type { CreateHerdrClientOptions } from "./herdr-client.js";
export { createRootSessionResolver } from "./root-session-resolver.js";
export type {
  CreateRootSessionResolverOptions,
  ResolvedRootSession,
  RootSessionResolver,
} from "./root-session-resolver.js";

export type { ChildSession, ChildSessionRegistry, ChildSessionState } from "./child-session.js";
export { createChildSessionRegistry } from "./child-session-registry.js";
export { createChildOwnershipResolver } from "./ownership-resolver.js";
export type {
  ChildOwnershipResolver,
  CreateChildOwnershipResolverOptions,
} from "./ownership-resolver.js";
export { resolveSessionId } from "./event-resolver.js";
export type { ResolvedSessionId } from "./event-resolver.js";

function checkPrerequisites(serverUrl: URL | undefined): RuntimePrerequisites {
  const herdrEnv = Boolean(process.env.HERDR_ENV);
  const herdrPaneId = process.env.HERDR_PANE_ID;
  const rawToggle = process.env.HERDR_CHILD_PANES;
  const notExplicitlyDisabled =
    rawToggle === undefined || rawToggle.trim().toLowerCase() !== "false";

  return {
    herdrEnv,
    herdrPaneId: herdrPaneId && herdrPaneId.trim().length > 0 ? herdrPaneId : undefined,
    serverUrl: serverUrl instanceof URL ? serverUrl : undefined,
    notExplicitlyDisabled,
  };
}

function prerequisitesMet(prereqs: RuntimePrerequisites): boolean {
  return Boolean(
    prereqs.herdrEnv && prereqs.herdrPaneId && prereqs.serverUrl && prereqs.notExplicitlyDisabled,
  );
}

const ACTIVITY_EVENT_TYPES = new Set([
  "message.updated",
  "message.part.updated",
  "message.part.delta",
]);
const ACTIVE_STATUS_TYPES = new Set(["active", "working", "busy", "running", "streaming"]);

function isActiveStatus(status: unknown): boolean {
  if (typeof status !== "object" || status === null) {
    return false;
  }
  return (
    "type" in status && typeof status.type === "string" && ACTIVE_STATUS_TYPES.has(status.type)
  );
}

export interface PluginDependencies {
  readonly registry?: ChildSessionRegistry;
  readonly herdrClient?: HerdrClient;
}

export const herdrChildPanesPlugin: Plugin = async (
  { serverUrl },
  options?: PluginDependencies,
) => {
  const config = parseConfig();
  const logger = createLogger(config.debug);
  const prereqs = checkPrerequisites(serverUrl);

  if (!config.enabled || !prerequisitesMet(prereqs)) {
    logger.debug("Plugin disabled: runtime prerequisites not satisfied", {
      config,
      prereqs,
    });
    return {};
  }

  logger.info("Herdr child panes plugin active", {
    paneId: prereqs.herdrPaneId,
    serverUrl: prereqs.serverUrl?.origin,
  });

  const paneId = prereqs.herdrPaneId;
  if (!paneId) {
    logger.debug("Plugin disabled: missing pane id at wiring", {});
    return {};
  }
  const herdrClient: HerdrClient = options?.herdrClient ?? createHerdrClient();
  const registry: ChildSessionRegistry = options?.registry ?? createChildSessionRegistry();
  const rootSessionResolver = createRootSessionResolver({
    paneId,
    herdrClient,
  });
  const ownershipResolver = createChildOwnershipResolver({ rootSessionResolver, registry });

  return {
    event: async ({ event }) => {
      const eventType: string = event.type;
      if (eventType === "session.created") {
        const sessionId = resolveSessionId(event);
        if (!sessionId) return;

        const parsed = sessionCreatedPropertiesSchema.safeParse(event.properties);
        if (!parsed.success || !parsed.data.info.parentID) return;

        const parentId = parsed.data.info.parentID;
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
        return;
      }

      const sessionId = resolveSessionId(event);
      if (!sessionId || !registry.has(sessionId)) return;

      if (eventType === "session.status") {
        const parsed = sessionStatusPropertiesSchema.safeParse(event.properties);
        if (parsed.success && isActiveStatus(parsed.data.status)) {
          const session = registry.get(sessionId);
          if (session?.state === "waiting_activity") {
            registry.transitionTo(sessionId, "spawning");
          } else if (session?.state === "idle_pending") {
            registry.transitionTo(sessionId, "attached");
          }
        }
        return;
      }

      if (ACTIVITY_EVENT_TYPES.has(eventType)) {
        const session = registry.get(sessionId);
        if (session?.state === "waiting_activity") {
          registry.transitionTo(sessionId, "spawning");
        } else if (session?.state === "idle_pending") {
          registry.transitionTo(sessionId, "attached");
        }
        return;
      }

      if (eventType === "session.idle") {
        registry.transitionTo(sessionId, "idle_pending");
        return;
      }

      if (eventType === "session.deleted" && registry.transitionTo(sessionId, "closing")) {
        if (registry.get(sessionId)?.paneId === undefined) {
          registry.transitionTo(sessionId, "closed");
        }
      }
    },
  };
};

export default herdrChildPanesPlugin;
