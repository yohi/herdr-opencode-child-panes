import type { Event } from "@opencode-ai/sdk";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachLauncher } from "../src/attach-launcher.js";
import { createChildSessionRegistry } from "../src/child-session-registry.js";
import type {
  ChildSessionRegistry,
  CreateChildSessionRegistryOptions,
} from "../src/child-session.js";
import type { ChildOwnershipResolver } from "../src/ownership-resolver.js";
import {
  type CreatePaneOrchestratorOptions,
  type PaneOrchestrator,
  createPaneOrchestrator,
} from "../src/pane-orchestrator.js";
import type { HerdrChildPanesConfig, HerdrClient } from "../src/types.js";

const SERVER_URL = new URL("http://localhost:3000");
const CALLER_PANE_ID = "pane-1";
const NEW_PANE_ID = "pane-2";
const DIRECTORY = "/tmp/project";
const CHILD_ID = "ses_child1";
const PARENT_ID = "ses_root1";

function eventWith(type: string, properties: unknown): Event {
  return { type, properties } as unknown as Event;
}

function createdEvent(sessionId: string, parentId: string): Event {
  return eventWith("session.created", { info: { id: sessionId, parentID: parentId } });
}

function activityEvent(sessionId: string): Event {
  return eventWith("message.part.updated", { part: { sessionID: sessionId } });
}

function deltaActivityEvent(sessionId: string): Event {
  return eventWith("message.part.delta", {
    sessionID: sessionId,
    messageID: "msg_delta1",
    partID: "part_delta1",
    field: "text",
    delta: "updated",
  });
}

function statusEvent(sessionId: string, statusType: string): Event {
  return eventWith("session.status", { sessionID: sessionId, status: { type: statusType } });
}

function idleEvent(sessionId: string): Event {
  return eventWith("session.idle", { sessionID: sessionId });
}

function deletedEvent(sessionId: string): Event {
  return eventWith("session.deleted", { info: { id: sessionId } });
}

interface Fixture {
  readonly orchestrator: PaneOrchestrator;
  readonly registry: ChildSessionRegistry;
  readonly getPaneLayout: Mock<HerdrClient["getPaneLayout"]>;
  readonly splitPane: Mock<HerdrClient["splitPane"]>;
  readonly closePane: Mock<HerdrClient["closePane"]>;
  readonly attach: Mock<AttachLauncher["attach"]>;
  readonly isOwnedChild: Mock<ChildOwnershipResolver["isOwnedChild"]>;
}

interface FixtureOptions {
  readonly registry?: CreateChildSessionRegistryOptions;
  readonly attachEnvironment?: Readonly<Record<string, string>>;
}

