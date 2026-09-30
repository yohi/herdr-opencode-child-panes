import type { Event } from "@opencode-ai/sdk";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachLauncher } from "../src/attach-launcher.js";
import { createChildSessionRegistry } from "../src/child-session-registry.js";
import type {
  ChildSessionRegistry,
  CreateChildSessionRegistryOptions,
} from "../src/child-session.js";
import type { Logger } from "../src/logger.js";
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
function messageUpdatedEvent(sessionId: string): Event {
  return eventWith("message.updated", { info: { sessionID: sessionId } });
}

function deletedEvent(sessionId: string): Event {
  return eventWith("session.deleted", { info: { id: sessionId } });
}

interface Fixture {
  readonly orchestrator: PaneOrchestrator;
  readonly registry: ChildSessionRegistry;
  readonly getPaneLayout: Mock<HerdrClient["getPaneLayout"]>;
  readonly splitPane: Mock<HerdrClient["splitPane"]>;
  readonly resizePane: Mock<HerdrClient["resizePane"]>;
  readonly closePane: Mock<HerdrClient["closePane"]>;
  readonly attach: Mock<AttachLauncher["attach"]>;
  readonly isOwnedChild: Mock<ChildOwnershipResolver["isOwnedChild"]>;
  readonly debug: Mock<Logger["debug"]>;
  readonly info: Mock<Logger["info"]>;
  readonly warn: Mock<Logger["warn"]>;
  readonly error: Mock<Logger["error"]>;
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
    resizePane: vi.fn<HerdrClient["resizePane"]>().mockResolvedValue(true),
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
    resizePane: herdrClient.resizePane as Mock<HerdrClient["resizePane"]>,
    closePane: herdrClient.closePane as Mock<HerdrClient["closePane"]>,
    attach: attachLauncher.attach as Mock<AttachLauncher["attach"]>,
    isOwnedChild: ownershipResolver.isOwnedChild as Mock<ChildOwnershipResolver["isOwnedChild"]>,
    debug: logger.debug as Mock<Logger["debug"]>,
    info: logger.info as Mock<Logger["info"]>,
    warn: logger.warn as Mock<Logger["warn"]>,
    error: logger.error as Mock<Logger["error"]>,
  };
}

async function registerOwnedChild(fixture: Fixture): Promise<void> {
  await fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, PARENT_ID));
}

async function registerChild(fixture: Fixture, sessionId: string): Promise<void> {
  await fixture.orchestrator.handleEvent(createdEvent(sessionId, PARENT_ID));
}

async function attachChild(fixture: Fixture): Promise<void> {
  await registerOwnedChild(fixture);
  await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
}

async function attachChildById(fixture: Fixture, sessionId: string): Promise<void> {
  await registerChild(fixture, sessionId);
  await fixture.orchestrator.handleEvent(activityEvent(sessionId));
}

async function startDelayedAttachAndIdle(fixture: Fixture): Promise<{
  readonly releaseAttach: (attached: boolean) => void;
  readonly spawning: Promise<void>;
}> {
  let resolveAttach: ((attached: boolean) => void) | undefined;
  const attachStarted = new Promise<void>((resolve) => {
    fixture.attach.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolveAttachPromise) => {
          resolveAttach = resolveAttachPromise;
          resolve();
        }),
    );
  });

  await registerOwnedChild(fixture);
  const spawning = fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
  await attachStarted;

  await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "idle"));

  return {
    releaseAttach: (attached) => resolveAttach?.(attached),
    spawning,
  };
}

async function assertReplaysPendingSpawn(fixture: Fixture, event: Event): Promise<void> {
  let resolveOwnership: ((owned: boolean) => void) | undefined;
  fixture.isOwnedChild.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        resolveOwnership = resolve;
      }),
  );

  const created = fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, PARENT_ID));
  await vi.waitFor(() => expect(fixture.isOwnedChild).toHaveBeenCalledTimes(1));

  await fixture.orchestrator.handleEvent(event);
  expect(fixture.splitPane).not.toHaveBeenCalled();

  resolveOwnership?.(true);
  await created;

  expect(fixture.splitPane).toHaveBeenCalledTimes(1);
  expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
}

