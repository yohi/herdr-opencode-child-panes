import { createAttachLauncher } from "./attach-launcher.js";
import { createChildSessionRegistry } from "./child-session-registry.js";
import type { ChildSessionRegistry } from "./child-session.js";
import { parseConfig } from "./config.js";
import { createHerdrClient } from "./herdr-client.js";
import { createLogger } from "./logger.js";
import { createChildOwnershipResolver } from "./ownership-resolver.js";
import { createPaneOrchestrator } from "./pane-orchestrator.js";
import { createRootSessionResolver } from "./root-session-resolver.js";
import type { HerdrClient } from "./types.js";
import { normalizeV2Event } from "./v2-events.js";
import type { V2Event } from "./v2-events.js";

/**
 * Structural subset of the public @opencode/plugin@2.1.4 Promise API.
 * No runtime import of the plugin package is needed: Plugin.define is identity.
 * See pinned source: packages/plugin/src/promise/{plugin,event}.ts.
 */
export interface V2PluginContext {
  readonly location: { readonly directory: string };
  readonly options: Readonly<Record<string, unknown>>;
  readonly event: {
    subscribe(options?: { readonly signal?: AbortSignal }): AsyncIterable<V2Event>;
  };
}

export interface V2PluginDependencies {
  readonly registry?: ChildSessionRegistry;
  readonly herdrClient?: HerdrClient;
}

function configuredServerUrl(ctx: V2PluginContext): URL | undefined {
  const raw =
    ctx.options.serverUrl === undefined
      ? process.env.HERDR_CHILD_PANES_SERVER_URL
      : ctx.options.serverUrl;
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/**
 * V2-only plugin entrypoint; V1 remains on the support/v1.x branch.
 * Subscriptions, timers and Herdr mutations are owned by this setup lifetime.
 */
export async function setupV2(
  ctx: V2PluginContext,
  deps: V2PluginDependencies = {},
): Promise<() => Promise<void>> {
  const config = parseConfig();
  const paneId = process.env.HERDR_PANE_ID?.trim();
  if (!process.env.HERDR_ENV || !paneId || !config.enabled) return async () => {};

  const serverUrl = configuredServerUrl(ctx);
  if (!serverUrl) {
    // Constant text only: never print malformed URLs, tokens or option values.
    console.warn(
      "[herdr-child-panes] V2 disabled: configure options.serverUrl or HERDR_CHILD_PANES_SERVER_URL",
    );
    return async () => {};
  }

  const logger = createLogger(config.debug);
  const herdrClient = deps.herdrClient ?? createHerdrClient();
  const registry = deps.registry ?? createChildSessionRegistry();
  const rootSessionResolver = createRootSessionResolver({
    paneId,
    herdrClient,
  });
  const ownershipResolver = createChildOwnershipResolver({ rootSessionResolver, registry });
  const orchestrator = createPaneOrchestrator({
    paneId,
    serverUrl,
    directory: ctx.location.directory,
    config,
    herdrClient,
    ownershipResolver,
    registry,
    attachLauncher: createAttachLauncher({ herdrClient, logger, mode: "v2" }),
    logger,
  });
  const controller = new AbortController();
  let disposed = false;

  const consume = (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (disposed || controller.signal.aborted) break;
        const normalized = normalizeV2Event(event, ctx.location.directory);
        if (!normalized) continue;
        try {
          await orchestrator.handleEvent(normalized);
        } catch {
          // A malformed event / Herdr failure must not crash OpenCode.
          logger.warn("V2 child-pane event handling failed");
        }
      }
    } catch {
      if (!disposed) logger.warn("V2 child-pane event subscription terminated");
    }
  })();

  return async () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    await orchestrator.dispose();
    await consume;
  };
}
