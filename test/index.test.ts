import { describe, expect, it, vi } from "vitest";
import herdrChildPanesPlugin, { herdrChildPanesPlugin as namedPlugin } from "../src/index.js";
import type { HerdrClient } from "../src/types.js";
import { createTestPluginHooks } from "../test-support/plugin-harness.js";

function eventWith<T>(type: string, properties: T): { type: string; properties: T } {
  return { type, properties };
}

function enablePlugin(): () => void {
  const originalHerdrEnv = process.env.HERDR_ENV;
  const originalHerdrPaneId = process.env.HERDR_PANE_ID;
  const originalToggle = process.env.HERDR_CHILD_PANES;

  process.env.HERDR_ENV = "1";
  process.env.HERDR_PANE_ID = "pane-1";
  process.env.HERDR_CHILD_PANES = "true";

  return () => {
    process.env.HERDR_ENV = originalHerdrEnv;
    process.env.HERDR_PANE_ID = originalHerdrPaneId;
    process.env.HERDR_CHILD_PANES = originalToggle;
  };
}

describe("herdrChildPanesPlugin", () => {
  it("exports the plugin as the default and as a named export", () => {
    expect(namedPlugin).toBe(herdrChildPanesPlugin);
  });

  it("returns empty hooks when runtime prerequisites are not satisfied", async () => {
    const originalHerdrEnv = process.env.HERDR_ENV;
    const originalHerdrPaneId = process.env.HERDR_PANE_ID;
    const originalToggle = process.env.HERDR_CHILD_PANES;

    try {
      process.env.HERDR_ENV = undefined;
      process.env.HERDR_PANE_ID = undefined;
      process.env.HERDR_CHILD_PANES = "false";

      const hooks = await herdrChildPanesPlugin({
        serverUrl: undefined,
      } as Parameters<typeof herdrChildPanesPlugin>[0]);

      expect(hooks).toEqual({});
    } finally {
      process.env.HERDR_ENV = originalHerdrEnv;
      process.env.HERDR_PANE_ID = originalHerdrPaneId;
      process.env.HERDR_CHILD_PANES = originalToggle;
    }
  });

  it("logs only the server URL origin when the plugin activates", async () => {
    const originalHerdrEnv = process.env.HERDR_ENV;
    const originalHerdrPaneId = process.env.HERDR_PANE_ID;
    const originalToggle = process.env.HERDR_CHILD_PANES;
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      process.env.HERDR_ENV = "1";
      process.env.HERDR_PANE_ID = "pane-1";
      process.env.HERDR_CHILD_PANES = "true";

      await herdrChildPanesPlugin({
        serverUrl: new URL("https://user:secret@example.test:8443/opencode?token=secret#fragment"),
      } as Parameters<typeof herdrChildPanesPlugin>[0]);

      expect(infoSpy).toHaveBeenCalledWith("[herdr-child-panes] Herdr child panes plugin active", {
        paneId: "pane-1",
        serverUrl: "https://example.test:8443",
      });
    } finally {
      infoSpy.mockRestore();
      process.env.HERDR_ENV = originalHerdrEnv;
      process.env.HERDR_PANE_ID = originalHerdrPaneId;
      process.env.HERDR_CHILD_PANES = originalToggle;
    }
  });

  it("ignores session.created events without properties", async () => {
    const originalHerdrEnv = process.env.HERDR_ENV;
    const originalHerdrPaneId = process.env.HERDR_PANE_ID;
    const originalToggle = process.env.HERDR_CHILD_PANES;

    try {
      process.env.HERDR_ENV = "1";
      process.env.HERDR_PANE_ID = "pane-1";
      process.env.HERDR_CHILD_PANES = "true";

      const hooks = await herdrChildPanesPlugin({
        serverUrl: new URL("http://localhost:3000"),
      } as Parameters<typeof herdrChildPanesPlugin>[0]);
      const malformedEvent = {
        type: "session.created",
        properties: undefined,
      } as unknown as Parameters<NonNullable<typeof hooks.event>>[0]["event"];

      await expect(hooks.event?.({ event: malformedEvent })).resolves.toBeUndefined();
    } finally {
      process.env.HERDR_ENV = originalHerdrEnv;
      process.env.HERDR_PANE_ID = originalHerdrPaneId;
      process.env.HERDR_CHILD_PANES = originalToggle;
    }
  });

  it("registers an owned direct child session created under the root", async () => {
    const originalHerdrEnv = process.env.HERDR_ENV;
    const originalHerdrPaneId = process.env.HERDR_PANE_ID;
    const originalToggle = process.env.HERDR_CHILD_PANES;

    try {
      process.env.HERDR_ENV = "1";
      process.env.HERDR_PANE_ID = "pane-1";
      process.env.HERDR_CHILD_PANES = "true";

      const getPane = vi.fn<HerdrClient["getPane"]>().mockResolvedValue({
        id: "pane-1",
        agent_session: { agent: "opencode", session_id: "ses_root123" },
      });
      const client = { getPane } as unknown as HerdrClient;
      const harness = await createTestPluginHooks({ herdrClient: client });

      const event = {
        type: "session.created",
        properties: { info: { id: "ses_child1", parentID: "ses_root123" } },
      } as unknown as Parameters<NonNullable<typeof hooks.event>>[0]["event"];

      await harness.hooks.event?.({ event });

      expect(harness.registry.get("ses_child1")).toEqual({
        sessionId: "ses_child1",
        parentId: "ses_root123",
        state: "waiting_activity",
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      });
    } finally {
      process.env.HERDR_ENV = originalHerdrEnv;
      process.env.HERDR_PANE_ID = originalHerdrPaneId;
      process.env.HERDR_CHILD_PANES = originalToggle;
    }
  });

  it("transitions a registered child to spawning on active session.status", async () => {
    const restoreEnvironment = enablePlugin();

    try {
      const harness = await createTestPluginHooks();
      harness.registry.register("ses_child1", "ses_root123");

      await harness.hooks.event?.({
        event: eventWith("session.status", {
          sessionID: "ses_child1",
          status: { type: "busy" },
        }),
      });

      expect(harness.registry.get("ses_child1")?.state).toBe("spawning");
    } finally {
      restoreEnvironment();
    }
  });

  it("transitions an attached child to idle_pending on session.idle", async () => {
    const restoreEnvironment = enablePlugin();

    try {
      const harness = await createTestPluginHooks();
      harness.registry.register("ses_child1", "ses_root123");
      harness.registry.transitionTo("ses_child1", "spawning");
      harness.registry.transitionTo("ses_child1", "attached");

      await harness.hooks.event?.({
        event: eventWith("session.idle", { sessionID: "ses_child1" }),
      });

      expect(harness.registry.get("ses_child1")?.state).toBe("idle_pending");
    } finally {
      restoreEnvironment();
    }
  });

  it("closes a registered child without an attached pane on session.deleted", async () => {
    const restoreEnvironment = enablePlugin();

    try {
      const harness = await createTestPluginHooks();
      harness.registry.register("ses_child1", "ses_root123");

      await harness.hooks.event?.({
        event: eventWith("session.deleted", { info: { id: "ses_child1" } }),
      });

      expect(harness.registry.get("ses_child1")?.state).toBe("closed");
    } finally {
      restoreEnvironment();
    }
  });
});
