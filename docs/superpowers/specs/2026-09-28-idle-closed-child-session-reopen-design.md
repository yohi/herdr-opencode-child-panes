# Idle-Closed Child Session Reopen Design

**Issue:** #41  
**Repository:** `yohi/herdr-opencode-child-panes`  
**Base:** `master@31a2c4da7c741622c5874e4a624c81f2c36b7122`  
**Status:** Superpowers Review Gate fixes HERDR41-RG-001 through HERDR41-RG-004 applied; implementation not started

## 1. Purpose

Extend the child-pane lifecycle so that an OpenCode child session whose pane was closed only because of the idle timeout can be visualized again when the same session later resumes work.

The central semantic distinction is:

- idle cleanup ends the current managed pane, but does **not** terminate the OpenCode child session;
- `session.deleted` permanently terminates visualization eligibility for that child session, including when deletion races with asynchronous ownership resolution before registry registration.

The implementation must preserve the invariant that one managed child session owns at most one managed pane at any time.

## 2. Scope

This design covers:

- same-session reopen after successful idle cleanup;
- reopen triggered by active status or meaningful message activity after idle close;
- races between idle close, work, later idle, and `session.deleted`;
- deadlock-free handoff from the serialized close task to the serialized reopen spawn task;
- capacity handling for reopen attempts;
- duplicate-signal idempotency;
- deletion while child ownership resolution is still pending;
- repeated idle-close/reopen cycles;
- state-machine, registry, orchestrator, test, and lifecycle-documentation changes.

This design does not add recovery for split, attach, or close failures; retry initially ignored sessions; restore old pane positions; add an OpenCode HTTP API dependency; or add OMO-private integration.

## 3. Existing constraints

At the design baseline:

- `closed`, `ignored`, and `failed` are terminal states.
- `resumeOrSpawn()` handles `waiting_activity`, `spawning`, and `idle_pending`, but not `closed`.
- meaningful activity is only routed to spawn when the session is currently `waiting_activity`.
- active status and meaningful activity intentionally differ in two existing lifecycle cases:
  - active status resumes `idle_pending -> attached`, while meaningful activity leaves the existing idle close scheduled;
  - active status received during `spawning` clears `idleDuringSpawn`, while meaningful activity does not.
- `reserveSpawn()` converts every capacity shortage into `ignored(capacity_limit)`.
- an idle-timeout close and a delete-triggered close both converge on `closing -> closed`, so the reason for closing is lost.
- successful close leaves the previous `paneId` in the registry record.
- `pendingSpawnRequests` can be repopulated by work after a pre-registration delete while ownership resolution is still pending.
- `AsyncQueue` is a FIFO promise-tail chain. A task running inside the queue must not await a second task enqueued onto the same queue, because that second task cannot start until the current task completes.

Those semantics prevent Issue #41 from being implemented safely by merely allowing `closed -> spawning`.

## 4. Considered approaches

### 4.1 Add a dedicated `reopenable` state — selected

Introduce `reopenable` for a child whose managed pane was successfully removed by idle cleanup while the OpenCode session remains eligible for future visualization.

Keep `closed` terminal and redefine it narrowly as permanent termination after `session.deleted`.

While a session is `closing`, store close intent and whether the latest relevant signal requires an immediate reopen after successful idle close.

Advantages:

- terminal and non-terminal meanings remain explicit;
- existing terminal-state reasoning stays simple;
- capacity retry behavior maps naturally to `reopenable`;
- `session.deleted` remains an irreversible boundary;
- repeated reopen cycles are represented directly by the state machine.

### 4.2 Split closing into multiple states — rejected

Adding `idle_closing`, `deleting`, and more states makes close intent visible in state names, but work/idle ordering during close still needs additional state or metadata. This adds state combinations without removing the need for a latch.

### 4.3 Keep `closed` and add reason metadata — rejected

Using `closed + closeReason=idle` as reopenable and `closed + closeReason=deleted` as terminal makes `closed` simultaneously terminal and non-terminal. It also weakens `TERMINAL_STATES`, `listActive()`, and transition reasoning.

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
| `reopenable` | Idle cleanup successfully removed the pane; the same OpenCode session can be visualized again. |
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

