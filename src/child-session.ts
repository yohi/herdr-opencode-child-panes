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
}
