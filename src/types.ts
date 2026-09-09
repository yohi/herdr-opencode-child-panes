/**
 * Herdr pane layout direction.
 */
export type Direction = "auto" | "horizontal" | "vertical";

/**
 * Parsed plugin configuration.
 */
export interface HerdrChildPanesConfig {
  /** Whether the bridge is enabled at all. */
  enabled: boolean;
  /** Grace period before considering an idle child session stale. */
  idleGraceMs: number;
  /** Maximum number of Herdr panes to manage. */
  maxPanes: number;
  /** Layout direction for new panes. */
  direction: Direction;
  /** Number of retries when asking Herdr to close a pane. */
  closeRetries: number;
  /** Whether to emit debug logs. */
  debug: boolean;
}

/**
 * Runtime prerequisites that must all be satisfied for the bridge to activate.
 */
export interface RuntimePrerequisites {
  /** HERDR_ENV must be set to a truthy value. */
  herdrEnv: boolean;
  /** HERDR_PANE_ID must be a non-empty string. */
  herdrPaneId: string | undefined;
  /** OpenCode must provide a usable serverUrl. */
  serverUrl: URL | undefined;
  /** HERDR_CHILD_PANES must not be explicitly disabled. */
  notExplicitlyDisabled: boolean;
}
