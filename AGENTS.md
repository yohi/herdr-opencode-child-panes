# AGENTS.md

Repository-specific instructions for AI agents working on `herdr-opencode-child-panes`. This document supplements the global `AGENTS.md`; global rules still apply unless overridden by a repository-specific requirement below.

## Mandatory verification

Before declaring any implementation, bugfix, or documentation task complete, run:

```sh
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run build       # tsup build to dist/
```

All checks must pass. If `npm run lint` reports a pre-existing `package.json` formatting issue, note it in your report but do not use it to claim the task is blocked unless your change introduced the issue.

## Integration test gating

Tests that exercise a real Herdr binary are gated by the `HERDR_BINARY` environment variable. If it is unset, those tests are skipped automatically. Do not invent or hard-code a Herdr binary path.

## Tool-selection conventions

- Prefer `codegraph_explore` for understanding indexed code structure, call paths, and blast radius.
- Use parallel `task` calls for independent work items.
- For file operations, use the repository's standard tools (read, write, edit, glob, grep).

## Safety constraints

- Do not include absolute paths or personal directory references in committed files. Use environment variables or relative paths.
- Do not log, print, or commit secrets, API keys, or credentials. Protect `.env` files, `.git`, and system configuration folders.
- Do not suppress TypeScript errors with `as any` or `@ts-ignore`. Use proper typing.
- Do not commit unless the user explicitly asks. This includes merges and force-pushes.
- Do not create new agent configuration files or directories (e.g., `.opencode/`, `.claude/`, `opencode.json(c)`, `claude.json(c)`). Editing existing files is permitted only when necessary.

## Generated files

- `dist/` is build output. Do not edit it by hand.
- `CHANGELOG.md` is generated and maintained by release-please. Do not rewrite it except as part of an explicit documentation refactoring task.
- `package.json` formatting must remain compatible with `biome check`. Avoid manual formatting that Biome would rewrite.

## Repository-specific workflow notes

- Source code is TypeScript under `src/`.
- Tests live under `test/` and run with Vitest.
- The plugin is an ESM package built with `tsup`.
- Keep documentation changes in the right canonical file: user-facing entry points in `README.md`, normative behavior in `SPEC.md`, detailed human docs under `docs/*.md`, and agent instructions here.
