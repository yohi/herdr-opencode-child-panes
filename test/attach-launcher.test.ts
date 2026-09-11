import { describe, expect, it, vi } from "vitest";
import {
  buildAttachCommand,
  createAttachLauncher,
  redactAttachCommand,
} from "../src/attach-launcher.js";
import { quoteShell } from "../src/shell-quote.js";
import type { HerdrClient } from "../src/types.js";

const SECRET_PASSWORD = "s3cret-password";
const SECRET_USERNAME = "s3cret-user";
const REDACTED = "[REDACTED]";

interface LoggerSpies {
  readonly debug: ReturnType<typeof vi.fn>;
  readonly info: ReturnType<typeof vi.fn>;
  readonly warn: ReturnType<typeof vi.fn>;
  readonly error: ReturnType<typeof vi.fn>;
}

interface LauncherHarness {
  readonly getPane: ReturnType<typeof vi.fn<HerdrClient["getPane"]>>;
  readonly runInPane: ReturnType<typeof vi.fn<HerdrClient["runInPane"]>>;
  readonly logger: LoggerSpies;
  readonly launcher: ReturnType<typeof createAttachLauncher>;
  readonly launch: ReturnType<typeof createAttachLauncher>["attach"];
}

function createHarness(
  runInPaneResult: boolean | Error,
  env: NodeJS.ProcessEnv = {},
): LauncherHarness {
  const runInPane = vi.fn<HerdrClient["runInPane"]>();
  if (runInPaneResult instanceof Error) {
    runInPane.mockRejectedValue(runInPaneResult);
  } else {
    runInPane.mockResolvedValue(runInPaneResult);
  }
  const getPane = vi.fn<HerdrClient["getPane"]>().mockResolvedValue({
    pane_id: "pane-2",
    agent_session: { agent: "opencode", value: "ses_child1" },
  });
  const client: HerdrClient = {
    getPane,
    getPaneLayout: vi.fn(),
    splitPane: vi.fn(),
    resizePane: vi.fn(),
    runInPane,
    closePane: vi.fn(),
  };
  const logger: LoggerSpies = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const launcher = createAttachLauncher({ herdrClient: client, logger, env });
  return { getPane, runInPane, logger, launcher, launch: launcher.attach };
}

function secretEnv(): NodeJS.ProcessEnv {
  return {
    OPENCODE_SERVER_PASSWORD: SECRET_PASSWORD,
    OPENCODE_SERVER_USERNAME: SECRET_USERNAME,
  };
}

function lastCommand(harness: LauncherHarness): string {
  const command = harness.runInPane.mock.calls[0]?.[1];
  if (command === undefined) {
    throw new Error("runInPane was not called");
  }
  return command;
}

describe("buildAttachCommand", () => {
  it("builds the opencode attach command with quoted arguments", () => {
    const command = buildAttachCommand({
      serverUrl: new URL("https://example.test:8443/opencode"),
      sessionId: "ses_child1",
      directory: "workspace/repo",
    });

    expect(command).toBe(
      "opencode attach 'https://example.test:8443/opencode' --session 'ses_child1' --dir 'workspace/repo'",
    );
  });

  it("strips user info credentials from the url", () => {
    const command = buildAttachCommand({
      serverUrl: new URL("https://user:secret@example.test:8443/opencode"),
      sessionId: "ses_child1",
      directory: "workspace/repo",
    });

    expect(command).toBe(
      "opencode attach 'https://example.test:8443/opencode' --session 'ses_child1' --dir 'workspace/repo'",
    );
  });
});

describe("redactAttachCommand", () => {
  it("redacts env assignments in the command", () => {
    const command = `OPENCODE_SERVER_PASSWORD=${quoteShell(SECRET_PASSWORD)} OPENCODE_SERVER_USERNAME=${quoteShell(
      SECRET_USERNAME,
    )} opencode attach`;

    expect(redactAttachCommand(command)).toBe(
      `OPENCODE_SERVER_PASSWORD=${quoteShell(REDACTED)} OPENCODE_SERVER_USERNAME=${quoteShell(
        REDACTED,
      )} opencode attach`,
    );
  });

  it("keeps a command without env assignments unchanged", () => {
    const command = "opencode attach 'https://example.test:8443'";

    expect(redactAttachCommand(command)).toBe(command);
  });

  it("redacts credentials containing shell quotes completely", () => {
    const command = `OPENCODE_SERVER_PASSWORD=${quoteShell("secret'with-quote")} opencode attach`;

    expect(redactAttachCommand(command)).toBe(
      `OPENCODE_SERVER_PASSWORD=${quoteShell(REDACTED)} opencode attach`,
    );
  });

  it("removes URL query parameters and fragments from the redacted command", () => {
    const command =
      "opencode attach 'https://example.test:8443/opencode?token=endpoint-secret#fragment-secret'";

    expect(redactAttachCommand(command)).toBe(
      "opencode attach 'https://example.test:8443/opencode'",
    );
  });
});