`reopenable -> closing -> closed` is used for `session.deleted` even when no pane exists, so permanent termination follows one explicit delete-intent path.

## 6. Close intent, reopen demand, and signal precedence

A `closing` record stores:

```ts
type ChildSessionCloseReason = "idle" | "deleted";

interface ChildSession {
  // existing fields...
  readonly closeReason?: ChildSessionCloseReason;
  readonly reopenRequested: boolean;
}
```

`reopenRequested` is not a historical "work happened" flag. During `closing(idle)` it represents the **latest reopen demand** observed after close began.

### 6.1 Idle timeout begins close

```text
idle_pending
  -> closing
     closeReason = idle
     reopenRequested = false
```

The old-pane close continues through the existing serialized Herdr mutation queue.

### 6.2 Work arrives while idle close is in progress

Either an active status or meaningful activity received while:

```text
state = closing
closeReason = idle
```

sets:

```text
reopenRequested = true
```

The signal does not cancel the close and does not split a new pane while the old pane can still exist.

Repeated work signals keep the same boolean value and therefore still represent one reopen demand.

### 6.3 A later idle arrives while idle close is in progress

Either `session.idle` or `session.status = idle` received while:

```text
state = closing
closeReason = idle
```

sets:

```text
reopenRequested = false
```

The old-pane close continues unchanged.

Therefore event ordering is last-signal-wins for work versus idle while the close is in progress:

```text
closing(idle)
  -> work
  -> idle
  -> close success
  -> reopenable
  -> no immediate reopen
```

and:

```text
closing(idle)
  -> work
  -> idle
  -> work
  -> close success
  -> reopenable
  -> exactly one immediate reopen attempt
```

The close-completion path reads the current `reopenRequested` value only after the old pane has been confirmed closed.

### 6.4 Delete has highest precedence

`session.deleted` received during any `closing(idle)` sequence changes the metadata to:

```text
closeReason = deleted
reopenRequested = false
```

After this promotion, later active, meaningful-activity, or idle signals cannot change close intent or request reopen.

The existing close operation continues. On success the lifecycle ends in `closed`, never `reopenable`.

Precedence is therefore:

```text
session.deleted
    > latest work/idle demand during closing(idle)
    > earlier work/idle signals
```

## 7. Close completion

### 7.1 Successful idle close

After Herdr confirms the old pane is closed, the currently executing queue task owns only these actions:

1. remove the old pane ID from the orchestrator's live `childPaneIds`;
2. clear the session's stored `paneId`;
3. snapshot the current `reopenRequested` value;
4. transition `closing -> reopenable`;
5. clear `closeReason` and reset `reopenRequested=false`;
6. when the snapshot was `true`, initiate the non-blocking queue handoff defined in §12.

The close task does **not** await the reopen spawn task.

Clearing `paneId` is mandatory. A `reopenable` session owns no live managed pane and contributes zero panes to `HERDR_CHILD_PANES_MAX`.

### 7.2 Successful delete close

After close success:

1. remove the pane ID from the live pane list when present;
2. clear the stored `paneId`;
3. transition `closing -> closed`;
4. clear close metadata and reopen demand.

No later active, idle, or message event can leave `closed`.

### 7.3 Close with no managed pane

For deletion of a `waiting_activity` or `reopenable` session, no Herdr close occurs. The orchestrator records delete intent and finalizes to `closed`.

An idle-triggered defensive close path with no managed pane finalizes to `reopenable`; it never becomes `closed` without `session.deleted`.

### 7.4 Close failure

If idle close retries are exhausted:

```text
closing -> failed(close_failed)
```

Any reopen demand is cleared. No new pane is created because the old pane can still exist.

Delete-triggered close failure retains the existing `failed(close_failed)` behavior.

## 8. Event routing and initial-lifecycle compatibility

The orchestrator uses one state-aware work dispatcher for routing, but **dispatcher reuse does not make active status and meaningful activity behavior identical in every state**.

Work categories are:

- active status: `active`, `working`, `busy`, `running`, `streaming`;
- meaningful activity: `message.updated`, `message.part.updated`, `message.part.delta`.

