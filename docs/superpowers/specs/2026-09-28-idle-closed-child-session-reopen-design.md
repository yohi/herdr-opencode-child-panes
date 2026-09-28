# Idle-Closed Child Session Reopen Design

**Issue:** #41  
**Repository:** `yohi/herdr-opencode-child-panes`  
**Base:** `master@31a2c4da7c741622c5874e4a624c81f2c36b7122`  
**Status:** Design approved in brainstorming; implementation not started

## 1. Purpose

Extend the child-pane lifecycle so that an OpenCode child session whose pane was closed only because of the idle timeout can be visualized again when the same session later resumes work.

The central semantic distinction is:

- idle cleanup ends the current managed pane, but does **not** terminate the OpenCode child session;
- `session.deleted` permanently terminates visualization eligibility for that child session.

The implementation must preserve the invariant that one managed child session owns at most one managed pane at any time.

## 2. Scope

This design covers:

- same-session reopen after successful idle cleanup;
- reopen triggered by active status or meaningful message activity;
- races between idle close and new work;
- races between idle close and `session.deleted`;
- capacity handling for reopen attempts;
- duplicate-signal idempotency;
- repeated idle-close/reopen cycles;
- state-machine, registry, orchestrator, test, and lifecycle-documentation changes.

This design does not add recovery for split, attach, or close failures; retry initially ignored sessions; restore old pane positions; add an OpenCode HTTP API dependency; or add OMO-private integration.

## 3. Existing constraints

At the design baseline:

- `closed`, `ignored`, and `failed` are terminal states.
- `resumeOrSpawn()` handles `waiting_activity`, `spawning`, and `idle_pending`, but not `closed`.
- meaningful activity is only routed to spawn when the session is currently `waiting_activity`.
- `reserveSpawn()` converts every capacity shortage into `ignored(capacity_limit)`.
- an idle-timeout close and a delete-triggered close both converge on `closing -> closed`, so the reason for closing is lost.
- successful close leaves the previous `paneId` in the registry record.

Those semantics prevent Issue #41 from being implemented safely by merely allowing `closed -> spawning`.

## 4. Considered approaches

### 4.1 Add a dedicated `reopenable` state — selected

Introduce `reopenable` for a child whose managed pane was successfully removed by idle cleanup while the OpenCode session remains eligible for future visualization.

Keep `closed` terminal and redefine it narrowly as permanent termination after `session.deleted`.

While a session is `closing`, store close intent and whether work arrived during an idle-triggered close.

Advantages:

- terminal and non-terminal meanings remain explicit;
- existing terminal-state reasoning stays simple;
- capacity retry behavior maps naturally to `reopenable`;
- `session.deleted` can remain an irreversible boundary;
- repeated reopen cycles are represented directly by the state machine.

### 4.2 Split closing into multiple states

For example, add `idle_closing`, `deleting`, and `reopenable`.

This makes close intent visible in the state name, but pending reopen would still require another state or metadata. The resulting state combinations are larger than needed.

### 4.3 Keep `closed` and add reason metadata

Use `closed + closeReason=idle` as reopenable and `closed + closeReason=deleted` as terminal.

This minimizes the enum change but makes `closed` simultaneously terminal and non-terminal. It also weakens `TERMINAL_STATES`, `listActive()`, and transition reasoning. This approach is rejected.

## 5. Selected lifecycle model

### 5.1 States

The lifecycle becomes:

```text
waiting_activity
spawning
attached
idle_pending
closing
reopenable
closed
ignored
failed
```

Meanings:

| State | Meaning |
| --- | --- |
| `waiting_activity` | Owned child is known; no pane has yet been visualized. |
| `spawning` | A split/attach attempt is claimed for this child. |
| `attached` | Exactly one managed pane is attached to the child session. |
| `idle_pending` | Idle grace timer is running; the existing pane is still attached. |
| `closing` | The existing pane is being removed or lifecycle termination is being finalized. |
| `reopenable` | Idle cleanup successfully removed the pane; the same OpenCode session may be visualized again. |
| `closed` | The session received `session.deleted`; visualization is permanently terminated. |
| `ignored` | Initial visualization was permanently skipped under existing policy, such as initial capacity exhaustion. |
| `failed` | Visualization failed and automatic recovery is out of scope. |

