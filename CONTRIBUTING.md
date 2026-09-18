# Contributing

Thank you for contributing to `herdr-opencode-child-panes`.

## Development setup

- Node.js 20 or later is required.
- Install dependencies:

  ```sh
  npm install
  ```

- Build the plugin:

  ```sh
  npm run build
  ```

## Running checks

Run the full check suite before opening a pull request:

```sh
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run build       # tsup build to dist/
```

Integration tests that require a real Herdr binary are gated by `HERDR_BINARY` and are skipped when that variable is unset.

## Commit conventions

This repository follows [Conventional Commits](https://www.conventionalcommits.org/). Use English commit messages. Examples:

- `feat: add idle timeout for child panes`
- `fix: prevent orphan pane on attach failure`
- `docs: update configuration reference`
- `refactor: extract pane orchestrator split logic`

## Where to open issues

Open issues on the [GitHub repository](https://github.com/yohi/herdr-opencode-child-panes/issues). Include:

- A clear description of the problem or request.
- Steps to reproduce, if applicable.
- The output of `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` if your change touches code.

## Pull request guidelines

- Keep changes focused and scoped to a single concern.
- Update relevant documentation if behavior changes.
- Do not commit `dist/` or unrelated formatting changes.