### 8.1 Registered-session decision table

| Current state | Active status | Meaningful activity |
| --- | --- | --- |
| `waiting_activity` | attempt initial spawn | attempt initial spawn |
| `spawning` | preserve current spawn and clear `idleDuringSpawn` | preserve current spawn and **do not** change `idleDuringSpawn` |
| `attached` | no-op | no-op |
| `idle_pending` | clear idle timer and transition to `attached` | preserve existing `idle_pending` state and existing close timer |
| `closing` + idle intent | set `reopenRequested=true` | set `reopenRequested=true` |
| `closing` + delete intent | ignore | ignore |
| `reopenable` | attempt reopen spawn | attempt reopen spawn |
| `closed` | ignore permanently | ignore permanently |
| `ignored` | ignore | ignore |
| `failed` | ignore | ignore |

This table deliberately preserves the current initial-lifecycle compatibility contracts:

- an active status can cancel deferred idle observed during attach;
- meaningful activity during `spawning` does not cancel `idleDuringSpawn`;
- an active status during `idle_pending` resumes the existing pane;
- meaningful activity during `idle_pending` does not cancel the scheduled close.

Issue #41 changes meaningful-activity behavior only after idle close has progressed to `closing(idle)` or `reopenable`.

### 8.2 Missing/unregistered session routing

Missing sessions are handled through three distinct orchestrator-owned concepts:

```text
ownershipPending
pendingSpawnRequests
deletedBeforeRegistration
```

Exact collection names are not externally observable, but their ownership and precedence are fixed:

1. After a valid `session.created` establishes a parent candidate and before awaiting `ownershipResolver.isOwnedChild()`, the orchestrator marks that `sessionId` as ownership-pending.
2. Work for a missing session is added to pending work only when the session is not tombstoned by `deletedBeforeRegistration`.
3. `session.deleted` for a session whose ownership resolution is pending:
   - removes any pending work request;
   - records a deletion tombstone;
   - does not register a child session merely to represent the deletion.
4. Work received after that tombstone is ignored and cannot recreate pending work.
5. When ownership resolution completes, the handler checks the tombstone **before** `registry.register()` and before replaying pending work.
6. When tombstoned, ownership completion performs no registry registration and no spawn, removes the ownership-pending marker and pending work, and leaves the deletion tombstone in place.
7. The deletion tombstone remains for the lifetime of the orchestrator so duplicate `session.created` or later work for the same deleted `sessionId` cannot resurrect it.
8. `dispose()` clears pending ownership, pending work, and deletion tombstones because no further events are accepted after disposal.

For a registered session, terminal `closed` itself is the permanent deletion tombstone; the separate pre-registration tombstone is only required before a registry entry exists.

This closes the race:

```text
session.created
-> ownership resolution pending
-> work
-> session.deleted
-> later work
-> ownership resolution succeeds
-> no register
-> no replay
-> no pane
```

## 9. Spawn modes, reopen spawning, and idempotency

Spawn requests have an explicit semantic mode:

```ts
type SpawnKind = "initial" | "reopen";
```

The spawn path receives this mode so capacity handling cannot infer semantics from stale metadata.

### 9.1 Initial spawn

`waiting_activity -> spawning` remains the synchronous idempotency claim for first visualization.

### 9.2 Reopen spawn

For a reopen attempt with available capacity:

1. reserve capacity using `SpawnKind = "reopen"`;
2. synchronously claim `reopenable -> spawning`;
3. enqueue the existing split/attach mutation onto the serialized queue;
4. return the enqueue promise to ordinary event callers, but use the non-awaiting handoff contract from §12 when invoked by a currently running close task.

The synchronous transition prevents a burst such as:

```text
session.status active
message.updated
message.part.updated
```

from creating more than one pane in one reopen cycle.

The reopened pane attaches using the existing child `sessionId`; no new OpenCode session is created.

After successful attach:

```text
spawning -> attached
```

A later idle cycle can repeat this sequence without an artificial count limit.

## 10. Capacity semantics

Capacity behavior is selected by `SpawnKind`.

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

the spawn path:

