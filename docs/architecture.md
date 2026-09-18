# Architecture

This document explains how `herdr-opencode-child-panes` works at a high level. For exact state machines, transition rules, and invariants, see [SPEC.md](../SPEC.md).

## What the plugin does

`herdr-opencode-child-panes` is an OpenCode companion plugin that visualizes accepted child sessions (subagents) as Herdr panes. When an OpenCode root session running inside a Herdr pane dispatches a subagent, the plugin creates a new pane next to the root session and runs `opencode attach` inside it. When the child becomes idle or is deleted, the pane closes automatically.

## How it fits into Herdr + OpenCode

The plugin relies on two external systems:

- **Herdr** provides the pane layout. The plugin reads the current layout and issues `split`, `resize`, `run`, and `close` commands through the `herdr` CLI.
- **OpenCode** provides session events. The plugin subscribes to `@opencode-ai/plugin` hooks such as `session.created`, `session.status`, `session.idle`, `session.deleted`, `message.updated`, and `message.part.updated`.

The plugin only acts when it can identify a root OpenCode session hosted by the current Herdr pane. It does not call the OpenCode HTTP API or inspect panes outside its own `HERDR_PANE_ID`.

## Module map and responsibilities

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | Plugin entry point. Validates `HERDR_ENV` and `HERDR_PANE_ID`, then wires dependencies. |
| `src/config.ts` | Parses environment variables into typed configuration. Invalid values fall back to defaults. |
| `src/child-session.ts` / `src/child-session-registry.ts` | Tracks child-session states and transitions. |
| `src/root-session-resolver.ts` | Resolves the OpenCode root session for the current Herdr pane, with a short TTL cache. |
| `src/ownership-resolver.ts` | Decides whether a new session belongs to the tracked root session. |
| `src/event-resolver.ts` | Extracts session IDs from OpenCode events. |
| `src/shell-quote.ts` | Shell-quotes commands passed to `herdr pane run`. |
| `src/attach-launcher.ts` | Builds and runs `opencode attach`, removing credentials from logs. |
| `src/herdr-client.ts` | Adapter for the Herdr CLI. |
| `src/pane-orchestrator.ts` | Drives split/attach, idle cleanup, retries, and capacity limits. |
| `src/async-queue.ts` | Serializes Herdr mutations so concurrent events do not interleave. |

`src/direction-policy.ts` still exists for backward compatibility but is not used by the fixed child-pane layout.

## Control flow overview

1. A `session.created` event arrives. The plugin resolves the parent and, if it belongs to the root session, registers the child as `waiting_activity`.
2. The first real activity event (`message.updated` / `message.part.updated`) arrives.
3. The pane orchestrator enqueues a split/attach operation.
4. `src/async-queue.ts` serializes the mutation. `src/herdr-client.ts` splits the caller pane to the right and runs `opencode attach` in the new pane.
5. Activity stops and an idle event arrives. The orchestrator schedules a close after the configured grace period.
6. New activity cancels the close timer. A `session.deleted` event closes the pane immediately.

## Relationship to OMO

This plugin serves the same use case as OMO's pane visualization: running multiple agent sessions side by side inside a Herdr layout. Sessions dispatched by OMO appear as ordinary OpenCode child sessions, so they are compatible with this plugin. There is no private dependency on OMO. At runtime the plugin consumes only public OpenCode plugin hooks and the public Herdr CLI.
