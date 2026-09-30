# Specification: herdr-opencode-child-panes

This document is the canonical technical specification for `herdr-opencode-child-panes`. It defines scope, architecture, module responsibilities, state transitions, lifecycle semantics, capacity behavior, failure handling, security guarantees, compatibility commitments, and acceptance invariants. For a human-readable introduction to the architecture and control flow, see [docs/architecture.md](docs/architecture.md). For the complete configuration reference, see [docs/configuration.md](docs/configuration.md).

## 1. Scope and non-goals

### In scope

- Detecting accepted child sessions of an OpenCode root session from `@opencode-ai/plugin` events.
- Splitting Herdr panes and attaching child sessions with `opencode attach`.
- Managing pane lifecycle: creation, activity tracking, idle timeout, deletion, close retries, and reopen after idle close.
- Enforcing a configurable maximum number of child panes.
- Preventing plugin failures from affecting the OpenCode server or the caller pane.
- Shell-quoting and credential hygiene for commands and logs.

### Non-goals

- This plugin is not a window manager. It does not expose arbitrary layout direction policies.
- It does not call OpenCode HTTP APIs.
- It does not persist timers across OpenCode restarts.
- It does not install or configure Herdr itself.

## 2. High-level architecture reference

The plugin runs inside a Herdr pane that hosts an OpenCode root session. It consumes OpenCode events via `@opencode-ai/plugin` hooks and mutates Herdr layout through the `herdr` CLI.

```text
OpenCode events  →  plugin event resolvers  →  child-session registry
                                           ↓
Herdr CLI        ←  herdr-client / async-queue  ←  pane-orchestrator
```

The plugin never uses the OpenCode HTTP API. All Herdr access goes through the CLI adapter. Mutations to Herdr layout are serialized through an internal async queue to prevent concurrent events from interleaving.

## 3. Module responsibilities

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | Plugin entry point. Validates runtime prerequisites and wires dependencies. |
| `src/config.ts` | Parses environment variables into typed configuration. Invalid values fall back to defaults. |
| `src/child-session.ts` / `src/child-session-registry.ts` | Child-session state machine, registry, transition rules, close metadata, and timers. |
| `src/root-session-resolver.ts` | Resolves the OpenCode root session hosted by the caller Herdr pane, with a short TTL cache. |
| `src/ownership-resolver.ts` | Determines whether a created session is an owned child or a tracked descendant. |
| `src/event-resolver.ts` | Extracts session IDs from OpenCode events. Handles undocumented shapes defensively. |
| `src/direction-policy.ts` | Legacy direction policy. Not used by the fixed child-pane layout. |
| `src/shell-quote.ts` | Shell-quoting for commands executed inside panes. |
| `src/attach-launcher.ts` | Builds and runs `opencode attach`. Scrubs credentials from logs. |
| `src/herdr-client.ts` | Adapter for the Herdr CLI (`pane get`, `layout`, `split`, `resize`, `run`, `close`). |
| `src/pane-orchestrator.ts` | Lifecycle driver: activity-triggered split/attach, idle cleanup, close retries, capacity limits, and reopen handoff. |
| `src/async-queue.ts` | Serializes Herdr mutations to prevent overlapping concurrent events. |

## 4. State machine and transitions

A child session managed by the plugin occupies exactly one of the following states at any time.

| State | Meaning |
| --- | --- |
| `waiting_activity` | Session was created under the caller pane's root session. No pane has been created yet. |
| `spawning` | A split/attach attempt is claimed for this child session. |
| `attached` | Pane was created and `opencode attach` succeeded. |
| `idle_pending` | Idle event received; close timer is running. Active status cancels the timer and returns the session to `attached`. |
| `closing` | The existing pane is being removed or lifecycle termination is being finalized. |
| `reopenable` | The pane was successfully removed after the idle timeout; the same child session can be visualized again. |
| `closed` | `session.deleted` was received; visualization is permanently terminated. |
| `ignored` | Session will not be visualized, e.g. because the capacity limit was reached. |
| `failed` | Pane creation, attach, or close failed. Visualization is lost; the child session itself is unaffected. |

### Legal transitions

