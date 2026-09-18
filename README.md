# herdr-opencode-child-panes

[日本語](README.ja.md)

[![CI](https://github.com/yohi/herdr-opencode-child-panes/actions/workflows/ci.yml/badge.svg)](https://github.com/yohi/herdr-opencode-child-panes/actions/workflows/ci.yml)
[![Release](https://github.com/yohi/herdr-opencode-child-panes/actions/workflows/release.yml/badge.svg)](https://github.com/yohi/herdr-opencode-child-panes/actions/workflows/release.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

An [OpenCode](https://opencode.ai) companion plugin that visualizes accepted child sessions (subagents) as [Herdr](https://github.com/herdrdev/herdr) panes.

When an OpenCode session running inside a Herdr pane launches a subagent, this plugin detects it from `session.created`, waits for the first real activity, splits the caller pane to the right, and attaches the child session with `opencode attach`. Additional child panes stack in the right column. Idle or deleted sessions close their panes automatically.

## Quick Start

### Requirements

- Node.js 20 or later
- `herdr` on your `PATH`
- OpenCode 1.17.x or newer with the plugin hooks consumed by this plugin
- The plugin must run inside a Herdr pane that hosts the OpenCode root session

### Install

1. Register the OpenCode agent with Herdr:

   ```sh
   herdr integration install opencode
   ```

2. Build and install the plugin into OpenCode's plugin directory:

   ```sh
   npm run build
   cp -r dist <opencode-plugins-dir>/herdr-opencode-child-panes
   ```

3. Restart OpenCode. The next time a root session inside a Herdr pane spawns a subagent, the plugin creates and attaches a child pane.

## Features

- Detects child sessions from OpenCode events, no HTTP API calls required
- Splits the caller pane and attaches children with `opencode attach`
- Stacks multiple child panes in a fixed right-column layout
- Closes idle or deleted child panes automatically
- Respects a configurable maximum number of child panes
- Isolates failures so a Herdr CLI error cannot crash OpenCode
- Compatible with sessions dispatched by OMO without a private dependency on OMO

## How It Works

The plugin consumes OpenCode events through `@opencode-ai/plugin` hooks and drives the Herdr CLI through a thin adapter. It keeps a small registry of child sessions, splits panes when activity starts, and cleans them up on idle or deletion. For the module map, control flow, and design invariants, see [docs/architecture.md](docs/architecture.md).

## Usage

Once the plugin is installed, use OpenCode normally inside a Herdr pane. For example, ask the agent to dispatch a subagent:

```text
Use a subagent to summarize README.md.
```

When the subagent starts, a new pane appears to the right and runs `opencode attach <child-session-id>`. The main pane keeps focus. When the child session goes idle or is deleted, its pane closes automatically.

## Configuration

Configuration is read from environment variables. Invalid values fall back to defaults instead of throwing.

| Variable | Default | Description |
| --- | --- | --- |
| `HERDR_ENV` | (unset) | Required. Set by Herdr inside the pane. |
| `HERDR_PANE_ID` | (unset) | Required. ID of the pane hosting this OpenCode session. Set by Herdr. |
| `HERDR_CHILD_PANES` | `true` | Master switch. Set to `false`, `0`, or `no` to disable. |
| `HERDR_CHILD_PANES_MAX` | `4` | Maximum number of child panes managed at once. |
| `HERDR_CHILD_PANES_IDLE_MS` | `10000` | Grace period in milliseconds before an idle child pane is closed. |
| `HERDR_CHILD_PANES_DEBUG` | `false` | Set to `true` to enable debug logging. |

For the complete environment variable reference and fallback behavior, see [docs/configuration.md](docs/configuration.md).

## Documentation

| Document | Purpose |
| --- | --- |
| [README.ja.md](README.ja.md) | Japanese translation of this README. |
| [docs/getting-started.md](docs/getting-started.md) | Detailed setup, prerequisites, and first-run verification. |
| [docs/architecture.md](docs/architecture.md) | High-level architecture, module map, and control flow. |
| [docs/configuration.md](docs/configuration.md) | Complete configuration reference. |
| [docs/operations.md](docs/operations.md) | Runbook: idle behavior, capacity limits, failures, troubleshooting. |
| `SPEC.md` | Normative technical specification (lifecycle, failure semantics, invariants). |
| `AGENTS.md` | Repository-specific instructions for AI agents working in this repo. |
| `CONTRIBUTING.md` | Development setup, commit conventions, and issue guidelines. |
| `SECURITY.md` | Supported versions and how to report vulnerabilities. |
| `CHANGELOG.md` | Release history, maintained by release-please. |

## Development

```sh
npm install
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run build       # tsup build to dist/
```

## License

[MIT](LICENSE)
