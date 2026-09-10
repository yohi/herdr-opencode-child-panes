import { describe, expect, it } from "vitest";
import { subcommandName } from "../src/herdr-client.js";

describe("subcommandName", () => {
  it("includes the namespace for a command with two argv entries", () => {
    expect(subcommandName(["pane", "list"])).toBe("pane list");
  });

  it("uses the only argv entry for a single-element command", () => {
    expect(subcommandName(["pane"])).toBe("pane");
  });

  it("falls back to herdr for an empty command", () => {
    expect(subcommandName([])).toBe("herdr");
  });
});
