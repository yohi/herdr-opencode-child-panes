import { describe, expect, it } from "vitest";
import herdrChildPanesPlugin, { herdrChildPanesPlugin as namedPlugin } from "../src/index.js";

describe("herdrChildPanesPlugin", () => {
  it("exports the plugin as the default and as a named export", () => {
    expect(namedPlugin).toBe(herdrChildPanesPlugin);
  });

  it("returns empty hooks when runtime prerequisites are not satisfied", async () => {
    const originalHerdrEnv = process.env.HERDR_ENV;
    const originalHerdrPaneId = process.env.HERDR_PANE_ID;
    const originalToggle = process.env.HERDR_CHILD_PANES;

    try {
      process.env.HERDR_ENV = undefined;
      process.env.HERDR_PANE_ID = undefined;
      process.env.HERDR_CHILD_PANES = "false";

      const hooks = await herdrChildPanesPlugin({
        serverUrl: undefined,
      } as Parameters<typeof herdrChildPanesPlugin>[0]);

      expect(hooks).toEqual({});
    } finally {
      process.env.HERDR_ENV = originalHerdrEnv;
      process.env.HERDR_PANE_ID = originalHerdrPaneId;
      process.env.HERDR_CHILD_PANES = originalToggle;
    }
  });
});
