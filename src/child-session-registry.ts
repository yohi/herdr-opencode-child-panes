import {
  CHILD_SESSION_TRANSITIONS,
  type ChildSession,
  type ChildSessionRegistry,
  type ChildSessionState,
  type CreateChildSessionRegistryOptions,
  type SessionTimer,
} from "./child-session.js";

const TERMINAL_STATES = new Set<ChildSessionState>(["closed", "ignored", "failed"]);

function canTransition(from: ChildSessionState, to: ChildSessionState): boolean {
  return CHILD_SESSION_TRANSITIONS[from].includes(to);
}

export function createChildSessionRegistry(
  options: CreateChildSessionRegistryOptions = {},
): ChildSessionRegistry {
  const now = options.now ?? Date.now;
  const clearTimeoutFn = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const sessions = new Map<string, ChildSession>();
  const timers = new Map<string, SessionTimer>();

  function update(sessionId: string, changes: Partial<ChildSession>): void {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }
    sessions.set(sessionId, { ...session, ...changes, updatedAt: now() });
  }

  return {
    register(sessionId: string, parentId: string): boolean {
      if (sessions.has(sessionId)) {
        return false;
      }
      const timestamp = now();
      sessions.set(sessionId, {
        sessionId,
        parentId,
        state: "waiting_activity",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return true;
    },

    get(sessionId: string): ChildSession | undefined {
      return sessions.get(sessionId);
    },

    has(sessionId: string): boolean {
      return sessions.has(sessionId);
    },

    isTrackedDescendant(sessionId: string): boolean {
      return sessions.has(sessionId);
    },

    transitionTo(sessionId: string, state: ChildSessionState): boolean {
      const session = sessions.get(sessionId);
      if (!session || !canTransition(session.state, state)) {
        return false;
      }
      update(sessionId, { state });
      return true;
    },

    setPaneId(sessionId: string, paneId: string): void {
      update(sessionId, { paneId });
    },

    setFailureReason(sessionId: string, failureReason: string): void {
      update(sessionId, { failureReason });
    },

    listActive(): readonly ChildSession[] {
      return [...sessions.values()].filter((session) => !TERMINAL_STATES.has(session.state));
    },

    listByState(state: ChildSessionState): readonly ChildSession[] {
      return [...sessions.values()].filter((session) => session.state === state);
    },

    setTimer(sessionId: string, timer: SessionTimer): void {
      const previousTimer = timers.get(sessionId);
      if (previousTimer !== undefined) {
        clearTimeoutFn(previousTimer);
      }
      timers.set(sessionId, timer);
    },

    getTimer(sessionId: string): SessionTimer | undefined {
      return timers.get(sessionId);
    },

    clearTimer(sessionId: string): void {
      const timer = timers.get(sessionId);
      if (timer === undefined) {
        return;
      }
      timers.delete(sessionId);
      clearTimeoutFn(timer);
    },

    clearAllTimers(): void {
      for (const timer of timers.values()) {
        clearTimeoutFn(timer);
      }
      timers.clear();
    },
  };
}
