import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChildSessionRegistry } from "../src/child-session-registry.js";
import plugin, { setupV2 } from "../src/index.js";
import type { HerdrClient } from "../src/types.js";
import type { V2Event } from "../src/v2-events.js";
import type { V2PluginContext } from "../src/v2-plugin.js";

const directory = "/project";
const URL_VALUE = "http://localhost:4096";

function context(events: V2Event[], serverUrl?: unknown, subscribeSpy = vi.fn()) {
  const ctx: V2PluginContext = {
    location: { directory },
    options: serverUrl === undefined ? {} : { serverUrl },
    event: {
      subscribe: (options) => {
        subscribeSpy(options);
        return {
          async *[Symbol.asyncIterator]() {
            for (const event of events) {
              if (options?.signal?.aborted) return;
              yield event;
            }
            if (options?.signal?.aborted) return;
            await new Promise<void>((resolve) => {
              options?.signal?.addEventListener("abort", () => resolve(), { once: true });
            });
          },
        };
      },
    },
  };
  return { ctx, subscribeSpy };
}

describe("V2 dedicated plugin setup", () => {
  beforeEach(() => {
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "pane-root";
    Reflect.deleteProperty(process.env, "HERDR_CHILD_PANES");
    Reflect.deleteProperty(process.env, "HERDR_CHILD_PANES_SERVER_URL");
  });
  afterEach(() => {
    Reflect.deleteProperty(process.env, "HERDR_ENV");
    Reflect.deleteProperty(process.env, "HERDR_PANE_ID");
    Reflect.deleteProperty(process.env, "HERDR_CHILD_PANES");
    Reflect.deleteProperty(process.env, "HERDR_CHILD_PANES_SERVER_URL");
    vi.restoreAllMocks();
  });

  it("exports only a V2 setup function to the host", () => {
    expect(plugin).toEqual({ id: "herdr-opencode-child-panes", setup: setupV2 });
    expect(plugin).not.toHaveProperty("server");
  });

  it("does not subscribe without Herdr prerequisites", async () => {
    Reflect.deleteProperty(process.env, "HERDR_ENV");
    const { ctx, subscribeSpy } = context([], URL_VALUE);
    const cleanup = await setupV2(ctx);
    expect(subscribeSpy).not.toHaveBeenCalled();
    await cleanup();
  });

  it("fails closed and warns exactly once when URL is missing/invalid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = context([]);
    await (await setupV2(a.ctx))();
    expect(a.subscribeSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const b = context([], "file:///tmp/forbidden");
    await (await setupV2(b.ctx))();
    expect(b.subscribeSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("forbidden");
  });

  it("uses explicit server URL over environment, and consumes owned child events", async () => {
    process.env.HERDR_CHILD_PANES_SERVER_URL = "http://wrong.invalid:9001";
    const registry = createChildSessionRegistry();
    const commands: string[] = [];
    const client: HerdrClient = {
      getPane: vi.fn().mockImplementation(async (id: string) => ({
        pane_id: id,
        agent_session: { agent: "opencode", value: id === "pane-root" ? "ses_root" : "ses_child" },
      })),
      getPaneLayout: vi.fn().mockResolvedValue(null),
      splitPane: vi.fn().mockResolvedValue("pane-child"),
      resizePane: vi.fn().mockResolvedValue(true),
      runInPane: vi.fn().mockImplementation(async (_id: string, command: string) => {
        commands.push(command);
        return true;
      }),
      closePane: vi.fn().mockResolvedValue(true),
    };
    const { ctx, subscribeSpy } = context(
      [
        {
          type: "session.created",
          data: { sessionID: "ses_child", parentID: "ses_root", location: { directory } },
        },
        { type: "session.execution.started", data: { sessionID: "ses_child" } },
        { type: "session.status", data: { sessionID: "ses_child", status: { type: "idle" } } },
      ],
      URL_VALUE,
    );
    const cleanup = await setupV2(ctx, { registry, herdrClient: client });
    await vi.waitFor(() => expect(commands.length).toBe(1));
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(commands[0]).toContain("--server 'http://localhost:4096/'");
    expect(commands[0]).not.toContain("wrong.invalid");
    expect(registry.get("ses_child")?.state).toBe("idle_pending");
    await cleanup();
    await cleanup();
  });

  it("falls back to the configured environment server URL", async () => {
    process.env.HERDR_CHILD_PANES_SERVER_URL = URL_VALUE;
    const { ctx, subscribeSpy } = context([]);
    const cleanup = await setupV2(ctx);
    expect(subscribeSpy).toHaveBeenCalledOnce();
    await cleanup();
  });
});
