# Idle-Closed Child Session Reopen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make idle-closed OpenCode child sessions reopen the same child session in a new Herdr pane while preserving permanent deletion, initial lifecycle compatibility, serialized pane mutation, and capacity safety.

**Architecture:** Add `reopenable` and close metadata to the registry, route work through a signal-aware orchestrator dispatcher, distinguish `initial` from `reopen` spawn capacity semantics, and finalize idle closes into `reopenable`. When work is latched during an idle close, synchronously claim the reopen and enqueue a successor spawn onto the same `AsyncQueue` without awaiting it from the current close task. Pre-registration deletion remains orchestrator-owned through a durable tombstone until disposal.

**Tech Stack:** TypeScript 5.6, Node.js >=20, Vitest 2.1, `@opencode-ai/plugin` ^1.17.0, existing Herdr CLI adapter, existing promise-tail `AsyncQueue`.

**Spec:** [`docs/superpowers/specs/2026-09-28-idle-closed-child-session-reopen-design.md`](../specs/2026-09-28-idle-closed-child-session-reopen-design.md)

## Global Constraints

- Do not redesign the approved lifecycle: `reopenable`, `SpawnKind = "initial" | "reopen"`, `ChildSessionCloseReason = "idle" | "deleted"`, and `reopenRequested: boolean` are fixed.
- `closed`, `ignored`, and `failed` remain terminal; `reopenable` is non-terminal and owns no live `paneId`.
- `session.deleted` is irreversible for both registered sessions and ownership-pending pre-registration candidates.
- During `closing(idle)`, work sets `reopenRequested=true`, later idle sets it to `false`, later work sets it back to `true`, and deletion overrides all of them.
- A task currently executing inside the existing `AsyncQueue` must never await a successor task enqueued on that same queue.
- Initial capacity shortage remains `ignored(capacity_limit)`; reopen capacity shortage remains `reopenable` with no failure reason.
- Preserve existing `spawning` and `idle_pending` active-status-versus-meaningful-activity behavior exactly.
- Reopened panes attach the same child `sessionId` and use the existing split/rebalance layout; old pane position is not restored.
- No recovery is added for split failure, attach failure, close failure, initially ignored sessions, or failed sessions.
- No new runtime dependency, OpenCode HTTP API call, OMO-private API dependency, or configuration variable is introduced.
- Every implementation task follows RED -> failure confirmation -> minimum GREEN -> GREEN confirmation -> commit.
- Do not update release-managed `CHANGELOG.md` manually.

## Review Focus

These are the highest-risk conditions implied by the Design. Each is pinned to a concrete test in the owning task.

1. **Close result races with metadata updates while `closePane()` is awaited:** Task 4 rereads current registry metadata after close success and tests work/idle/delete arriving while the close promise is in flight.
2. **Both idle signal shapes during `closing(idle)`:** Task 4 tests both `session.idle` and `session.status=idle` cancelling pending reopen demand.
3. **Defensive `message.part.delta` reopen path:** Task 2 tests that a `reopenable` child reopens on `message.part.delta` even though that event is outside the current SDK union.
4. **Duplicate creation around ownership resolution and deletion:** Task 6 tests duplicate `session.created` while ownership is pending and after a deletion tombstone; neither may create a second resolver/spawn path.
5. **Immediate reopen demand when capacity is unavailable:** Task 5 tests that the post-close handoff performs no split, leaves the child `reopenable`, records no failure, and can be retried by a later work signal.

## File Structure

| File | Responsibility in this change |
| --- | --- |
| `src/child-session.ts` | Add `reopenable`, `ChildSessionCloseReason`, `reopenRequested`, and registry interface methods. |
| `src/child-session-registry.ts` | Implement transitions, metadata setters/reset, explicit `paneId` clearing, and non-terminal `reopenable`. |
| `src/pane-orchestrator.ts` | Own signal dispatch, spawn kind, close intent, last-signal-wins reopen demand, queue handoff, capacity behavior, deletion races, and pre-registration tombstones. |
| `src/async-queue.ts` | **No behavior change planned.** Its existing FIFO promise-tail semantics are the contract Task 5 must respect. |
| `test/child-session-registry.test.ts` | Pin lifecycle, metadata, terminality, and pane ownership. |
| `test/pane-orchestrator.test.ts` | Pin reopen behavior, compatibility, capacity, close races, queue handoff, deletion races, tombstones, and repeated cycles. |
| `SPEC.md` | Synchronize the canonical lifecycle, capacity, failure, and invariants after code is green. |
| `docs/architecture.md` / `docs/architecture.ja.md` | Synchronize high-level control flow in English and Japanese. |
| `docs/operations.md` | Synchronize operational idle/reopen/capacity/logging behavior and correct the active-vs-message idle-grace distinction. |
| `README.md` / `README.ja.md` | Synchronize concise user-facing lifecycle behavior. |

---

### Task 1: Add Reopenable Registry Lifecycle and Metadata

**Files:**
- Modify: `src/child-session.ts`
- Modify: `src/child-session-registry.ts`
- Test: `test/child-session-registry.test.ts`