describe("createPaneOrchestrator", () => {
  it("keeps a created-only session waiting without splitting", async () => {
    const fixture = createFixture();

    await fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, PARENT_ID));

    expect(fixture.registry.get(CHILD_ID)?.state).toBe("waiting_activity");
    expect(fixture.splitPane).not.toHaveBeenCalled();
    expect(fixture.attach).not.toHaveBeenCalled();
  });

  it("replays activity that arrives while child ownership is resolving", async () => {
    const fixture = createFixture();
    await assertReplaysPendingSpawn(fixture, activityEvent(CHILD_ID));
  });

  it("replays active status that arrives while child ownership is resolving", async () => {
    const fixture = createFixture();
    await assertReplaysPendingSpawn(fixture, statusEvent(CHILD_ID, "busy"));
  });

  it.each([
    { name: "activity", event: activityEvent(CHILD_ID) },
    { name: "active status", event: statusEvent(CHILD_ID, "busy") },
  ])("does not replay pending $name after deletion", async ({ event }) => {
    let resolveOwnership: ((owned: boolean) => void) | undefined;
    const fixture = createFixture();
    fixture.isOwnedChild.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOwnership = resolve;
        }),
    );

    const created = fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, PARENT_ID));
    await vi.waitFor(() => expect(fixture.isOwnedChild).toHaveBeenCalledTimes(1));

    await fixture.orchestrator.handleEvent(event);
    await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));
    resolveOwnership?.(true);
    await created;

    expect(fixture.splitPane).not.toHaveBeenCalled();
    expect(fixture.attach).not.toHaveBeenCalled();
  });
  describe("pre-registration deletion", () => {
    /**
     * Hold `isOwnedChild()` unresolved and start the created event's
     * ownership resolution; returns its promise and the resolver release.
     */
    async function holdOwnershipResolution(
      fixture: Fixture,
    ): Promise<{ created: Promise<void>; resolveOwnership: (owned: boolean) => void }> {
      let resolveOwnership: (owned: boolean) => void = () => {};
      fixture.isOwnedChild.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveOwnership = resolve;
          }),
      );
      const created = fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, PARENT_ID));
      await vi.waitFor(() => expect(fixture.isOwnedChild).toHaveBeenCalledTimes(1));
      return {
        created,
        resolveOwnership: (owned) => resolveOwnership(owned),
      };
    }

    it("does not resurrect a child deleted while ownership resolution is pending", async () => {
      const fixture = createFixture();
      const { created, resolveOwnership } = await holdOwnershipResolution(fixture);

      await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));
      await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));
      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      await fixture.orchestrator.handleEvent(deltaActivityEvent(CHILD_ID));

      resolveOwnership(true);
      await created;

      expect(fixture.registry.has(CHILD_ID)).toBe(false);
      expect(fixture.splitPane).not.toHaveBeenCalled();
      expect(fixture.attach).not.toHaveBeenCalled();
      expect(fixture.info).toHaveBeenCalledWith(
        "Pre-registration deletion prevented child registration",
        expect.objectContaining({ sessionId: CHILD_ID }),
      );
    });

    it("does not start another ownership resolution for duplicate create while one is pending", async () => {
      const fixture = createFixture();
      const { created, resolveOwnership } = await holdOwnershipResolution(fixture);

      await fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, PARENT_ID));

      expect(fixture.isOwnedChild).toHaveBeenCalledTimes(1);

      resolveOwnership(true);
      await created;

      expect(fixture.registry.get(CHILD_ID)?.state).toBe("waiting_activity");
      expect(fixture.splitPane).not.toHaveBeenCalled();
    });

    it("keeps a pre-registration deletion tombstone until dispose", async () => {
      const fixture = createFixture();
      const { created, resolveOwnership } = await holdOwnershipResolution(fixture);

      await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));
      resolveOwnership(true);
      await created;

      expect(fixture.registry.has(CHILD_ID)).toBe(false);

      // Duplicate create and work must not repopulate pending spawn state.
      await fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, PARENT_ID));
      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

      expect(fixture.isOwnedChild).toHaveBeenCalledTimes(1);
      expect(fixture.registry.has(CHILD_ID)).toBe(false);
      expect(fixture.splitPane).not.toHaveBeenCalled();

      await fixture.orchestrator.dispose();

      // dispose must clear transient bookkeeping and accept no later events.
      await expect(
        fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, PARENT_ID)),
      ).resolves.toBeUndefined();
      expect(fixture.registry.has(CHILD_ID)).toBe(false);
      expect(fixture.splitPane).not.toHaveBeenCalled();
    });

    it("does not register a child if dispose happens while ownership resolution is pending", async () => {
      const fixture = createFixture();
      const { created, resolveOwnership } = await holdOwnershipResolution(fixture);

      await fixture.orchestrator.dispose();
      resolveOwnership(true);
      await created;

      expect(fixture.registry.has(CHILD_ID)).toBe(false);
      expect(fixture.splitPane).not.toHaveBeenCalled();
      expect(fixture.attach).not.toHaveBeenCalled();
    });
  });

  it("splits once and attaches on the first meaningful activity", async () => {
    const fixture = createFixture();
    await registerOwnedChild(fixture);

    await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

    expect(fixture.splitPane).toHaveBeenCalledTimes(1);
    expect(fixture.splitPane).toHaveBeenCalledWith({
      paneId: CALLER_PANE_ID,
      direction: "right",
      ratio: 2 / 3,
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
      ratio: 2 / 3,
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

  it("uses the fixed root layout regardless of configured direction", async () => {
    const fixture = createFixture({ direction: "down" });
    await registerOwnedChild(fixture);

    await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

    expect(fixture.getPaneLayout).not.toHaveBeenCalled();
    expect(fixture.splitPane).toHaveBeenCalledWith({
      paneId: CALLER_PANE_ID,
      direction: "right",
      ratio: 2 / 3,
      noFocus: true,
    });
  });

  it("splits the second child below the first child", async () => {
    const fixture = createFixture();
    const paneIds = ["pane-2", "pane-3"];
    let splitIndex = 0;
    fixture.splitPane.mockImplementation(async () => paneIds[splitIndex++] ?? null);

    await attachChild(fixture);
    await attachChildById(fixture, "ses_child2");

    expect(fixture.splitPane).toHaveBeenNthCalledWith(2, {
      paneId: "pane-2",
      direction: "down",
      ratio: 0.5,
      noFocus: true,
    });
    expect(fixture.resizePane).not.toHaveBeenCalled();
  });

  it("rebalances the right column when the third child is attached", async () => {
    const fixture = createFixture();
    const paneIds = ["pane-2", "pane-3", "pane-4"];
    let splitIndex = 0;
    fixture.splitPane.mockImplementation(async () => paneIds[splitIndex++] ?? null);

    await attachChild(fixture);
    await attachChildById(fixture, "ses_child2");
    await attachChildById(fixture, "ses_child3");

    expect(fixture.splitPane).toHaveBeenNthCalledWith(3, {
      paneId: "pane-3",
      direction: "down",
      ratio: 0.5,
      noFocus: true,
    });
    expect(fixture.resizePane).toHaveBeenCalledTimes(1);
    expect(fixture.resizePane).toHaveBeenCalledWith({
      paneId: "pane-3",
      direction: "up",
      amount: 1 / 6,
    });
  });

  it("uses pane creation order when activity order differs from registration order", async () => {
    const fixture = createFixture();
    const paneIds = ["pane-2", "pane-3", "pane-4"];
    let splitIndex = 0;
    fixture.splitPane.mockImplementation(async () => paneIds[splitIndex++] ?? null);

    await registerChild(fixture, "ses_childA");
    await registerChild(fixture, "ses_childB");
    await registerChild(fixture, "ses_childC");
    await fixture.orchestrator.handleEvent(activityEvent("ses_childB"));
    await fixture.orchestrator.handleEvent(activityEvent("ses_childA"));
    await fixture.orchestrator.handleEvent(activityEvent("ses_childC"));

    expect(fixture.splitPane).toHaveBeenNthCalledWith(3, {
      paneId: "pane-3",
      direction: "down",
      ratio: 0.5,
      noFocus: true,
    });
    expect(fixture.resizePane).toHaveBeenCalledWith({
      paneId: "pane-3",
      direction: "up",
      amount: 1 / 6,
    });
  });

  it("retains an open pane when closing it fails", async () => {
    const fixture = createFixture();
    const paneIds = ["pane-2", "pane-3", "pane-4"];
    let splitIndex = 0;
    fixture.splitPane.mockImplementation(async () => paneIds[splitIndex++] ?? null);

    await attachChildById(fixture, "ses_childA");
    await attachChildById(fixture, "ses_childB");
    fixture.closePane.mockResolvedValue(false);
    await fixture.orchestrator.handleEvent(deletedEvent("ses_childB"));
    await attachChildById(fixture, "ses_childC");

    expect(fixture.splitPane).toHaveBeenNthCalledWith(3, {
      paneId: "pane-3",
      direction: "down",
      ratio: 0.5,
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

    let releaseSplit: ((paneId: string | null) => void) | undefined;
    const splitStarted = new Promise<void>((resolve) => {
      fixture.splitPane.mockImplementationOnce(
        () =>
          new Promise((resolveSplit) => {
            releaseSplit = resolveSplit;
            resolve();
          }),
      );
    });

    const spawning = fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
    await splitStarted;

    await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));

    expect(fixture.registry.get(CHILD_ID)?.state).toBe("closing");
    releaseSplit?.(NEW_PANE_ID);
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
    const laterChildId = "ses_child_later";
    await fixture.orchestrator.handleEvent(createdEvent(laterChildId, PARENT_ID));
    await fixture.orchestrator.handleEvent(activityEvent(laterChildId));
    fixture.closePane.mockClear();
    await fixture.orchestrator.handleEvent(deletedEvent(laterChildId));
    expect(fixture.closePane).toHaveBeenCalledTimes(1);
    expect(fixture.closePane).toHaveBeenCalledWith(NEW_PANE_ID);
    expect(fixture.registry.get(laterChildId)?.state).toBe("closed");
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
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
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
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
    });

    it("keeps the close scheduled when a message event arrives after idle", async () => {
      const fixture = createFixture();
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));

      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

      expect(fixture.registry.get(CHILD_ID)?.state).toBe("idle_pending");
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fixture.closePane).toHaveBeenCalledWith(NEW_PANE_ID);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
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

    it("closes the pane after an idle session.status reaches the timeout", async () => {
      const fixture = createFixture();
      await attachChild(fixture);

      await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "idle"));
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("idle_pending");
      expect(fixture.closePane).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);

      expect(fixture.closePane).toHaveBeenCalledTimes(1);
      expect(fixture.closePane).toHaveBeenCalledWith(NEW_PANE_ID);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
    });

    it("closes a child that becomes idle while its pane is still attaching", async () => {
      const fixture = createFixture();
      const { releaseAttach, spawning } = await startDelayedAttachAndIdle(fixture);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("spawning");

      releaseAttach(true);
      await spawning;
      await vi.advanceTimersByTimeAsync(1000);

      expect(fixture.closePane).toHaveBeenCalledWith(NEW_PANE_ID);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
    });

    it("keeps the deferred close when a final activity event follows idle during attach", async () => {
      const fixture = createFixture();
      const { releaseAttach, spawning } = await startDelayedAttachAndIdle(fixture);
      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

      releaseAttach(true);
      await spawning;
      await vi.advanceTimersByTimeAsync(1000);

      expect(fixture.closePane).toHaveBeenCalledWith(NEW_PANE_ID);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
    });

    it("does not log a scheduled close when the deferred idle transition fails", async () => {
      const fixture = createFixture();
      const paneIds = ["pane-2", "pane-3", "pane-4"];
      let splitIndex = 0;
      fixture.splitPane.mockImplementation(async () => paneIds[splitIndex++] ?? null);

      await attachChild(fixture);
      await attachChildById(fixture, "ses_child2");

      let releaseAttach: ((attached: boolean) => void) | undefined;
      const attachStarted = new Promise<void>((resolve) => {
        fixture.attach.mockImplementationOnce(
          () =>
            new Promise<boolean>((resolveAttach) => {
              releaseAttach = resolveAttach;
              resolve();
            }),
        );
      });
      let releaseResize: (() => void) | undefined;
      const resizeStarted = new Promise<void>((resolve) => {
        fixture.resizePane.mockImplementationOnce(
          () =>
            new Promise<boolean>((resolveResize) => {
              releaseResize = () => resolveResize(true);
              resolve();
            }),
        );
      });

      await registerChild(fixture, "ses_child3");
      const spawning = fixture.orchestrator.handleEvent(activityEvent("ses_child3"));
      await attachStarted;

      await fixture.orchestrator.handleEvent(idleEvent("ses_child3"));
      releaseAttach?.(true);
      await resizeStarted;

      await fixture.orchestrator.handleEvent(idleEvent("ses_child3"));
      expect(fixture.registry.get("ses_child3")?.state).toBe("idle_pending");

      releaseResize?.();
      await spawning;

      expect(fixture.debug).not.toHaveBeenCalledWith(
        "Child session was idle during attach: close scheduled",
        { sessionId: "ses_child3", graceMs: 1000 },
      );
    });

    it("ignores a stale timer that fires after the session resumed", async () => {
      // The registry forgets the handle but never really cancels the timer,
      // simulating a stale fire after a resume.
      const neverCancel = vi.fn();
      const fixture = createFixture({}, { registry: { clearTimeout: neverCancel } });
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));
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
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
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
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
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
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
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
  describe("reopenable work dispatch", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });
    function stageReopenableWithoutPane(fixture: Fixture, sessionId: string): void {
      fixture.registry.register(sessionId, PARENT_ID);
      fixture.registry.transitionTo(sessionId, "spawning");
      fixture.registry.transitionTo(sessionId, "attached");
      fixture.registry.transitionTo(sessionId, "idle_pending");
      fixture.registry.transitionTo(sessionId, "closing");
      fixture.registry.transitionTo(sessionId, "reopenable");
      fixture.registry.clearPaneId(sessionId);
    }

    function messageUpdatedEvent(sessionId: string): Event {
      return eventWith("message.updated", { info: { sessionID: sessionId } });
    }

    function messagePartUpdatedEvent(sessionId: string): Event {
      return eventWith("message.part.updated", { part: { sessionID: sessionId } });
    }

    it("reopens a reopenable child on active status using the same session ID", async () => {
      const fixture = createFixture();
      stageReopenableWithoutPane(fixture, CHILD_ID);

      await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));

      expect(fixture.attach).toHaveBeenCalledWith(expect.objectContaining({ sessionId: CHILD_ID }));
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
    });

    it("reopens a reopenable child on message.updated", async () => {
      const fixture = createFixture();
      stageReopenableWithoutPane(fixture, CHILD_ID);

      await fixture.orchestrator.handleEvent(messageUpdatedEvent(CHILD_ID));

      expect(fixture.attach).toHaveBeenCalledWith(expect.objectContaining({ sessionId: CHILD_ID }));
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
    });

    it("reopens a reopenable child on message.part.updated", async () => {
      const fixture = createFixture();
      stageReopenableWithoutPane(fixture, CHILD_ID);

      await fixture.orchestrator.handleEvent(messagePartUpdatedEvent(CHILD_ID));

      expect(fixture.attach).toHaveBeenCalledWith(expect.objectContaining({ sessionId: CHILD_ID }));
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
    });

    it("reopens a reopenable child on message.part.delta", async () => {
      const fixture = createFixture();
      stageReopenableWithoutPane(fixture, CHILD_ID);

      await fixture.orchestrator.handleEvent(deltaActivityEvent(CHILD_ID));

      expect(fixture.splitPane).toHaveBeenCalledTimes(1);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
    });

    it("creates exactly one pane when active status and meaningful activity arrive while reopenable", async () => {
      const fixture = createFixture();
      stageReopenableWithoutPane(fixture, CHILD_ID);

      const first = fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));
      const second = fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      await Promise.all([first, second]);

      expect(fixture.splitPane).toHaveBeenCalledTimes(1);
      expect(fixture.attach).toHaveBeenCalledTimes(1);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
    });

    it("clears idleDuringSpawn on active status but not meaningful activity", async () => {
      const activeFixture = createFixture();
      const { releaseAttach: releaseActiveAttach, spawning: activeSpawning } =
        await startDelayedAttachAndIdle(activeFixture);
      await activeFixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));
      releaseActiveAttach(true);
      await activeSpawning;
      await vi.advanceTimersByTimeAsync(1000);
      expect(activeFixture.closePane).not.toHaveBeenCalled();

      const messageFixture = createFixture();
      const { releaseAttach: releaseMessageAttach, spawning: messageSpawning } =
        await startDelayedAttachAndIdle(messageFixture);
      await messageFixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      releaseMessageAttach(true);
      await messageSpawning;
      await vi.advanceTimersByTimeAsync(1000);
      expect(messageFixture.closePane).toHaveBeenCalledWith(NEW_PANE_ID);
    });
  });

  describe("reopen capacity", () => {
    it("keeps a reopenable child retryable when capacity is full", async () => {
      const fixture = createFixture({ maxPanes: 1 });
      fixture.registry.register(CHILD_ID, PARENT_ID);
      fixture.registry.transitionTo(CHILD_ID, "spawning");
      fixture.registry.transitionTo(CHILD_ID, "attached");
      fixture.registry.transitionTo(CHILD_ID, "idle_pending");
      fixture.registry.transitionTo(CHILD_ID, "closing");
      fixture.registry.transitionTo(CHILD_ID, "reopenable");
      fixture.registry.clearPaneId(CHILD_ID);
      await attachChildById(fixture, "ses_busy");
      fixture.splitPane.mockClear();
      fixture.attach.mockClear();

      await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));

      expect(fixture.splitPane).not.toHaveBeenCalled();
      expect(fixture.registry.get(CHILD_ID)).toMatchObject({
        state: "reopenable",
        reopenRequested: false,
      });
      expect(fixture.registry.get(CHILD_ID)?.failureReason).toBeUndefined();
      expect(fixture.warn).toHaveBeenCalledWith(
        "Reopen deferred because capacity was full",
        expect.objectContaining({ sessionId: CHILD_ID }),
      );
    });

    it("retries a capacity-blocked reopen on a later work signal", async () => {
      const fixture = createFixture({ maxPanes: 1 });
      fixture.registry.register(CHILD_ID, PARENT_ID);
      fixture.registry.transitionTo(CHILD_ID, "spawning");
      fixture.registry.transitionTo(CHILD_ID, "attached");
      fixture.registry.transitionTo(CHILD_ID, "idle_pending");
      fixture.registry.transitionTo(CHILD_ID, "closing");
      fixture.registry.transitionTo(CHILD_ID, "reopenable");
      fixture.registry.clearPaneId(CHILD_ID);
      await attachChildById(fixture, "ses_busy");

      await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");

      await fixture.orchestrator.handleEvent(deletedEvent("ses_busy"));
      fixture.splitPane.mockClear();
      fixture.attach.mockClear();

      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
      expect(fixture.splitPane).toHaveBeenCalledTimes(1);
    });

    it("does not split for repeated reopen work while capacity remains full", async () => {
      const fixture = createFixture({ maxPanes: 1 });
      fixture.registry.register(CHILD_ID, PARENT_ID);
      fixture.registry.transitionTo(CHILD_ID, "spawning");
      fixture.registry.transitionTo(CHILD_ID, "attached");
      fixture.registry.transitionTo(CHILD_ID, "idle_pending");
      fixture.registry.transitionTo(CHILD_ID, "closing");
      fixture.registry.transitionTo(CHILD_ID, "reopenable");
      fixture.registry.clearPaneId(CHILD_ID);
      await attachChildById(fixture, "ses_busy");
      fixture.splitPane.mockClear();

      await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));
      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      await fixture.orchestrator.handleEvent(deltaActivityEvent(CHILD_ID));

      expect(fixture.splitPane).not.toHaveBeenCalled();
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
    });

    it("ignores initial capacity shortage with ignored(capacity_limit)", async () => {
      const fixture = createFixture({ maxPanes: 1 });
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(createdEvent("ses_childB", PARENT_ID));
      await fixture.orchestrator.handleEvent(activityEvent("ses_childB"));

      expect(fixture.registry.get("ses_childB")).toMatchObject({
        state: "ignored",
        failureReason: "capacity_limit",
      });
    });
  });

  describe("idle close reopenability", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Start an idle close and hold its `closePane()` promise unresolved. */
    async function blockClosePane(fixture: Fixture): Promise<(closed: boolean) => void> {
      let releaseClose: (closed: boolean) => void = () => {};
      const closeStarted = new Promise<void>((resolve) => {
        fixture.closePane.mockImplementationOnce(
          () =>
            new Promise<boolean>((resolveClose) => {
              releaseClose = resolveClose;
              resolve();
            }),
        );
      });
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await vi.advanceTimersByTimeAsync(1000);
      await closeStarted;
      return releaseClose;
    }

    function stageReopenableWithoutPaneLocal(fixture: Fixture): void {
      fixture.registry.register(CHILD_ID, PARENT_ID);
      fixture.registry.transitionTo(CHILD_ID, "spawning");
      fixture.registry.transitionTo(CHILD_ID, "attached");
      fixture.registry.transitionTo(CHILD_ID, "idle_pending");
      fixture.registry.transitionTo(CHILD_ID, "closing");
      fixture.registry.transitionTo(CHILD_ID, "reopenable");
      fixture.registry.clearPaneId(CHILD_ID);
    }

    async function driveCloseRetryWithFinalDemand(
      fixture: Fixture,
      finalDemand: "idle" | "work",
    ): Promise<void> {
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await vi.advanceTimersByTimeAsync(1000);
      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
      if (finalDemand === "work") {
        await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
        expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);
      }
      await vi.advanceTimersByTimeAsync(500);
    }

    it("clears pane ownership and becomes reopenable after successful idle close", async () => {
      const fixture = createFixture();

      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await vi.advanceTimersByTimeAsync(1000);

      const session = fixture.registry.get(CHILD_ID);
      expect(session?.state).toBe("reopenable");
      expect(session?.paneId).toBeUndefined();
      expect(session?.closeReason).toBeUndefined();
      expect(session?.reopenRequested).toBe(false);
      expect(fixture.info).toHaveBeenCalledWith(
        "idle-closed child became reopenable",
        expect.objectContaining({ sessionId: CHILD_ID }),
      );
    });

    it.each(["session.idle", "session.status idle"])(
      "later %s cancels reopen demand while the old close continues",
      async (source) => {
        const fixture = createFixture();
        const releaseClose = await blockClosePane(fixture);

        await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
        expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);

        const laterIdle =
          source === "session.idle" ? idleEvent(CHILD_ID) : statusEvent(CHILD_ID, "idle");
        await fixture.orchestrator.handleEvent(laterIdle);
        expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
        expect(fixture.debug).toHaveBeenCalledWith(
          "later idle cancelled pending reopen",
          expect.objectContaining({ sessionId: CHILD_ID }),
        );

        releaseClose(true);
        await vi.advanceTimersByTimeAsync(0);

        expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
      },
    );

    it("promotes an idle close to permanent deletion", async () => {
      const fixture = createFixture();
      const releaseClose = await blockClosePane(fixture);

      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);

      await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.closeReason).toBe("deleted");
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
      expect(fixture.debug).toHaveBeenCalledWith(
        "pending reopen cancelled because session.deleted arrived",
        expect.objectContaining({ sessionId: CHILD_ID }),
      );

      releaseClose(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
      expect(fixture.closePane).toHaveBeenCalledTimes(1);
      expect(fixture.registry.get(CHILD_ID)?.closeReason).toBeUndefined();
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
    });

    it("closes a reopenable session permanently when session.deleted arrives with no pane", async () => {
      const fixture = createFixture();
      stageReopenableWithoutPaneLocal(fixture);

      await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));

      expect(fixture.closePane).not.toHaveBeenCalled();
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
      expect(fixture.registry.get(CHILD_ID)?.closeReason).toBeUndefined();
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
    });

    it("reopens after a close retry when work latched reopen demand", async () => {
      const fixture = createFixture();
      fixture.closePane.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await vi.advanceTimersByTimeAsync(1000);

      expect(fixture.closePane).toHaveBeenCalledTimes(1);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closing");

      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);
      expect(fixture.debug).toHaveBeenCalledWith(
        "work requested reopen while idle close was in progress",
        expect.objectContaining({ sessionId: CHILD_ID }),
      );

      await vi.advanceTimersByTimeAsync(500);

      expect(fixture.closePane).toHaveBeenCalledTimes(2);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
      expect(fixture.splitPane).toHaveBeenCalledTimes(2);
      expect(fixture.attach).toHaveBeenCalledTimes(2);
      expect(fixture.registry.get(CHILD_ID)?.closeReason).toBeUndefined();
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
    });

    it("cancels reopen demand with a later idle before the closing retry succeeds", async () => {
      const fixture = createFixture();
      fixture.closePane.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await vi.advanceTimersByTimeAsync(1000);

      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);

      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
      expect(fixture.debug).toHaveBeenCalledWith(
        "later idle cancelled pending reopen",
        expect.objectContaining({ sessionId: CHILD_ID }),
      );

      await vi.advanceTimersByTimeAsync(500);

      expect(fixture.closePane).toHaveBeenCalledTimes(2);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
    });

    it("clears reopen demand and close metadata when closing retries are exhausted", async () => {
      const fixture = createFixture();
      fixture.closePane.mockResolvedValue(false);
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));

      await vi.advanceTimersByTimeAsync(1000);
      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);

      // Initial attempt plus closeRetries (3) backoff retries, then exhaustion.
      await vi.advanceTimersByTimeAsync(3500);

      expect(fixture.closePane).toHaveBeenCalledTimes(4);
      expect(fixture.registry.get(CHILD_ID)).toMatchObject({
        state: "failed",
        failureReason: "close_failed",
      });
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
      expect(fixture.registry.get(CHILD_ID)?.closeReason).toBeUndefined();
    });

    it("rereads closing metadata when work, idle, and deletion arrive while closePane is unresolved", async () => {
      const fixture = createFixture();
      const releaseClose = await blockClosePane(fixture);

      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);

      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);

      await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.closeReason).toBe("deleted");

      releaseClose(true);
      await vi.advanceTimersByTimeAsync(0);

      // The finalizer rereads the promoted metadata instead of a stale
      // pre-await snapshot, so the session ends closed, not reopenable.
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
      expect(fixture.registry.get(CHILD_ID)?.closeReason).toBeUndefined();
      expect(fixture.registry.get(CHILD_ID)?.paneId).toBeUndefined();
    });

    it("hands an idle close to exactly one reopen without awaiting the successor queue task", async () => {
      const fixture = createFixture();
      const calls: string[] = [];
      let releaseClose: (closed: boolean) => void = () => {};
      let releaseReopenSplit: ((paneId: string | null) => void) | undefined;

      // Hold the initial idle close in flight, then latch reopen demand via
      // active status while closing. Resolving the close hands the reopen
      // off non-awaitingly, so the reopen split records after the close
      // resolves while the close task itself has already returned.
      fixture.closePane.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolveClose) => {
            releaseClose = resolveClose;
          }),
      );
      fixture.splitPane
        .mockImplementationOnce(() => Promise.resolve(NEW_PANE_ID))
        .mockImplementationOnce(() => {
          calls.push("split");
          return new Promise<string | null>((resolve) => {
            releaseReopenSplit = resolve;
          });
        });

      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await vi.advanceTimersByTimeAsync(1000);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closing");

      await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);

      releaseClose(true);

      // The handoff must start the reopen split without awaiting it: wait
      // until the successor task is inside `splitPane`, then release.
      await vi.waitFor(() => expect(calls.length).toBe(1));
      releaseReopenSplit?.("pane-reopen");

      await vi.waitFor(() => expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached"));
      expect(calls).toEqual(["split"]);
      expect(fixture.splitPane).toHaveBeenCalledTimes(2);
      expect(fixture.attach).toHaveBeenCalledTimes(2);
      expect(fixture.info).toHaveBeenCalledWith(
        "Child reopened and attached",
        expect.objectContaining({ sessionId: CHILD_ID, paneId: "pane-reopen" }),
      );
    });

    it("uses the final work signal after work-idle-work and reopens exactly once", async () => {
      const fixture = createFixture();
      const releaseClose = await blockClosePane(fixture);

      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);

      releaseClose(true);
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached"));
      expect(fixture.splitPane).toHaveBeenCalledTimes(2);
      expect(fixture.attach).toHaveBeenCalledTimes(2);
    });

    it("does not immediately reopen when the final closing signal is idle", async () => {
      const fixture = createFixture();
      const releaseClose = await blockClosePane(fixture);

      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);

      releaseClose(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
      expect(fixture.splitPane).toHaveBeenCalledTimes(1);
      expect(fixture.attach).toHaveBeenCalledTimes(1);
    });

    it("hands an idle close to a reopen on meaningful activity without awaiting the successor queue task", async () => {
      const fixture = createFixture();
      const releaseClose = await blockClosePane(fixture);

      let releaseReopenSplit: ((paneId: string | null) => void) | undefined;
      fixture.splitPane.mockImplementationOnce(async () => {
        return new Promise<string | null>((resolve) => {
          releaseReopenSplit = resolve;
        });
      });

      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      releaseClose(true);
      await vi.advanceTimersByTimeAsync(0);

      // The close-success handoff has started the reopen spawn; the reopen
      // split is now the held in-flight call. Release it to finish attaching.
      await vi.waitFor(() => expect(releaseReopenSplit).toBeDefined());
      releaseReopenSplit?.("pane-reopen");

      await vi.waitFor(() => expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached"));
      expect(fixture.splitPane).toHaveBeenCalledTimes(2);
      expect(fixture.attach).toHaveBeenCalledTimes(2);
    });

    it("reopens through the actual idle close path when work arrives after close completes", async () => {
      const fixture = createFixture();

      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await vi.advanceTimersByTimeAsync(1000);

      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
      expect(fixture.registry.get(CHILD_ID)?.paneId).toBeUndefined();
      // The old pane position was retired: the reopen split must not target it.
      expect(fixture.splitPane).not.toHaveBeenCalledWith(
        expect.objectContaining({ paneId: NEW_PANE_ID }),
      );

      await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));

      expect(fixture.splitPane).toHaveBeenCalledTimes(2);
      expect(fixture.attach).toHaveBeenCalledWith(expect.objectContaining({ sessionId: CHILD_ID }));
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
    });

    it("reopens a reopenable child on message.updated after actual idle close", async () => {
      const fixture = createFixture();
      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await vi.advanceTimersByTimeAsync(1000);

      await fixture.orchestrator.handleEvent(messageUpdatedEvent(CHILD_ID));

      expect(fixture.attach).toHaveBeenCalledWith(expect.objectContaining({ sessionId: CHILD_ID }));
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
    });

    it("stays reopenable after a close retry when the final demand is false", async () => {
      const fixture = createFixture();
      fixture.closePane.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await driveCloseRetryWithFinalDemand(fixture, "idle");

      expect(fixture.closePane).toHaveBeenCalledTimes(2);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
      expect(fixture.splitPane).toHaveBeenCalledTimes(1);
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
    });

    it("reopens after a close retry when the final demand is true", async () => {
      const fixture = createFixture();
      fixture.closePane.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await driveCloseRetryWithFinalDemand(fixture, "work");

      expect(fixture.closePane).toHaveBeenCalledTimes(2);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
      expect(fixture.splitPane).toHaveBeenCalledTimes(2);
      expect(fixture.attach).toHaveBeenCalledTimes(2);
    });

    it("fails a claimed reopen cleanly when queue disposal rejects the successor enqueue", async () => {
      const fixture = createFixture();
      const releaseClose = await blockClosePane(fixture);
      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);

      const disposing = fixture.orchestrator.dispose();
      releaseClose(true);
      await disposing;

      await vi.waitFor(() =>
        expect(fixture.registry.get(CHILD_ID)).toMatchObject({
          state: "failed",
          failureReason: "spawn_failed",
        }),
      );
      expect(fixture.splitPane).toHaveBeenCalledTimes(1);
      expect(fixture.warn).toHaveBeenCalledWith(
        "reopen enqueue failed because the serialized queue was unavailable",
        expect.objectContaining({ sessionId: CHILD_ID }),
      );
    });

    it("reopens using the current live layout rather than the closed pane location", async () => {
      const fixture = createFixture();
      const paneIds = ["pane-2", "pane-3", "pane-4", "pane-5"];
      let splitIndex = 0;
      fixture.splitPane.mockImplementation(async () => paneIds[splitIndex++] ?? null);

      await attachChildById(fixture, "ses_childA");
      await attachChildById(fixture, "ses_childB");
      await attachChildById(fixture, "ses_childC");

      await fixture.orchestrator.handleEvent(idleEvent("ses_childA"));
      await vi.advanceTimersByTimeAsync(1000);

      expect(fixture.registry.get("ses_childA")?.state).toBe("reopenable");

      await fixture.orchestrator.handleEvent(statusEvent("ses_childA", "active"));

      expect(fixture.splitPane).toHaveBeenLastCalledWith({
        paneId: "pane-4",
        direction: "down",
        ratio: 0.5,
        noFocus: true,
      });
      expect(fixture.resizePane).toHaveBeenCalledWith({
        paneId: "pane-4",
        direction: "up",
        amount: 1 / 6,
      });
      expect(fixture.resizePane).toHaveBeenCalledWith({
        paneId: "pane-4",
        direction: "up",
        amount: 1 / 6,
      });
    });

    it("closes a newly split pane when deletion arrives during a reopen spawn", async () => {
      const fixture = createFixture();
      stageReopenableWithoutPaneLocal(fixture);

      let releaseReopenSplit: ((paneId: string | null) => void) | undefined;
      fixture.splitPane.mockImplementationOnce(
        () =>
          new Promise<string | null>((resolve) => {
            releaseReopenSplit = resolve;
          }),
      );

      const reopening = fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));
      // Wait until the queued reopen task is actually inside `splitPane`; a
      // deletion observed before the task starts would be finalized against
      // the pre-spawn reopenable state instead of racing the spawned pane.
      await vi.waitFor(() => expect(fixture.splitPane).toHaveBeenCalledTimes(1));

      const deletion = fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));
      releaseReopenSplit?.("pane-reopen");
      await Promise.all([reopening, deletion]);

      expect(fixture.closePane).toHaveBeenCalledWith("pane-reopen");
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
    });

    it("supports multiple idle-close-reopen cycles for the same child session", async () => {
      const fixture = createFixture();
      const paneIds = ["pane-2", "pane-3", "pane-4"];
      let splitIndex = 0;
      fixture.splitPane.mockImplementation(async () => paneIds[splitIndex++] ?? null);

      await attachChild(fixture);
      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await vi.advanceTimersByTimeAsync(1000);
      await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));

      await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
      await vi.advanceTimersByTimeAsync(1000);
      await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));

      expect(fixture.attach).toHaveBeenCalledTimes(3);
      expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
      expect(fixture.registry.get(CHILD_ID)?.closeReason).toBeUndefined();
      expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
    });
  });
});
