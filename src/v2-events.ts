/**
 * OpenCode v2.1.4 events are framed as { type, data, ... }.
 * Only documented, session-scoped payloads may drive a child pane.
 * No legacy or speculative event envelopes are accepted here.
 *
 * The existing pane orchestrator deliberately consumes an internal normalized
 * event shape, so ownership, capacity, and closing stay unchanged.
 */
export interface V2Event {
  readonly type: string;
  readonly data: unknown;
  readonly location?: unknown;
}

export interface NormalizedPaneEvent {
  readonly type: string;
  readonly properties: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function sessionId(data: unknown): string | undefined {
  const value = record(data)?.sessionID;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

const ACTIVITY = new Set([
  "session.execution.started",
  "session.step.started",
  "session.text.started",
  "session.reasoning.started",
  "session.tool.called",
]);

/** Fail-closed: do not infer session identity or root ownership from the envelope. */
export function normalizeV2Event(
  event: V2Event,
  pluginDirectory?: string,
): NormalizedPaneEvent | undefined {
  const id = sessionId(event.data);
  if (!id) return undefined;

  if (event.type === "session.created") {
    const data = record(event.data);
    const parent = data?.parentID;
    if (typeof parent !== "string" || parent.trim().length === 0) return undefined;
    // The V2 plugin location need not be the session's current location.
    // Until cross-location attach is validated, never attach in a guessed directory.
    const location = record(data?.location);
    if (
      pluginDirectory !== undefined &&
      (typeof location?.directory !== "string" || location.directory !== pluginDirectory)
    ) return undefined;
    return { type: "session.created", properties: { info: { id, parentID: parent } } };
  }
  if (event.type === "session.deleted") {
    return { type: "session.deleted", properties: { info: { id } } };
  }
  if (event.type === "session.status") {
    if (record(record(event.data)?.status)?.type !== "idle") return undefined;
    return { type: "session.status", properties: { sessionID: id, status: { type: "idle" } } };
  }
  if (event.type === "session.idle") {
    return { type: "session.idle", properties: { sessionID: id } };
  }
  if (ACTIVITY.has(event.type)) {
    // Only an actual execution/step/part signal may become "busy".
    // A raw V2 session.status=busy MUST NOT create a pane.
    return { type: "session.status", properties: { sessionID: id, status: { type: "busy" } } };
  }
  return undefined;
}