**Interfaces:**
- Produces:
  - `export type ChildSessionCloseReason = "idle" | "deleted";`
  - `ChildSession.state` includes `"reopenable"`
  - `ChildSession.closeReason?: ChildSessionCloseReason`
  - `ChildSession.reopenRequested: boolean`
  - `ChildSessionRegistry.clearPaneId(sessionId: string): void`
  - `ChildSessionRegistry.setCloseReason(sessionId: string, reason: ChildSessionCloseReason): void`
  - `ChildSessionRegistry.setReopenRequested(sessionId: string, requested: boolean): void`
  - `ChildSessionRegistry.clearCloseMetadata(sessionId: string): void`
- Consumed by: Tasks 2–6.

- [ ] **Step 1: Write failing registry tests for reopenable transitions, metadata, and pane clearing**

Add tests equivalent to:

```ts
it("supports a reopenable lifecycle while keeping closed terminal", () => {
  const registry = createChildSessionRegistry();
  registry.register("child-1", "root-1");

  expect(registry.get("child-1")?.reopenRequested).toBe(false);
  expect(registry.transitionTo("child-1", "spawning")).toBe(true);
  expect(registry.transitionTo("child-1", "attached")).toBe(true);
  expect(registry.transitionTo("child-1", "idle_pending")).toBe(true);
  expect(registry.transitionTo("child-1", "closing")).toBe(true);
  expect(registry.transitionTo("child-1", "reopenable")).toBe(true);
  expect(registry.transitionTo("child-1", "spawning")).toBe(true);
});

it("clears pane ownership and close metadata explicitly", () => {
  const registry = createChildSessionRegistry();
  registry.register("child-1", "root-1");
  registry.setPaneId("child-1", "pane-1");
  registry.setCloseReason("child-1", "idle");
  registry.setReopenRequested("child-1", true);

  registry.clearPaneId("child-1");
  registry.clearCloseMetadata("child-1");

  expect(registry.get("child-1")).toMatchObject({ reopenRequested: false });
  expect(registry.get("child-1")?.paneId).toBeUndefined();
  expect(registry.get("child-1")?.closeReason).toBeUndefined();
});

it("lists reopenable as non-terminal but keeps closed terminal", () => {
  // Stage one child in reopenable and one in closed.
  expect(registry.listActive().map((session) => session.sessionId)).toContain("reopenable");
  expect(registry.listActive().map((session) => session.sessionId)).not.toContain("closed");
});
```

Also update the existing exact registered-session object assertion to include `reopenRequested: false`, and extend the illegal-transition coverage to assert `closed -> spawning` remains rejected.

- [ ] **Step 2: Run the registry tests and confirm RED**

Run:

```bash
npm test -- test/child-session-registry.test.ts
```

Expected: FAIL because `reopenable`, the close metadata fields, and the new registry methods do not exist.

- [ ] **Step 3: Implement the minimum registry contract**

In `src/child-session.ts`:

- add `"reopenable"` to `ChildSessionState`;
- add the exact `ChildSessionCloseReason` type above;
- make `reopenRequested: boolean` present on every registered `ChildSession`;
- add the four registry method signatures;
- set legal transitions exactly to:
  - `closing -> reopenable | closed | failed`
  - `reopenable -> spawning | closing`
  - `closed | ignored | failed -> none`.

In `src/child-session-registry.ts`:

- initialize `reopenRequested: false` on register;
- keep `TERMINAL_STATES` as `closed`, `ignored`, `failed` only;
- implement `clearPaneId()` by removing the property rather than using an empty/sentinel ID;
- implement close metadata setters and `clearCloseMetadata()` so the latter removes `closeReason` and resets `reopenRequested=false`.

- [ ] **Step 4: Run the registry tests and confirm GREEN**

Run:

```bash
npm test -- test/child-session-registry.test.ts
npm run typecheck
```

Expected: both commands PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/child-session.ts src/child-session-registry.ts test/child-session-registry.test.ts
git commit -m "feat: add reopenable child session lifecycle"
```

---

### Task 2: Introduce Signal-Aware Work Dispatch Without Breaking Initial Lifecycle Compatibility

**Files:**
- Modify: `src/pane-orchestrator.ts`
- Modify: `test/pane-orchestrator.test.ts`

**Interfaces:**
- Consumes: Task 1 registry contract.
- Produces internal orchestrator types/signatures:
  - `type WorkSignalKind = "active_status" | "meaningful_activity";`
  - `type SpawnKind = "initial" | "reopen";`
  - `handleWorkSignal(sessionId: string | undefined, signalKind: WorkSignalKind): Promise<void>`
  - `enqueueSpawn(session: ChildSession, kind: SpawnKind): Promise<void>`
- Task 3 will make `SpawnKind` capacity-sensitive.
- Task 5 will call `enqueueSpawn(..., "reopen")` from a non-awaiting queue handoff.

- [ ] **Step 1: Write failing tests for reopenable work routing and compatibility**

Add a test helper with this exact purpose:

```ts
function stageReopenableWithoutPane(fixture: Fixture, sessionId: string): void
```

It registers the child if needed, advances the registry through the legal lifecycle to `reopenable`, and calls `clearPaneId(sessionId)`. It does not mutate the orchestrator's private `childPaneIds`.

Add tests equivalent to:

```ts
it("reopens a reopenable child on active status using the same session ID", async () => {
  // stage reopenable, send active
  expect(fixture.attach).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: CHILD_ID }),
  );
  expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
});

it("reopens a reopenable child on message.part.delta", async () => {
  // stage reopenable, send deltaActivityEvent
  expect(fixture.splitPane).toHaveBeenCalledTimes(1);
  expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
});

