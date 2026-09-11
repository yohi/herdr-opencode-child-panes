import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pluginModule, { herdrChildPanesPlugin } from "../src/index.js";
import type { HerdrClient } from "../src/types.js";
import { createTestPluginHooks } from "../test-support/plugin-harness.js";

function asPluginEvent<T>(type: string, properties: T) {
  return { type, properties } as unknown as Parameters<
    NonNullable<Awaited<ReturnType<typeof createTestPluginHooks>>["hooks"]["event"]>
  >[0]["event"];
}

type TestPluginHarness = Awaited<ReturnType<typeof createTestPluginHooks>>;

async function emit(harness: TestPluginHarness, type: string, properties: unknown): Promise<void> {
  await harness.hooks.event?.({ event: asPluginEvent(type, properties) });
}

function createRootPaneClient(): HerdrClient {
  return {
    getPane: vi.fn<HerdrClient["getPane"]>().mockResolvedValue({
      pane_id: "pane-1",
      agent_session: { agent: "opencode", value: "ses_root123" },
    }),
    getPaneLayout: vi.fn<HerdrClient["getPaneLayout"]>().mockResolvedValue(null),
    splitPane: vi.fn<HerdrClient["splitPane"]>().mockResolvedValue(null),
    runInPane: vi.fn<HerdrClient["runInPane"]>().mockResolvedValue(false),
    closePane: vi.fn<HerdrClient["closePane"]>().mockResolvedValue(false),
  };
}

