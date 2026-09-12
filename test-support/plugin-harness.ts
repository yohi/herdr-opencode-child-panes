import { createChildSessionRegistry } from "../src/child-session-registry.js";
import type { ChildSessionRegistry } from "../src/child-session.js";
import { herdrChildPanesPlugin } from "../src/index.js";
import type { HerdrClient } from "../src/types.js";

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

  const hooks = await herdrChildPanesPlugin(
    {
      client: {
        app: {
          log: () => Promise.resolve({ data: true }),
        },
      },
      serverUrl: new URL("http://localhost:3000"),
      directory: process.cwd(),
    } as never,
    { registry, herdrClient },
  );

  return { registry, hooks: hooks as unknown as PluginHarness["hooks"] };
}
