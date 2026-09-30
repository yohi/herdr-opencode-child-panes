# Architecture

This document explains how `herdr-opencode-child-panes` works at a high level. For exact state machines, transition rules, and invariants, see [SPEC.md](../SPEC.md).

## What the plugin does

`herdr-opencode-child-panes` is an OpenCode companion plugin that visualizes accepted child sessions (subagents) as Herdr panes. When an OpenCode root session running inside a Herdr pane dispatches a subagent, the plugin creates a new pane next to the root session and runs `opencode attach` inside it. When the child becomes idle, its pane is closed, but the OpenCode child session itself keeps running. If that same child resumes work later, the plugin can open a fresh pane attached to the same session. When the child is deleted, visualization ends permanently.

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
| `src/child-session.ts` / `src/child-session-registry.ts` | Tracks child-session states, transitions, and close metadata (`closeReason`, `reopenRequested`). |
| `src/root-session-resolver.ts` | Resolves the OpenCode root session for the current Herdr pane, with a short TTL cache. |
| `src/ownership-resolver.ts` | Decides whether a new session belongs to the tracked root session. |
| `src/event-resolver.ts` | Extracts session IDs from OpenCode events. |
| `src/shell-quote.ts` | Shell-quotes commands passed to `herdr pane run`. |
| `src/attach-launcher.ts` | Builds and runs `opencode attach`, removing credentials from logs. |
| `src/herdr-client.ts` | Adapter for the Herdr CLI. |
| `src/pane-orchestrator.ts` | Drives split/attach, idle cleanup, retries, capacity limits, and reopen handoff. |
| `src/async-queue.ts` | Serializes Herdr mutations so concurrent events do not interleave. |

`src/direction-policy.ts` still exists for backward compatibility but is not used by the fixed child-pane layout.

## Control flow overview

1. A `session.created` event arrives. The plugin resolves the parent and, if it belongs to the root session, registers the child as `waiting_activity`.
2. The first real activity event (`message.updated`, `message.part.updated`, or `message.part.delta`) arrives.
3. The pane orchestrator claims the session (`spawning`), reserves capacity, and enqueues a split/attach operation.
4. `src/async-queue.ts` serializes the mutation. `src/herdr-client.ts` splits the caller pane to the right and runs `opencode attach <session-id>` in the new pane.
5. Activity stops and an idle event arrives. The orchestrator transitions the session to `idle_pending` and schedules a close after the configured grace period.
6. Active status during the grace period cancels the timer and returns the session to `attached`. Meaningful activity preserves the existing scheduled close.
7. If the grace period expires, the pane is closed and the session becomes `reopenable`. The same OpenCode child session can later resume work and be visualized again.
8. `session.deleted` permanently terminates visualization and ends in terminal `closed`.

### Idle close and later work on the same session

- An idle cleanup closes only the managed pane; the underlying OpenCode child session is unaffected.
- A work signal (active status or meaningful activity) received while the idle close is running records `reopenRequested=true`. When the close finishes, the orchestrator transitions the session to `reopenable` and immediately enqueues a reopen spawn for the same `sessionId`.
- The reopen spawn is pushed onto the same `AsyncQueue` that handled the close. The close task does not await the reopen task; the queue order guarantees the successor reopen runs after the close settles.
- A later idle signal while the idle close is running clears `reopenRequested`, so the close finishes into `reopenable` with no immediate reopen.
- `session.deleted` while an idle close is running promotes the close to a permanent delete close. The session ends in `closed`, not `reopenable`.

## Permanent deletion

`session.deleted` is an irreversible boundary:

- A registered session moves through `closing` to terminal `closed`.
- A `reopenable` session moves through `closing` to terminal `closed`; it cannot be reopened.
- A session deleted while its ownership resolution is still pending is tombstoned so the resolver outcome can never register or spawn a pane for it.

## Relationship to OMO

This plugin serves the same use case as OMO's pane visualization: running multiple agent sessions side by side inside a Herdr layout. Sessions dispatched by OMO appear as ordinary OpenCode child sessions, so they are compatible with this plugin. There is no private dependency on OMO. At runtime the plugin consumes only public OpenCode plugin hooks and the public Herdr CLI.
