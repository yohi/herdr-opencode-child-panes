/**
 * Minimal logger that respects the plugin's debug flag.
 */
type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  readonly service: "herdr-child-panes";
  readonly level: LogLevel;
  readonly message: string;
  readonly extra?: Record<string, unknown>;
}

type LogSink = (entry: LogEntry) => void | Promise<void>;

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

function isLogExtra(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createLogEntry(level: LogLevel, message: string, args: readonly unknown[]): LogEntry {
  const [firstArg] = args;
  let extra: Record<string, unknown> | undefined;
  if (args.length === 1 && isLogExtra(firstArg)) {
    extra = firstArg;
  } else if (args.length > 0) {
    extra = { args: [...args] };
  }

  return {
    service: "herdr-child-panes",
    level,
    message,
    ...(extra === undefined ? {} : { extra }),
  };
}

function discardLogFailure(error: unknown): void {
  // Logging is best effort; reporting the failure through the console would recreate the TUI issue.
  void error;
}

export function createLogger(debug: boolean, sink?: LogSink): Logger {
  function write(level: LogLevel, message: string, args: readonly unknown[]): void {
    if (level === "debug" && !debug) {
      return;
    }

    if (sink) {
      try {
        const result = sink(createLogEntry(level, message, args));
        if (result !== undefined) {
          void result.catch(discardLogFailure);
        }
      } catch (error) {
        discardLogFailure(error);
      }
      return;
    }

    switch (level) {
      case "debug":
        // eslint-disable-next-line no-console
        console.debug(`[herdr-child-panes] ${message}`, ...args);
        return;
      case "info":
        // eslint-disable-next-line no-console
        console.info(`[herdr-child-panes] ${message}`, ...args);
        return;
      case "warn":
        // eslint-disable-next-line no-console
        console.warn(`[herdr-child-panes] ${message}`, ...args);
        return;
      case "error":
        // eslint-disable-next-line no-console
        console.error(`[herdr-child-panes] ${message}`, ...args);
        return;
    }
  }

  return {
    debug(message: string, ...args: unknown[]) {
      write("debug", message, args);
    },
    info(message: string, ...args: unknown[]) {
      write("info", message, args);
    },
    warn(message: string, ...args: unknown[]) {
      write("warn", message, args);
    },
    error(message: string, ...args: unknown[]) {
      write("error", message, args);
    },
  };
}