- does not create a reservation;
- does not split;
- does not transition to `spawning`;
- does not set `failureReason`;
- does not transition to `ignored`;
- leaves the session in `reopenable`.

The work signal has been consumed. A later work signal retries when capacity is available.

When an immediate reopen demand is handed off from successful idle close and capacity is already full, the same rule applies: the session remains `reopenable` and no queue task is created.

## 11. Layout semantics

A reopened child is treated as a newly added visible child:

- do not restore its former pane position;
- use the existing fixed root/right-column split policy;
- use the current live `childPaneIds` ordering;
- apply the existing rebalance rules.

The old pane ID is removed before any reopen split plan is calculated.

## 12. Serialization, queue handoff, and races

All Herdr split, resize, and close mutations continue to use the existing `AsyncQueue`.

### 12.1 Queue ownership rule

A queue task owns only its own Herdr mutation and the registry updates needed to finalize that mutation.

A task currently executing inside `AsyncQueue` must **never await** a second task enqueued on the same queue.

This rule is required by the current FIFO promise-tail implementation:

```text
current task
    -> must settle
queue tail
    -> then permits next task to start
```

Awaiting the next task from the current task would create a self-deadlock.

### 12.2 Successful idle-close handoff

When a successful idle close snapshots `reopenRequested=true`, the current close task performs this sequence synchronously:

```text
old pane confirmed closed
-> remove old pane ownership
-> closing -> reopenable
-> consume/reset reopenRequested
-> capacity check for SpawnKind=reopen
-> if capacity available:
     reserve spawn
     reopenable -> spawning
     enqueue reopen spawn continuation
     DO NOT await that continuation
-> current close task returns
-> queue tail settles
-> reopen spawn continuation becomes eligible to run
```

The new split therefore remains serialized behind the old close, but the old close never waits for it.

The enqueue promise must have its normal rejection handler attached before the close task returns; fire-and-forget here means "not awaited by the current queue task", not "unobserved promise".

### 12.3 Queue rejection after the reopen claim

If the reopen continuation cannot be enqueued because the queue has been disposed:

- no Herdr split or attach is attempted;
- the spawn reservation is released;
- the already claimed `spawning` session transitions to `failed`;
- `failureReason` is `spawn_failed`, matching the existing unexpected spawn/queue failure ownership;
- the rejection is handled by the spawn path and does not escape as an unhandled promise rejection.

This is a plugin-lifecycle failure after a successful old-pane close. It does not roll back to `reopenable` because disposal means this orchestrator will accept no future work.

### 12.4 Work and idle while close is running

While `closing(idle)`:

- work sets `reopenRequested=true`;
- later idle sets it back to `false`;
- later work sets it back to `true`;
- none of these signals enqueue Herdr mutation;
- close success snapshots the final boolean and performs at most one handoff.

### 12.5 Delete races

If `session.deleted` arrives before the reopen claim, it promotes close intent to `deleted`, clears reopen demand, and the current close lands in `closed`.

If deletion arrives after reopen has already claimed `spawning`, the existing deletion-during-spawn safety model applies: the session moves to `closing(deleted)`; any pane created by the in-flight spawn is closed rather than retained; final success lands in `closed`.

A close failure never triggers reopen.

These rules preserve:

```text
1 managed child session = at most 1 managed pane
```

and ensure every Herdr mutation remains ordered by the same queue.

## 13. Registry and orchestrator interfaces

### 13.1 Registry data

Add:

```ts
export type ChildSessionCloseReason = "idle" | "deleted";

export interface ChildSession {
  // existing fields...
  readonly closeReason?: ChildSessionCloseReason;
  readonly reopenRequested: boolean;
}
```

A newly registered session starts with `reopenRequested=false` and no `closeReason`.

### 13.2 Registry operations

The registry exposes explicit lifecycle-metadata operations:

```ts
clearPaneId(sessionId: string): void;
setCloseReason(sessionId: string, reason: ChildSessionCloseReason): void;
setReopenRequested(sessionId: string, requested: boolean): void;
clearCloseMetadata(sessionId: string): void;
```

