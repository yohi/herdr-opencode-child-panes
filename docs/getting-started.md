# Getting Started

This guide walks through installing and verifying `herdr-opencode-child-panes`.

## Prerequisites

- **Node.js** 20 or later.
- **Herdr** installed and available on your `PATH` as `herdr`.
- **OpenCode** 1.17.x or newer, with the plugin hooks consumed by this plugin.
- A Herdr pane configured to host an OpenCode root session.

## Install the Herdr integration

Herdr must know how to run OpenCode inside a pane. Register the integration once:

```sh
herdr integration install opencode
```

Verify that the integration is listed:

```sh
herdr integration list
```

## Build and install the plugin

Clone or open the plugin repository, then build it:

```sh
npm install
npm run build
```

Copy the built `dist/` directory into OpenCode's plugin directory. The exact path depends on your OpenCode installation:

```sh
cp -r dist <opencode-plugins-dir>/herdr-opencode-child-panes
```

For example, on many systems the plugin directory is under the OpenCode configuration directory. Consult OpenCode's plugin documentation if you are unsure.

Restart OpenCode so it loads the plugin.

## Verify the first child pane

1. Open a Herdr pane that hosts an OpenCode root session.
2. Ask the agent to spawn a subagent, for example:

   ```text
   Use a subagent to summarize README.md.
   ```

3. Watch for a new pane to appear to the right of the root session. The new pane should run `opencode attach <child-session-id>`.
4. The main pane keeps focus. When the subagent finishes and goes idle, the child pane closes automatically after the configured grace period.

## Common pitfalls

- **No child pane appears**: Confirm `HERDR_ENV` and `HERDR_PANE_ID` are present inside the pane. They are set by Herdr, not by the user.
- **Child pane opens but attach fails**: Verify that `opencode` is on the `PATH` inside the new pane and that the OpenCode server is reachable.
- **Too many panes stack up**: Check `HERDR_CHILD_PANES_MAX`. The default is `4`; additional child sessions are ignored for visualization.
- **Idle panes stay open**: Check `HERDR_CHILD_PANES_IDLE_MS`. The default grace period is 10 seconds, but new activity cancels the close timer.
- **Layout looks wrong after external changes**: The plugin counts capacity from the live layout, but it does not restore custom layouts. Restarting OpenCode will rebuild the layout for new child sessions.

For exact state-machine behavior, see [SPEC.md](../SPEC.md).
