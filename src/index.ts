import type { Plugin } from "@opencode-ai/plugin";
import { parseConfig } from "./config.js";
import { createLogger } from "./logger.js";
import type { RuntimePrerequisites } from "./types.js";

export type { HerdrChildPanesConfig, Direction, RuntimePrerequisites } from "./types.js";
export type { PaneInfo, PaneLayout, SplitPaneInput, HerdrClient } from "./types.js";
export { parseConfig, DEFAULT_CONFIG } from "./config.js";
export { createLogger } from "./logger.js";
export { createHerdrClient } from "./herdr-client.js";
export type { CreateHerdrClientOptions } from "./herdr-client.js";

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

export const herdrChildPanesPlugin: Plugin = async ({ serverUrl }) => {
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
    serverUrl: prereqs.serverUrl?.toString(),
  });

  return {
    event: async ({ event }) => {
      if (event.type !== "session.created") return;

      const session = event.properties?.info;
      if (!session?.parentID) return;

      logger.debug("Child session created", {
        sessionID: session.id,
        parentID: session.parentID,
      });

      // Pane creation will be implemented in a future iteration.
    },
  };
};

export default herdrChildPanesPlugin;
