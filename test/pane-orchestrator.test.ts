import type { Event } from "@opencode-ai/sdk";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import type { AttachLauncher } from "../src/attach-launcher.js";
import { createChildSessionRegistry } from "../src/child-session-registry.js";
import type { ChildSessionRegistry } from "../src/child-session.js";
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

function createFixture(configOverrides: Partial<HerdrChildPanesConfig> = {}): Fixture {
  const config: HerdrChildPanesConfig = {
    enabled: true,
    idleGraceMs: 10000,
    maxPanes: 4,
    direction: "auto",
    closeRetries: 3,
    debug: false,
    ...configOverrides,
  };
  const registry = createChildSessionRegistry();
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
  const attachLauncher: AttachLauncher = {
    attach: vi.fn<AttachLauncher["attach"]>().mockResolvedValue(true),
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
});
