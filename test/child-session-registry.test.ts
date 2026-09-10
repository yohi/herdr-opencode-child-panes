import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChildSessionRegistry } from "../src/child-session-registry.js";

describe("createChildSessionRegistry", () => {
  it("transitions a registered child through its legal lifecycle", () => {
    // Given
    let now = 100;
    const registry = createChildSessionRegistry({ now: () => now });
    registry.register("child-1", "root-1");

    // When
    now = 200;
    const spawning = registry.transitionTo("child-1", "spawning");
    now = 300;
    const attached = registry.transitionTo("child-1", "attached");

    // Then
    expect(spawning).toBe(true);
    expect(attached).toBe(true);
    expect(registry.get("child-1")).toEqual({
      sessionId: "child-1",
      parentId: "root-1",
      state: "attached",
      createdAt: 100,
      updatedAt: 300,
    });
  });

  it("rejects an illegal lifecycle transition without changing the record", () => {
    // Given
    const registry = createChildSessionRegistry();
    registry.register("child-1", "root-1");

    // When
    const transitioned = registry.transitionTo("child-1", "attached");

    // Then
    expect(transitioned).toBe(false);
    expect(registry.get("child-1")?.state).toBe("waiting_activity");
  });

  it("makes duplicate child registrations idempotent", () => {
    // Given
    const registry = createChildSessionRegistry();
    const registered = registry.register("child-1", "root-1");

    // When
    const registeredAgain = registry.register("child-1", "other-parent");

    // Then
    expect(registered).toBe(true);
    expect(registeredAgain).toBe(false);
    expect(registry.get("child-1")?.parentId).toBe("root-1");
  });

  it("records pane and failure metadata", () => {
    // Given
    const registry = createChildSessionRegistry();
    registry.register("child-1", "root-1");

    // When
    registry.setPaneId("child-1", "pane-1");
    registry.setFailureReason("child-1", "split_failed");

    // Then
    expect(registry.get("child-1")).toMatchObject({
      paneId: "pane-1",
      failureReason: "split_failed",
    });
  });

  it("lists only non-terminal child sessions as active", () => {
    // Given
    const registry = createChildSessionRegistry();
    registry.register("waiting", "root-1");
    registry.register("closed", "root-1");
    registry.register("ignored", "root-1");
    registry.register("failed", "root-1");
    registry.transitionTo("closed", "closing");
    registry.transitionTo("closed", "closed");
    registry.transitionTo("ignored", "ignored");
    registry.transitionTo("failed", "failed");

    // When
    const active = registry.listActive();

    // Then
    expect(active.map((session) => session.sessionId)).toEqual(["waiting"]);
    expect(registry.listByState("closed").map((session) => session.sessionId)).toEqual(["closed"]);
  });
});

describe("createChildSessionRegistry timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and returns a pending timer per session", () => {
    // Given
    const registry = createChildSessionRegistry();
    const timer = setTimeout(() => {}, 1000);

    // When
    registry.setTimer("child-1", timer);

    // Then
    expect(registry.getTimer("child-1")).toBe(timer);
    expect(registry.getTimer("child-2")).toBeUndefined();
  });

  it("cancels the old handle when a session replaces its timer", () => {
    // Given
    const clearTimeoutFn = vi.fn();
    const registry = createChildSessionRegistry({ clearTimeout: clearTimeoutFn });
    const first = setTimeout(() => {}, 1000);
    const second = setTimeout(() => {}, 2000);

    // When
    registry.setTimer("child-1", first);
    registry.setTimer("child-1", second);

    // Then
    expect(registry.getTimer("child-1")).toBe(second);
    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(clearTimeoutFn).toHaveBeenCalledWith(first);

    registry.clearTimer("child-1");

    expect(clearTimeoutFn).toHaveBeenCalledTimes(2);
    expect(clearTimeoutFn).toHaveBeenLastCalledWith(second);
    expect(registry.getTimer("child-1")).toBeUndefined();
  });

  it("cancels and forgets the timer on clearTimer", () => {
    // Given
    const clearTimeoutFn = vi.fn();
    const registry = createChildSessionRegistry({ clearTimeout: clearTimeoutFn });
    const timer = setTimeout(() => {}, 1000);
    registry.setTimer("child-1", timer);

    // When
    registry.clearTimer("child-1");

    // Then
    expect(clearTimeoutFn).toHaveBeenCalledWith(timer);
    expect(registry.getTimer("child-1")).toBeUndefined();
  });

  it("treats clearTimer for an unknown session as a no-op", () => {
    // Given
    const clearTimeoutFn = vi.fn();
    const registry = createChildSessionRegistry({ clearTimeout: clearTimeoutFn });

    // When
    registry.clearTimer("child-unknown");

    // Then
    expect(clearTimeoutFn).not.toHaveBeenCalled();
  });

  it("cancels every stored timer on clearAllTimers", () => {
    // Given
    const clearTimeoutFn = vi.fn();
    const registry = createChildSessionRegistry({ clearTimeout: clearTimeoutFn });
    const timerA = setTimeout(() => {}, 1000);
    const timerB = setTimeout(() => {}, 2000);
    registry.setTimer("child-a", timerA);
    registry.setTimer("child-b", timerB);

    // When
    registry.clearAllTimers();

    // Then
    expect(clearTimeoutFn).toHaveBeenCalledWith(timerA);
    expect(clearTimeoutFn).toHaveBeenCalledWith(timerB);
    expect(registry.getTimer("child-a")).toBeUndefined();
    expect(registry.getTimer("child-b")).toBeUndefined();
  });
});
