import { createAttachLauncher } from "../src/attach-launcher.js";
import { createChildSessionRegistry } from "../src/child-session-registry.js";
import type { ChildSessionRegistry } from "../src/child-session.js";
import { parseConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { createChildOwnershipResolver } from "../src/ownership-resolver.js";
import { createPaneOrchestrator } from "../src/pane-orchestrator.js";
import { createRootSessionResolver } from "../src/root-session-resolver.js";
import type { HerdrClient } from "../src/types.js";
import type { NormalizedPaneEvent } from "../src/v2-events.js";

export interface PluginHarness {
  readonly registry: ChildSessionRegistry;
  readonly hooks: {
    event?: (input: { event: unknown }) => Promise<void>;
    dispose?: () => Promise<void>;
  };
}

interface HarnessOptions {
  readonly herdrClient?: HerdrClient;
}

/**
 * V2 tests keep exercising the already-implemented pane state machine with
 * normalized event fixtures. This is test-only wiring, NOT a V1 plugin export.
 */
export async function createTestPluginHooks(options: HarnessOptions = {}): Promise<PluginHarness> {
  const registry = createChildSessionRegistry();
  const herdrClient: HerdrClient =
    options.herdrClient ??
    ({
      getPane: () => Promise.resolve(null),
      getPaneLayout: () => Promise.resolve(null),
      splitPane: () => Promise.resolve(null),
      resizePane: () => Promise.resolve(false),
      runInPane: () => Promise.resolve(false),
      closePane: () => Promise.resolve(false),
    } as HerdrClient);
  const paneId = process.env.HERDR_PANE_ID ?? "pane-1";
  const logger = createLogger(false, () => {});
  const ownershipResolver = createChildOwnershipResolver({
    rootSessionResolver: createRootSessionResolver({ paneId, herdrClient }),
    registry,
  });
  const orchestrator = createPaneOrchestrator({
    paneId,
    serverUrl: new URL("http://localhost:3000"),
    directory: process.cwd(),
    config: parseConfig(),
    herdrClient,
    ownershipResolver,
    registry,
    attachLauncher: createAttachLauncher({ herdrClient, logger }),
    logger,
  });
  return {
    registry,
    hooks: {
      event: async ({ event }) => orchestrator.handleEvent(event as NormalizedPaneEvent),
      dispose: async () => orchestrator.dispose(),
    },
  };
}
