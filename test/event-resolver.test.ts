import type { Event } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";
import { resolveSessionId } from "../src/event-resolver.js";

function eventWith<T>(type: string, properties: T): Event {
  return { type, properties } as unknown as Event;
}

describe("resolveSessionId", () => {
  it("resolves session.created events from properties.info.id", () => {
    const event = eventWith("session.created", {
      info: { id: "ses_child1", parentID: "ses_root1" },
    });

    expect(resolveSessionId(event)).toBe("ses_child1");
  });

  it("resolves session.status events from properties.sessionID", () => {
    const event = eventWith("session.status", {
      sessionID: "ses_status1",
      status: { type: "busy" },
    });

    expect(resolveSessionId(event)).toBe("ses_status1");
  });

  it("resolves session.idle events from properties.sessionID", () => {
    const event = eventWith("session.idle", { sessionID: "ses_idle1" });

    expect(resolveSessionId(event)).toBe("ses_idle1");
  });

  it("resolves session.deleted events from properties.info.id", () => {
    const event = eventWith("session.deleted", { info: { id: "ses_deleted1" } });

    expect(resolveSessionId(event)).toBe("ses_deleted1");
  });

  it("resolves message.updated events from properties.info.sessionID", () => {
    const event = eventWith("message.updated", {
      info: { sessionID: "ses_msg1" },
    });

    expect(resolveSessionId(event)).toBe("ses_msg1");
  });

  it("resolves message.part.updated events from properties.part.sessionID", () => {
    const event = eventWith("message.part.updated", {
      part: { sessionID: "ses_part1" },
    });

    expect(resolveSessionId(event)).toBe("ses_part1");
  });

  it("resolves defensive message.part.delta events from direct properties", () => {
    const event = eventWith("message.part.delta", {
      sessionID: "ses_delta1",
      messageID: "msg_delta1",
      partID: "part_delta1",
      field: "text",
      delta: "updated",
    });

    expect(resolveSessionId(event)).toBe("ses_delta1");
  });

  it("returns undefined for unsupported event types", () => {
    const event = eventWith("permission.updated", { sessionID: "ses_x1" });

    expect(resolveSessionId(event)).toBeUndefined();
  });

  it("returns undefined when the resolved id is missing or malformed", () => {
    expect(resolveSessionId(eventWith("session.idle", {}))).toBeUndefined();
    expect(resolveSessionId(eventWith("message.part.updated", { part: {} }))).toBeUndefined();
    expect(resolveSessionId(eventWith("session.created", { info: {} }))).toBeUndefined();
  });
});
