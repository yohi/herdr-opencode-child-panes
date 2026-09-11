import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRootSessionResolver } from "../src/root-session-resolver.js";
import type { HerdrClient, PaneInfo } from "../src/types.js";

const OPCODE_AGENT = "opencode";
const PANE_ID = "pane-1";
const ROOT_SESSION_ID = "ses_abc123";

function createMockClient(): HerdrClient {
  return {
    getPane: vi.fn(),
    getPaneLayout: vi.fn(),
    splitPane: vi.fn(),
    resizePane: vi.fn(),
    runInPane: vi.fn(),
    closePane: vi.fn(),
  };
}

function opencodePaneInfo(sessionId: string): PaneInfo {
  return {
    pane_id: PANE_ID,
    agent_session: {
      agent: OPCODE_AGENT,
      value: sessionId,
    },
  };
}

describe("createRootSessionResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the root session id from opencode agent_session metadata", async () => {
    const client = createMockClient();
    vi.mocked(client.getPane).mockResolvedValue(opencodePaneInfo(ROOT_SESSION_ID));
    const resolver = createRootSessionResolver({ paneId: PANE_ID, herdrClient: client });

    const result = await resolver.resolve();

    expect(result).toEqual({ rootSessionId: ROOT_SESSION_ID });
    expect(client.getPane).toHaveBeenCalledTimes(1);
    expect(client.getPane).toHaveBeenCalledWith(PANE_ID);
  });

  it("resolves the root session id from Herdr's live agent_session value field", async () => {
    const client = createMockClient();
    vi.mocked(client.getPane).mockResolvedValue({
      pane_id: PANE_ID,
      agent_session: {
        agent: OPCODE_AGENT,
        value: ROOT_SESSION_ID,
      },
    });
    const resolver = createRootSessionResolver({ paneId: PANE_ID, herdrClient: client });

    const result = await resolver.resolve();

    expect(result).toEqual({ rootSessionId: ROOT_SESSION_ID });
  });

  it("returns no root session when pane metadata is missing agent_session", async () => {
    const client = createMockClient();
    vi.mocked(client.getPane).mockResolvedValue({ pane_id: PANE_ID });
    const resolver = createRootSessionResolver({ paneId: PANE_ID, herdrClient: client });

    const result = await resolver.resolve();

    expect(result).toEqual({ rootSessionId: undefined });
  });

  it("returns no root session when agent_session names a different agent", async () => {
    const client = createMockClient();
    vi.mocked(client.getPane).mockResolvedValue({
      pane_id: PANE_ID,
      agent_session: {
        agent: "claude",
        value: ROOT_SESSION_ID,
      },
    });
    const resolver = createRootSessionResolver({ paneId: PANE_ID, herdrClient: client });

    const result = await resolver.resolve();

    expect(result).toEqual({ rootSessionId: undefined });
  });

  it("returns no root session when Herdr lookup fails", async () => {
    const client = createMockClient();
    vi.mocked(client.getPane).mockResolvedValue(null);
    const resolver = createRootSessionResolver({ paneId: PANE_ID, herdrClient: client });

    const result = await resolver.resolve();

    expect(result).toEqual({ rootSessionId: undefined });
  });

  it("uses the cached pane metadata within the TTL", async () => {
    const client = createMockClient();
    vi.mocked(client.getPane).mockResolvedValue(opencodePaneInfo(ROOT_SESSION_ID));
    let nowMs = 0;
    const resolver = createRootSessionResolver({
      paneId: PANE_ID,
      herdrClient: client,
      cacheTtlMs: 1000,
      now: () => nowMs,
    });

    await resolver.resolve();
    nowMs = 999;
    const result = await resolver.resolve();

    expect(result).toEqual({ rootSessionId: ROOT_SESSION_ID });
    expect(client.getPane).toHaveBeenCalledTimes(1);
  });

  it("refetches pane metadata after the cache TTL expires", async () => {
    const client = createMockClient();
    vi.mocked(client.getPane)
      .mockResolvedValueOnce(opencodePaneInfo(ROOT_SESSION_ID))
      .mockResolvedValueOnce({
        pane_id: PANE_ID,
        agent_session: {
          agent: OPCODE_AGENT,
          value: "ses_updated",
        },
      });
    let nowMs = 0;
    const resolver = createRootSessionResolver({
      paneId: PANE_ID,
      herdrClient: client,
      cacheTtlMs: 1000,
      now: () => nowMs,
    });

    await resolver.resolve();
    nowMs = 1000;
    const result = await resolver.resolve();

    expect(result).toEqual({ rootSessionId: "ses_updated" });
    expect(client.getPane).toHaveBeenCalledTimes(2);
  });

  it("defaults the cache TTL to 750 ms", async () => {
    const client = createMockClient();
    vi.mocked(client.getPane).mockResolvedValue(opencodePaneInfo(ROOT_SESSION_ID));
    let nowMs = 0;
    const resolver = createRootSessionResolver({
      paneId: PANE_ID,
      herdrClient: client,
      now: () => nowMs,
    });

    await resolver.resolve();
    nowMs = 749;
    const cached = await resolver.resolve();
    nowMs = 750;
    const refetched = await resolver.resolve();

    expect(cached).toEqual({ rootSessionId: ROOT_SESSION_ID });
    expect(refetched).toEqual({ rootSessionId: ROOT_SESSION_ID });
    expect(client.getPane).toHaveBeenCalledTimes(2);
  });
});
