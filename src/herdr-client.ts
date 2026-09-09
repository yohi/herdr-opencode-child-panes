import { execFile } from "node:child_process";
import { z } from "zod";
import type { Logger } from "./logger.js";
import type { HerdrClient, PaneInfo, PaneLayout, SplitPaneInput } from "./types.js";

const paneInfoSchema = z.object({
  id: z.string().min(1),
});

const paneLayoutChildSchema = z.object({
  id: z.string().min(1),
  direction: z.enum(["auto", "horizontal", "vertical"]).optional(),
});

const paneLayoutSchema = z.object({
  paneId: z.string().min(1),
  direction: z.enum(["auto", "horizontal", "vertical"]).optional(),
  children: z.array(paneLayoutChildSchema).optional(),
});

const splitPaneResponseSchema = z.object({
  id: z.string().min(1),
});

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

function subcommandName(argv: readonly string[]): string {
  if (argv.length >= 3) {
    return `${argv[1]} ${argv[2]}`;
  }
  return argv[1] ?? "herdr";
}

export type Runner = (
  herdrPath: string,
  argv: readonly string[],
  timeoutMs: number,
) => Promise<Buffer>;

async function defaultRunner(
  herdrPath: string,
  argv: readonly string[],
  timeoutMs: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(herdrPath, [...argv], { encoding: "buffer", timeout: timeoutMs }, (error, stdout) => {
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

  async function run(argv: readonly string[]): Promise<Buffer> {
    return runner(herdrPath, argv, timeoutMs);
  }

  async function runJson<T>(argv: readonly string[], schema: z.ZodType<T>): Promise<T | null> {
    try {
      const stdout = await run(argv);
      const raw: unknown = JSON.parse(stdout.toString("utf-8"));
      return schema.parse(raw);
    } catch (error) {
      const { code } = classifyError(error);
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
      return runJson(["pane", "get", paneId], paneInfoSchema);
    },

    async getPaneLayout(paneId: string): Promise<PaneLayout | null> {
      return runJson(["pane", "layout", "--pane", paneId], paneLayoutSchema);
    },

    async splitPane(input: SplitPaneInput): Promise<string | null> {
      const argv = ["pane", "split", "--pane", input.paneId];
      if (input.direction !== undefined) {
        argv.push("--direction", input.direction);
      }
      if (input.command !== undefined) {
        argv.push("--command", input.command);
      }
      const result = await runJson(argv, splitPaneResponseSchema);
      return result?.id ?? null;
    },

    async runInPane(paneId: string, command: string): Promise<boolean> {
      return runVoid(["pane", "run", paneId, command]);
    },

    async closePane(paneId: string): Promise<boolean> {
      return runVoid(["pane", "close", paneId]);
    },
  };
}