describe("herdrChildPanesPlugin", () => {
  const ENV_KEYS = [
    "HERDR_ENV",
    "HERDR_PANE_ID",
    "HERDR_CHILD_PANES",
    "HERDR_CHILD_PANES_IDLE_MS",
  ] as const;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "pane-1";
    process.env.HERDR_CHILD_PANES = "true";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("exports the server module as the default and the plugin function as a named export", () => {
    expect(pluginModule).toEqual({
      id: "herdr-opencode-child-panes",
      server: herdrChildPanesPlugin,
    });
  });

  it("returns empty hooks when runtime prerequisites are not satisfied", async () => {
    process.env.HERDR_CHILD_PANES = "false";

    const hooks = await herdrChildPanesPlugin({
      serverUrl: undefined,
    } as Parameters<typeof herdrChildPanesPlugin>[0]);

    expect(hooks).toEqual({});
  });
  it("logs only the server URL origin when the plugin activates", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      await herdrChildPanesPlugin({
        serverUrl: new URL("https://user:secret@example.test:8443/opencode?token=secret#fragment"),
      } as Parameters<typeof herdrChildPanesPlugin>[0]);

      expect(infoSpy).toHaveBeenCalledWith("[herdr-child-panes] Herdr child panes plugin active", {
        paneId: "pane-1",
        serverUrl: "https://example.test:8443",
      });
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("ignores session.created events without properties", async () => {
    const hooks = await herdrChildPanesPlugin({
      serverUrl: new URL("http://localhost:3000"),
    } as Parameters<typeof herdrChildPanesPlugin>[0]);
    const malformedEvent = {
      type: "session.created",
      properties: undefined,
    } as unknown as Parameters<NonNullable<typeof hooks.event>>[0]["event"];

    await expect(hooks.event?.({ event: malformedEvent })).resolves.toBeUndefined();
  });

  it("registers an owned direct child session created under the root", async () => {
    const harness = await createTestPluginHooks({ herdrClient: createRootPaneClient() });

    await emit(harness, "session.created", {
      info: { id: "ses_child1", parentID: "ses_root123" },
    });

    expect(harness.registry.get("ses_child1")).toEqual({
      sessionId: "ses_child1",
      parentId: "ses_root123",
      state: "waiting_activity",
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
  });

  it("provides event and dispose hooks when runtime prerequisites are met", async () => {
    // Given: the plugin runs in a configured Herdr pane.
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "pane-1";

    // When: the plugin is initialized.
    const harness = await createTestPluginHooks();

    // Then: OpenCode receives both lifecycle hooks.
    expect(harness.hooks.event).toEqual(expect.any(Function));
    expect(harness.hooks.dispose).toEqual(expect.any(Function));
  });

  it("runs the full child pane lifecycle from creation to close", async () => {
    const client = createRootPaneClient();
    vi.mocked(client.getPaneLayout).mockResolvedValue({
      paneId: "pane-1",
      width: 200,
      height: 50,
    });
    vi.mocked(client.splitPane).mockResolvedValue("pane-2");
    vi.mocked(client.runInPane).mockResolvedValue(true);
    vi.mocked(client.closePane).mockResolvedValue(true);
    const harness = await createTestPluginHooks({ herdrClient: client });

    await emit(harness, "session.created", {
      info: { id: "ses_child1", parentID: "ses_root123" },
    });
    expect(harness.registry.get("ses_child1")?.state).toBe("waiting_activity");

    await emit(harness, "message.part.updated", { part: { sessionID: "ses_child1" } });
    expect(client.splitPane).toHaveBeenCalledWith({
      paneId: "pane-1",
      direction: "right",
      noFocus: true,
    });
    expect(client.runInPane).toHaveBeenCalledTimes(1);
    expect(harness.registry.get("ses_child1")).toMatchObject({
      state: "attached",
      paneId: "pane-2",
    });

    await emit(harness, "session.idle", { sessionID: "ses_child1" });
    expect(harness.registry.get("ses_child1")?.state).toBe("idle_pending");

    await emit(harness, "session.deleted", { info: { id: "ses_child1" } });
    expect(client.closePane).toHaveBeenCalledWith("pane-2");
    expect(harness.registry.get("ses_child1")?.state).toBe("closed");
  });

  it("ignores a child session owned by another pane", async () => {
    const harness = await createTestPluginHooks({ herdrClient: createRootPaneClient() });

    await emit(harness, "session.created", {
      info: { id: "ses_other", parentID: "ses_unrelated" },
    });

    expect(harness.registry.has("ses_other")).toBe(false);
  });

  it("cancels idle cleanup on dispose without closing an attached pane", async () => {
    // Given: an attached child has entered its idle grace period.
    vi.useFakeTimers();
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "pane-1";
    process.env.HERDR_CHILD_PANES_IDLE_MS = "1";
    const getPane = vi.fn<HerdrClient["getPane"]>().mockResolvedValue({
      pane_id: "pane-1",
      agent_session: { agent: "opencode", value: "ses_root123" },
    });
    const getPaneLayout = vi.fn<HerdrClient["getPaneLayout"]>().mockResolvedValue({
      paneId: "pane-1",
      width: 200,
      height: 50,
    });
    const splitPane = vi.fn<HerdrClient["splitPane"]>().mockResolvedValue("pane-2");
    const runInPane = vi.fn<HerdrClient["runInPane"]>().mockResolvedValue(true);
    const closePane = vi.fn<HerdrClient["closePane"]>().mockResolvedValue(true);
    const client = { getPane, getPaneLayout, splitPane, runInPane, closePane } as HerdrClient;
    const harness = await createTestPluginHooks({ herdrClient: client });

    try {
      await harness.hooks.event?.({
        event: asPluginEvent("session.created", {
          info: { id: "ses_child1", parentID: "ses_root123" },
        }),
      });
      await harness.hooks.event?.({
        event: asPluginEvent("message.part.updated", { part: { sessionID: "ses_child1" } }),
      });
      await harness.hooks.event?.({
        event: asPluginEvent("session.idle", { sessionID: "ses_child1" }),
      });

      // When: OpenCode disposes the plugin before the idle grace period expires.
      await harness.hooks.dispose?.();
      await vi.advanceTimersByTimeAsync(1);

      // Then: the attached pane is preserved and its pending close cannot run.
      expect(closePane).not.toHaveBeenCalled();
      expect(harness.registry.get("ses_child1")?.state).toBe("idle_pending");
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts spawning a registered child on active session.status", async () => {
    let resolveSplit: ((paneId: string | null) => void) | undefined;
    const client = createRootPaneClient();
    vi.mocked(client.getPane)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        pane_id: "pane-2",
        agent_session: { agent: "opencode", value: "ses_child1" },
      });
    vi.mocked(client.splitPane).mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveSplit = resolve;
        }),
    );
    vi.mocked(client.runInPane).mockResolvedValue(true);
    vi.mocked(client.closePane).mockResolvedValue(true);
    const harness = await createTestPluginHooks({ herdrClient: client });
    harness.registry.register("ses_child1", "ses_root123");

    const eventPromise = harness.hooks.event?.({
      event: asPluginEvent("session.status", {
        sessionID: "ses_child1",
        status: { type: "busy" },
      }),
    });

    await vi.waitFor(() => expect(resolveSplit).toBeDefined());
    expect(harness.registry.get("ses_child1")?.state).toBe("spawning");
    resolveSplit?.("pane-2");
    await eventPromise;
    expect(harness.registry.get("ses_child1")?.state).toBe("attached");
  });

  it("transitions an attached child to idle_pending on session.idle", async () => {
    vi.useFakeTimers();

    try {
      const harness = await createTestPluginHooks();
      harness.registry.register("ses_child1", "ses_root123");
      harness.registry.transitionTo("ses_child1", "spawning");
      harness.registry.transitionTo("ses_child1", "attached");

      await emit(harness, "session.idle", { sessionID: "ses_child1" });

      expect(harness.registry.get("ses_child1")?.state).toBe("idle_pending");
      await harness.hooks.dispose?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a registered child without an attached pane on session.deleted", async () => {
    const harness = await createTestPluginHooks();
    harness.registry.register("ses_child1", "ses_root123");

    await emit(harness, "session.deleted", { info: { id: "ses_child1" } });

    expect(harness.registry.get("ses_child1")?.state).toBe("closed");
  });
});
