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
  readonly mode?: "v1" | "v2";
}

export interface AttachLauncher {
  attach(input: AttachInput): Promise<boolean>;
  readonly environment?: Readonly<Record<string, string>>;
}

const AUTH_ENV_KEYS = ["OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME"] as const;
const REDACTED = "[REDACTED]";
const ATTACH_RETRY_DELAY_MS = 1000;
const ATTACH_RETRY_ATTEMPTS = 10;

function stripCredentials(url: URL): string {
  const safe = new URL(url.toString());
  safe.username = "";
  safe.password = "";
  return safe.toString();
}

function stripUrlQueryAndFragment(url: string): string | undefined {
  try {
    const safe = new URL(url);
    if (safe.search === "" && safe.hash === "") {
      return url;
    }
    safe.search = "";
    safe.hash = "";
    return safe.toString();
  } catch {
    return undefined;
  }
}

export function buildAttachCommand(input: AttachInput, mode: "v1" | "v2" = "v1"): string {
  const url = stripCredentials(input.serverUrl);
  if (mode === "v2") {
    return `opencode ${quoteShell(input.directory)} --server ${quoteShell(url)} --session ${quoteShell(input.sessionId)}`;
  }
  return `opencode attach ${quoteShell(url)} --session ${quoteShell(input.sessionId)} --dir ${quoteShell(input.directory)}`;
}

function shellWordEnd(command: string, start: number): number {
  let inSingleQuotes = false;

  for (let index = start; index < command.length; index += 1) {
    const character = command[index];
    if (character === "'") {
      inSingleQuotes = !inSingleQuotes;
      continue;
    }
    if (character === "\\" && !inSingleQuotes) {
      index += 1;
      continue;
    }
    if (!inSingleQuotes && character === " ") {
      return index;
    }
  }
  return command.length;
}

export function redactAttachCommand(command: string): string {
  let redacted = command;
  let cursor = 0;
  const redactedValue = quoteShell(REDACTED);

  while (cursor < redacted.length) {
    const equalsIndex = redacted.indexOf("=", cursor);
    if (equalsIndex < 0) {
      break;
    }
    const key = redacted.slice(cursor, equalsIndex);
    if (!AUTH_ENV_KEYS.some((authKey) => authKey === key)) {
      break;
    }

    const valueStart = equalsIndex + 1;
    const valueEnd = shellWordEnd(redacted, valueStart);
    redacted = `${redacted.slice(0, valueStart)}${redactedValue}${redacted.slice(valueEnd)}`;
    cursor = valueStart + redactedValue.length;
    if (redacted[cursor] === " ") {
      cursor += 1;
    }
  }

  const attachMarker = "opencode attach ";
  const v2Marker = " --server ";
  const markerStart = redacted.indexOf(attachMarker);
  const v2Start = redacted.indexOf(v2Marker);
  if (markerStart < 0 && v2Start < 0) {
    return redacted;
  }

  const urlStart = markerStart >= 0 ? markerStart + attachMarker.length : v2Start + v2Marker.length;
  const urlEnd = shellWordEnd(redacted, urlStart);
  const shellUrl = redacted.slice(urlStart, urlEnd);
  if (!shellUrl.startsWith("'") || !shellUrl.endsWith("'")) {
    return redacted;
  }

  const safeUrl = stripUrlQueryAndFragment(shellUrl.slice(1, -1));
  if (safeUrl === undefined) {
    return redacted;
  }
  return `${redacted.slice(0, urlStart)}${quoteShell(safeUrl)}${redacted.slice(urlEnd)}`;
}

function authEnvironment(env: NodeJS.ProcessEnv = process.env): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const key of AUTH_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value.trim().length > 0) {
      environment[key] = value;
    }
  }
  return environment;
}

async function waitForOpenCodePane(
  herdrClient: HerdrClient,
  paneId: string,
  sessionId: string,
  mode: "v1" | "v2",
): Promise<boolean> {
  const pane = await herdrClient.getPane(paneId);
  if (mode === "v2") {
    // A generic OpenCode pane is NOT evidence of the expected child session.
    return pane?.agent_session?.agent === "opencode" && pane.agent_session.value === sessionId;
  }
  return pane?.agent === "opencode" || pane?.agent_session?.agent === "opencode";
}

export function createAttachLauncher(options: CreateAttachLauncherOptions): AttachLauncher {
  const herdrClient = options.herdrClient;
  const logger = options.logger ?? noopLogger;
  const env = options.env ?? process.env;
  const mode = options.mode ?? "v1";
  const environment = authEnvironment(env);

  async function launch(input: AttachInput): Promise<boolean> {
    const command = buildAttachCommand(input, mode);
    // Build a fresh redacted command instead of parsing shell-escaped URL text.
    // URLs containing quotes must not bypass query/fragment redaction.
    const safeLogUrl = new URL(input.serverUrl.toString());
    safeLogUrl.username = "";
    safeLogUrl.password = "";
    safeLogUrl.search = "";
    safeLogUrl.hash = "";
    const safeLogCommand = buildAttachCommand({ ...input, serverUrl: safeLogUrl }, mode);
    logger.debug("Attaching OpenCode session to pane", {
      paneId: input.paneId,
      sessionId: input.sessionId,
      command: safeLogCommand,
    });

    try {
      const attached = await herdrClient.runInPane(input.paneId, command);
      if (!attached) {
        logger.warn("Failed to run attach command in pane", {
          paneId: input.paneId,
          sessionId: input.sessionId,
        });
        return false;
      }
      for (let attempt = 0; attempt < ATTACH_RETRY_ATTEMPTS; attempt += 1) {
        if (await waitForOpenCodePane(herdrClient, input.paneId, input.sessionId, mode)) {
          return true;
        }
        if (attempt < ATTACH_RETRY_ATTEMPTS - 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, ATTACH_RETRY_DELAY_MS));
        }
      }
      logger.warn("OpenCode did not start in attached pane", {
        paneId: input.paneId,
        sessionId: input.sessionId,
      });
      return false;
    } catch {
      // Do not expose a failed process message that may contain the URL or credentials.
      logger.error("Attach command failed unexpectedly", {
        paneId: input.paneId,
        sessionId: input.sessionId,
      });
      return false;
    }
  }

  return { attach: launch, environment };
}
