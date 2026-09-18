# Documentation Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor repository documentation to conform to the [Documentation Architecture Standard for `yohi/*`](https://github.com/yohi/.github/blob/master/docs/documentation-architecture.md).

**Architecture:** Split the current Japanese README into an English canonical README with a Japanese translation, extract normative technical content into `SPEC.md`, extract human-facing details into topic-specific `docs/*.md` files with Japanese translations where useful, rewrite `CHANGELOG.md` in English, and create `AGENTS.md`, `CONTRIBUTING.md`, and `SECURITY.md`.

**Tech Stack:** Markdown, GitHub-flavored Markdown, npm scripts for verification.

## Global Constraints

- English is the canonical language for `README.md`, `SPEC.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, and `docs/*.md`.
- Japanese translations use the `.ja.md` suffix and are derived from English.
- `README.md` must stay focused on discovery, onboarding, and routing.
- Do not duplicate agent rules, protocol contracts, or configuration catalogs across files.
- No absolute paths or personal directories in committed documentation.
- Every task ends with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` passing.
- No commit is created unless explicitly requested by the user.

---

### Task 1: Create English `README.md`

**Files:**
- Create: `README.md`
- Reference: `docs/superpowers/specs/2026-09-18-documentation-refactoring-design.md`

**Interfaces:**
- Consumes: Existing `README.md` content, `package.json`, `.github/workflows/*.yml`.
- Produces: English canonical README that routes readers to `docs/*.md`, `SPEC.md`, and `AGENTS.md`.

- [ ] **Step 1: Write the English README**

  Create `README.md` with these sections in order:

  1. Language switch link to `README.ja.md`
  2. Badges (CI, release, Node.js, license)
  3. One-line value proposition
  4. Short What / Why
  5. Quick Start (requirements, install plugin, one execution path, expected result)
  6. Features (bullet list)
  7. How It Works (high-level only, link to `docs/architecture.md`)
  8. Usage (representative example)
  9. Configuration (only the most important settings, link to `docs/configuration.md`)
  10. Documentation (routing table)
  11. Development (build/test commands)
  12. License

  Use the existing Japanese README as the source of facts, but remove all
  detailed architecture tables, full environment-variable catalogs, lifecycle
  semantics, failure semantics, security guarantees, and limitations.

- [ ] **Step 2: Verify Markdown and links**

  Run: `npx biome check README.md`  
  Expected: no errors.

- [ ] **Step 3: Verify repository checks still pass**

  Run:

  ```bash
  npm run lint
  npm run typecheck
  npm run test
  npm run build
  ```

  Expected: all pass.

- [ ] **Step 4: Review the diff**

  Run: `git diff README.md`  
  Expected: old Japanese content replaced by new English content; no unrelated changes.

---

### Task 2: Create Japanese `README.ja.md`

**Files:**
- Create: `README.ja.md`
- Reference: `README.md`

**Interfaces:**
- Consumes: English `README.md`.
- Produces: Japanese translation of the README with an authority notice.

- [ ] **Step 1: Translate README to Japanese**

  Create `README.ja.md` as a faithful Japanese translation of `README.md`.
  Include at the top:

  ```markdown
  [English](README.md)

  > [!NOTE]
  > この文書は [English version](README.md) の日本語訳です。
  > 内容に相違がある場合は、英語版を権威あるものとします。
  ```

  Preserve all links to English canonical documents (`docs/architecture.md`,
  `docs/configuration.md`, etc.) because translations will also exist at
  `docs/architecture.ja.md` and `docs/configuration.ja.md`.

- [ ] **Step 2: Verify Markdown**

  Run: `npx biome check README.ja.md`  
  Expected: no errors.

- [ ] **Step 3: Verify repository checks**

  Run:

  ```bash
  npm run lint
  npm run typecheck
  npm run test
  npm run build
  ```

  Expected: all pass.

- [ ] **Step 4: Review the diff**

  Run: `git status --short` and `git diff README.ja.md`  
  Expected: only `README.ja.md` added.

---

### Task 3: Create `SPEC.md`

**Files:**
- Create: `SPEC.md`
- Reference: Current `README.md` sections "アーキテクチャと境界", "設定", "ペインライフサイクルの挙動", "容量の挙動", "失敗と劣化のセマンティクス", "セキュリティに関する注意", "現在の制限"

**Interfaces:**
- Consumes: Existing README technical details and source code context.
- Produces: Normative English specification.

- [ ] **Step 1: Write SPEC.md**

  Create `SPEC.md` with these sections:

  1. Scope and non-goals
  2. High-level architecture reference
  3. Module responsibilities (condensed table)
  4. State machine and transitions
  5. Lifecycle semantics
  6. Capacity semantics
  7. Failure and degradation semantics
  8. Security guarantees
  9. Compatibility guarantees
  10. Acceptance criteria / invariants

  Convert tables and prose from the old README into precise, normative
  English. Do not add tutorial-style explanations; link to `docs/architecture.md`
  for those.

- [ ] **Step 2: Verify Markdown**

  Run: `npx biome check SPEC.md`  
  Expected: no errors.

- [ ] **Step 3: Verify repository checks**

  Run:

  ```bash
  npm run lint
  npm run typecheck
  npm run test
  npm run build
  ```

  Expected: all pass.

---

### Task 4: Create `docs/architecture.md` and `docs/architecture.ja.md`

**Files:**
- Create: `docs/architecture.md`
- Create: `docs/architecture.ja.md`
- Reference: `SPEC.md`, current `README.md` "アーキテクチャと境界"

**Interfaces:**
- Consumes: `SPEC.md`, old README architecture section.
- Produces: Human-oriented architecture explanation in English and Japanese.

- [ ] **Step 1: Write English architecture doc**

  Create `docs/architecture.md` with:

  1. What the plugin does
  2. How it fits into Herdr + OpenCode
  3. Module map and responsibilities
  4. Control flow overview
  5. Relationship to OMO
  6. Link to `SPEC.md` for exact behavior

- [ ] **Step 2: Write Japanese translation**

  Create `docs/architecture.ja.md` as a translation of `docs/architecture.md`.
  Include the authority notice pointing to the English version.

- [ ] **Step 3: Verify Markdown**

  Run:

  ```bash
  npx biome check docs/architecture.md
  npx biome check docs/architecture.ja.md
  ```

  Expected: no errors.

- [ ] **Step 4: Verify repository checks**

  Run:

  ```bash
  npm run lint
  npm run typecheck
  npm run test
  npm run build
  ```

  Expected: all pass.

---

### Task 5: Create `docs/configuration.md` and `docs/configuration.ja.md`

**Files:**
- Create: `docs/configuration.md`
- Create: `docs/configuration.ja.md`
- Reference: Current `README.md` "設定" section

**Interfaces:**
- Consumes: Environment variable table from old README.
- Produces: Complete configuration reference in English and Japanese.

- [ ] **Step 1: Write English configuration doc**

  Create `docs/configuration.md` with:

  1. Overview (all settings are environment variables)
  2. Required environment variables (`HERDR_ENV`, `HERDR_PANE_ID`)
  3. Optional environment variables table (name, default, description, value rules)
  4. Fallback behavior for invalid values
  5. Security implications
  6. Example configuration

- [ ] **Step 2: Write Japanese translation**

  Create `docs/configuration.ja.md` as a translation of `docs/configuration.md`.
  Include the authority notice.

- [ ] **Step 3: Verify Markdown and checks**

  Run:

  ```bash
  npx biome check docs/configuration.md docs/configuration.ja.md
  npm run lint
  npm run typecheck
  npm run test
  npm run build
  ```

  Expected: all pass.

---

### Task 6: Create `docs/getting-started.md` and `docs/getting-started.ja.md`

**Files:**
- Create: `docs/getting-started.md`
- Create: `docs/getting-started.ja.md`
- Reference: Current `README.md` "要件", "インストール"

**Interfaces:**
- Consumes: Setup instructions from old README.
- Produces: Detailed getting-started guide in English and Japanese.

- [ ] **Step 1: Write English getting-started doc**

  Create `docs/getting-started.md` with:

  1. Prerequisites (Node.js 20+, Herdr, OpenCode version)
  2. Install Herdr integration
  3. Build and install the plugin
  4. Verify the first child pane appears
  5. Common pitfalls

- [ ] **Step 2: Write Japanese translation**

  Create `docs/getting-started.ja.md` as a translation of `docs/getting-started.md`.
  Include the authority notice.

- [ ] **Step 3: Verify Markdown and checks**

  Run:

  ```bash
  npx biome check docs/getting-started.md docs/getting-started.ja.md
  npm run lint
  npm run typecheck
  npm run test
  npm run build
  ```

  Expected: all pass.

---

### Task 7: Create `docs/operations.md` and `docs/operations.ja.md`

**Files:**
- Create: `docs/operations.md`
- Create: `docs/operations.ja.md`
- Reference: Current `README.md` sections "ペインライフサイクルの挙動", "容量の挙動", "失敗と劣化のセマンティクス", "セキュリティに関する注意", "現在の制限"

**Interfaces:**
- Consumes: Operational content from old README.
- Produces: Operational runbook in English and Japanese.

- [ ] **Step 1: Write English operations doc**

  Create `docs/operations.md` with:

  1. Monitoring / expected logs
  2. Idle timeout behavior
  3. Capacity limits
  4. Retry and failure behavior
  5. Security notes (operational perspective)
  6. Current limitations
  7. Troubleshooting checklist

- [ ] **Step 2: Write Japanese translation**

  Create `docs/operations.ja.md` as a translation of `docs/operations.md`.
  Include the authority notice.

- [ ] **Step 3: Verify Markdown and checks**

  Run:

  ```bash
  npx biome check docs/operations.md docs/operations.ja.md
  npm run lint
  npm run typecheck
  npm run test
  npm run build
  ```

  Expected: all pass.

---

### Task 8: Rewrite `CHANGELOG.md` in English

**Files:**
- Modify: `CHANGELOG.md`
- Reference: Current `CHANGELOG.md`

**Interfaces:**
- Consumes: Existing Japanese changelog.
- Produces: English changelog in the same release structure.

- [ ] **Step 1: Translate changelog to English**

  Rewrite `CHANGELOG.md` preserving the same releases, sections
  (`Features`, `Bug Fixes`, `Reverts`), and commit links. Translate only the
  human-readable descriptions; do not change commit SHAs, issue numbers, or
  release dates.

  Example:

  ```markdown
  ### Bug Fixes

  * fix release-publish lint failure ([9651fa5](...))
  ```

- [ ] **Step 2: Verify Markdown and checks**

  Run:

  ```bash
  npx biome check CHANGELOG.md
  npm run lint
  npm run typecheck
  npm run test
  npm run build
  ```

  Expected: all pass.

---

### Task 9: Create `AGENTS.md`, `CONTRIBUTING.md`, and `SECURITY.md`

**Files:**
- Create: `AGENTS.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Reference: `docs/superpowers/specs/2026-09-18-documentation-refactoring-design.md`

**Interfaces:**
- Consumes: Global `AGENTS.md`, repository conventions, package scripts.
- Produces: Repository-level canonical documents.

- [ ] **Step 1: Write AGENTS.md**

  Create `AGENTS.md` with:

  1. Mandatory verification commands
  2. Integration test gating (`HERDR_BINARY`)
  3. Tool-selection conventions
  4. Safety constraints (no absolute paths, no secrets, no type-error suppression)
  5. Generated files and what not to edit manually
  6. Repository-specific workflow notes

- [ ] **Step 2: Write CONTRIBUTING.md**

  Create `CONTRIBUTING.md` with:

  1. Development setup
  2. Running checks
  3. Commit conventions
  4. Where to open issues

- [ ] **Step 3: Write SECURITY.md**

  Create `SECURITY.md` with:

  1. Supported versions
  2. How to report vulnerabilities
  3. Sensitive data handling notes

- [ ] **Step 4: Verify Markdown and checks**

  Run:

  ```bash
  npx biome check AGENTS.md CONTRIBUTING.md SECURITY.md
  npm run lint
  npm run typecheck
  npm run test
  npm run build
  ```

  Expected: all pass.

---

### Task 10: Verify Superseded `docs/superpowers/` Files and Final Review

**Files:**
- Verify absent: `docs/superpowers/specs/2026-09-17-github-release-packages-design.md`
- Verify absent: `docs/superpowers/plans/2026-09-17-github-release-packages.md`
- Keep the non-empty `docs/superpowers/specs/` and `docs/superpowers/plans/` directories, which contain the current design and plan.
- Keep: `docs/superpowers/specs/2026-09-18-documentation-refactoring-design.md`

**Interfaces:**
- Consumes: Git index state showing old files already deleted.
- Produces: Clean docs hierarchy without superseded work-in-progress files.

- [ ] **Step 1: Confirm old files are no longer needed**

  Verify that `.github/workflows/release.yml` and `package.json` already
  contain the implemented GitHub Packages release logic. No information from
  the old design/plan files needs to be preserved.

- [ ] **Step 2: Verify old files remain deleted**

  The old files were deleted before this plan is executed. Do not run `git rm`
  again. Verify that neither path exists in `HEAD`, the Git index, or the
  working tree:

  ```bash
  old_files=(
    docs/superpowers/specs/2026-09-17-github-release-packages-design.md
    docs/superpowers/plans/2026-09-17-github-release-packages.md
  )
  for file in "${old_files[@]}"; do
    if git cat-file -e "HEAD:${file}" 2>/dev/null \
      || git ls-files --error-unmatch -- "$file" >/dev/null 2>&1 \
      || test -e "$file"; then
      printf 'Superseded file is still present: %s\n' "$file" >&2
      exit 1
    fi
  done
  ```

  Expected: the loop exits with status 0, confirming that both old paths are
  absent from `HEAD`, the index, and the working tree.

- [ ] **Step 3: Final verification**

  Run:

  ```bash
  git status --short
  npm run lint
  npm run typecheck
  npm run test
  npm run build
  ```

  Expected:

  - `git status` shows only intended new/modified/deleted documentation files.
  - All npm scripts pass.

- [ ] **Step 4: Review all internal links**

  Run the following link-check script. It extracts Markdown inline and
  reference-style links, resolves every relative target from the directory of
  its source document, and fails if a target is missing, is not a file, or
  resolves outside the repository. Planning artifacts under
  `docs/superpowers/` are excluded because they contain illustrative snippets,
  not user-facing document links, and fenced code blocks are ignored.

  ```bash
  node <<'NODE'
  const fs = require("node:fs");
  const path = require("node:path");

  const root = process.cwd();
  const entries = [
    "README.md",
    "README.ja.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "SPEC.md",
    "docs",
  ];
  const markdownFiles = [];

  function collectMarkdownFiles(entry) {
    const absolute = path.resolve(root, entry);
    const relativeEntry = path.relative(root, absolute);
    const planningRoot = path.join("docs", "superpowers");
    if (relativeEntry === planningRoot || relativeEntry.startsWith(`${planningRoot}${path.sep}`)) {
      return;
    }
    const stats = fs.statSync(absolute);
    if (stats.isDirectory()) {
      for (const child of fs.readdirSync(absolute)) {
        collectMarkdownFiles(path.join(entry, child));
      }
      return;
    }
    if (absolute.endsWith(".md")) {
      markdownFiles.push(absolute);
    }
  }

  for (const entry of entries) {
    collectMarkdownFiles(entry);
  }

  function withoutFencedCodeBlocks(text) {
    let fenced = false;
    return text
      .split("\n")
      .map((line) => {
        if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) {
          fenced = !fenced;
          return "";
        }
        return fenced ? "" : line;
      })
      .join("\n");
  }

  const linkPatterns = [
    /!?\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^)]*["'])?\s*\)/g,
    /^\s*\[[^\]]+\]:\s*(<[^>]+>|[^\s]+)\s*$/gm,
  ];
  const failures = [];

  for (const source of markdownFiles) {
    const text = withoutFencedCodeBlocks(fs.readFileSync(source, "utf8"));
    for (const pattern of linkPatterns) {
      for (const match of text.matchAll(pattern)) {
        const rawTarget = match[1].replace(/^<|>$/g, "");
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(rawTarget)) {
          continue;
        }
        const target = rawTarget.split(/[?#]/, 1)[0];
        if (target.length === 0) {
          continue;
        }

        const resolved = path.resolve(path.dirname(source), target);
        if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
          failures.push(`${path.relative(root, source)}: ${rawTarget} resolves outside the repository`);
          continue;
        }

        let isFile = false;
        try {
          isFile = fs.statSync(resolved).isFile();
        } catch {
          // The failure below reports missing targets uniformly.
        }
        if (!isFile) {
          failures.push(`${path.relative(root, source)}: missing file for ${rawTarget}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(`Checked ${markdownFiles.length} Markdown files and all relative links.`);
  NODE
  ```

  Expected: the script exits with status 0 and every relative link resolves to
  an existing file based on its source document's directory. External URLs and
  fragment-only links are skipped. A grep-based command, if retained as a
  separate check, is only a syntax-extraction aid and is not the existence
  validation gate.

---

## Self-Review Checklist

- [ ] Spec coverage: every section of `2026-09-18-documentation-refactoring-design.md` maps to at least one task.
- [ ] No placeholders: no "TBD", "TODO", or vague steps remain.
- [ ] File naming: repository-level docs use uppercase; topic docs use kebab-case; Japanese translations use `.ja.md`.
- [ ] No duplication: agent rules live only in `AGENTS.md`; configuration catalog lives only in `docs/configuration.md`; normative behavior lives only in `SPEC.md`.
