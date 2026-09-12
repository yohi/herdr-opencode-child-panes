import type { Plugin } from "@opencode-ai/plugin";
import { createAttachLauncher } from "./attach-launcher.js";
import { createChildSessionRegistry } from "./child-session-registry.js";
import type { ChildSessionRegistry } from "./child-session.js";
import { parseConfig } from "./config.js";
import { createHerdrClient } from "./herdr-client.js";
import { createLogger } from "./logger.js";
import { createChildOwnershipResolver } from "./ownership-resolver.js";
import { createPaneOrchestrator } from "./pane-orchestrator.js";
import type { PaneOrchestrator } from "./pane-orchestrator.js";
import { createRootSessionResolver } from "./root-session-resolver.js";
import type { HerdrClient, RuntimePrerequisites } from "./types.js";

export type { HerdrChildPanesConfig, Direction, RuntimePrerequisites } from "./types.js";
export type { PaneInfo, PaneLayout, SplitPaneInput, HerdrClient } from "./types.js";
export { parseConfig, DEFAULT_CONFIG } from "./config.js";
export { createLogger } from "./logger.js";
export { createAsyncQueue } from "./async-queue.js";
export type { AsyncQueue } from "./async-queue.js";
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

function loggablePrerequisites(prereqs: RuntimePrerequisites) {
  return {
    ...prereqs,
    serverUrl: prereqs.serverUrl?.origin,
  };
}

export interface PluginDependencies {
  readonly registry?: ChildSessionRegistry;
  readonly herdrClient?: HerdrClient;
}

export const herdrChildPanesPlugin: Plugin = async (
  { client, serverUrl, directory },
  options?: PluginDependencies,
) => {
  const config = parseConfig();
  const logger = createLogger(config.debug, async (entry) => {
    await client.app.log({ body: entry });
  });
  const prereqs = checkPrerequisites(serverUrl);

  if (!config.enabled || !prerequisitesMet(prereqs)) {
    logger.debug("Plugin disabled: runtime prerequisites not satisfied", {
      config,
      prereqs: loggablePrerequisites(prereqs),
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
  const attachLauncher = createAttachLauncher({ herdrClient, logger });
  const paneOrchestrator: PaneOrchestrator = createPaneOrchestrator({
    paneId,
    serverUrl,
    directory,
    config,
    herdrClient,
    ownershipResolver,
    registry,
    attachLauncher,
    logger,
  });

  return {
    event: async ({ event }) => {
      await paneOrchestrator.handleEvent(event);
    },
    dispose: async () => {
      await paneOrchestrator.dispose();
    },
  };
};

export default {
  id: "herdr-opencode-child-panes",
  server: herdrChildPanesPlugin,
};
