import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChildSessionRegistry } from "../src/child-session-registry.js";
import { createChildOwnershipResolver } from "../src/ownership-resolver.js";
import { createRootSessionResolver } from "../src/root-session-resolver.js";
import type { HerdrClient, PaneInfo } from "../src/types.js";

const PANE_ID = "pane-1";
const ROOT_SESSION_ID = "ses_root123";

function createMockClient(): HerdrClient {
  return {
    getPane: vi.fn(),
    getPaneLayout: vi.fn(),
    splitPane: vi.fn(),
    runInPane: vi.fn(),
    closePane: vi.fn(),
  };
}

function opencodePaneInfo(sessionId: string): PaneInfo {
  return {
    pane_id: PANE_ID,
    agent_session: {
      agent: "opencode",
      value: sessionId,
    },
  };
}

interface ResolverHarness {
  readonly client: HerdrClient;
  readonly registry: ReturnType<typeof createChildSessionRegistry>;
  readonly resolver: ReturnType<typeof createChildOwnershipResolver>;
}

function createHarness(rootSessionId: string | null): ResolverHarness {
  const client = createMockClient();
  vi.mocked(client.getPane).mockResolvedValue(
    rootSessionId === null ? null : opencodePaneInfo(rootSessionId),
  );
  const nowMs = 0;
  const registry = createChildSessionRegistry({ now: () => nowMs });
  const rootSessionResolver = createRootSessionResolver({
    paneId: PANE_ID,
    herdrClient: client,
    cacheTtlMs: 1000,
    now: () => nowMs,
  });
  return {
    client,
    registry,
    resolver: createChildOwnershipResolver({ rootSessionResolver, registry }),
  };
}

describe("createChildOwnershipResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a direct child of the resolved root session", async () => {
    const harness = createHarness(ROOT_SESSION_ID);

    const owned = await harness.resolver.isOwnedChild({
      sessionId: "ses_child1",
      parentId: ROOT_SESSION_ID,
    });

    expect(owned).toBe(true);
  });

  it("accepts a nested descendant whose parent is already tracked", async () => {
    const harness = createHarness(ROOT_SESSION_ID);
    harness.registry.register("ses_child1", ROOT_SESSION_ID);

    const owned = await harness.resolver.isOwnedChild({
      sessionId: "ses_grandchild1",
      parentId: "ses_child1",
    });

    expect(owned).toBe(true);
  });

  it("rejects a child created under an unrelated root session", async () => {
    const harness = createHarness(ROOT_SESSION_ID);

    const owned = await harness.resolver.isOwnedChild({
      sessionId: "ses_other_child",
      parentId: "ses_other_root",
    });

    expect(owned).toBe(false);
    expect(harness.resolver.isTrackedDescendant("ses_other_child")).toBe(false);
  });

  it("rejects a child whose parent is unknown to the registry", async () => {
    const harness = createHarness(ROOT_SESSION_ID);

    const owned = await harness.resolver.isOwnedChild({
      sessionId: "ses_child2",
      parentId: "ses_unknown_parent",
    });

    expect(owned).toBe(false);
  });

  it("rejects a child of a tracked session that was marked ignored", async () => {
    const harness = createHarness(ROOT_SESSION_ID);
    harness.registry.register("ses_ignored", ROOT_SESSION_ID);
    harness.registry.transitionTo("ses_ignored", "ignored");

    const childOwned = await harness.resolver.isOwnedChild({
      sessionId: "ses_child_of_ignored",
      parentId: "ses_ignored",
    });
    const grandchildOwned = await harness.resolver.isOwnedChild({
      sessionId: "ses_grandchild_of_ignored",
      parentId: "ses_child_of_ignored",
    });

    expect(childOwned).toBe(false);
    expect(grandchildOwned).toBe(false);
  });

  it("rejects a child of a tracked session that was closed", async () => {
    const harness = createHarness(ROOT_SESSION_ID);
    harness.registry.register("ses_closed", ROOT_SESSION_ID);
    harness.registry.transitionTo("ses_closed", "closing");
    harness.registry.transitionTo("ses_closed", "closed");

    const childOwned = await harness.resolver.isOwnedChild({
      sessionId: "ses_child_of_closed",
      parentId: "ses_closed",
    });

    expect(childOwned).toBe(false);
  });

  it("rejects every child while the root session is unavailable", async () => {
    const harness = createHarness(null);

    const owned = await harness.resolver.isOwnedChild({
      sessionId: "ses_child1",
      parentId: ROOT_SESSION_ID,
    });

    expect(owned).toBe(false);
  });

  it("answers duplicate created events idempotently without extra Herdr calls", async () => {
    const harness = createHarness(ROOT_SESSION_ID);
    const input = { sessionId: "ses_child1", parentId: ROOT_SESSION_ID } as const;

    const first = await harness.resolver.isOwnedChild(input);
    const second = await harness.resolver.isOwnedChild(input);
    const registeredFirst = harness.registry.register(input.sessionId, input.parentId);
    const registeredAgain = harness.registry.register(input.sessionId, input.parentId);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(registeredFirst).toBe(true);
    expect(registeredAgain).toBe(false);
    expect(harness.client.getPane).toHaveBeenCalledTimes(1);
  });

  it("does not claim a self-parented session as an owned child", async () => {
    const harness = createHarness(ROOT_SESSION_ID);

    const owned = await harness.resolver.isOwnedChild({
      sessionId: ROOT_SESSION_ID,
      parentId: ROOT_SESSION_ID,
    });

    expect(owned).toBe(false);
    expect(harness.resolver.isTrackedDescendant(ROOT_SESSION_ID)).toBe(false);
  });

  it("reports tracked descendant state from the registry", () => {
    const harness = createHarness(ROOT_SESSION_ID);

    expect(harness.resolver.isTrackedDescendant("ses_child1")).toBe(false);
    harness.registry.register("ses_child1", ROOT_SESSION_ID);

    expect(harness.resolver.isTrackedDescendant("ses_child1")).toBe(true);
  });
});
