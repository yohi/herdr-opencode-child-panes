# GitHub Release Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the Node.js plugin through release-please, publish the scoped npm package to GitHub Packages, and attach the npm tarball to the GitHub Release.

**Architecture:** Keep release PR and tag creation in `googleapis/release-please-action`. A single conditional job checks out the created tag, validates and builds the package, publishes it to GitHub Packages, and uploads the tarball as a release asset.

**Tech Stack:** GitHub Actions, release-please v4, npm, Node.js 20, GitHub Packages, GitHub CLI.

## Global Constraints

- The project is a single Node.js package requiring Node.js 20 or newer.
- The package name must be `@yohi/herdr-opencode-child-panes` for GitHub Packages scope matching.
- The registry is `https://npm.pkg.github.com` and authentication uses `${{ secrets.GITHUB_TOKEN }}`.
- The default branch is `master`, detected from `origin/HEAD`.
- The release runner is `ubuntu-slim`.
- Third-party actions use the pinned SHAs from the release workflow reference.
- Existing `.codegraph/` and `opencodePlugin/` untracked changes are not modified.
- No commit is created unless explicitly requested.

---

### Task 1: Package Metadata

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Existing npm package metadata and lockfile.
- Produces: A scoped package whose default npm registry is GitHub Packages.

- [ ] **Step 1: Update package metadata**

Change the package name from `herdr-opencode-child-panes` to
`@yohi/herdr-opencode-child-panes` and add:

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com"
}
```

- [ ] **Step 2: Synchronize the lockfile**

Run `npm install --package-lock-only --ignore-scripts` and confirm the root
package metadata reflects the scoped name without changing dependency versions.

- [ ] **Step 3: Verify package metadata**

Run `npm pkg get name publishConfig` and expect the scoped name plus the GitHub
Packages registry URL.

### Task 2: Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: The scoped npm package, npm scripts, `master`, and GitHub Actions token.
- Produces: Release PRs, GitHub Releases, GitHub Packages publication, and npm tarball assets.

- [ ] **Step 1: Add the release-please job**

Create a workflow with `push.branches: [master]`, permissions for contents,
pull requests, and packages, and this pinned action configuration:

```yaml
- uses: googleapis/release-please-action@c3fc4de07084f75a2b61a5b933069bda6edf3d5c
  id: release
  with:
    release-type: node
    target-branch: master
```

- [ ] **Step 2: Add conditional checkout and npm setup**

After `release_created`, use the pinned checkout and setup-node actions, check
out `steps.release.outputs.tag_name`, select Node.js 20, and enable npm caching.
Keep the initial setup-node registry at the normal npm default so unscoped
dependencies are installed from npmjs.org.

- [ ] **Step 3: Add validation and publication**

Under the same `release_created` condition, run `npm ci`, `npm run lint`,
`npm run typecheck`, `npm run test`, and `npm run build` in that order. Publish
with a second setup-node step configured with
`registry-url: https://npm.pkg.github.com` and
`scope: @${{ github.repository_owner }}`, then run
`npm publish --ignore-scripts` with:

```yaml
env:
  NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 4: Upload the release asset**

Run `npm pack`, store the generated filename in `PACKAGE_FILE`, and upload it
with `gh release upload ${{ steps.release.outputs.tag_name }} $PACKAGE_FILE`,
using `GITHUB_TOKEN` in the environment.

### Task 3: Deterministic Verification

**Files:**
- Verify: `package.json`
- Verify: `package-lock.json`
- Verify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: The completed metadata and workflow changes.
- Produces: Local evidence that package contents, scripts, and workflow syntax are valid.

- [ ] **Step 1: Validate workflow structure**

Parse `.github/workflows/release.yml` with an available YAML parser and inspect
that the trigger is `master`, the runner is `ubuntu-slim`, permissions include
`packages: write`, and publication steps are gated by `release_created`.

- [ ] **Step 2: Run repository checks**

Run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`.
Expect all commands to exit successfully.

- [ ] **Step 3: Inspect package contents**

Run `npm pack --dry-run` and confirm the output includes `dist/` artifacts and
does not include `src/`, `test/`, `node_modules/`, or repository metadata.

- [ ] **Step 4: Review the final diff**

Run `git status --short` and `git diff -- package.json package-lock.json .github/workflows/release.yml docs/superpowers/specs/2026-09-17-github-release-packages-design.md docs/superpowers/plans/2026-09-17-github-release-packages.md`.
Confirm unrelated pre-existing untracked files remain untouched.
