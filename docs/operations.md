# Operations

This runbook covers day-to-day operation of `herdr-opencode-child-panes`. For exact behavior, see [SPEC.md](../SPEC.md). For setup, see [getting-started.md](getting-started.md).

## Monitoring / expected logs

The plugin logs lifecycle events and warnings:

- Child session registered (`waiting_activity`).
- Pane split and attach attempted.
- Attach success or failure.
- Idle timer started and cancelled.
- Pane close and final state (`closed`, `failed`, `ignored`).

When `HERDR_CHILD_PANES_DEBUG` is enabled, additional diagnostic logs include event payloads and Herdr CLI output (with credentials removed).

## Idle timeout behavior

A child pane is closed after it has been idle for `HERDR_CHILD_PANES_IDLE_MS` milliseconds (default `10000`).

- Idle is triggered by `session.status` containing `idle` or a `session.idle` event.
- Any new activity (`message.updated` or `message.part.updated`) cancels the close timer and keeps the pane attached.
- The timer lives in memory. If OpenCode restarts, pending timers are lost. Already-attached panes remain open until the session is deleted or becomes idle again.

## Capacity limits

The maximum number of concurrently managed child panes is controlled by `HERDR_CHILD_PANES_MAX` (default `4`).

- Requests beyond the limit are recorded as `ignored` with reason `capacity_limit`.
- The child session itself is unaffected; only visualization is skipped.
- Capacity is counted from the live pane layout. External pane closures free capacity.
- Because mutations are serialized, concurrent events cannot exceed the limit.

## Retry and failure behavior

- **Split failure**: session moves to `failed`; child session continues running.
- **Attach failure**: the just-split pane is closed immediately to avoid orphans; session moves to `failed`.
- **Close failure**: retried with bounded backoff. After retries are exhausted, the session moves to `failed` with reason `close_failed`.
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
| Too many panes | `HERDR_CHILD_PANES_MAX` value and current live layout. |
| Idle panes stay open | `HERDR_CHILD_PANES_IDLE_MS`; whether new activity keeps resetting the timer. |
| Attach logs show no server details | Expected: credentials and query strings are intentionally removed. |
| Panes closed externally confuse the plugin | Restart OpenCode to rebuild layout state for new children. |
