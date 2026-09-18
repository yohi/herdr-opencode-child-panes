# Security Policy

## Supported versions

Only the latest released version on the default branch is actively supported with security fixes. Older releases are not maintained unless explicitly stated in the release notes.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

## Reporting vulnerabilities

If you discover a security issue in `herdr-opencode-child-panes`, please report it privately by opening a security advisory on the [GitHub repository](https://github.com/yohi/herdr-opencode-child-panes/security/advisories/new) or by contacting the maintainers directly. Do not open a public issue for undisclosed vulnerabilities.

Provide as much detail as possible, including:

- Affected versions or commit range.
- Steps to reproduce the issue.
- Potential impact.
- Any suggested mitigation.

## Sensitive data handling

- The plugin does not read `OPENCODE_SERVER_PASSWORD` or `OPENCODE_SERVER_USERNAME` directly. It only inherits them into the `opencode attach` child process.
- Server URLs in logs are truncated to the origin. Query strings, credentials, and fragments are not logged.
- Commands sent to `herdr pane run` are shell-quoted to prevent injection from event-derived values.
- Do not commit `.env` files or other files containing secrets, API keys, or session credentials.

## Disclosure policy

We will acknowledge receipt of a vulnerability report as soon as possible and work toward a fix and coordinated disclosure. Public disclosure will only happen after a fix is available or after the reporter agrees to an extended timeline.