### 5.2 Legal transitions

```text
waiting_activity -> spawning | closing | ignored | failed
spawning         -> attached | closing | failed
attached         -> idle_pending | closing | failed
idle_pending     -> attached | closing | failed
closing          -> reopenable | closed | failed
reopenable       -> spawning | closing
closed           -> (none)
ignored          -> (none)
failed           -> (none)
```

`reopenable -> closing -> closed` is used for `session.deleted` even though no pane may exist, so permanent termination follows the same delete intent path.

## 6. Close intent and pending reopen

A `closing` record must preserve enough metadata to distinguish idle cleanup from permanent deletion.

The registry model should store the equivalent of:

```text
closeReason: "idle" | "deleted" | undefined
reopenRequested: boolean
```

Exact property names are implementation details, but the following semantics are required.

### 6.1 Idle timeout begins close

```text
idle_pending
  -> closing
     closeReason = idle
     reopenRequested = false
```

The close operation continues through the existing serialized Herdr mutation queue.

### 6.2 Work arrives while idle close is in progress

An active status or meaningful activity received while:

```text
state = closing
closeReason = idle
```

sets:

```text
reopenRequested = true
```

It does not cancel the close and does not start a split while the old pane may still exist.

Multiple work signals only set the same latch and therefore represent one reopen request.

### 6.3 Delete arrives while idle close is in progress

`session.deleted` has precedence over a pending reopen.

The registry is updated to the equivalent of:

```text
state = closing
closeReason = deleted
reopenRequested = false
```

The existing close operation continues. On success the lifecycle ends in `closed`, never `reopenable`.

This rule is required to prevent an idle-close race from resurrecting a session after OpenCode has deleted it.

## 7. Close completion

### 7.1 Successful idle close

After Herdr confirms the old pane is closed:

1. remove that pane ID from the orchestrator's live `childPaneIds`;
2. clear the session's stored `paneId`;
3. transition `closing -> reopenable`;
4. clear close-intent metadata;
5. if `reopenRequested` had been latched, consume it and perform one reopen spawn attempt.

Clearing `paneId` is mandatory. A reopenable session has no live managed pane and must not count against `HERDR_CHILD_PANES_MAX`.

### 7.2 Successful delete close

After close success:

1. remove the pane ID from the live pane list if present;
2. clear the stored `paneId`;
3. transition `closing -> closed`;
4. clear pending reopen metadata.

No later active or message event may leave `closed`.

### 7.3 Close with no managed pane

For a delete of a `waiting_activity` or `reopenable` session, no Herdr close is needed. The lifecycle still finalizes through delete intent and lands in `closed`.

An idle-triggered close with no managed pane should finalize as `reopenable`, although this is primarily a defensive path.

### 7.4 Close failure

If idle close retries are exhausted:

```text
closing -> failed(close_failed)
```

A latched reopen request is discarded. No new pane is created because the old pane may still exist.

Delete-triggered close failure retains the current failure behavior.

## 8. Work-signal routing

Active statuses and meaningful activity must use one common resume/spawn decision path.

Work signals are:

- active status: `active`, `working`, `busy`, `running`, `streaming`;
- meaningful activity: `message.updated`, `message.part.updated`, `message.part.delta`.

The decision table is:

| Current state | Work-signal result |
| --- | --- |
| missing/unregistered | preserve existing pending pre-registration signal behavior |
| `waiting_activity` | attempt initial spawn |
| `spawning` | preserve current spawn; clear an idle-during-spawn marker if appropriate |
| `attached` | no-op |
| `idle_pending` | cancel timer and return to `attached`; same pane remains |
| `closing` with idle intent | latch exactly one reopen request |
| `closing` with delete intent | ignore |
| `reopenable` | attempt reopen spawn |
| `closed` | ignore permanently |
| `ignored` | ignore under existing policy |
| `failed` | ignore; recovery is out of scope |

