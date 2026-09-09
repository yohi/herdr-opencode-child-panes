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

/**
 * Opaque Herdr pane identifier.
 */
export type PaneId = Brand<string, "PaneId">;

/**
 * Minimal pane information returned by `herdr pane get`.
 */
export interface PaneInfo {
  readonly id: string;
}

/**
 * A child entry in a pane layout response.
 */
export interface PaneLayoutChild {
  readonly id: string;
  readonly direction?: Direction;
}

/**
 * Pane layout information returned by `herdr pane layout`.
 */
export interface PaneLayout {
  readonly paneId: string;
  readonly direction?: Direction;
  readonly children?: readonly PaneLayoutChild[];
}

/**
 * Input for splitting an existing pane.
 */
export interface SplitPaneInput {
  readonly paneId: string;
  readonly direction?: Direction;
  readonly command?: string;
}

/**
 * Adapter around the Herdr CLI.
 */
export interface HerdrClient {
  getPane(paneId: string): Promise<PaneInfo | null>;
  getPaneLayout(paneId: string): Promise<PaneLayout | null>;
  splitPane(input: SplitPaneInput): Promise<string | null>;
  runInPane(paneId: string, command: string): Promise<boolean>;
  closePane(paneId: string): Promise<boolean>;
}

/**
 * Brand helper for distinct primitive types.
 */
declare const __brand: unique symbol;
export type Brand<T, B> = T & { readonly [__brand]: B };
