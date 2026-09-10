import type { Direction, PaneLayout, PaneLayoutDirection } from "./types.js";

export interface ResolvePaneLayoutDirectionInput {
  readonly direction: Direction;
  readonly layout: PaneLayout | null;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected direction: ${value}`);
}

export function resolvePaneLayoutDirection(
  input: ResolvePaneLayoutDirectionInput,
): PaneLayoutDirection {
  switch (input.direction) {
    case "right":
      return "right";
    case "down":
      return "down";
    case "auto": {
      const width = input.layout?.width;
      const height = input.layout?.height;
      if (width === undefined || height === undefined) {
        return "right";
      }
      return width > height ? "right" : "down";
    }
    default:
      return assertNever(input.direction);
  }
}