`clearCloseMetadata()` removes `closeReason` and resets `reopenRequested=false`.

State transitions continue to go through `transitionTo()`; metadata setters do not bypass transition validation.

`listActive()` continues to mean all non-terminal sessions. `reopenable` is non-terminal, but because its `paneId` is cleared it contributes zero live panes to capacity calculations.

### 13.3 Orchestrator-only transient state

Pre-registration ownership/deletion bookkeeping belongs to the orchestrator rather than `ChildSessionRegistry`, because no accepted child record exists yet.

The orchestrator owns:

- ownership-pending session IDs;
- pending pre-registration work;
- deletion-before-registration tombstones.

The tombstones are cleared only by `dispose()`.

## 14. Failure metadata

A successful idle close is not a failure and does not set `failureReason`.

A reopen capacity shortage is not a failure and does not set `failureReason=capacity_limit`.

Existing failure reasons remain for:

- initial capacity rejection;
- split failure;
- attach failure;
- close failure;
- unexpected spawn or queue-enqueue failure.

## 15. Logging

Lifecycle logs must make reopen behavior diagnosable without adding per-event noise.

Semantic events to log are:

- idle-closed child became `reopenable`;
- work requested reopen while idle close was in progress;
- later idle cancelled pending reopen while idle close was in progress;
- child reopened and attached;
- reopen deferred because capacity was full;
- pending reopen cancelled because `session.deleted` arrived;
- pre-registration deletion prevented registration after ownership resolution;
- reopen enqueue failed because the serialized queue was unavailable.

Logs preserve existing credential-hygiene guarantees.

## 16. Test design

### 16.1 Registry tests

Add coverage for:

- legal `closing -> reopenable -> spawning -> attached` cycle;
- repeated reopen cycles;
- `reopenable -> closing -> closed` deletion path;
- `closed` remaining terminal;
- `reopenable` being non-terminal;
- pane ID clearing;
- close-reason metadata;
- `reopenRequested` true/false updates and reset;
- illegal transitions remaining rejected.

### 16.2 Orchestrator reopen tests

Cover:

1. idle timeout close followed by active status creates a new pane;
2. idle timeout close followed by each meaningful activity form creates a new pane;
3. reopened attach targets the original child session ID;
4. active status plus message activity in one reopen cycle creates exactly one pane;
5. repeated open -> idle close -> reopen cycles continue to work;
6. reopen uses the current layout and not the old pane location.

### 16.3 Existing initial-lifecycle compatibility tests

The following existing observable behavior is preserved:

- active status during `idle_pending` cancels the timer and keeps the existing pane;
- meaningful activity during `idle_pending` leaves the timer scheduled;
- idle during `spawning` schedules deferred cleanup after attach;
- active status received after idle during `spawning` clears `idleDuringSpawn`;
- meaningful activity received after idle during `spawning` does **not** clear `idleDuringSpawn`; the deferred close remains scheduled.

The existing regression test equivalent to:

```text
spawning
-> idle
-> meaningful activity
-> attach completes
-> deferred idle close still occurs
```

must remain valid.

Add an explicit companion test for:

```text
spawning
-> idle
-> active status
-> attach completes
-> no deferred idle close
```

so both signal types are locked down.

### 16.4 Closing work/idle ordering tests

Cover all of these deterministic sequences:

```text
closing(idle)
-> active
-> close success
=> exactly one reopen
```

```text
closing(idle)
-> meaningful activity
-> close success
=> exactly one reopen
```

```text
closing(idle)
-> work
-> idle
-> close success
=> reopenable, no immediate reopen
```

```text
closing(idle)
-> meaningful activity
-> idle
-> close success
=> reopenable, no immediate reopen
```

```text
closing(idle)
-> work
-> idle
-> work
-> close success
=> exactly one reopen
```

Also verify:

- multiple work signals before close success still produce one reopen;
- close retries can run while reopen demand changes;
- close retry exhaustion produces `failed(close_failed)` and no reopen;
- `session.deleted` after work demand forces `closed` and no reopen;
- deletion after reopen enters `spawning` leaves no orphan or duplicate pane.

### 16.5 Queue handoff tests