describe("createAttachLauncher", () => {
  it("runs the quoted attach command in the target pane", async () => {
    const harness = createHarness(true);

    const attached = await harness.launch({
      paneId: "pane-2",
      sessionId: "ses_child1",
      serverUrl: new URL("https://example.test:8443"),
      directory: "workspace/repo",
    });

    expect(attached).toBe(true);
    expect(harness.runInPane).toHaveBeenCalledTimes(1);
    expect(lastCommand(harness)).toBe(
      "opencode attach 'https://example.test:8443/' --session 'ses_child1' --dir 'workspace/repo'",
    );
  });

  it("does not embed auth env vars in the command when present", async () => {
    const harness = createHarness(true, secretEnv());

    await harness.launch({
      paneId: "pane-2",
      sessionId: "ses_child1",
      serverUrl: new URL("https://example.test:8443"),
      directory: "workspace/repo",
    });

    expect(lastCommand(harness)).toBe(
      "opencode attach 'https://example.test:8443/' --session 'ses_child1' --dir 'workspace/repo'",
    );
    expect(lastCommand(harness)).not.toContain(SECRET_PASSWORD);
    expect(lastCommand(harness)).not.toContain(SECRET_USERNAME);
    expect(harness.launcher).toHaveProperty("environment", {
      OPENCODE_SERVER_PASSWORD: SECRET_PASSWORD,
      OPENCODE_SERVER_USERNAME: SECRET_USERNAME,
    });
  });

  it("retains endpoint query parameters for execution but removes them from debug logs", async () => {
    const harness = createHarness(true);

    await harness.launch({
      paneId: "pane-2",
      sessionId: "ses_child1",
      serverUrl: new URL(
        "https://example.test:8443/opencode?token=endpoint-secret#fragment-secret",
      ),
      directory: "workspace/repo",
    });

    expect(lastCommand(harness)).toContain(
      "'https://example.test:8443/opencode?token=endpoint-secret#fragment-secret'",
    );
    expect(harness.logger.debug).toHaveBeenCalledWith(
      "Attaching OpenCode session to pane",
      expect.objectContaining({
        command:
          "opencode attach 'https://example.test:8443/opencode' --session 'ses_child1' --dir 'workspace/repo'",
      }),
    );
  });

  it("omits env assignments when credentials are missing", async () => {
    const harness = createHarness(true);

    await harness.launch({
      paneId: "pane-2",
      sessionId: "ses_child1",
      serverUrl: new URL("https://example.test:8443"),
      directory: "workspace/repo",
    });

    expect(lastCommand(harness)).toBe(
      "opencode attach 'https://example.test:8443/' --session 'ses_child1' --dir 'workspace/repo'",
    );
  });

  it("never logs credentials", async () => {
    const harness = createHarness(true, secretEnv());

    await harness.launch({
      paneId: "pane-2",
      sessionId: "ses_child1",
      serverUrl: new URL("https://example.test:8443"),
      directory: "workspace/repo",
    });

    for (const level of ["debug", "info", "warn", "error"] as const) {
      for (const call of harness.logger[level].mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(SECRET_PASSWORD);
        expect(serialized).not.toContain(SECRET_USERNAME);
      }
    }
  });

  it("logs the command without authentication values at debug level", async () => {
    const harness = createHarness(true, secretEnv());

    await harness.launch({
      paneId: "pane-2",
      sessionId: "ses_child1",
      serverUrl: new URL("https://example.test:8443"),
      directory: "workspace/repo",
    });

    expect(harness.logger.debug).toHaveBeenCalledWith(
      "Attaching OpenCode session to pane",
      expect.objectContaining({
        paneId: "pane-2",
        sessionId: "ses_child1",
        command:
          "opencode attach 'https://example.test:8443/' --session 'ses_child1' --dir 'workspace/repo'",
      }),
    );
  });

  it("polls for OpenCode without resending the attach command", async () => {
    const harness = createHarness(true);
    harness.getPane.mockResolvedValueOnce({ pane_id: "pane-2" }).mockResolvedValue({
      pane_id: "pane-2",
      agent_session: { agent: "opencode", value: "ses_child1" },
    });

    const attached = await harness.launch({
      paneId: "pane-2",
      sessionId: "ses_child1",
      serverUrl: new URL("https://example.test:8443"),
      directory: "workspace/repo",
    });

    expect(attached).toBe(true);
    expect(harness.getPane).toHaveBeenCalledTimes(2);
    expect(harness.runInPane).toHaveBeenCalledTimes(1);
  });

  it("accepts a pane identified by its top-level agent", async () => {
    const harness = createHarness(true);
    harness.getPane.mockResolvedValue({
      pane_id: "pane-2",
      agent: "opencode",
    });

    const attached = await harness.launch({
      paneId: "pane-2",
      sessionId: "ses_child1",
      serverUrl: new URL("https://example.test:8443"),
      directory: "workspace/repo",
    });

    expect(attached).toBe(true);
    expect(harness.getPane).toHaveBeenCalledTimes(1);
  });

  it("returns false when the pane run reports failure", async () => {
    const harness = createHarness(false, secretEnv());

    const attached = await harness.launch({
      paneId: "pane-2",
      sessionId: "ses_child1",
      serverUrl: new URL("https://example.test:8443"),
      directory: "workspace/repo",
    });

    expect(attached).toBe(false);
    expect(harness.logger.warn).toHaveBeenCalled();
  });

  it("returns false and logs an error when the pane run throws", async () => {
    const harness = createHarness(new Error("boom"), secretEnv());

    const attached = await harness.launch({
      paneId: "pane-2",
      sessionId: "ses_child1",
      serverUrl: new URL("https://example.test:8443"),
      directory: "workspace/repo",
    });

    expect(attached).toBe(false);
    expect(harness.logger.error).toHaveBeenCalled();
  });
});
