import { describe, expect, it, vi } from "vitest";
import { buildAttachCommand, createAttachLauncher } from "../src/attach-launcher.js";
import type { HerdrClient } from "../src/types.js";

describe("V2 CLI invocation", () => {
  it("uses only V2 root flags and quotes all untrusted values", () => {
    expect(buildAttachCommand({
      paneId: "pane-2", sessionId: "ses_x' ; touch /tmp/fail",
      serverUrl: new URL("https://user:pass@example.test:3333"),
      directory: "/tmp/work tree",
    }, "v2")).toBe(
      "opencode '/tmp/work tree' --server 'https://example.test:3333/' --session 'ses_x'\\'' ; touch /tmp/fail'",
    );
  });

  it("never emits URL secrets in debug command, even with a quote in the query", async () => {
    const debug = vi.fn();
    const client: HerdrClient = {
      getPane: vi.fn().mockResolvedValue({ pane_id: "child", agent: "opencode" }),
      getPaneLayout: vi.fn(),
      splitPane: vi.fn(),
      resizePane: vi.fn(),
      runInPane: vi.fn().mockResolvedValue(true),
      closePane: vi.fn(),
    };
    const launcher = createAttachLauncher({
      herdrClient: client, mode: "v2",
      logger: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await launcher.attach({
      paneId: "child", sessionId: "ses_child",
      directory: "/tmp/project",
      serverUrl: new URL("https://user:password@example.test/path?token=secret%27query#secretfragment"),
    });
    expect(JSON.stringify(debug.mock.calls)).not.toContain("password");
    expect(JSON.stringify(debug.mock.calls)).not.toContain("secret");
    expect(vi.mocked(client.runInPane)).toHaveBeenCalledOnce();
  });
});
