import { setupV2 } from "./v2-plugin.js";

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

export { setupV2 } from "./v2-plugin.js";

// The 2.x package exposes only the V2 setup entrypoint to the host.
export default {
  id: "herdr-opencode-child-panes",
  setup: setupV2,
};