- `waiting_activity` → `spawning`, `closing`, `ignored`, `failed`.
- `spawning` → `attached`, `closing`, `failed`.
- `attached` → `idle_pending`, `closing`, `failed`.
- `idle_pending` → `attached`, `closing`, `failed`.
- `closing` → `reopenable`, `closed`, `failed`.
- `reopenable` → `spawning`, `closing`.
- `closed` → (none).
- `ignored` → (none).
- `failed` → (none).

### Operational transitions

- `session.created` and ownership resolves to caller root → `waiting_activity`.
- `session.deleted` while ownership resolution is pending → record pre-registration tombstone; discard pending work; session will never register or visualize.
- First real activity (`message.updated`, `message.part.updated`, or `message.part.delta`) → `spawning` → split pane and attach → `attached`.
- Idle signal while `spawning` → record deferred idle cleanup (`idleDuringSpawn`).
- Active status while `spawning` with deferred cleanup pending → clear deferred cleanup.
- Meaningful activity while `spawning` with deferred cleanup pending → preserve deferred cleanup; close is scheduled immediately upon attach completion.
- `session.status` reports `idle` or `session.idle` event while `attached` → `idle_pending`.
- Active status while `idle_pending` → clear timer and transition to `attached`.
- Meaningful activity while `idle_pending` → leave the existing close timer scheduled.
- Idle grace period elapses → close pane → `closing` → `reopenable`.
- `session.deleted` → close pane immediately (via the serialized queue) → `closed`.
- Work while `closing` with `closeReason = idle` → record `reopenRequested`; on successful close the session moves to `reopenable` and immediately attempts one reopen spawn.
- A later idle signal while `closing` with `closeReason = idle` → clear `reopenRequested`; successful close ends in `reopenable` with no immediate reopen.
- `session.deleted` while `closing(idle)` → promote to `closing(deleted)`; successful close ends in terminal `closed`.
- Work while `closing(deleted)` is ignored.
- Close fails after bounded retries → `failed` with reason `close_failed`.
- Capacity limit reached at initial spawn time → `ignored` with reason `capacity_limit`.
- Reopen attempt when capacity is full → remains `reopenable`; a later work signal retries when capacity is available.
- Split failure → `failed`. Attach failure → close the just-split pane, then `failed`.
- `reopenable` plus `session.deleted` → `closing` → `closed`.

### Signal categorization and work dispatch

The orchestrator classifies incoming session events into specific work categories:

- **Active status**: `session.status` where `status.type` is one of `active`, `working`, `busy`, `running`, or `streaming`.
- **Meaningful activity**: `message.updated`, `message.part.updated`, or `message.part.delta`.
- **Idle signals**: `session.status` with `status.type === "idle"`, or `session.idle` event.
- **Deletion signal**: `session.deleted`.

#### Work signal decision table

| Current state | Active status | Meaningful activity |
| --- | --- | --- |
| `waiting_activity` | Attempt initial spawn (`kind = "initial"`) | Attempt initial spawn (`kind = "initial"`) |
| `spawning` | Preserve current spawn; clear `idleDuringSpawn` | Preserve current spawn; do **not** clear `idleDuringSpawn` |
| `attached` | No-op | No-op |
| `idle_pending` | Cancel idle timer and transition to `attached` | Preserve existing `idle_pending` state and timer |
| `closing` (`closeReason === "idle"`) | Record `reopenRequested = true` | Record `reopenRequested = true` |
| `closing` (`closeReason === "deleted"`) | Ignored | Ignored |
| `reopenable` | Attempt reopen spawn (`kind = "reopen"`) | Attempt reopen spawn (`kind = "reopen"`) |
| `closed`, `ignored`, `failed` | Ignored | Ignored |

### Data model and close metadata

Each registered child session in `ChildSessionRegistry` maintains:

```ts
export type ChildSessionCloseReason = "idle" | "deleted";

export interface ChildSession {
  readonly sessionId: string;
  readonly parentId: string;
  readonly state: ChildSessionState;
  readonly paneId?: string;
  readonly closeReason?: ChildSessionCloseReason;
  readonly reopenRequested: boolean;
  readonly failureReason?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}
```

- `closeReason`: Records the intent when entering `closing`. Set to `"idle"` by idle grace expiration; set or promoted to `"deleted"` by `session.deleted`. Cleared upon transition to `reopenable` or `closed`.
- `reopenRequested`: Tracks whether work arrived while `closing(idle)`. Updated by last-signal-wins between work (`true`) and idle (`false`). Reset to `false` when entering `closing`, promoted to `deleted`, or when metadata is cleared.
- `paneId`: Defined only while a live pane is attached or in the process of closing. Cleared (`undefined`) when close finishes; a `reopenable` session owns no live pane.