This requires meaningful activity to stop special-casing only `waiting_activity`; it should route through the same state-aware logic as active status.

## 9. Reopen spawning and idempotency

Reopen uses the existing split/attach path and existing layout policy.

Before Herdr work is queued, `reopenable -> spawning` is the synchronous idempotency claim, analogous to the current `waiting_activity -> spawning` claim.

Therefore a burst such as:

```text
session.status active
message.updated
message.part.updated
```

can create at most one pane for that reopen cycle.

The reopened pane attaches using the existing child `sessionId`; no new OpenCode session is created.

After successful attach:

```text
spawning -> attached
```

and the newly created pane becomes the session's current `paneId`.

A later idle cycle may repeat this sequence without an artificial count limit.

## 10. Capacity semantics

Capacity behavior must distinguish initial visualization from reopen visualization.

### 10.1 Initial spawn

Preserve existing behavior:

```text
waiting_activity
  -> work
  -> capacity full
  -> ignored
     failureReason = capacity_limit
```

No retry is introduced for an initially ignored child.

### 10.2 Reopen spawn

For:

```text
reopenable
  -> work
  -> capacity full
```

do not reserve a pane, do not split, and do not transition to `ignored`.

The session remains:

```text
reopenable
```

A later work signal may retry after capacity becomes available.

Capacity shortage during reopen is therefore a transient inability to visualize, not a lifecycle failure.

The spawn reservation check should be context-aware, either by inspecting the source state or by receiving an explicit initial/reopen mode. The observable distinction above is mandatory; the internal API shape is not.

## 11. Layout semantics

A reopened child is treated as a newly added visible child for layout purposes:

- do not restore its former pane position;
- use the existing fixed root/right-column split policy;
- use the current live `childPaneIds` ordering;
- apply the existing rebalance rules.

The old pane ID must have been removed before the reopen split is planned.

## 12. Serialization and races

All Herdr split, resize, and close mutations continue to use the existing async queue.

Important ordering rules:

1. A work signal during `closing(idle)` only updates registry metadata; it does not mutate Herdr.
2. The old pane close completes before any reopen split is allowed.
3. The close completion path may immediately claim `reopenable -> spawning` and enqueue the reopen.
4. If `session.deleted` arrives before the reopen claim, it transitions toward permanent close.
5. If deletion arrives after a reopen has already claimed `spawning`, the existing deletion-during-spawn safety path must close any newly created pane and terminate the session.
6. A close failure never triggers reopen.

These rules preserve:

```text
1 managed child session = at most 1 managed pane
```

at every point in the lifecycle.

## 13. Registry API implications

The registry needs a way to remove stale pane ownership after close success.

The preferred API is an explicit operation such as:

```text
clearPaneId(sessionId)
```

rather than overloading `setPaneId` with an empty string or sentinel value.

The registry also needs operations to set/clear close intent and the pending-reopen latch. They may be implemented as dedicated methods or as a constrained lifecycle-metadata update API, but callers must not bypass transition validation.

`listActive()` may continue to mean "all non-terminal sessions". `reopenable` is non-terminal, but because its `paneId` is cleared it contributes zero live panes to capacity calculations.

## 14. Failure metadata

A successful idle close is not a failure and must not set `failureReason`.

A reopen capacity shortage is also not a failure and must not set `failureReason=capacity_limit`.

Existing failure reasons remain for:

- initial capacity rejection;
- split failure;
- attach failure;
- close failure;
- unexpected spawn failure.

## 15. Logging

Lifecycle logs should make reopen behavior diagnosable without adding noisy per-event logging.

Useful semantic events include:

- idle-closed child became reopenable;
- work latched while idle close was in progress;
- child reopened and attached;
- reopen deferred because capacity was full;
- pending reopen cancelled because `session.deleted` arrived.

Logs must preserve existing credential-hygiene guarantees.

## 16. Test design

### 16.1 Registry tests

Add coverage for:

- legal `closing -> reopenable -> spawning -> attached` cycle;
- repeated reopen cycles;
- `reopenable -> closing -> closed` deletion path;
- `closed` remaining terminal;
- `reopenable` being non-terminal;
- pane ID clearing;
- close-reason and reopen-latch metadata semantics;
- illegal transitions remaining rejected.

