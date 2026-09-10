import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Runner, createHerdrClient, subcommandName } from "../src/herdr-client.js";
import type { Logger } from "../src/logger.js";
import type { Direction } from "../src/types.js";

const mockRunner = vi.fn<Runner>();

function mockRunnerStdout(stdout: string): void {
  mockRunner.mockResolvedValue(Buffer.from(stdout));
}

function mockRunnerError(code: string | number, message = "herdr failed"): void {
  const error = Object.assign(new Error(message), { code: String(code) });
  mockRunner.mockRejectedValue(error);
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("subcommandName", () => {
  it("includes the namespace for a command with two argv entries", () => {
    expect(subcommandName(["pane", "list"])).toBe("pane list");
  });

  it("uses the only argv entry for a single-element command", () => {
    expect(subcommandName(["pane"])).toBe("pane");
  });
});

describe("createHerdrClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPane", () => {
    it("returns parsed pane info when herdr exits cleanly", async () => {
      mockRunnerStdout(JSON.stringify({ id: "pane-1" }));
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.getPane("pane-1");

      expect(result).toEqual({ id: "pane-1" });
      expect(mockRunner).toHaveBeenCalledWith("herdr", ["pane", "get", "pane-1"], 5000);
    });

    it("returns null when herdr exits with a non-zero code", async () => {
      mockRunnerError(1);
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.getPane("pane-1");

      expect(result).toBeNull();
    });

    it("returns null when the command times out", async () => {
      mockRunnerError("ETIMEDOUT");
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.getPane("pane-1");

      expect(result).toBeNull();
    });

    it("returns null when stdout is not valid JSON", async () => {
      mockRunnerStdout("not-json");
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.getPane("pane-1");

      expect(result).toBeNull();
    });

    it("returns null when the parsed JSON lacks a required field", async () => {
      mockRunnerStdout(JSON.stringify({ name: "pane-1" }));
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.getPane("pane-1");

      expect(result).toBeNull();
    });

    it("logs failures without exposing command details", async () => {
      mockRunnerError(1, "Command failed: secret-token");
      const logger = createMockLogger();
      const client = createHerdrClient({ runner: mockRunner, logger });

      await client.getPane("pane-1");

      expect(logger.warn).toHaveBeenCalled();
      const call = vi.mocked(logger.warn).mock.calls[0];
      expect(JSON.stringify(call)).not.toContain("secret-token");
    });

    it("logs the pane namespace and subcommand without runtime arguments", async () => {
      mockRunnerError(1);
      const logger = createMockLogger();
      const client = createHerdrClient({ runner: mockRunner, logger });

      await client.getPane("pane-1");

      const call = vi.mocked(logger.warn).mock.calls[0];
      expect(call?.[0]).toBe("Herdr pane get command failed");
    });
  });

  describe("getPaneLayout", () => {
    it("returns parsed layout when herdr exits cleanly", async () => {
      mockRunnerStdout(
        JSON.stringify({
          paneId: "pane-1",
          direction: "horizontal" satisfies Direction,
          children: [{ id: "pane-2" }],
        }),
      );
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.getPaneLayout("pane-1");

      expect(result).toEqual({
        paneId: "pane-1",
        direction: "horizontal",
        children: [{ id: "pane-2" }],
      });
      expect(mockRunner).toHaveBeenCalledWith(
        "herdr",
        ["pane", "layout", "--pane", "pane-1"],
        5000,
      );
    });

    it("returns null on non-zero exit", async () => {
      mockRunnerError(1);
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.getPaneLayout("pane-1");

      expect(result).toBeNull();
    });

    it("returns null on malformed JSON", async () => {
      mockRunnerStdout("{");
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.getPaneLayout("pane-1");

      expect(result).toBeNull();
    });
  });

  describe("splitPane", () => {
    it("returns the new pane id parsed from the response", async () => {
      mockRunnerStdout(JSON.stringify({ id: "pane-2" }));
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.splitPane({ paneId: "pane-1" });

      expect(result).toBe("pane-2");
    });

    it("passes direction and command as argv entries", async () => {
      mockRunnerStdout(JSON.stringify({ id: "pane-2" }));
      const client = createHerdrClient({ runner: mockRunner });

      await client.splitPane({
        paneId: "pane-1",
        direction: "vertical",
        command: "vim",
      });

      expect(mockRunner).toHaveBeenCalledWith(
        "herdr",
        ["pane", "split", "--pane", "pane-1", "--direction", "vertical", "--command", "vim"],
        5000,
      );
    });

    it("returns null when the response has no id", async () => {
      mockRunnerStdout(JSON.stringify({ ok: true }));
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.splitPane({ paneId: "pane-1" });

      expect(result).toBeNull();
    });

    it("returns null on non-zero exit", async () => {
      mockRunnerError(1);
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.splitPane({ paneId: "pane-1" });

      expect(result).toBeNull();
    });
  });

  describe("runInPane", () => {
    it("returns true when herdr exits cleanly", async () => {
      mockRunnerStdout("");
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.runInPane("pane-1", "echo hello");

      expect(result).toBe(true);
      expect(mockRunner).toHaveBeenCalledWith(
        "herdr",
        ["pane", "run", "pane-1", "echo hello"],
        5000,
      );
    });

    it("returns false on non-zero exit", async () => {
      mockRunnerError(1);
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.runInPane("pane-1", "echo hello");

      expect(result).toBe(false);
    });

    it("passes the command as a single argv entry", async () => {
      mockRunnerStdout("");
      const client = createHerdrClient({ runner: mockRunner });

      await client.runInPane("pane-1", "echo hello; echo world");

      const args = mockRunner.mock.calls[0][1];
      expect(args).toEqual(["pane", "run", "pane-1", "echo hello; echo world"]);
    });
  });

  describe("closePane", () => {
    it("returns true when herdr exits cleanly", async () => {
      mockRunnerStdout("");
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.closePane("pane-1");

      expect(result).toBe(true);
      expect(mockRunner).toHaveBeenCalledWith("herdr", ["pane", "close", "pane-1"], 5000);
    });

    it("returns false on non-zero exit", async () => {
      mockRunnerError(1);
      const client = createHerdrClient({ runner: mockRunner });

      const result = await client.closePane("pane-1");

      expect(result).toBe(false);
    });
  });

  it("uses the configured timeout", async () => {
    mockRunnerStdout(JSON.stringify({ id: "pane-1" }));
    const client = createHerdrClient({ runner: mockRunner, timeoutMs: 3000 });

    await client.getPane("pane-1");

    expect(mockRunner).toHaveBeenCalledWith("herdr", ["pane", "get", "pane-1"], 3000);
  });

  it("uses the configured herdr path", async () => {
    mockRunnerStdout(JSON.stringify({ id: "pane-1" }));
    const client = createHerdrClient({ runner: mockRunner, herdrPath: "/usr/local/bin/herdr" });

    await client.getPane("pane-1");

    expect(mockRunner).toHaveBeenCalledWith(
      "/usr/local/bin/herdr",
      ["pane", "get", "pane-1"],
      5000,
    );
  });
});