it("clears idleDuringSpawn on active status but not meaningful activity", async () => {
  // Preserve the existing meaningful-activity deferred-close test.
  // Add the active-status companion case.
  expect(activeCase.closePane).not.toHaveBeenCalled();
  expect(messageCase.closePane).toHaveBeenCalledWith(NEW_PANE_ID);
});
```

Keep the existing tests that prove:

- `idle_pending + active status -> attached` and timer cancellation;
- `idle_pending + meaningful activity -> idle_pending` and timer preservation.

- [ ] **Step 2: Run focused orchestrator tests and confirm RED**

Run:

```bash
npm test -- test/pane-orchestrator.test.ts -t "reopenable|idleDuringSpawn|keeps the close scheduled|resumes the session"
```

Expected: new reopenable tests FAIL because current activity/status handlers do not route `reopenable`; the existing compatibility tests must still pass.

- [ ] **Step 3: Implement one state-aware work dispatcher**

In `src/pane-orchestrator.ts`:

- replace the split logic between `resumeOrSpawn()` and `handleActivity()` with `handleWorkSignal(sessionId, signalKind)`;
- route active status as `"active_status"`;
- route all three meaningful events as `"meaningful_activity"`;
- use the approved state/signal table:
  - `waiting_activity`: `enqueueSpawn(session, "initial")`;
  - `spawning + active_status`: clear `idleDuringSpawn`;
  - `spawning + meaningful_activity`: no marker change;
  - `attached`: no-op;
  - `idle_pending + active_status`: existing timer cancel + `attached`;
  - `idle_pending + meaningful_activity`: no-op;
  - `closing`: preserve the current no-op work behavior in this incremental task; Task 4 replaces this row with the approved idle/delete-intent handling;
  - `closing(deleted)`: ignore;
  - `reopenable`: `enqueueSpawn(session, "reopen")`;
  - terminal states: ignore.
- add `SpawnKind` to `enqueueSpawn` now; Task 3 will use it to differentiate capacity behavior.

Do not change `idleDuringSpawn` compatibility in this task.

- [ ] **Step 4: Run the whole orchestrator test file and confirm GREEN**

Run:

```bash
npm test -- test/pane-orchestrator.test.ts
npm run typecheck
```

Expected: both commands PASS; specifically the existing meaningful-activity-after-idle-during-attach regression remains green.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/pane-orchestrator.ts test/pane-orchestrator.test.ts
git commit -m "feat: route reopen work signals by lifecycle state"
```

---

### Task 3: Split Initial and Reopen Capacity Semantics

**Files:**
- Modify: `src/pane-orchestrator.ts`
- Modify: `test/pane-orchestrator.test.ts`

**Interfaces:**
- Consumes: `SpawnKind` and `enqueueSpawn(session, kind)` from Task 2.
- Produces:
  - `reserveSpawn(sessionId: string, kind: SpawnKind): boolean`
  - Initial full-capacity behavior: `ignored(capacity_limit)`.
  - Reopen full-capacity behavior: remain `reopenable`, no failure reason, no reservation, no queue task.

- [ ] **Step 1: Write failing reopen-capacity tests**

Use `stageReopenableWithoutPane()` and an attached second child to consume capacity.

Add tests equivalent to:

```ts
it("keeps a reopenable child retryable when capacity is full", async () => {
  const fixture = createFixture({ maxPanes: 1 });
  stageReopenableWithoutPane(fixture, CHILD_ID);
  await attachChildById(fixture, "ses_busy");
  fixture.splitPane.mockClear();
  fixture.attach.mockClear();

  await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));

  expect(fixture.splitPane).not.toHaveBeenCalled();
  expect(fixture.registry.get(CHILD_ID)).toMatchObject({
    state: "reopenable",
    reopenRequested: false,
  });
  expect(fixture.registry.get(CHILD_ID)?.failureReason).toBeUndefined();
});

it("retries a capacity-blocked reopen on a later work signal", async () => {
  // First signal while full: no split, reopenable.
  // Delete the busy child, then send meaningful activity.
  expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
  expect(fixture.splitPane).toHaveBeenCalledTimes(1);
});
```

Keep the existing initial-capacity tests asserting `ignored` + `capacity_limit`.

- [ ] **Step 2: Run capacity tests and confirm RED**

Run:

```bash
npm test -- test/pane-orchestrator.test.ts -t "capacity"
```

Expected: new reopen-capacity test FAILS because current reservation logic transitions every full-capacity child to `ignored(capacity_limit)`.

- [ ] **Step 3: Make reservation behavior depend on `SpawnKind`**

Change the private signature to:

```ts
function reserveSpawn(sessionId: string, kind: SpawnKind): boolean
```

When full:

- `kind === "initial"`: preserve existing `failureReason="capacity_limit"`, transition to `ignored`, and existing warning;
- `kind === "reopen"`: return `false` without state mutation or failure reason; log reopen deferral.

Only add `spawnReservations` after the capacity check succeeds.

Pass `kind` through every `enqueueSpawn()` call.

- [ ] **Step 4: Run capacity and full orchestrator tests and confirm GREEN**

Run:

```bash
npm test -- test/pane-orchestrator.test.ts -t "capacity"
npm test -- test/pane-orchestrator.test.ts
npm run typecheck
```

