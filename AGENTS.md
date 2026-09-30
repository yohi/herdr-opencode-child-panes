# AGENTS.md

Repository-specific instructions for AI agents working on `herdr-opencode-child-panes`. This document supplements the global `AGENTS.md`; global rules still apply unless overridden by a repository-specific requirement below.

## Project Overview

`herdr-opencode-child-panes` is an OpenCode companion plugin that visualizes accepted child sessions (subagents) as Herdr split panes using `@opencode-ai/plugin` hooks and the `herdr` CLI.

- **Runtime**: Node.js >= 20 (ESM)
- **Package Manager**: npm
- **Tech Stack**: TypeScript, `@opencode-ai/plugin`, `herdr` CLI, `zod`
- **Toolchain**: `tsup` (build to `dist/`), `vitest` (tests), `biome` (linter/formatter), `tsc` (typecheck)

## Progressive Disclosure (Documentation Map)

Keep this file concise to conserve the agent instruction budget. Consult topic-specific documentation when needed:

- [SPEC.md](SPEC.md): Normative technical specification (state machine, lifecycle semantics, capacity rules, queue serialization, invariants).
- [docs/architecture.md](docs/architecture.md) / [docs/architecture.ja.md](docs/architecture.ja.md): Module map, high-level control flow, and system integration.
- [docs/configuration.md](docs/configuration.md): Complete environment variable catalog and fallback rules.
- [docs/operations.md](docs/operations.md): Operational runbook, semantic lifecycle logs, and troubleshooting checklists.
- [docs/getting-started.md](docs/getting-started.md): Installation prerequisites and verification steps.
- [README.md](README.md) / [README.ja.md](README.ja.md): User-facing entry point and high-level feature overview.

## Mandatory Verification Gates

Before declaring any implementation, bugfix, or documentation task complete, run:

```sh
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run build       # tsup build to dist/
```

All checks must pass. If `npm run lint` reports a pre-existing `package.json` formatting issue, note it in your report but do not use it to claim the task is blocked unless your change introduced the issue.

## Integration Test Gating

Tests that exercise a real Herdr binary are gated by the `HERDR_BINARY` environment variable. If it is unset, those tests are skipped automatically. Do not invent or hard-code a Herdr binary path.

## Safety & Operational Constraints

- **No unauthorized commits**: Do not commit unless the user explicitly asks. This includes merges and force-pushes.
- **No path leaks**: Do not include absolute paths or personal directory references in committed files. Use environment variables or relative paths.
- **Protect secrets**: Do not log, print, or commit secrets, API keys, passwords, or credentials. Protect `.env` files, `.git`, and system configuration folders.
- **Strict typing**: Do not suppress TypeScript errors with `as any` or `@ts-ignore`. Use proper typing.
- **Deterministic formatting**: Do not enforce subjective code styles in prompts; rely on `biome check`. Keep `package.json` formatting compatible with Biome.
- **No agent config pollution**: Do not create new agent configuration files or directories (e.g., `.opencode/`, `.claude/`, `opencode.json(c)`, `claude.json(c)`). Editing existing files is permitted only when necessary.
- **Generated artifacts**: `dist/` is build output; do not edit it by hand. `CHANGELOG.md` is generated and maintained by release-please; do not rewrite it manually.

## Tool & Workflow Conventions

- **CodeGraph**: In repos indexed by CodeGraph, prefer `codegraph_explore` for understanding indexed code structure, call paths, and blast radius before grep or manual file reading.
- **Parallel tasks**: Use parallel `task` calls for independent work items.
- **Standard file tools**: For file operations, use the repository's standard tools (read, write, edit, glob, grep).
- **Source & test layout**: Source code is TypeScript under `src/`; tests live under `test/` and run with Vitest.
- **Documentation placement**: Keep documentation changes in the right canonical file according to the Documentation Map above.