### 16.2 Orchestrator reopen tests

Cover at minimum:

1. idle timeout close followed by active status creates a new pane;
2. idle timeout close followed by each meaningful activity form creates a new pane;
3. reopened attach targets the original child session ID;
4. active status plus message activity in one reopen cycle creates exactly one pane;
5. repeated open -> idle close -> reopen cycles continue to work;
6. reopen uses the current layout and not the old pane location.

### 16.3 Idle-grace compatibility tests

Preserve and assert:

- activity during `idle_pending` cancels close;
- the original pane remains attached;
- no second pane is created.

### 16.4 Closing-race tests

Cover:

- active status while idle close is in flight -> old close succeeds -> exactly one reopen;
- multiple work signals while close is in flight -> exactly one reopen;
- meaningful activity has the same behavior;
- close retries may occur while reopen is latched;
- close retry exhaustion -> `failed(close_failed)`, no reopen;
- `session.deleted` while reopen is latched changes the outcome to `closed`, no reopen;
- deletion after reopen has entered `spawning` cannot leave an orphan or duplicate pane.

### 16.5 Capacity tests

Cover:

- reopen at full capacity creates no pane and remains `reopenable`;
- no initial-style `ignored` transition occurs;
- a later work signal after capacity is freed successfully reopens;
- repeated signals while capacity remains full do not split;
- initial capacity behavior remains `ignored(capacity_limit)`;
- concurrent spawn reservations still cannot exceed `maxPanes`.

### 16.6 Regression tests

All existing lifecycle, deletion, failed split, failed attach, close retry, layout, credential, and capacity tests must continue to pass unless assertions are intentionally updated for the new `closed` semantics.

## 17. Documentation updates during implementation

Once implementation is complete, update:

- `SPEC.md` as the canonical technical contract;
- `docs/architecture.md`;
- `docs/architecture.ja.md`;
- user-facing lifecycle documentation where idle close is currently described as terminal.

The documentation must explicitly distinguish idle pane cleanup from `session.deleted`.

## 18. Acceptance mapping

| Issue #41 acceptance criterion | Design mechanism |
| --- | --- |
| AC-1 / AC-2 | `reopenable` handles active status and meaningful activity |
| AC-3 | synchronous `reopenable -> spawning` idempotency claim |
| AC-4 | existing `sessionId` is passed to attach |
| AC-5 | `idle_pending -> attached` reuses the old pane |
| AC-6 | `closing(idle)` latches work; reopen occurs only after close success |
| AC-7 | close failure goes to `failed(close_failed)`; latch discarded |
| AC-8 / AC-9 | reopen capacity shortage stays `reopenable` and is retryable |
| AC-10 | initial capacity path remains `ignored(capacity_limit)` |
| AC-11 | `attached -> ... -> reopenable -> spawning -> attached` is repeatable |
| AC-12 | `session.deleted` ends at terminal `closed` and overrides pending reopen |
| AC-13 | reopen reuses existing split/rebalance policy |
| AC-14 | TDD and full regression suite are required by the implementation plan |

## 19. Invariants

The implementation must maintain all of the following:

1. A managed child session owns at most one managed pane.
2. No reopen split occurs before an old pane's successful close.
3. `session.deleted` is irreversible.
4. Idle cleanup alone never permanently disables visualization.
5. Reopen capacity pressure never becomes a permanent ignore.
6. Initial capacity semantics do not change.
7. `closed`, `ignored`, and `failed` remain terminal.
8. `reopenable` contains no live pane ID.
9. Duplicate work signals cannot create duplicate panes.
10. Herdr mutations remain serialized.
11. The caller pane and unmanaged panes are never closed by this plugin.
12. Reopen count is unbounded until deletion or failure.

## 20. Implementation boundary

This document defines behavior and lifecycle contracts only. It does not authorize source-code implementation.

The next step after review approval of this written design is to create a separate Superpowers implementation plan. Source code, tests, `SPEC.md`, and architecture documentation must not be modified before that planning gate is completed.
