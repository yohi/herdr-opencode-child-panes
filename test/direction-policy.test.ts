import { describe, expect, it } from "vitest";
import { resolvePaneLayoutDirection } from "../src/direction-policy.js";

describe("resolvePaneLayoutDirection", () => {
  it("preserves the explicit right direction", () => {
    const direction = resolvePaneLayoutDirection({ direction: "right", layout: null });

    expect(direction).toBe("right");
  });

  it("preserves the explicit down direction", () => {
    const direction = resolvePaneLayoutDirection({ direction: "down", layout: null });

    expect(direction).toBe("down");
  });

  it("chooses right for a wide auto layout", () => {
    const direction = resolvePaneLayoutDirection({
      direction: "auto",
      layout: { paneId: "pane-1", width: 120, height: 40 },
    });

    expect(direction).toBe("right");
  });

  it("chooses down for a tall auto layout", () => {
    const direction = resolvePaneLayoutDirection({
      direction: "auto",
      layout: { paneId: "pane-1", width: 40, height: 120 },
    });

    expect(direction).toBe("down");
  });

  it("falls back to right when auto layout dimensions are unavailable", () => {
    const direction = resolvePaneLayoutDirection({
      direction: "auto",
      layout: { paneId: "pane-1" },
    });

    expect(direction).toBe("right");
  });
});
