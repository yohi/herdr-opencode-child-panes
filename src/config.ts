import type { Direction, HerdrChildPanesConfig } from "./types.js";

export const DEFAULT_CONFIG: HerdrChildPanesConfig = {
  enabled: true,
  idleGraceMs: 10000,
  maxPanes: 4,
  direction: "auto",
  closeRetries: 3,
  debug: false,
};

const VALID_DIRECTIONS: Direction[] = ["auto", "horizontal", "vertical"];

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (trimmed === "") return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function parseDirection(value: string | undefined, fallback: Direction): Direction {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (VALID_DIRECTIONS.includes(normalized as Direction)) {
    return normalized as Direction;
  }
  return fallback;
}

/**
 * Parse plugin configuration from environment variables.
 *
 * Invalid optional values fall back to defaults rather than throwing.
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env): HerdrChildPanesConfig {
  return {
    enabled: parseBoolean(env.HERDR_CHILD_PANES, DEFAULT_CONFIG.enabled),
    idleGraceMs: parsePositiveInt(env.HERDR_CHILD_PANES_IDLE_MS, DEFAULT_CONFIG.idleGraceMs),
    maxPanes: parsePositiveInt(env.HERDR_CHILD_PANES_MAX, DEFAULT_CONFIG.maxPanes),
    direction: parseDirection(env.HERDR_CHILD_PANES_DIRECTION, DEFAULT_CONFIG.direction),
    closeRetries: DEFAULT_CONFIG.closeRetries,
    debug: parseBoolean(env.HERDR_CHILD_PANES_DEBUG, DEFAULT_CONFIG.debug),
  };
}
