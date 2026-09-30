# Operations

This runbook covers day-to-day operation of `herdr-opencode-child-panes`. For exact behavior, see [SPEC.md](../SPEC.md). For setup, see [getting-started.md](getting-started.md).

## Monitoring / expected logs

The plugin logs lifecycle events and warnings:

- Child session registered (`waiting_activity`).
- Pane split and attach attempted.
- Attach success or failure.
- Idle timer started and cancelled.
- Pane close and final state (`reopenable`, `closed`, `failed`, `ignored`).
- `idle-closed child became reopenable` after the idle grace period closes the pane.
- `work requested reopen while idle close was in progress` when work arrives during an idle close.
- `later idle cancelled pending reopen` when a later idle signal overrides the reopen demand.
- `Child reopened and attached` when an idle-closed session resumes work.
- `Reopen deferred because capacity was full` when a reopen attempt cannot reserve a pane slot.
- `pending reopen cancelled because session.deleted arrived` when deletion overrides a pending reopen.
- `Pre-registration deletion prevented child registration` when a session is deleted before ownership resolution finishes.
- `reopen enqueue failed because the serialized queue was unavailable` when disposal prevents a handoff.

When `HERDR_CHILD_PANES_DEBUG` is enabled, additional diagnostic logs include selected session and prerequisite details, lifecycle decisions, idle-timer diagnostics, and an attach command with credentials, URL queries, and fragments redacted. Herdr CLI output is not logged.

## Idle timeout behavior

A child pane is closed after it has been idle for `HERDR_CHILD_PANES_IDLE_MS` milliseconds (default `10000`).

- Idle is triggered by `session.status` containing `idle` or a `session.idle` event.
- If an idle signal arrives while a session is still `spawning`, deferred idle cleanup is scheduled. Active status cancels this deferred cleanup, while message activity does not; the grace timer starts as soon as attach finishes.
- Active status (`active`, `working`, `busy`, `running`, or `streaming`) during the grace period cancels the close timer and keeps the existing pane attached.
- Meaningful activity (`message.updated`, `message.part.updated`, or `message.part.delta`) during `idle_pending` preserves the existing scheduled close. It does not reset the timer or create a new pane.
- When the grace period expires, the pane is closed and the session becomes `reopenable`. The OpenCode child session itself continues running.
- The timer lives in memory. If OpenCode restarts, pending timers are lost. Already-attached panes remain open until the session is deleted or becomes idle again.

## Reopen after idle close

- Idle cleanup closes only the managed pane; the same OpenCode child session can later resume work.
- Later work on the same session (active status or meaningful activity) creates a new pane and attaches it with `opencode attach <session-id>`.
- If the work signal arrives while the idle close is still running, the close is allowed to finish first and then the session reopens through the same serialized mutation queue.
- A later idle signal during the close cancels any pending reopen demand for that close.
- Once `session.deleted` arrives, the session can never reopen.

## Capacity limits

The maximum number of concurrently managed child panes is controlled by `HERDR_CHILD_PANES_MAX` (default `4`).

- Initial creation requests beyond the limit are recorded as `ignored` with reason `capacity_limit`.
- Reopen attempts that find capacity full remain in `reopenable`. They do not set `failureReason` and do not transition to `ignored`. A later work signal retries when capacity is available.
- Capacity is counted from active registry sessions whose `session.paneId` is defined. `reopenable` sessions have no pane ID and do not count toward capacity.
- Because mutations are serialized, concurrent events cannot exceed the limit.

## Retry and failure behavior

- **Split failure**: session moves to `failed`; child session continues running.
- **Attach failure**: the just-split pane is closed immediately to avoid orphans; session moves to `failed`.
- **Close failure**: retried with bounded backoff. After retries are exhausted, the session moves to `failed` with reason `close_failed`. No reopen is attempted after a close failure.
- **Reopen capacity pressure**: session remains `reopenable`; retry on the next work signal when capacity is available.
- **Queue unavailable during handoff**: `reopenable -> spawning` succeeds, but the serialized queue has been disposed; the session moves to `failed` with reason `spawn_failed`.
- A Herdr CLI error never crashes OpenCode. The plugin logs a warning and stops processing the affected child.

## Security notes

- Commands passed to `herdr pane run` are shell-quoted so event-derived session IDs cannot inject shell syntax.
- Attach logs show server URLs truncated to the origin only. Credentials, query strings, and fragments are not logged.
- `OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME` are inherited only into the `opencode attach` child process; they are not read or stored by the plugin.
- The plugin never inspects or closes panes outside `HERDR_PANE_ID`.

## Current limitations

- Only `right` and `down` split directions are used, matching Herdr's supported directions.
- Idle timers are in-memory and are lost on OpenCode restart.
- `message.part.delta` events are handled defensively but are not part of the current SDK event union.
- Integration tests that exercise a real Herdr binary are gated by `HERDR_BINARY` and are skipped when that variable is unset.
- Nested child sessions are tracked, but visualization depth is subject to the same capacity limit and depth-first ordering is not guaranteed.

## Troubleshooting checklist

| Symptom | Check |
| --- | --- |
| No panes appear | `HERDR_ENV` and `HERDR_PANE_ID` are present; `HERDR_CHILD_PANES` is not disabled. |
| Pane opens but stays blank | `opencode` is on the `PATH` in the new pane; the OpenCode server is reachable. |
| Too many panes | `HERDR_CHILD_PANES_MAX` value and active registered sessions with pane IDs. |
| Idle panes stay open | `HERDR_CHILD_PANES_IDLE_MS`; whether active status keeps resetting the timer. |
| A closed idle pane does not reopen | Work signal was active status or meaningful activity; capacity was not full; session was not deleted. |
| Attach logs show no server details | Expected: credentials and query strings are intentionally removed. |
| Panes closed externally confuse the plugin | Restart OpenCode to rebuild layout state for new children. |