The orchestrator also maintains transient in-memory state for unregistered sessions:
- `ownershipPending: Set<string>`: Sessions whose root-session ownership resolution is currently in flight.
- `pendingSpawnRequests: Set<string>`: Work requests received before ownership resolution finishes.
- `deletedBeforeRegistration: Set<string>`: Tombstones for sessions deleted while ownership resolution was pending. Persists until `dispose()`.

## 5. Lifecycle semantics

### Detection

On `session.created`, the plugin asynchronously resolves the parent to the caller pane's root session. Only sessions owned by or descending from that root are tracked. While resolution is in flight, the session is tracked in transient ownership-pending state. If `session.deleted` arrives while ownership resolution is pending, a tombstone is recorded so completion will never register the session or replay pending work.

### Pane creation

- The first tracked child stays in `waiting_activity` until the first real activity event.
- On first activity, the caller pane (`HERDR_PANE_ID`) is split to the right with `--no-focus` at a `2/3` ratio, producing a main:right-column layout of 2:1. Main focus is preserved.
- The new right-column pane runs `opencode attach <child-session-id>`.
- Subsequent children split the bottom pane of the right column downward at `1/2`, then rebalance existing right-column boundaries so all child panes in the column have equal height.
- `HERDR_CHILD_PANES_DIRECTION` is parsed for compatibility but does not affect this fixed layout.

### Idle

- `session.status` containing `idle` or a `session.idle` event transitions an `attached` session to `idle_pending` and starts the close timer (`HERDR_CHILD_PANES_IDLE_MS`).
- If an idle signal arrives while a session is still `spawning`, deferred idle cleanup is recorded (`idleDuringSpawn`). Active status received before attach completes cancels this deferred cleanup, while meaningful message activity leaves it scheduled; upon attach completion, the session immediately enters `idle_pending` and arms the timer.
- Active status during `idle_pending` cancels the timer and returns the session to `attached`. The same pane remains attached; a second pane is not created.
- Meaningful activity during `idle_pending` preserves the existing scheduled close. It does not cancel the timer or change the current pane.
- If the grace period expires, the pane is closed and the session moves to `reopenable`, not `closed`. The OpenCode child session itself continues running; only the managed pane is removed.

### Reopen after idle close

- While the session is `reopenable`, a work signal (active status or meaningful activity) enqueues a new split/attach for the same `sessionId` using `opencode attach <session-id>`.
- If work arrives while an idle close is currently in flight (`closing` with `closeReason = idle`), `reopenRequested` demand is set to `true`. A later idle signal during the close resets `reopenRequested` back to `false` (last-signal-wins).
- When the old pane close completes inside `AsyncQueue`, the close task clears `paneId`, transitions to `reopenable`, and (when `reopenRequested` was latched and capacity allows) synchronously claims `spawning` and enqueues the successor split/attach onto `AsyncQueue` without awaiting it (`void enqueueSpawn`). This non-awaiting handoff prevents FIFO promise-tail self-deadlock while ensuring Herdr mutations remain strictly serialized.
- A reopened session follows the same fixed right-column split policy and is treated as a newly added visible child. The old pane ID is removed from the live layout before the reopen split plan is calculated, and rebalancing follows normal layout rules; former pane position is not restored.
- The number of reopen cycles for a child session is unbounded until `session.deleted` or unrecoverable failure.

### Deletion

- `session.deleted` permanently terminates visualization:
  - Every registered session, including `waiting_activity` and `reopenable`, first transitions to `closing`. If it has a managed pane, that pane is closed through the serialized mutation queue before the session transitions to terminal `closed`. If no pane is managed and no spawn is in progress, the session transitions from `closing` to `closed` without touching Herdr. If a spawn is in progress, its queued operation observes `closing` and closes any pane it created before finalizing the session. A pane-close failure after retries transitions the session to `failed` as specified below.
  - If `session.deleted` arrives while an idle close is in flight (`closing(idle)`), close intent is promoted to `closeReason = deleted` and `reopenRequested` is cleared; completion transitions to terminal `closed` instead of `reopenable`.
  - If `session.deleted` arrives while ownership resolution is pending, pending work is deleted and a durable pre-registration tombstone is recorded. When ownership resolution finishes, registration and spawn replay are skipped. Subsequent work signals and duplicate `session.created` events for that `sessionId` are ignored until orchestrator disposal.
