/**
 * Minimal logger that respects the plugin's debug flag.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export function createLogger(debug: boolean): Logger {
  return {
    debug(message: string, ...args: unknown[]) {
      if (debug) {
        // eslint-disable-next-line no-console
        console.debug(`[herdr-child-panes] ${message}`, ...args);
      }
    },
    info(message: string, ...args: unknown[]) {
      // eslint-disable-next-line no-console
      console.info(`[herdr-child-panes] ${message}`, ...args);
    },
    warn(message: string, ...args: unknown[]) {
      // eslint-disable-next-line no-console
      console.warn(`[herdr-child-panes] ${message}`, ...args);
    },
    error(message: string, ...args: unknown[]) {
      // eslint-disable-next-line no-console
      console.error(`[herdr-child-panes] ${message}`, ...args);
    },
  };
}