function createFixture(
  configOverrides: Partial<HerdrChildPanesConfig> = {},
  fixtureOptions: FixtureOptions = {},
): Fixture {
  const config: HerdrChildPanesConfig = {
    enabled: true,
    idleGraceMs: 1000,
    maxPanes: 4,
    direction: "auto",
    closeRetries: 3,
    debug: false,
    ...configOverrides,
  };
  const registry = createChildSessionRegistry(fixtureOptions.registry);
  const herdrClient: HerdrClient = {
    getPane: vi.fn<HerdrClient["getPane"]>().mockResolvedValue(null),
    getPaneLayout: vi.fn<HerdrClient["getPaneLayout"]>().mockResolvedValue({
      paneId: CALLER_PANE_ID,
      width: 200,
      height: 50,
    }),
    splitPane: vi.fn<HerdrClient["splitPane"]>().mockResolvedValue(NEW_PANE_ID),
    runInPane: vi.fn<HerdrClient["runInPane"]>().mockResolvedValue(true),
    closePane: vi.fn<HerdrClient["closePane"]>().mockResolvedValue(true),
  };
  const ownershipResolver: ChildOwnershipResolver = {
    isOwnedChild: vi.fn<ChildOwnershipResolver["isOwnedChild"]>().mockResolvedValue(true),
    isTrackedDescendant: vi
      .fn<ChildOwnershipResolver["isTrackedDescendant"]>()
      .mockReturnValue(false),
  };
  const attachLauncher = {
    attach: vi.fn<AttachLauncher["attach"]>().mockResolvedValue(true),
    environment: fixtureOptions.attachEnvironment ?? {},
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const orchestratorOptions: CreatePaneOrchestratorOptions = {
    paneId: CALLER_PANE_ID,
    serverUrl: SERVER_URL,
    directory: DIRECTORY,
    config,
    herdrClient,
    ownershipResolver,
    registry,
    attachLauncher,
    logger,
  };

  return {
    orchestrator: createPaneOrchestrator(orchestratorOptions),
    registry,
    getPaneLayout: herdrClient.getPaneLayout as Mock<HerdrClient["getPaneLayout"]>,
    splitPane: herdrClient.splitPane as Mock<HerdrClient["splitPane"]>,
    closePane: herdrClient.closePane as Mock<HerdrClient["closePane"]>,
    attach: attachLauncher.attach as Mock<AttachLauncher["attach"]>,
    isOwnedChild: ownershipResolver.isOwnedChild as Mock<ChildOwnershipResolver["isOwnedChild"]>,
  };
}

async function registerOwnedChild(fixture: Fixture): Promise<void> {
  await fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, PARENT_ID));
}

async function attachChild(fixture: Fixture): Promise<void> {
  await registerOwnedChild(fixture);
  await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
}