- Close failures are retried with backoff. After exhausting retries, the session moves to `failed` with reason `close_failed`.

## 6. Capacity semantics

- The number of concurrently managed child panes is capped by `HERDR_CHILD_PANES_MAX` (default `4`).
- A creation request that would exceed the cap transitions the session to `ignored` with reason `capacity_limit`. The child session itself is unaffected; only visualization is skipped.
- A reopen attempt that would exceed the cap leaves the session in `reopenable`; it does not set `failureReason` and does not transition to `ignored`. A later work signal retries when capacity is available.
- Capacity is counted from `registry.listActive()` sessions whose `session.paneId` is defined. A `reopenable` session owns no pane and therefore contributes zero to capacity.
- Creation and close operations are serialized through the internal queue, so concurrent events cannot overshoot the limit.

## 7. Failure and degradation semantics

- Split failure: the session moves to `failed`. The child session continues running; only visualization is lost.
- Attach failure: the just-split pane is closed to avoid leaving an orphan pane, then the session moves to `failed`.
- Close failure: retried with bounded backoff. After retries are exhausted, the session moves to `failed` with reason `close_failed`. No reopen is attempted.
- Reopen capacity pressure: the session remains `reopenable`; a later work signal retries when capacity is available.
- Queue unavailability during reopen handoff: if the queue is disposed before the successor spawn begins, the reservation is released and the session transitions to `failed` with reason `spawn_failed`.
- A Herdr CLI error never crashes the OpenCode server. The plugin logs a warning and leaves the child task untouched.
- The plugin only closes panes it created. The caller pane (`HERDR_PANE_ID`) is never closed.
- Children of an `ignored` or `failed` parent are not visualized. Failures do not cascade to orphan panes.

## 8. Security guarantees

- Commands sent to `herdr pane run` are shell-quoted. Session IDs and directories derived from events cannot inject shell syntax.
- Attach logs shorten server URLs to the origin only. Usernames, passwords, query strings, and fragments do not appear in logs.
- `OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME` are inherited from the environment by the attach process but are not logged or persisted.
- The plugin only splits and closes panes derived from `HERDR_PANE_ID`. It does not inspect or close unrelated panes.

## 9. Compatibility guarantees

- Node.js 20 or later is required at runtime and in CI.
- The plugin is compatible with `@opencode-ai/plugin` peer dependency `^1.17.0`.
- The plugin requires OpenCode events: `session.created`, `session.status` (including `idle`), `session.idle`, `session.deleted`, `message.updated`, and `message.part.updated`.
- `message.part.delta` is handled defensively but is not part of the current SDK event union.
- The plugin is compatible with sessions dispatched by OMO. It has no private dependency on OMO: it consumes only public OpenCode plugin hooks and the public Herdr CLI.

## 10. Acceptance criteria / invariants

- The plugin only loads when `HERDR_ENV` and `HERDR_PANE_ID` are present in the environment.
- Every tracked child session is in exactly one state at a time.
- A pane is created only after the first real activity event for a tracked child session.
- The caller pane always keeps focus during child-pane creation.
- Only right/down split directions are used, matching Herdr's supported directions.
- The caller pane is never closed by the plugin.
- Invalid configuration values fall back to documented defaults without throwing.
- Capacity is never exceeded because creation and close operations are serialized.
- A Herdr CLI error inside the plugin does not propagate as an OpenCode server crash.
- Credentials and URL secrets do not appear in plugin logs.
- One managed child session owns at most one managed pane at any time.
- A session cannot be reopened after it has reached terminal `closed`.
- A session is not split before the old pane close settles; successor reopen is serialized behind the close through the same `AsyncQueue`.
- A queue task never awaits another task enqueued on the same `AsyncQueue`.
- No duplicate pane is created for the same `sessionId`: the synchronous `spawning` or `reopenable → spawning` transition is the idempotency gate.
- `session.deleted` received while ownership resolution is pending prevents registration and any later resurrection for that `sessionId`.
- Reopen count is unbounded across repeated idle-close and reopen cycles until `session.deleted` or unrecoverable failure.
