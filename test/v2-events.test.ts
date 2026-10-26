import { describe, expect, it } from "vitest";
import { normalizeV2Event } from "../src/v2-events.js";

const directory = "/project";

describe("OpenCode V2.1.4 event normalization", () => {
  it("registers only explicitly parented, same-location children", () => {
    expect(
      normalizeV2Event(
        {
          type: "session.created",
          data: { sessionID: "ses_child", parentID: "ses_root", location: { directory } },
        },
        directory,
      ),
    ).toEqual({
      type: "session.created",
      properties: { info: { id: "ses_child", parentID: "ses_root" } },
    });
    expect(
      normalizeV2Event(
        {
          type: "session.created",
          data: { sessionID: "ses_child", parentID: "ses_root", location: { directory: "/other" } },
        },
        directory,
      ),
    ).toBeUndefined();
    expect(
      normalizeV2Event(
        {
          type: "session.created",
          data: { sessionID: "ses_child", location: { directory } },
        },
        directory,
      ),
    ).toBeUndefined();
  });

  it("maps execution/part activity and ignores raw busy status", () => {
    for (const type of [
      "session.execution.started",
      "session.step.started",
      "session.text.started",
      "session.reasoning.started",
      "session.tool.called",
    ]) {
      expect(normalizeV2Event({ type, data: { sessionID: "ses_child" } })).toEqual({
        type: "session.status",
        properties: { sessionID: "ses_child", status: { type: "busy" } },
      });
    }
    expect(
      normalizeV2Event({
        type: "session.status",
        data: { sessionID: "ses_child", status: { type: "busy" } },
      }),
    ).toBeUndefined();
  });

  it("recognizes both idle forms and terminal deletion without guessing", () => {
    expect(
      normalizeV2Event({
        type: "session.status",
        data: { sessionID: "ses_child", status: { type: "idle" } },
      }),
    ).toEqual({
      type: "session.status",
      properties: { sessionID: "ses_child", status: { type: "idle" } },
    });
    expect(
      normalizeV2Event({
        type: "session.idle",
        data: { sessionID: "ses_child" },
      }),
    ).toEqual({ type: "session.idle", properties: { sessionID: "ses_child" } });
    expect(
      normalizeV2Event({
        type: "session.deleted",
        data: { sessionID: "ses_child" },
      }),
    ).toEqual({ type: "session.deleted", properties: { info: { id: "ses_child" } } });
    expect(
      normalizeV2Event({ type: "session.deleted", data: { info: { id: "ses_child" } } }),
    ).toBeUndefined();
    expect(
      normalizeV2Event({ type: "session.execution.started", data: { sessionID: "" } }),
    ).toBeUndefined();
    expect(
      normalizeV2Event({ type: "message.updated", data: { sessionID: "ses_child" } }),
    ).toBeUndefined();
  });
});
