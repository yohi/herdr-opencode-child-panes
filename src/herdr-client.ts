import { execFile } from "node:child_process";
import { z } from "zod";
import type { Logger } from "./logger.js";
import { paneInfoResponseSchema, paneLayoutSchema, splitPaneResponseSchema } from "./schemas.js";
import type { HerdrClient, PaneInfo, PaneLayout, SplitPaneInput } from "./types.js";

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function classifyError(error: unknown): { readonly code: string } {
  if (
    error instanceof Error &&
    "code" in error &&
    (typeof error.code === "string" || typeof error.code === "number")
  ) {
    return { code: String(error.code) };
  }
  return { code: "UNKNOWN" };
}

export function subcommandName(argv: readonly string[]): string {
  if (argv.length >= 2) {
    return `${argv[0]} ${argv[1]}`;
  }
  return argv[0] ?? "herdr";
}

export type Runner = (
  herdrPath: string,
  argv: readonly string[],
  timeoutMs: number,
) => Promise<string>;

async function defaultRunner(
  herdrPath: string,
  argv: readonly string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(herdrPath, [...argv], { encoding: "utf8", timeout: timeoutMs }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export interface CreateHerdrClientOptions {
  readonly herdrPath?: string;
  readonly timeoutMs?: number;
  readonly logger?: Logger;
  readonly runner?: Runner;
}

export function createHerdrClient(options: CreateHerdrClientOptions = {}): HerdrClient {
  const herdrPath = options.herdrPath ?? "herdr";
  const timeoutMs = options.timeoutMs ?? 5000;
  const logger = options.logger ?? noopLogger;
  const runner = options.runner ?? defaultRunner;

  async function run(argv: readonly string[]): Promise<string> {
    return runner(herdrPath, argv, timeoutMs);
  }

  async function runJson<T>(argv: readonly string[], schema: z.ZodType<T>): Promise<T | null> {
    let stdout: string;
    try {
      stdout = await run(argv);
    } catch (error) {
      const { code } = classifyError(error);
      logger.warn(`Herdr ${subcommandName(argv)} command failed`, {
        code,
      });
      return null;
    }

    try {
      const raw: unknown = JSON.parse(stdout);
      return schema.parse(raw);
    } catch (error) {
      const code =
        error instanceof SyntaxError
          ? "INVALID_JSON"
          : error instanceof z.ZodError
            ? "INVALID_RESPONSE"
            : "UNKNOWN";
      logger.warn(`Herdr ${subcommandName(argv)} command failed`, {
        code,
      });
      return null;
    }
  }

  async function runVoid(argv: readonly string[]): Promise<boolean> {
    try {
      await run(argv);
      return true;
    } catch (error) {
      const { code } = classifyError(error);
      logger.warn(`Herdr ${subcommandName(argv)} command failed`, {
        code,
      });
      return false;
    }
  }

  return {
    async getPane(paneId: string): Promise<PaneInfo | null> {
      const response = await runJson(["pane", "get", paneId], paneInfoResponseSchema);
      return response?.result.pane ?? null;
    },

    async getPaneLayout(paneId: string): Promise<PaneLayout | null> {
      const response = await runJson(["pane", "layout", "--pane", paneId], paneLayoutSchema);
      if (!response) {
        return null;
      }
      const layout = response.result.layout;
      const pane = layout.panes.find((candidate) => candidate.pane_id === paneId);
      if (!pane) {
        return null;
      }
      const direction = layout.splits[0]?.direction;
      return {
        paneId,
        width: pane.rect.width,
        height: pane.rect.height,
        ...(direction === undefined ? {} : { direction }),
      };
    },

    async splitPane(input: SplitPaneInput): Promise<string | null> {
      const argv = ["pane", "split", "--pane", input.paneId];
      if (input.direction !== undefined && input.direction !== "auto") {
        argv.push("--direction", input.direction);
      }
      if (input.command !== undefined) {
        argv.push("--command", input.command);
      }
      for (const [key, value] of Object.entries(input.env ?? {})) {
        argv.push("--env", `${key}=${value}`);
      }
      if (input.noFocus) {
        argv.push("--no-focus");
      }
      const result = await runJson(argv, splitPaneResponseSchema);
      return result?.result.pane.pane_id ?? null;
    },

    async runInPane(paneId: string, command: string): Promise<boolean> {
      return runVoid(["pane", "run", paneId, command]);
    },

    async closePane(paneId: string): Promise<boolean> {
      return runVoid(["pane", "close", paneId]);
    },
  };
}