Expected: all commands PASS; existing initial capacity tests remain unchanged.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/pane-orchestrator.ts test/pane-orchestrator.test.ts
git commit -m "feat: keep reopen capacity shortages retryable"
```

---

### Task 4: Finalize Idle Close as Reopenable and Implement Work/Idle/Delete Precedence

**Files:**
- Modify: `src/pane-orchestrator.ts`
- Modify: `test/pane-orchestrator.test.ts`

**Interfaces:**
- Consumes: Task 1 close metadata and pane-clear API.
- Produces:
  - idle timeout begins `closing` with `closeReason="idle"`;
  - deletion begins/promotes `closing` with `closeReason="deleted"` and `reopenRequested=false`;
  - `closing(idle) + work` sets `reopenRequested=true`;
  - `closing(idle) + session.idle/status idle` sets `reopenRequested=false`;
  - successful idle close clears old pane ownership and ends in `reopenable`;
  - successful delete close ends in terminal `closed`.
- Task 5 will consume a true `reopenRequested` snapshot to perform the successor queue handoff.

- [ ] **Step 1: Write failing close-finalization and precedence tests**

Update existing idle-timeout assertions from `closed` to `reopenable` where the close was caused only by idle timeout.

Add tests equivalent to:

```ts
it("clears pane ownership and becomes reopenable after successful idle close", async () => {
  await attachChild(fixture);
  await fixture.orchestrator.handleEvent(idleEvent(CHILD_ID));
  await vi.advanceTimersByTimeAsync(1000);

  expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
  expect(fixture.registry.get(CHILD_ID)?.paneId).toBeUndefined();
});

it.each([
  ["session.idle", idleEvent(CHILD_ID)],
  ["session.status idle", statusEvent(CHILD_ID, "idle")],
])("later %s cancels reopen demand while the old close continues", async (_name, idle) => {
  // Hold closePane in flight.
  await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));
  expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(true);

  await fixture.orchestrator.handleEvent(idle);
  expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
});

it("promotes an idle close to permanent deletion", async () => {
  // closePane remains in flight; work first sets reopenRequested=true.
  await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));

  expect(fixture.registry.get(CHILD_ID)).toMatchObject({
    state: "closing",
    closeReason: "deleted",
    reopenRequested: false,
  });

  releaseClose(true);
  await vi.waitFor(() => expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed"));
});
```

Add a race test where work/idle/delete arrive while the `closePane()` promise is unresolved, so close success must reread current metadata rather than use a stale pre-await session object.

- [ ] **Step 2: Run idle/closing tests and confirm RED**

Run:

```bash
npm test -- test/pane-orchestrator.test.ts -t "idle|closing|reopenable|deletion"
```

Expected: FAIL because idle success still becomes `closed`, pane ownership is retained, and close intent/reopen demand do not exist.

- [ ] **Step 3: Implement close intent and successful-close finalization**

In `closeAfterIdleGrace()`:

- clear timer as today;
- transition `idle_pending -> closing`;
- synchronously set `closeReason="idle"` and `reopenRequested=false`;
- keep the existing close retry policy.

In `handleWorkSignal()`:

- when current state is `closing` and `closeReason==="idle"`, set `reopenRequested=true`;
- when `closeReason==="deleted"`, ignore.

In `handleSessionIdle()`:

- preserve current `spawning` and `attached` behavior;
- when `closing(idle)`, set `reopenRequested=false`;
- when `closing(deleted)`, ignore.

In `handleSessionDeleted()`:

- clear idle timer and `idleDuringSpawn` as today;
- if already `closing(idle)`, promote metadata to `deleted`, clear reopen demand, and let the existing close task continue;
- if already `closing(deleted)` or terminal, no-op;
- otherwise set delete intent and transition to `closing` before the existing immediate close/no-pane path.

Introduce a single private close-success finalizer with this exact signature:

```ts
function finalizeSuccessfulClose(sessionId: string, childPaneId?: string): boolean
```

Return value: the snapshot of `reopenRequested` that existed on a successful **idle** close; return `false` for delete close.

The helper must:

1. reread the current registry record after the Herdr close has succeeded;
2. remove `childPaneId` from `childPaneIds` when supplied;
3. call `clearPaneId(sessionId)`;
4. if current `closeReason==="deleted"`: transition to `closed`, clear close metadata, return `false`;
5. if current `closeReason==="idle"`: snapshot `reopenRequested`, transition to `reopenable`, clear close metadata, return the snapshot.

Task 4 stops at returning that snapshot; Task 5 owns acting on `true`.

Use this finalizer from successful idle/delete close paths, including no-managed-pane finalization. In particular, replace the queued-spawn guard that currently performs a raw `closing + no pane -> closed` transition with `finalizeSuccessfulClose(sessionId)` so deletion-before-mutation also clears close metadata.

- [ ] **Step 4: Run idle/closing and full orchestrator tests and confirm GREEN for this slice**

Run:

```bash
npm test -- test/pane-orchestrator.test.ts -t "idle|closing|reopenable|deletion"
npm test -- test/pane-orchestrator.test.ts
npm run typecheck
```

Expected: all Task 4 tests PASS; no test yet requires an immediate successor reopen from a true snapshot.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/pane-orchestrator.ts test/pane-orchestrator.test.ts
git commit -m "feat: preserve idle close intent for child reopen"
```

---

