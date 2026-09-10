export type ChildSessionState =
  | "waiting_activity"
  | "spawning"
  | "attached"
  | "idle_pending"
  | "closing"
  | "closed"
  | "ignored"
  | "failed";

export interface ChildSession {
  readonly sessionId: string;
  readonly parentId: string;
  readonly state: ChildSessionState;
  readonly paneId?: string;
  readonly failureReason?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ChildSessionRegistry {
  register(sessionId: string, parentId: string): boolean;
  get(sessionId: string): ChildSession | undefined;
  has(sessionId: string): boolean;
  isTrackedDescendant(sessionId: string): boolean;
  transitionTo(sessionId: string, state: ChildSessionState): boolean;
  setPaneId(sessionId: string, paneId: string): void;
  setFailureReason(sessionId: string, reason: string): void;
  listActive(): readonly ChildSession[];
  listByState(state: ChildSessionState): readonly ChildSession[];
  /** Store the pending timer handle for a session, replacing any previous one. */
  setTimer(sessionId: string, timer: SessionTimer): void;
  /** Return the pending timer handle for a session, if any. */
  getTimer(sessionId: string): SessionTimer | undefined;
  /** Cancel and forget the pending timer handle for a session; no-op if absent. */
  clearTimer(sessionId: string): void;
  /** Cancel and forget every pending timer handle. */
  clearAllTimers(): void;
}

export const CHILD_SESSION_TRANSITIONS: Readonly<
  Record<ChildSessionState, readonly ChildSessionState[]>
> = {
  waiting_activity: ["spawning", "closing", "ignored", "failed"],
  spawning: ["attached", "closing", "failed"],
  attached: ["idle_pending", "closing", "failed"],
  idle_pending: ["attached", "closing", "failed"],
  closing: ["closed", "failed"],
  closed: [],
  ignored: [],
  failed: [],
};

export interface CreateChildSessionRegistryOptions {
  readonly now?: () => number;
  /** Timer cancellation used by clearTimer/clearAllTimers. */
  readonly clearTimeout?: typeof globalThis.clearTimeout;
}

/**
 * Handle for a scheduled timer, as returned by `setTimeout`.
 */
export type SessionTimer = ReturnType<typeof setTimeout>;