describe("createPaneOrchestrator", () => {
  it("keeps a created-only session waiting without splitting", async () => {
    const fixture = createFixture();

    await fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, PARENT_ID));

    expect(fixture.registry.get(CHILD_ID)?.state).toBe("waiting_activity");
    expect(fixture.splitPane).not.toHaveBeenCalled();
    expect(fixture.attach).not.toHaveBeenCalled();
  });

  it("splits once and attaches on the first meaningful activity", async () => {
    const fixture = createFixture();
    await registerOwnedChild(fixture);

    await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

    expect(fixture.splitPane).toHaveBeenCalledTimes(1);
    expect(fixture.splitPane).toHaveBeenCalledWith({
      paneId: CALLER_PANE_ID,
      direction: "right",
      noFocus: true,
    });
    expect(fixture.attach).toHaveBeenCalledTimes(1);
    expect(fixture.attach).toHaveBeenCalledWith({
      paneId: NEW_PANE_ID,
      sessionId: CHILD_ID,
      serverUrl: SERVER_URL,
      directory: DIRECTORY,
    });
    expect(fixture.registry.get(CHILD_ID)).toMatchObject({
      state: "attached",
      paneId: NEW_PANE_ID,
    });
  });

  it("passes auth environment separately when creating the child pane", async () => {
    const fixture = createFixture(
      { direction: "right" },
      {
        attachEnvironment: {
          OPENCODE_SERVER_PASSWORD: "s3cret-password",
          OPENCODE_SERVER_USERNAME: "s3cret-user",
        },
      },
    );
    await attachChild(fixture);

    expect(fixture.splitPane).toHaveBeenCalledWith({
      paneId: CALLER_PANE_ID,
      direction: "right",
      noFocus: true,
      env: {
        OPENCODE_SERVER_PASSWORD: "s3cret-password",
        OPENCODE_SERVER_USERNAME: "s3cret-user",
      },
    });
  });

  it("splits on direct message.part.delta activity", async () => {
    const fixture = createFixture();
    await registerOwnedChild(fixture);

    await fixture.orchestrator.handleEvent(deltaActivityEvent(CHILD_ID));

    expect(fixture.splitPane).toHaveBeenCalledTimes(1);
  });

  it("passes the configured direction and skips the layout probe", async () => {
    const fixture = createFixture({ direction: "down" });
    await registerOwnedChild(fixture);

    await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

    expect(fixture.getPaneLayout).not.toHaveBeenCalled();
    expect(fixture.splitPane).toHaveBeenCalledWith({
      paneId: CALLER_PANE_ID,
      direction: "down",
      noFocus: true,
    });
  });

  it("resolves the auto direction from the caller pane layout", async () => {
    const fixture = createFixture();
    fixture.getPaneLayout.mockResolvedValue({
      paneId: CALLER_PANE_ID,
      width: 40,
      height: 120,
    });
    await registerOwnedChild(fixture);

    await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

    expect(fixture.splitPane).toHaveBeenCalledWith({
      paneId: CALLER_PANE_ID,
      direction: "down",
      noFocus: true,
    });
  });

  it("marks the session failed and never retries after a failed split", async () => {
    const fixture = createFixture();
    fixture.splitPane.mockResolvedValue(null);
    await registerOwnedChild(fixture);

    await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
    await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

    expect(fixture.splitPane).toHaveBeenCalledTimes(1);
    expect(fixture.attach).not.toHaveBeenCalled();
    expect(fixture.registry.get(CHILD_ID)).toMatchObject({
      state: "failed",
      failureReason: "split_failed",
    });
  });

  it("closes only the new pane when the attach fails", async () => {
    const fixture = createFixture();
    fixture.attach.mockResolvedValue(false);
    await attachChild(fixture);

    expect(fixture.closePane).toHaveBeenCalledTimes(1);
    expect(fixture.closePane).toHaveBeenCalledWith(NEW_PANE_ID);
    expect(fixture.registry.get(CHILD_ID)).toMatchObject({
      state: "failed",
      failureReason: "attach_failed",
    });
  });

  it("splits on each status value that indicates active work", async () => {
    for (const statusType of ["active", "working", "busy", "running", "streaming"]) {
      const fixture = createFixture();
      await registerOwnedChild(fixture);

      await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, statusType));

      expect(fixture.splitPane).toHaveBeenCalledTimes(1);
    }
  });

  it("ignores unknown status values without erroring", async () => {
    const fixture = createFixture();
    await registerOwnedChild(fixture);

    await expect(
      fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "warp_drive")),
    ).resolves.toBeUndefined();

    expect(fixture.splitPane).not.toHaveBeenCalled();
    expect(fixture.registry.get(CHILD_ID)?.state).toBe("waiting_activity");
  });

  it("moves an attached session to idle_pending on session.idle", async () => {
    const fixture = createFixture();
    await attachChild(fixture);

    await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));

    expect(fixture.registry.get(CHILD_ID)?.state).toBe("idle_pending");
    expect(fixture.closePane).not.toHaveBeenCalled();
  });

  it("ignores session.idle for sessions that are not attached", async () => {
    const fixture = createFixture();
    await registerOwnedChild(fixture);

    await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));

    expect(fixture.registry.get(CHILD_ID)?.state).toBe("waiting_activity");
  });

  it("closes the child pane and marks the session closed on session.deleted", async () => {
    const fixture = createFixture();
    await attachChild(fixture);

    await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));

    expect(fixture.closePane).toHaveBeenCalledTimes(1);
    expect(fixture.closePane).toHaveBeenCalledWith(NEW_PANE_ID);
    expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
  });

  it("closes nothing when a waiting session without a pane is deleted", async () => {
    const fixture = createFixture();
    await registerOwnedChild(fixture);

    await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));

    expect(fixture.closePane).not.toHaveBeenCalled();
    expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
  });

  it("closes a pane created after the session is deleted while spawning", async () => {
    const fixture = createFixture();
    await registerOwnedChild(fixture);

    let releaseLayout:
      | ((layout: { paneId: string; width: number; height: number }) => void)
      | undefined;
    const layoutStarted = new Promise<void>((resolve) => {
      fixture.getPaneLayout.mockImplementationOnce(
        () =>
          new Promise((resolveLayout) => {
            releaseLayout = resolveLayout;
            resolve();
          }),
      );
    });

    const spawning = fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
    await layoutStarted;

    await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));

    expect(fixture.registry.get(CHILD_ID)?.state).toBe("closing");
    releaseLayout?.({ paneId: CALLER_PANE_ID, width: 200, height: 50 });
    await spawning;

    expect(fixture.closePane).toHaveBeenCalledWith(NEW_PANE_ID);
    expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
  });

  it("marks the session failed when closing the pane fails", async () => {
    const fixture = createFixture();
    fixture.closePane.mockResolvedValue(false);
    await attachChild(fixture);

    await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));

    expect(fixture.closePane).toHaveBeenCalledTimes(1);
    expect(fixture.registry.get(CHILD_ID)).toMatchObject({
      state: "failed",
      failureReason: "close_failed",
    });
  });

  it("never closes the caller pane itself", async () => {
    const fixture = createFixture();
    await attachChild(fixture);
    fixture.registry.setPaneId(CHILD_ID, CALLER_PANE_ID);

    await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));

    expect(fixture.closePane).not.toHaveBeenCalled();
    expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
  });

  it("keeps duplicate created events idempotent", async () => {
    const fixture = createFixture();
    await registerOwnedChild(fixture);

    await fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, "ses_other"));

    expect(fixture.isOwnedChild).toHaveBeenCalledTimes(1);
    expect(fixture.registry.get(CHILD_ID)?.parentId).toBe(PARENT_ID);
  });

  it("keeps duplicate activity events idempotent", async () => {
    const fixture = createFixture();
    await attachChild(fixture);

    await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

    expect(fixture.splitPane).toHaveBeenCalledTimes(1);
    expect(fixture.attach).toHaveBeenCalledTimes(1);
  });

  it("does not double-split while a split is still in flight", async () => {
    const fixture = createFixture();
    await registerOwnedChild(fixture);
    let resolveSplit: ((value: string | null) => void) | undefined;
    fixture.splitPane.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          resolveSplit = resolve;
        }),
    );

    const first = fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const second = fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
    resolveSplit?.(NEW_PANE_ID);
    await Promise.all([first, second]);

    expect(fixture.splitPane).toHaveBeenCalledTimes(1);
    expect(fixture.attach).toHaveBeenCalledTimes(1);
  });

  it("keeps duplicate idle events idempotent", async () => {
    const fixture = createFixture();
    await attachChild(fixture);

    await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
    await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));

    expect(fixture.registry.get(CHILD_ID)?.state).toBe("idle_pending");
  });

  it("keeps duplicate deleted events idempotent", async () => {
    const fixture = createFixture();
    await attachChild(fixture);

    await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));
    await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));

    expect(fixture.closePane).toHaveBeenCalledTimes(1);
  });

  it("does not register or split for unowned child sessions", async () => {
    const fixture = createFixture();
    fixture.isOwnedChild.mockResolvedValue(false);

    await fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, PARENT_ID));
    await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

    expect(fixture.registry.has(CHILD_ID)).toBe(false);
    expect(fixture.splitPane).not.toHaveBeenCalled();
  });

  it("ignores activity for sessions it does not track", async () => {
    const fixture = createFixture();

    await fixture.orchestrator.handleEvent(activityEvent("ses_unknown"));

    expect(fixture.splitPane).not.toHaveBeenCalled();
  });
  it("serializes 10 concurrent activity events into at most one split", async () => {
    const fixture = createFixture();
    await registerOwnedChild(fixture);

    await Promise.all(
      Array.from({ length: 10 }, () => fixture.orchestrator.handleEvent(activityEvent(CHILD_ID))),
    );

    expect(fixture.splitPane).toHaveBeenCalledTimes(1);
    expect(fixture.attach).toHaveBeenCalledTimes(1);
    expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
  });

  it("serializes pane mutations across concurrent children", async () => {
    const fixture = createFixture();
    const CHILD_A = "ses_childA";
    const CHILD_B = "ses_childB";
    await fixture.orchestrator.handleEvent(createdEvent(CHILD_A, PARENT_ID));
    await fixture.orchestrator.handleEvent(createdEvent(CHILD_B, PARENT_ID));

    const callLog: string[] = [];
    let splitCalls = 0;
    let releaseSplit: () => void = () => {};
    fixture.splitPane.mockImplementation(() => {
      callLog.push("split");
      splitCalls += 1;
      if (splitCalls === 1) {
        return new Promise<string | null>((resolve) => {
          releaseSplit = () => resolve(NEW_PANE_ID);
        });
      }
      return Promise.resolve(NEW_PANE_ID);
    });
    fixture.attach.mockImplementation(async (input) => {
      callLog.push(`attach:${input.sessionId}`);
      return true;
    });

    const first = fixture.orchestrator.handleEvent(activityEvent(CHILD_A));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = fixture.orchestrator.handleEvent(activityEvent(CHILD_B));
    releaseSplit();
    await Promise.all([first, second]);

    expect(callLog).toEqual(["split", `attach:${CHILD_A}`, "split", `attach:${CHILD_B}`]);
    expect(fixture.splitPane).toHaveBeenCalledTimes(2);
  });

  it("re-checks lifecycle state inside the queued spawn before mutating Herdr", async () => {
    const fixture = createFixture();
    const CHILD_A = "ses_childA";
    const CHILD_B = "ses_childB";
    await fixture.orchestrator.handleEvent(createdEvent(CHILD_A, PARENT_ID));
    await fixture.orchestrator.handleEvent(createdEvent(CHILD_B, PARENT_ID));

    let releaseSplit: () => void = () => {};
    fixture.splitPane.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          releaseSplit = () => resolve(NEW_PANE_ID);
        }),
    );

    const firstSpawn = fixture.orchestrator.handleEvent(activityEvent(CHILD_A));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const secondSpawn = fixture.orchestrator.handleEvent(activityEvent(CHILD_B));
    // Child B dies while its spawn is still queued behind child A's spawn.
    await fixture.orchestrator.handleEvent(deletedEvent(CHILD_B));
    releaseSplit();
    await Promise.all([firstSpawn, secondSpawn]);

    expect(fixture.splitPane).toHaveBeenCalledTimes(1);
    expect(fixture.registry.get(CHILD_B)?.state).toBe("closed");
  });

  it("keeps the orchestrator responsive when a queued spawn throws", async () => {
    const fixture = createFixture();
    fixture.splitPane.mockRejectedValue(new Error("herdr exploded"));
    await registerOwnedChild(fixture);

    await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

    expect(fixture.registry.get(CHILD_ID)).toMatchObject({
      state: "failed",
      failureReason: "spawn_failed",
    });

    // A later child still goes through the queue normally.
    const CHILD_B = "ses_childB";
    fixture.splitPane.mockResolvedValue(NEW_PANE_ID);
    await fixture.orchestrator.handleEvent(createdEvent(CHILD_B, PARENT_ID));
    await fixture.orchestrator.handleEvent(activityEvent(CHILD_B));
    expect(fixture.registry.get(CHILD_B)?.state).toBe("attached");
  });

  it("keeps the orchestrator responsive when a queued close throws", async () => {
    const fixture = createFixture();
    fixture.closePane.mockRejectedValue(new Error("herdr exploded"));
    await attachChild(fixture);

    await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));

    expect(fixture.registry.get(CHILD_ID)).toMatchObject({
      state: "failed",
      failureReason: "close_failed",
    });

    // A later close still goes through the queue normally.
    fixture.closePane.mockResolvedValue(true);
    await fixture.orchestrator.handleEvent(deletedEvent("ses_unknown"));
    expect(fixture.closePane).toHaveBeenCalledTimes(1);
  });

  it("rejects queued work gracefully after dispose", async () => {
    const fixture = createFixture();
    await registerOwnedChild(fixture);
    await fixture.orchestrator.dispose();

    await expect(
      fixture.orchestrator.handleEvent(activityEvent(CHILD_ID)),
    ).resolves.toBeUndefined();
    expect(fixture.splitPane).not.toHaveBeenCalled();
    expect(fixture.registry.get(CHILD_ID)?.state).toBe("waiting_activity");
  });

  describe("idle cleanup", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("closes the pane after the grace period elapses", async () => {
      const fixture = createFixture();
      await attachChild(fixture);

      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("idle_pending");
      expect(fixture.closePane).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);

      expect(fixture.closePane).toHaveBeenCalledTimes(1);
      expect(fixture.closePane).toHaveBeenCalledWith(NEW_PANE_ID);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
    });

    it("does not arm a second timer for duplicate idle events", async () => {
      const fixture = createFixture();
      await attachChild(fixture);

      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      const timerCount = vi.getTimerCount();
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));

      expect(vi.getTimerCount()).toBe(timerCount);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fixture.closePane).toHaveBeenCalledTimes(1);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
    });

    it("resumes the session and cancels the close when activity arrives before the timeout", async () => {
      const fixture = createFixture();
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));

      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fixture.closePane).not.toHaveBeenCalled();
    });

    it("also resumes the session on an active status before the timeout", async () => {
      const fixture = createFixture();
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));

      await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));

      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
      await vi.advanceTimersByTimeAsync(1000);
      expect(fixture.closePane).not.toHaveBeenCalled();
    });

    it("ignores a stale timer that fires after the session resumed", async () => {
      // The registry forgets the handle but never really cancels the timer,
      // simulating a stale fire after a resume.
      const neverCancel = vi.fn();
      const fixture = createFixture({}, { registry: { clearTimeout: neverCancel } });
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");

      await vi.advanceTimersByTimeAsync(1000);

      expect(fixture.closePane).not.toHaveBeenCalled();
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
    });

    it("closes the pane immediately when a session is deleted while idle pending", async () => {
      const fixture = createFixture();
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));

      await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));

      expect(fixture.closePane).toHaveBeenCalledTimes(1);
      expect(fixture.closePane).toHaveBeenCalledWith(NEW_PANE_ID);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
      await vi.advanceTimersByTimeAsync(1000);
      expect(fixture.closePane).toHaveBeenCalledTimes(1);
    });

    it("never closes the caller pane when the idle timer fires", async () => {
      const fixture = createFixture();
      await attachChild(fixture);
      fixture.registry.setPaneId(CHILD_ID, CALLER_PANE_ID);

      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await vi.advanceTimersByTimeAsync(1000);

      expect(fixture.closePane).not.toHaveBeenCalled();
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
    });

    it("closes nothing when an idle session without a pane times out", async () => {
      const fixture = createFixture();
      await registerOwnedChild(fixture);
      // Walk the state machine to attached without ever splitting a pane.
      expect(fixture.registry.transitionTo(CHILD_ID, "spawning")).toBe(true);
      expect(fixture.registry.transitionTo(CHILD_ID, "attached")).toBe(true);

      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await vi.advanceTimersByTimeAsync(1000);

      expect(fixture.closePane).not.toHaveBeenCalled();
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
    });

    it("retries the close with backoff and marks the session failed on exhaustion", async () => {
      const fixture = createFixture();
      fixture.closePane.mockResolvedValue(false);
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));

      // Grace (1000) + backoffs 500 + 1000 + 2000: initial attempt plus
      // closeRetries (3) retries, then exhaustion.
      await vi.advanceTimersByTimeAsync(4500);

      expect(fixture.closePane).toHaveBeenCalledTimes(4);
      expect(fixture.registry.get(CHILD_ID)).toMatchObject({
        state: "failed",
        failureReason: "close_failed",
      });
    });

    it("closes the pane when a retry succeeds before the retry limit", async () => {
      const fixture = createFixture();
      fixture.closePane
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));

      // Grace + two failed attempts, then the third succeeds.
      await vi.advanceTimersByTimeAsync(2500);

      expect(fixture.closePane).toHaveBeenCalledTimes(3);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
    });

    it("cancels pending timers on dispose without closing attached panes", async () => {
      const fixture = createFixture();
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));

      await fixture.orchestrator.dispose();
      await vi.advanceTimersByTimeAsync(1000);

      expect(fixture.closePane).not.toHaveBeenCalled();
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("idle_pending");
    });
  });

  describe("capacity limits", () => {
    it("creates a pane while usage is under maxPanes", async () => {
      const fixture = createFixture({ maxPanes: 1 });

      await attachChild(fixture);

      expect(fixture.splitPane).toHaveBeenCalledTimes(1);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
    });

    it("transitions a waiting session to ignored at maxPanes without splitting", async () => {
      const fixture = createFixture({ maxPanes: 1 });
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(createdEvent("ses_childB", PARENT_ID));

      await fixture.orchestrator.handleEvent(activityEvent("ses_childB"));

      expect(fixture.splitPane).toHaveBeenCalledTimes(1);
      expect(fixture.attach).toHaveBeenCalledTimes(1);
      expect(fixture.registry.get("ses_childB")).toMatchObject({
        state: "ignored",
        failureReason: "capacity_limit",
      });
    });

    it("cannot exceed maxPanes when many children spawn concurrently", async () => {
      const fixture = createFixture({ maxPanes: 2 });
      const children = ["ses_childA", "ses_childB", "ses_childC", "ses_childD"];
      for (const child of children) {
        await fixture.orchestrator.handleEvent(createdEvent(child, PARENT_ID));
      }

      await Promise.all(
        children.map((child) => fixture.orchestrator.handleEvent(activityEvent(child))),
      );

      expect(fixture.splitPane).toHaveBeenCalledTimes(2);
      const states = children.map((child) => fixture.registry.get(child)?.state);
      expect(states).toEqual(["attached", "attached", "ignored", "ignored"]);
      for (const child of children.slice(2)) {
        expect(fixture.registry.get(child)).toMatchObject({
          failureReason: "capacity_limit",
        });
      }
    });

    it("releases capacity once a pane closes", async () => {
      const fixture = createFixture({ maxPanes: 1 });
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");

      await fixture.orchestrator.handleEvent(createdEvent("ses_childB", PARENT_ID));
      await fixture.orchestrator.handleEvent(activityEvent("ses_childB"));

      expect(fixture.splitPane).toHaveBeenCalledTimes(2);
      expect(fixture.registry.get("ses_childB")?.state).toBe("attached");
    });

    it("leaves the ignored child session untouched in Herdr", async () => {
      const fixture = createFixture({ maxPanes: 1 });
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(createdEvent("ses_childB", PARENT_ID));

      await fixture.orchestrator.handleEvent(activityEvent("ses_childB"));

      // The OMO child keeps running; the bridge only refuses to visualize it.
      expect(fixture.closePane).not.toHaveBeenCalled();
      expect(fixture.attach).toHaveBeenCalledTimes(1);
      expect(fixture.registry.get("ses_childB")?.state).toBe("ignored");
    });

    it("counts an in-progress spawn reservation against maxPanes", async () => {
      const fixture = createFixture({ maxPanes: 1, direction: "right" });
      const childA = "ses_childA";
      const childB = "ses_childB";
      await fixture.orchestrator.handleEvent(createdEvent(childA, PARENT_ID));
      await fixture.orchestrator.handleEvent(createdEvent(childB, PARENT_ID));

      let releaseSplit: ((paneId: string | null) => void) | undefined;
      fixture.splitPane.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseSplit = resolve;
          }),
      );

      const firstSpawn = fixture.orchestrator.handleEvent(activityEvent(childA));
      const secondSpawn = fixture.orchestrator.handleEvent(activityEvent(childB));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fixture.splitPane).toHaveBeenCalledTimes(1);
      releaseSplit?.(NEW_PANE_ID);
      await Promise.all([firstSpawn, secondSpawn]);

      expect(fixture.registry.get(childB)).toMatchObject({
        state: "ignored",
        failureReason: "capacity_limit",
      });
    });
  });
});