### Task 5: Add Non-Awaiting Reopen Handoff, Queue Failure Ownership, and Reopen-Spawn Races

**Files:**
- Modify: `src/pane-orchestrator.ts`
- Modify: `test/pane-orchestrator.test.ts`
- Reference only: `src/async-queue.ts`

**Interfaces:**
- Consumes:
  - Task 3 `enqueueSpawn(session, "reopen")` and retryable capacity semantics;
  - Task 4 `finalizeSuccessfulClose(...): boolean`.
- Produces:
  - successful idle close with final work demand performs synchronous capacity/claim + non-awaiting successor enqueue;
  - queue rejection after claim becomes `failed(spawn_failed)` and releases reservation;
  - deletion during reopen spawn leaves no managed duplicate/orphan pane;
  - repeated idle-close/reopen cycles remain valid.

- [ ] **Step 1: Write failing non-deadlocking handoff and ordering tests**

Add a real-queue ordering test equivalent to:

```ts
it("hands an idle close to exactly one reopen without awaiting the successor queue task", async () => {
  const calls: string[] = [];
  // Initial attach, then hold closePane in flight and record "close".
  // While closing, send active status so reopenRequested=true.
  // Resolve close success; reopened split records "split".

  await vi.waitFor(() => expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached"));
  expect(calls).toEqual(["close", "split"]);
  expect(fixture.splitPane).toHaveBeenCalledTimes(2); // initial + reopen
  expect(fixture.attach).toHaveBeenCalledTimes(2);
});
```

This test must have an explicit completion assertion rather than only timer advancement so a self-deadlock manifests as a test timeout/failure.

Add:

```ts
it("uses the final work signal after work-idle-work and reopens exactly once", async () => {
  // closing -> work -> idle -> work -> close success
  expect(reopenSplitCount).toBe(1);
  expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
});

it("does not immediately reopen when the final closing signal is idle", async () => {
  // closing -> work -> idle -> close success
  expect(reopenSplitCount).toBe(0);
  expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable");
});
```

- [ ] **Step 2: Add failing queue-disposal and full-capacity handoff tests**

Add:

```ts
it("fails a claimed reopen cleanly when queue disposal rejects the successor enqueue", async () => {
  // close task is already running
  // work latches reopen
  await fixture.orchestrator.dispose();
  releaseClose(true);

  await vi.waitFor(() =>
    expect(fixture.registry.get(CHILD_ID)).toMatchObject({
      state: "failed",
      failureReason: "spawn_failed",
    }),
  );
  expect(reopenSplitCount).toBe(0);
});

it("leaves the child reopenable when immediate post-close reopen has no capacity", async () => {
  // Arrange another registered attached pane before close resolves so capacity is full.
  releaseClose(true);

  await vi.waitFor(() => expect(fixture.registry.get(CHILD_ID)?.state).toBe("reopenable"));
  expect(fixture.registry.get(CHILD_ID)?.failureReason).toBeUndefined();
  expect(reopenSplitCount).toBe(0);
});
```

The full-capacity test must then free capacity and send a later work signal, asserting that the child successfully reopens.

- [ ] **Step 3: Add failing deletion-during-reopen-spawn and repeated-cycle tests**

Add:

```ts
it("closes a newly split pane when deletion arrives during a reopen spawn", async () => {
  // Reach reopenable, start reopen with splitPane held in flight.
  await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));
  releaseReopenSplit("pane-reopen");
  await reopening;

  expect(fixture.closePane).toHaveBeenCalledWith("pane-reopen");
  expect(fixture.registry.get(CHILD_ID)?.state).toBe("closed");
});

it("supports multiple idle-close-reopen cycles for the same child session", async () => {
  // Complete two full cycles.
  expect(fixture.attach).toHaveBeenCalledTimes(3); // initial + two reopens
  expect(fixture.registry.get(CHILD_ID)?.state).toBe("attached");
  expect(fixture.registry.get(CHILD_ID)?.closeReason).toBeUndefined();
  expect(fixture.registry.get(CHILD_ID)?.reopenRequested).toBe(false);
});
```

- [ ] **Step 4: Run the new handoff/race tests and confirm RED**

Run:

```bash
npm test -- test/pane-orchestrator.test.ts -t "handoff|successor|post-close|reopen spawn|multiple idle-close-reopen|final closing signal"
```

Expected: FAIL because Task 4 returns the reopen snapshot but does not enqueue a successor reopen.

- [ ] **Step 5: Implement the non-awaiting successor handoff**

At each successful idle-close completion site:

1. call `finalizeSuccessfulClose(...)`;
2. if it returns `false`, finish the current close task;
3. if it returns `true`, reread the now-`reopenable` session and call:

```ts
void enqueueSpawn(reopenableSession, "reopen");
```

Do **not** `await` this promise inside the current queue task.

Rely on `enqueueSpawn()` to:

- run the reopen capacity check synchronously;
- reserve capacity only when available;
- synchronously claim `reopenable -> spawning`;
- enqueue the successor spawn;
- release `spawnReservations` in `.finally()`;
- catch queue/spawn rejection and call `fail(sessionId, "spawn_failed")` when still `spawning` or relevant `closing`.

Verify the rejection chain is attached inside `enqueueSpawn()` before it returns so `void enqueueSpawn(...)` cannot create an unhandled rejection.

Do not change `src/async-queue.ts`.

