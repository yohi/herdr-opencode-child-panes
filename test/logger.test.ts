import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes enabled log levels to the configured sink instead of the console", () => {
    const sink = vi.fn();
    const consoleSpies = [
      vi.spyOn(console, "debug").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    const logger = createLogger(true, sink);

    logger.debug("debug message", { paneId: "pane-1" });
    logger.info("info message", { serverUrl: "https://example.test" });
    logger.warn("warn message", { sessionId: "ses-1" });
    logger.error("error message", { parentId: "ses-root" });

    expect(sink).toHaveBeenCalledWith({
      service: "herdr-child-panes",
      level: "debug",
      message: "debug message",
      extra: { paneId: "pane-1" },
    });
    expect(sink).toHaveBeenCalledWith({
      service: "herdr-child-panes",
      level: "info",
      message: "info message",
      extra: { serverUrl: "https://example.test" },
    });
    expect(sink).toHaveBeenCalledWith({
      service: "herdr-child-panes",
      level: "warn",
      message: "warn message",
      extra: { sessionId: "ses-1" },
    });
    expect(sink).toHaveBeenCalledWith({
      service: "herdr-child-panes",
      level: "error",
      message: "error message",
      extra: { parentId: "ses-root" },
    });
    for (const consoleSpy of consoleSpies) {
      expect(consoleSpy).not.toHaveBeenCalled();
    }
  });
});
