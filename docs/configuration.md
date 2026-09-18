# Configuration

All plugin settings are read from environment variables. Invalid values fall back to documented defaults instead of throwing. For runtime prerequisites and setup, see [getting-started.md](getting-started.md).

## Required environment variables

| Variable | Description |
| --- | --- |
| `HERDR_ENV` | Identifies the Herdr environment. Required for the plugin to load. Herdr sets this automatically inside the pane. |
| `HERDR_PANE_ID` | ID of the Herdr pane that hosts this OpenCode root session. Herdr sets this automatically inside the pane. |

If either variable is missing, the plugin does not initialize.

## Optional environment variables

| Variable | Default | Valid values | Description |
| --- | --- | --- | --- |
| `HERDR_CHILD_PANES` | `true` | `true`, `false`, `0`, `1`, `yes`, `no` | Master switch. Any value that parses as `false`, `0`, or `no` disables child-pane visualization. |
| `HERDR_CHILD_PANES_MAX` | `4` | Positive integer | Maximum number of concurrently managed child panes. |
| `HERDR_CHILD_PANES_IDLE_MS` | `10000` | Non-negative integer (milliseconds) | Grace period before an idle child pane is closed. |
| `HERDR_CHILD_PANES_DIRECTION` | `auto` | `auto`, `right`, `down`, `up`, `left` | Parsed for backward compatibility. The fixed child-pane layout always splits right for the first child and down within the right column for additional children, so this value does not affect layout. |
| `HERDR_CHILD_PANES_DEBUG` | `false` | `true`, `false`, `0`, `1`, `yes`, `no` | Enables debug logging when parsed as `true`, `1`, or `yes`. |

## Fallback behavior

- Non-integer values for numeric variables are ignored and the default is used.
- Negative values for `HERDR_CHILD_PANES_MAX` and `HERDR_CHILD_PANES_IDLE_MS` are ignored and the default is used.
- Unrecognized boolean strings fall back to the default.
- Empty values are treated as unset and fall back to the default.

## Security implications

- `HERDR_ENV` and `HERDR_PANE_ID` must be provided by Herdr, not by untrusted sources.
- `HERDR_CHILD_PANES_DEBUG` may emit detailed logs. Do not enable in environments where session IDs or pane contents are sensitive.
- The plugin does not read `OPENCODE_SERVER_PASSWORD` or `OPENCODE_SERVER_USERNAME` directly. It only inherits them into the `opencode attach` child process.

## Example configuration

```sh
export HERDR_CHILD_PANES=true
export HERDR_CHILD_PANES_MAX=4
export HERDR_CHILD_PANES_IDLE_MS=10000
export HERDR_CHILD_PANES_DEBUG=false
```

No restart-specific settings are required. Changes take effect the next time OpenCode starts.