For deletion during reopen spawn, preserve the existing state re-checks around split/attach; update successful cleanup to clear pane ownership/close metadata and end in terminal `closed` under delete intent.

- [ ] **Step 6: Run Task 5 tests and confirm GREEN**

Run:

```bash
npm test -- test/pane-orchestrator.test.ts -t "handoff|successor|post-close|reopen spawn|multiple idle-close-reopen|final closing signal"
npm test -- test/pane-orchestrator.test.ts
npm run typecheck
```

Expected: all commands PASS; the handoff test completes rather than timing out.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/pane-orchestrator.ts test/pane-orchestrator.test.ts
git commit -m "feat: hand idle close off to serialized reopen"
```

---

### Task 6: Make Pre-Registration Deletion Irreversible

**Files:**
- Modify: `src/pane-orchestrator.ts`
- Modify: `test/pane-orchestrator.test.ts`

**Interfaces:**
- Produces orchestrator-owned transient sets:
  - `ownershipPending: Set<string>`
  - existing `pendingSpawnRequests: Set<string>`
  - `deletedBeforeRegistration: Set<string>`
- Tombstone lifetime: until `dispose()`.
- Registry remains unaware of candidates that were deleted before accepted registration.

- [ ] **Step 1: Write the failing ownership-resolution deletion race test**

Add:

```ts
it("does not resurrect a child deleted while ownership resolution is pending", async () => {
  // Hold isOwnedChild() unresolved.
  const created = fixture.orchestrator.handleEvent(createdEvent(CHILD_ID, PARENT_ID));
  await ownershipStarted;

  await fixture.orchestrator.handleEvent(statusEvent(CHILD_ID, "active"));
  await fixture.orchestrator.handleEvent(deletedEvent(CHILD_ID));
  await fixture.orchestrator.handleEvent(activityEvent(CHILD_ID));
  await fixture.orchestrator.handleEvent(deltaActivityEvent(CHILD_ID));

  resolveOwnership(true);
  await created;

  expect(fixture.registry.has(CHILD_ID)).toBe(false);
  expect(fixture.splitPane).not.toHaveBeenCalled();
  expect(fixture.attach).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Add duplicate-create and tombstone-lifetime tests**

Add:

```ts
it("does not start another ownership resolution for duplicate create while one is pending", async () => {
  // First create blocks in ownership resolver; send duplicate create.
  expect(fixture.isOwnedChild).toHaveBeenCalledTimes(1);
});

it("keeps a pre-registration deletion tombstone until dispose", async () => {
  // Tombstone via pending ownership + delete, finish ownership, then send duplicate create/work.
  expect(fixture.isOwnedChild).toHaveBeenCalledTimes(1);
  expect(fixture.registry.has(CHILD_ID)).toBe(false);
  expect(fixture.splitPane).not.toHaveBeenCalled();

  await fixture.orchestrator.dispose();
  // dispose must clear transient bookkeeping and accept no later events.
});
```

- [ ] **Step 3: Run the new tests and confirm RED**

Run:

```bash
npm test -- test/pane-orchestrator.test.ts -t "ownership resolution|tombstone|resurrect|duplicate create"
```

Expected: the resurrection test FAILS because work can repopulate `pendingSpawnRequests` after deletion and before ownership resolution completes.

- [ ] **Step 4: Implement ownership-pending and deletion tombstones**

In `createPaneOrchestrator()`, add:

```ts
const ownershipPending = new Set<string>();
const deletedBeforeRegistration = new Set<string>();
```

Update `handleSessionCreated()`:

- reject early when `registry.has(sessionId)`, `ownershipPending.has(sessionId)`, or `deletedBeforeRegistration.has(sessionId)`;
- after validating a parent candidate and before awaiting ownership, add to `ownershipPending`;
- after ownership resolves, check `deletedBeforeRegistration` before registration or pending-work replay;
- always remove the ownership-pending marker when the ownership attempt completes;
- when tombstoned, delete pending work and do not register.

Update missing-session work handling:

- if `deletedBeforeRegistration.has(sessionId)`, ignore;
- otherwise preserve existing pending-work behavior.

Update `handleSessionDeleted()` for a missing session:

- delete pending work;
- when `ownershipPending.has(sessionId)`, add the deletion tombstone;
- return without registry registration.

Update `dispose()` to clear all three transient collections.

Do not create tombstones for arbitrary unknown session IDs that were never in ownership resolution; the approved scope is the ownership-pending race.

- [ ] **Step 5: Run ownership-race and full orchestrator tests and confirm GREEN**

Run:

```bash
npm test -- test/pane-orchestrator.test.ts -t "ownership resolution|tombstone|resurrect|duplicate create"
npm test -- test/pane-orchestrator.test.ts
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/pane-orchestrator.ts test/pane-orchestrator.test.ts
git commit -m "fix: make pre-registration deletion irreversible"
```

---

### Task 7: Synchronize Canonical and User-Facing Lifecycle Documentation

**Files:**
- Modify: `SPEC.md`
- Modify: `docs/architecture.md`
- Modify: `docs/architecture.ja.md`
- Modify: `docs/operations.md`
- Modify: `README.md`
- Modify: `README.ja.md`

**Interfaces:**
- Consumes: final green implementation from Tasks 1–6.
- Produces: documentation with the same state names, signal semantics, capacity split, deletion irreversibility, queue ordering, and failure behavior as the approved Design and implemented code.

- [ ] **Step 1: Run a documentation RED check against stale lifecycle semantics**

Run:

```bash
rg -n 'closed.*no longer tracked|moves? to `closed`|Any new activity.*cancels|新しいアクティビティ.*タイマー'   SPEC.md docs/architecture.md docs/architecture.ja.md docs/operations.md README.md README.ja.md
```

Expected: one or more matches showing pre-Issue-#41 idle-terminal or overly broad idle-resume wording.

- [ ] **Step 2: Update `SPEC.md` as the canonical contract**

Synchronize:

- state table: include `spawning` if omitted today and add `reopenable`;
- `closed` means permanent deletion, not successful idle cleanup;
- legal transitions and close metadata;
- active-status vs meaningful-activity compatibility in `spawning` and `idle_pending`;
- `closing(idle)` last-signal-wins work/idle semantics and delete precedence;
- non-awaiting same-`AsyncQueue` reopen handoff;
- `SpawnKind` capacity split;
- pre-registration deletion tombstone;
- failure semantics including queue rejection -> `failed(spawn_failed)`;
- invariants: no duplicate pane, no split before old close settles, no resurrection after delete.

Do not document private helper names that are not normative interfaces.

- [ ] **Step 3: Update architecture and operations documentation**

In `docs/architecture.md` and `docs/architecture.ja.md`:

- explain idle cleanup -> `reopenable`;
- explain same-session later work -> new pane + same `opencode attach <session-id>`;
- distinguish `session.deleted` as permanent;
- mention close/reopen Herdr mutations remain serialized and successor reopen runs after close.

In `docs/operations.md`:

- state that active status during the grace period cancels the close timer;
- state that meaningful message activity preserves the existing scheduled close during `idle_pending`;
- describe later work after successful idle close reopening the pane;
- distinguish initial capacity rejection from transient reopen capacity pressure;
- add expected logs for reopen deferral/reopen/delete suppression.

- [ ] **Step 4: Update README English canonical text and Japanese translation**

Keep README detail concise:

- idle pane cleanup does not terminate the child session;
- later work on the same child can create a new pane attached to the same session;
- `session.deleted` permanently ends visualization;
- capacity remains bounded.

Keep `README.ja.md` semantically aligned with `README.md`.

- [ ] **Step 5: Run documentation GREEN checks**

Run:

```bash
rg -n 'reopenable' SPEC.md docs/architecture.md docs/architecture.ja.md docs/operations.md
rg -n 'same (child )?session|same session ID|same child' README.md docs/operations.md
rg -n '同じ.*セッション|再.*ペイン' README.ja.md docs/architecture.ja.md
npm run lint
```

Expected:

- `reopenable` is documented in canonical/architecture/operations docs;
- English and Japanese user-facing docs describe same-session reopen;
- lint PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add SPEC.md docs/architecture.md docs/architecture.ja.md docs/operations.md README.md README.ja.md
git commit -m "docs: document idle-closed child session reopen"
```

---

### Task 8: Full Verification and Branch Evidence

**Files:**
- No planned modifications.
- Inspect all files changed by Tasks 1–7.

**Interfaces:**
- Verifies every Design contract and acceptance criterion without introducing new behavior.

- [ ] **Step 1: Run formatter/lint verification**

Run:

```bash
npm run lint
```

Expected: PASS with zero Biome errors.

- [ ] **Step 2: Run static type verification**

Run:

```bash
npm run typecheck
```

Expected: PASS with zero TypeScript errors.

- [ ] **Step 3: Run the complete test suite**

Run:

```bash
npm test
```

Expected: PASS with zero failed tests.

- [ ] **Step 4: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS and produce the normal `dist/` build output.

- [ ] **Step 5: Inspect branch scope and commit sequence**

Run:

```bash
git status --short
git diff --name-only master...HEAD
git log --oneline --decorate master..HEAD
```

Expected:

- working tree clean;
- implementation branch changes are limited to:
  - approved Design and this Plan;
  - `src/child-session.ts`;
  - `src/child-session-registry.ts`;
  - `src/pane-orchestrator.ts`;
  - `test/child-session-registry.test.ts`;
  - `test/pane-orchestrator.test.ts`;
  - `SPEC.md`;
  - `docs/architecture.md`;
  - `docs/architecture.ja.md`;
  - `docs/operations.md`;
  - `README.md`;
  - `README.ja.md`;
- no config, dependency, `src/async-queue.ts`, or unrelated file change unless a later Review Gate explicitly authorizes it.

- [ ] **Step 6: Verify acceptance behavior by focused test names**

Run:

```bash
npm test -- test/child-session-registry.test.ts
npm test -- test/pane-orchestrator.test.ts -t "reopen|capacity|idle|closing|ownership resolution|tombstone|deletion"
```

Expected: PASS. This focused run must include coverage for:

- active and meaningful reopen;
- exactly-once reopen;
- same session ID attach;
- idle-grace compatibility;
- closing work/idle/delete ordering;
- close failure no reopen;
- initial/reopen capacity split;
- repeated cycles;
- deletion during reopen spawn;
- non-awaiting queue handoff and queue rejection;
- pre-registration deletion tombstone.

- [ ] **Step 7: Do not commit verification-only output**

If verification changes no tracked source/document file, create no additional commit. If a generated artifact is tracked unexpectedly, restore it and rerun the relevant verification.

---

## Design -> Plan Traceability

| Approved Design contract | Plan owner |
| --- | --- |
| `reopenable` state, terminal states, close metadata | Task 1 |
| explicit `paneId` clearing API | Task 1; used by Task 4 |
| active/message dispatcher with preserved `spawning` and `idle_pending` compatibility (HERDR41-RG-003) | Task 2 |
| `SpawnKind` with `initial` / `reopen` modes | Task 2 |
| initial capacity -> `ignored(capacity_limit)` | Task 3 |
| reopen capacity -> remain `reopenable` | Task 3 and immediate-handoff case in Task 5 |
| idle close -> `reopenable` | Task 4 |
| work/idle last-signal-wins during `closing(idle)` (HERDR41-RG-002) | Task 4 |
| `session.deleted` overrides pending reopen | Task 4 |
| reread metadata after async close succeeds | Task 4 |
| same-queue non-awaiting close -> reopen handoff (HERDR41-RG-001) | Task 5 |
| queue disposal/rejection -> release reservation + `failed(spawn_failed)` | Task 5 |
| deletion during reopen spawn | Task 5 |
| repeated idle-close/reopen cycles | Task 5 |
| ownership-pending deletion tombstone (HERDR41-RG-004) | Task 6 |
| duplicate create/work cannot resurrect tombstoned ID | Task 6 |
| canonical + architecture + operations + user docs synchronization | Task 7 |
| full AC-1–AC-14 / FR / NFR regression evidence | Task 8 |

## Issue #41 Acceptance Traceability

| Acceptance criterion | Owning task / proof |
| --- | --- |
| AC-1 idle timeout then active -> new pane | Tasks 4–5: idle close reaches `reopenable`; active latch/handoff test |
| AC-2 idle timeout then meaningful activity -> new pane | Tasks 2 and 5: meaningful reopen routing + closing meaningful handoff test |
| AC-3 active + message burst -> one pane | Tasks 2 and 5: synchronous `reopenable -> spawning` claim / exactly-once handoff |
| AC-4 reopened attach uses same child session ID | Task 2 same-session attach assertion; Task 5 repeated-cycle assertion |
| AC-5 grace-period resume keeps old pane | Task 2 preserves existing `idle_pending + active_status` test |
| AC-6 work after close starts reopens only after old close | Task 5 real-queue ordering test `close` before `split` |
| AC-7 close failure -> no reopen | Task 4 failure metadata cleanup + existing close-failure regression; Task 5 never handoffs on false finalizer |
| AC-8 reopen at maxPanes -> no pane / no overflow | Task 3 reopen-capacity RED/GREEN test |
| AC-9 later work retries capacity-blocked reopen | Task 3 later-signal retry; Task 5 immediate-handoff-full-capacity retry |
| AC-10 initial capacity semantics unchanged | Task 3 existing `ignored(capacity_limit)` regression |
| AC-11 repeated idle close / reopen | Task 5 two-cycle test |
| AC-12 deleted session never reopens | Tasks 4–6: delete precedence, reopen-spawn deletion, pre-registration tombstone |
| AC-13 existing split/rebalance policy reused | Task 2 uses existing `runSpawn`; Task 5 repeated-cycle/layout regressions; no layout algorithm change |
| AC-14 all existing + new tests pass | Task 8 complete `npm test`, typecheck, lint, build |

## Plan -> Design Traceability

| Plan task | Design sections implemented |
| --- | --- |
| Task 1 | §5, §6 data model, §13, §19 |
| Task 2 | §8, §9 initial/reopen routing, §16.2–§16.3, §20 preserved behavior |
| Task 3 | §9 `SpawnKind`, §10, §16.6, §18 FR-13–16 / AC-8–10 |
| Task 4 | §6, §7, §12.4–§12.5, §16.4, §18 FR-10–12 / AC-6–7 |
| Task 5 | §7.1, §9, §12.1–§12.5, §16.5–§16.6, HERDR41-RG-001/002 |
| Task 6 | §8.2, §13.3, §16.7, invariants 4–5, HERDR41-RG-004 |
| Task 7 | §17 and §20 documentation/compatibility boundary |
| Task 8 | §18 acceptance mapping, §19 invariants, AC-14 |

## Commit Sequence

The expected implementation commit sequence is:

```text
feat: add reopenable child session lifecycle
feat: route reopen work signals by lifecycle state
feat: keep reopen capacity shortages retryable
feat: preserve idle close intent for child reopen
feat: hand idle close off to serialized reopen
fix: make pre-registration deletion irreversible
docs: document idle-closed child session reopen
```

Each commit must be independently reviewable and must only contain the files named by its task.

## Review Gate Boundary

This Plan does not authorize implementation by itself.

Before Task 1 begins, run the next Superpowers Review Gate against both:

- `docs/superpowers/specs/2026-09-28-idle-closed-child-session-reopen-design.md`
- `docs/superpowers/plans/2026-09-28-idle-closed-child-session-reopen.md`

The Review Gate must verify bidirectional agreement in terminology, state transitions, exact types/interfaces, queue ownership, error handling, test obligations, compatibility guarantees, FR/NFR coverage, and AC-1–AC-14.

Source code, tests, config, `SPEC.md`, architecture docs, operations docs, and README files must remain unchanged until that Review Gate returns READY.