Add a test that exercises the real serialized queue ordering:

```text
closing(idle)
-> work signal latches reopen
-> old close succeeds inside queued close task
-> close task returns
-> reopen split executes afterward
```

Assertions:

- the operation completes without hanging;
- old `closePane` completes before the reopen `splitPane` starts;
- `splitPane` is called exactly once for the reopen;
- attach occurs exactly once;
- final state is `attached`.

Add a disposal/rejection test:

```text
idle close task is in flight
-> reopenRequested=true
-> orchestrator/queue disposed
-> old close succeeds
-> reopen enqueue rejected
=> no split
=> reservation released
=> failed(spawn_failed)
=> no unhandled rejection
```

### 16.6 Capacity tests

Cover:

- reopen at full capacity creates no pane and remains `reopenable`;
- no initial-style `ignored` transition occurs;
- no failure reason is recorded for reopen capacity shortage;
- a later work signal after capacity is freed successfully reopens;
- repeated signals while capacity remains full do not split;
- an immediate post-close reopen demand at full capacity ends in `reopenable` without enqueueing;
- initial capacity behavior remains `ignored(capacity_limit)`;
- concurrent spawn reservations still cannot exceed `maxPanes`.

### 16.7 Pre-registration deletion tests

Add the required race:

```text
session.created
-> ownership resolution pending
-> active
-> session.deleted
-> active/message
-> ownership resolution succeeds
=> no registry registration
=> no pending-work replay
=> no split
=> no attach
```

Also verify:

- a tombstoned session ignores later meaningful activity;
- a duplicate `session.created` for the tombstoned ID cannot restart ownership-driven registration;
- disposal clears tombstone bookkeeping.

### 16.8 Regression suite

All existing lifecycle, deletion, failed split, failed attach, close retry, layout, credential, and capacity tests continue to pass, except assertions that intentionally change because **successful idle timeout now ends in `reopenable` instead of terminal `closed`**.

No existing initial-lifecycle signal behavior listed in §16.3 is intentionally changed.

## 17. Documentation updates during implementation

After source implementation is approved and completed, update:

- `SPEC.md` as the canonical technical contract;
- `docs/architecture.md`;
- `docs/architecture.ja.md`;
- user-facing lifecycle documentation where idle close is currently described as terminal.

Those later documentation changes must explicitly distinguish idle pane cleanup from `session.deleted`.

They are not part of the current document-only Review Gate fix.

## 18. Acceptance and requirement mapping

| Issue #41 requirement | Design mechanism |
| --- | --- |
| FR-1 / AC-1 / AC-2 | successful idle close reaches `reopenable`; active status or meaningful activity can reopen |
| FR-4 / AC-3 / NFR-1 | synchronous `reopenable -> spawning` claim and one boolean reopen demand |
| FR-5 / AC-4 | existing child `sessionId` is passed to attach |
| FR-9 / AC-5 / NFR-4 | existing grace-period behavior is preserved: active status resumes the existing pane; existing meaningful-activity behavior remains unchanged |
| FR-10 / FR-11 / AC-6 | `closing(idle)` never cancels old close; final work/idle demand determines whether a non-blocking reopen handoff occurs after close |
| FR-12 / AC-7 | close failure goes to `failed(close_failed)`; reopen demand is discarded |
| FR-13 / FR-14 / FR-15 / AC-8 / AC-9 | `SpawnKind=reopen` capacity shortage stays `reopenable` and is retryable on a later work signal |
| FR-16 / AC-10 / NFR-4 | `SpawnKind=initial` preserves `ignored(capacity_limit)` |
| FR-7 / AC-11 / NFR-5 | `attached -> ... -> reopenable -> spawning -> attached` is repeatable without a counter |
| FR-8 / AC-12 | registered `closed` and pre-registration deletion tombstones both make `session.deleted` irreversible |
| FR-6 / AC-13 | reopen reuses existing split/rebalance policy |
| NFR-2 | close and reopen Herdr mutations remain on the same serialized queue with a non-awaiting queue-task handoff |
| NFR-3 | existing pane ownership rules remain; caller/unmanaged panes are never closed |
| AC-14 | TDD coverage in §16 plus the full existing regression suite is required by the later implementation plan |

