# OpenCode V2 Migration / V1 Maintenance

## Status (2026-10-26)
- Migration branch: `feat/opencode-v2-major-migration`; release is **NOT VERIFIED / NOT APPROVED**.
- V1 fixed base: commit `285ca1918a0d1b63da178de5a3683b4f4de9198b`; maintenance branch: `support/v1.x`, package v1.1.0.
- V2 proposal: package v2.0.0, OpenCode host v2.1.4+, public server Promise API.
- V2.0.x is out of scope. Do not treat schema review or CI PASS as a host integration PASS.
- Guide: https://gist.github.com/yohi/0c3d8edea98d86e7f5c8d6c2d9f93d2d

## Changes
- V1 1.x remains frozen on `support/v1.x`; 2.x default export contains V2 `setup(ctx)`, not V1 `server()`.
- V2 event subscription uses `ctx.event.subscribe({ signal })`, `event.type` + `event.data`, and idempotent setup cleanup.
- `session.created` registers an owned child only; `session.execution.started` / `session.step.started` / text/reasoning/tool-start events count as observed activity. Raw `session.status: busy` never creates a pane.
- V2 `session.status: idle` and deprecated `session.idle` retain grace-close semantics.
- V2 commands use the CLI root command with positional directory, `--server` and `--session`; the V1 `attach` subcommand is no longer present at v2.1.4.
- Server URL: `options.serverUrl` takes precedence over `HERDR_CHILD_PANES_SERVER_URL`; no default-port/server guessing. Without a valid URL, feature is disabled with one constant warning per setup.
- V2 events whose `session.created.data.location.directory` differs from the plugin's loaded directory are not registered; this is a deliberate fail-closed limitation pending cross-location testing.

## Install
For OpenCode V1, pin `@yohi/herdr-opencode-child-panes@1.x` from the maintenance release.
For V2, do not install a 2.x release until acceptance. The host needs `herdr integration install opencode`, `HERDR_ENV`, `HERDR_PANE_ID`, and an explicit `HERDR_CHILD_PANES_SERVER_URL` or plugin option `serverUrl`.

## Blocking host acceptance
1. Confirm actual V2.1.4 installed-package loader accepts the 2.x default `{id, setup}` entrypoint.
2. Confirm the version-pinned V2 CLI launch selects an **existing** child session without silently creating an unrelated session on deletion/race; the CLI's `--session` currently may create a missing session. **STOP publishing** until this is prevented or explicitly accepted with a safe design.
3. Confirm Herdr root `agent_session` attribution and child-pane attach/idle/reopen/delete/focus/capacity behavior on a real v2.1.4 host.
4. Verify malformed events, duplicate status signals, aborted subscription and unload, subprocess failure, URL secret redaction, and unexpected plugin-location conditions.
5. Run `npm run lint && npm run typecheck && npm run test && npm run build` and record SHA256 of the installed package/build and host version.
6. Run regression/loader acceptance for V1 1.18.29 on `support/v1.x`, separately from V2 acceptance.
7. Reconcile Issue #40: it assumes V2.0.10 and old `message.updated` events that do not exist in v2.1.4.

## Explicitly unused migration-guide surfaces
No external OpenCode HTTP client, Effect plugin API, custom tools, providers, credentials, MCP, compaction transformers, native replay serializer, RPC, TUI extension, LSP, or ChatGPT model authorization is implemented in this plugin. Their specific migration test cases remain N/A subject to confirming inventory and absence of indirect dependencies.
