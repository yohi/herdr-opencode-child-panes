import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("returns defaults when no environment variables are set", () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("parses explicit overrides", () => {
    const env = {
      HERDR_CHILD_PANES: "false",
      HERDR_CHILD_PANES_IDLE_MS: "5000",
      HERDR_CHILD_PANES_MAX: "2",
      HERDR_CHILD_PANES_DIRECTION: "vertical",
      HERDR_CHILD_PANES_DEBUG: "true",
    };

    expect(parseConfig(env)).toEqual({
      enabled: false,
      idleGraceMs: 5000,
      maxPanes: 2,
      direction: "vertical",
      closeRetries: 3,
      debug: true,
    });
  });

  it("falls back to defaults for invalid numeric values", () => {
    const env = {
      HERDR_CHILD_PANES_IDLE_MS: "not-a-number",
      HERDR_CHILD_PANES_MAX: "-1",
    };

    expect(parseConfig(env)).toEqual({
      ...DEFAULT_CONFIG,
      idleGraceMs: DEFAULT_CONFIG.idleGraceMs,
      maxPanes: DEFAULT_CONFIG.maxPanes,
    });
  });

  it("falls back to defaults for invalid direction values", () => {
    const env = {
      HERDR_CHILD_PANES_DIRECTION: "diagonal",
    };

    expect(parseConfig(env)).toEqual({
      ...DEFAULT_CONFIG,
      direction: "auto",
    });
  });

  it("treats empty optional values as defaults", () => {
    const env = {
      HERDR_CHILD_PANES: "",
      HERDR_CHILD_PANES_IDLE_MS: "",
      HERDR_CHILD_PANES_MAX: "",
      HERDR_CHILD_PANES_DIRECTION: "",
      HERDR_CHILD_PANES_DEBUG: "",
    };

    expect(parseConfig(env)).toEqual({
      ...DEFAULT_CONFIG,
      enabled: true,
    });
  });
});