## 19. Invariants

The implementation must maintain all of the following:

1. A managed child session owns at most one managed pane.
2. No reopen split starts before an old pane's successful close task has settled.
3. A queue task never awaits another task enqueued on the same `AsyncQueue`.
4. `session.deleted` is irreversible for registered sessions and ownership-pending pre-registration candidates.
5. A pre-registration deletion tombstone blocks later work and duplicate creation for that `sessionId` until orchestrator disposal.
6. Idle cleanup alone never permanently disables visualization.
7. During `closing(idle)`, the latest work/idle signal determines immediate reopen demand; deletion overrides both.
8. Reopen capacity pressure never becomes a permanent ignore or failure.
9. Initial capacity semantics do not change.
10. `closed`, `ignored`, and `failed` remain terminal.
11. `reopenable` contains no live pane ID.
12. Duplicate work signals cannot create duplicate panes.
13. Herdr mutations remain serialized.
14. Initial `spawning` and `idle_pending` active-vs-message behavior remains compatible with the current implementation.
15. The caller pane and unmanaged panes are never closed by this plugin.
16. Reopen count is unbounded until deletion or failure.

## 20. Compatibility boundary

### Preserved behavior

Issue #41 does not change:

- ownership criteria for a normal child;
- initial `waiting_activity` spawn triggers;
- the active-status versus meaningful-activity distinction in `spawning`;
- the active-status versus meaningful-activity distinction in `idle_pending`;
- initial capacity rejection semantics;
- split and attach failure terminal behavior;
- close failure terminal behavior;
- layout policy;
- caller-pane and unmanaged-pane safety;
- Herdr mutation serialization.

### Intentional changes required by Issue #41

Issue #41 changes:

- successful idle timeout from `closing -> closed` to `closing -> reopenable`;
- work received during `closing(idle)` into immediate-reopen demand rather than a no-op;
- idle received after such work during `closing(idle)` into cancellation of that immediate-reopen demand;
- active status or meaningful activity in `reopenable` into a reopen spawn attempt;
- capacity shortage for `SpawnKind=reopen` into a retryable `reopenable` outcome;
- deletion during ownership resolution into a durable pre-registration tombstone so AC-12 remains true before registry registration.

## 21. Review Gate resolution

### HERDR41-RG-001

Resolved by §7.1 and §12:

- close task owns old-pane close and registry finalization only;
- reopen uses the same serialized queue;
- reopen claim/enqueue is performed without awaiting the successor task from the current queue task;
- queue-disposal rejection is owned by the spawn path and ends in `failed(spawn_failed)`;
- §16.5 requires a non-hanging exactly-once handoff test.

### HERDR41-RG-002

Resolved by §6.3, §6.4, §12.4, and §16.4:

- later idle during `closing(idle)` clears reopen demand;
- later work can set it again;
- deletion has higher precedence than both;
- all required work/idle ordering sequences are explicitly tested.

### HERDR41-RG-003

Resolved by §8 and §16.3:

- the dispatcher is shared, but observable behavior is state-and-signal specific;
- active status clears `idleDuringSpawn`;
- meaningful activity does not;
- current `idle_pending` message behavior is also preserved;
- no conditional wording remains for these semantics.

### HERDR41-RG-004

Resolved by §8.2, §13.3, §16.7, and invariant 4–5:

- ownership-pending state, pending work, and deletion tombstones have explicit ownership;
- delete clears pending work and records a durable tombstone;
- later work cannot repopulate pending work;
- ownership completion checks deletion before registration/replay;
- tombstones live until orchestrator disposal.

## 22. Implementation boundary

This document defines the complete behavior, state ownership, interfaces, error handling, serialization contract, compatibility boundary, and test obligations for Issue #41.

It does not authorize source-code implementation.

The next step after a successful Superpowers Review Gate is to create a separate Superpowers Implementation Plan whose terminology, types, interfaces, failure semantics, queue handoff, and tests match this design exactly.

Source code, tests, configuration, `SPEC.md`, and architecture documentation must not be modified before that planning gate is completed.
