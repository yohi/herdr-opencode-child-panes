import type { Logger } from "./logger.js";
import { quoteShell } from "./shell-quote.js";
import type { HerdrClient } from "./types.js";

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface AttachInput {
  readonly paneId: string;
  readonly sessionId: string;
  readonly serverUrl: URL;
  readonly directory: string;
}

export interface CreateAttachLauncherOptions {
  readonly herdrClient: HerdrClient;
  readonly logger?: Logger;
  readonly env?: NodeJS.ProcessEnv;
}

export interface AttachLauncher {
  attach(input: AttachInput): Promise<boolean>;
}

const AUTH_ENV_KEYS = ["OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME"] as const;
const REDACTED = "[REDACTED]";

function stripCredentials(url: URL): string {
  const safe = new URL(url.toString());
  safe.username = "";
  safe.password = "";
  return safe.toString();
}

export function buildAttachCommand(input: AttachInput): string {
  const url = stripCredentials(input.serverUrl);
  return `opencode attach ${quoteShell(url)} --session ${quoteShell(input.sessionId)} --dir ${quoteShell(input.directory)}`;
}

export function redactAttachCommand(command: string): string {
  return command.replace(/([A-Za-z_][A-Za-z0-9_]*)=(?:'[^']*'|\S*)/g, (_match, key: string) => {
    return `${key}=${quoteShell(REDACTED)}`;
  });
}

function authEnvAssignments(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  return AUTH_ENV_KEYS.filter((key) => {
    const value = env[key];
    return value !== undefined && value.trim().length > 0;
  }).map((key) => `${key}=${quoteShell(env[key] ?? "")}`);
}

export function createAttachLauncher(options: CreateAttachLauncherOptions): AttachLauncher {
  const herdrClient = options.herdrClient;
  const logger = options.logger ?? noopLogger;
  const env = options.env ?? process.env;

  async function launch(input: AttachInput): Promise<boolean> {
    const command = buildAttachCommand(input);
    const envPrefix = authEnvAssignments(env).join(" ");
    const fullCommand = envPrefix ? `${envPrefix} ${command}` : command;
    logger.debug("Attaching OpenCode session to pane", {
      paneId: input.paneId,
      sessionId: input.sessionId,
      command: redactAttachCommand(fullCommand),
    });

    try {
      const attached = await herdrClient.runInPane(input.paneId, fullCommand);
      if (!attached) {
        logger.warn("Failed to run attach command in pane", {
          paneId: input.paneId,
          sessionId: input.sessionId,
        });
        return false;
      }
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      logger.error("Attach command failed unexpectedly", {
        paneId: input.paneId,
        sessionId: input.sessionId,
        detail,
      });
      return false;
    }
  }

  return { attach: launch };
}
