# GitHub Release Packages Design

## Goal

Automate release pull requests, GitHub Releases, GitHub Packages publication,
and npm tarball upload for this Node.js plugin using release-please.

## Repository Findings

- The project is a single Node.js package requiring Node.js 20 or newer.
- `package-lock.json` and npm scripts establish npm as the package manager.
- There is no Dockerfile or Python, Go, or Rust manifest.
- The repository is `yohi/herdr-opencode-child-panes`.
- `origin/HEAD` identifies `master` as the default branch.
- The existing CI workflow targets `main`; this design does not broaden the
  release change into an unrelated CI migration.

## Options Considered

1. **Scoped npm package on GitHub Packages (selected)**
   Change the package name to `@yohi/herdr-opencode-child-panes`, set
   `publishConfig.registry` to `https://npm.pkg.github.com`, and publish with
   `GITHUB_TOKEN`. This satisfies GitHub Packages naming and authentication
   requirements without adding long-lived credentials.
2. **GitHub Release only**
   Keep the package name and create releases and tarball assets without a
   package registry. This avoids the package identity change but does not
   satisfy npm package publication.
3. **Unscoped package on npmjs.org**
   Keep the package name and publish to npmjs.org. This requires a separate npm
   token and is outside the requested GitHub Packages target.

## Selected Design

### Package Metadata

- Update `package.json` to use `@yohi/herdr-opencode-child-panes`.
- Add `publishConfig.registry` with the GitHub Packages npm registry URL.
- Update the lockfile root package name if npm metadata records the package
  name there.

### Release Workflow

Create `.github/workflows/release.yml` with these properties:

- Trigger on pushes to `master`.
- Use `runs-on: ubuntu-slim`.
- Grant `contents: write`, `pull-requests: write`, and `packages: write`.
- Run `googleapis/release-please-action` with the pinned v4 SHA,
  `release-type: node`, and `target-branch: master`.
- Only after `release_created`, check out the generated tag, configure Node.js
  20, install dependencies from the normal npm registry, run the existing lint,
  typecheck, test, and build scripts, then configure GitHub Packages and publish
  with `GITHUB_TOKEN`. Keeping registry setup after dependency installation
  prevents unscoped public dependencies from being requested from GitHub
  Packages.
- Create an npm tarball and upload it to the same GitHub Release using the
  preinstalled GitHub CLI.
- Pin every third-party action to the SHAs documented by the release workflow
  reference.

The release-please action remains responsible for release PR creation and tag
creation. Publishing is conditional on a newly created release, so ordinary
pushes only update release metadata and do not publish an artifact.

### Error Handling and Security

- A failed build or test stops publication because all packaging steps are in
  the release-created path and run before `npm publish`.
- Authentication uses the ephemeral `GITHUB_TOKEN`; no new repository secret is
  required.
- The package scope matches the GitHub repository owner, as required by GitHub
  Packages.
- No credentials are written to files or command output.

### Verification

- Parse the workflow as YAML and inspect the resulting keys and conditions.
- Run the repository's `npm run lint`, `npm run typecheck`, `npm run test`, and
  `npm run build` commands.
- Run `npm pack --dry-run` to confirm that the scoped package contains the
  built `dist/` files and excludes development files.

## Scope Boundary

The existing CI workflow's `main` branch filter is not changed here. The
release workflow follows the dynamically detected default branch, `master`.
Any CI branch correction should be handled as a separate change after checking
the repository's intended branch policy.
