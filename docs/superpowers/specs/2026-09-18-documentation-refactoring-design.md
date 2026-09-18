# Documentation Refactoring Design

## Goal

Refactor the documentation of `herdr-opencode-child-panes` so that it follows the
[Documentation Architecture Standard for `yohi/*`](https://github.com/yohi/.github/blob/master/docs/documentation-architecture.md).

The target state separates human-facing entry points, normative technical
specifications, agent instructions, and topic-specific detailed documentation,
with English as the canonical language.

## Applicable Standard

- Keep one canonical source for each kind of information.
- `README.md` is the project entry point: discovery, onboarding, and routing.
- `SPEC.md` owns normative technical correctness.
- `AGENTS.md` owns repository-specific AI agent behavior.
- `docs/*.md` owns human-facing detailed documentation.
- `CHANGELOG.md` is English only by default.
- Japanese translations use the `.ja.md` suffix and are derived from English.

## Current State

| File | Language | Responsibility | Issues |
| --- | --- | --- | --- |
| `README.md` | Japanese | Entry point + full spec | Wrong canonical language; embeds detailed architecture, configuration catalog, lifecycle semantics, failure semantics, security notes, and limitations |
| `CHANGELOG.md` | Japanese | Release history | Wrong canonical language |
| `docs/superpowers/specs/2026-09-17-github-release-packages-design.md` | English | Old design memo | Already tracked as deleted in the index; content is superseded by `.github/workflows/release.yml` |
| `docs/superpowers/plans/2026-09-17-github-release-packages.md` | English | Old implementation plan | Already tracked as deleted in the index; implementation is complete |
| `docs/validation/v1-omo-4.19.4.md` | Japanese | Manual E2E validation record | Valuable; keep under `docs/validation/` |

No `AGENTS.md`, `SPEC.md`, `CONTRIBUTING.md`, or `SECURITY.md` exists.

## Target Structure

```text
repository/
├── README.md
├── README.ja.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── AGENTS.md
├── SPEC.md
├── LICENSE
└── docs/
    ├── architecture.md
    ├── architecture.ja.md
    ├── configuration.md
    ├── configuration.ja.md
    ├── getting-started.md
    ├── getting-started.ja.md
    ├── operations.md
    ├── operations.ja.md
    └── validation/
        └── v1-omo-4.19.4.md
```

## Responsibility Mapping

| Information | Canonical Source | Japanese Translation |
| --- | --- | --- |
| Project overview / value prop | `README.md` | `README.ja.md` |
| Quick Start | `README.md` | `README.ja.md` |
| Key features | `README.md` | `README.ja.md` |
| High-level architecture | `README.md` | `README.ja.md` |
| Detailed architecture | `docs/architecture.md` | `docs/architecture.ja.md` |
| Design invariants / state transitions / failure semantics / protocol behavior | `SPEC.md` | None (English only) |
| Configuration reference | `docs/configuration.md` | `docs/configuration.ja.md` |
| Operational runbook / limitations / troubleshooting | `docs/operations.md` | `docs/operations.ja.md` |
| Agent behavior / repo-specific workflows | `AGENTS.md` | None (English only) |
| Contribution workflow | `CONTRIBUTING.md` | None (minimal repo, English only) |
| Security policy | `SECURITY.md` | None (English only) |
| Release history | `CHANGELOG.md` | None (English only) |
| Validation records | `docs/validation/*.md` | As needed |

## Language Policy

- English is canonical.
- Human-facing documents (`README.md`, `docs/*.md`) get Japanese translations where the value exceeds maintenance cost.
- Normative documents (`SPEC.md`, `AGENTS.md`), `CHANGELOG.md`, and machine-consumed files are English only.
- Each Japanese translation includes a notice that the English version is authoritative.

## Document Designs

### `README.md` (English)

Approximately 80–120 lines. Library/Plugin archetype (Type A).

Sections:

1. Language switch: `[日本語](README.ja.md)`
2. Badges: CI, release, Node.js, license
3. One-line value proposition
4. What / Why (2–3 sentences)
5. Quick Start (requirements, install plugin, one execution path, expected result)
6. Features (bullet list)
7. How It Works (high-level only; link to `docs/architecture.md`)
8. Usage (representative example)
9. Configuration (only the most important settings; link to `docs/configuration.md`)
10. Documentation (routing table)
11. Development (build/test commands)
12. License

### `README.ja.md` (Japanese)

Translation of `README.md`. Includes the authority notice and an `[English](README.md)` switch.

### `SPEC.md` (English)

Normative technical source of truth. Contents:

- Scope and non-goals
- High-level architecture reference
- Module responsibilities (condensed from the current README module table)
- State machine and transitions
- Lifecycle semantics (`session.created`, activity, idle, delete, close)
- Capacity semantics
- Failure and degradation semantics
- Security guarantees
- Compatibility guarantees
- Acceptance criteria / invariants

### `AGENTS.md` (English)

Repository-specific agent instructions. Contents:

- Mandatory verification: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`
- Integration tests gated by `HERDR_BINARY`
- Tool-selection conventions (prefer `codegraph_explore`, use `task` for parallel work)
- No absolute paths in committed files
- No type-error suppression (`as any`, `@ts-ignore`)
- No committing without explicit request
- No new agent config files
- Generated files: `dist/` is build output; `CHANGELOG.md` is release-please generated

### `docs/architecture.md` (English)

Human-oriented architecture explanation. Contents:

- What the plugin does at a high level
- How it fits into Herdr + OpenCode
- Module map and responsibilities
- Control flow overview
- Relationship to OMO (human-readable, not normative)
- Link to `SPEC.md` for exact behavior

### `docs/architecture.ja.md` (Japanese)

Translation of `docs/architecture.md`.

### `docs/configuration.md` (English)

Complete configuration reference. Contents:

- All environment variables
- Defaults, required/optional, value types
- Behavior of invalid values (fallback policy)
- Security implications
- Examples

### `docs/configuration.ja.md` (Japanese)

Translation of `docs/configuration.md`.

### `docs/getting-started.md` (English)

Detailed setup guide beyond Quick Start:

- Prerequisites (Node.js, Herdr, OpenCode version)
- Herdr integration install
- Plugin build and install
- Verifying the first child pane
- Common pitfalls

### `docs/getting-started.ja.md` (Japanese)

Translation of `docs/getting-started.md`.

### `docs/operations.md` (English)

Operational runbook:

- Monitoring / expected logs
- Idle timeout behavior
- Capacity limits
- Retry and failure behavior
- Current limitations
- Troubleshooting checklist

### `docs/operations.ja.md` (Japanese)

Translation of `docs/operations.md`.

### `CHANGELOG.md` (English)

Rewrite the existing Japanese changelog into English, preserving the same
release structure. The file will continue to be maintained by release-please.

### `CONTRIBUTING.md` (English)

Minimal contribution guide:

- Development setup
- Running checks
- Commit conventions
- Where to open issues

### `SECURITY.md` (English)

Minimal security policy:

- Supported versions
- How to report vulnerabilities
- Sensitive data handling notes

### `docs/validation/v1-omo-4.19.4.md`

Keep as-is. It is a Japanese validation record and does not need canonical
English synchronization because it is a snapshot of a manual test run.

## Cleanup

- Remove the old `docs/superpowers/specs/2026-09-17-github-release-packages-design.md`
  and `docs/superpowers/plans/2026-09-17-github-release-packages.md` files.
  Their content is superseded by `.github/workflows/release.yml` and the
  package metadata in `package.json`.
- Retain the non-empty `docs/superpowers/specs/` and `docs/superpowers/plans/`
  directories after deletion. They contain the active design and implementation
  plan; do not remove them recursively.

## Migration Plan

1. Create new `README.md` in English.
2. Create `README.ja.md` as translation.
3. Extract normative content from the old README into `SPEC.md`.
4. Extract human-oriented architecture into `docs/architecture.md` and its Japanese translation.
5. Extract configuration catalog into `docs/configuration.md` and its Japanese translation.
6. Extract setup details into `docs/getting-started.md` and its Japanese translation.
7. Extract operational content into `docs/operations.md` and its Japanese translation.
8. Rewrite `CHANGELOG.md` in English.
9. Create `AGENTS.md`, `CONTRIBUTING.md`, and `SECURITY.md`.
10. Remove superseded `docs/superpowers/` files.
11. Run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` to ensure the repository still passes checks.
12. Review rendered Markdown and verify all internal links.

## Risks and Notes

- The old README contains both user-facing and normative content; care is needed
  to avoid losing invariants during extraction.
- `CHANGELOG.md` is currently generated/maintained by release-please. Rewriting
  it in English aligns with the standard but must not break release-please
  updates.
- Internal links from README to docs must work on GitHub.
- Absolute paths or personal directory references must not be introduced.

## Approval

This design follows the A option: full conformance to the Documentation
Architecture Standard.
