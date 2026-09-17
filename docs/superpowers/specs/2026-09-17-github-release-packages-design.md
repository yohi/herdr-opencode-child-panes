# GitHub Release Packages Design

## Goal

Automate release pull requests, GitHub Releases, GitHub Packages publication,
and npm tarball upload for this Node.js plugin using release-please, with
publication that can be retried independently.

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

Create `.github/workflows/release.yml` with separate release and publication jobs:

- Trigger the workflow on pushes to `master` and on `release.published`.
- Run the release job only for pushes. Expose the release-please
  `release_created` and `tag_name` step outputs as job outputs.
- Make the publication job depend on the release job and run when either the
  release event is received or the release-please job reports
  `release_created == 'true'`. This chains publication for releases created by
  the workflow while retaining the release-event path for externally created
  releases when the creating token allows workflow triggering.
- Use `runs-on: ubuntu-slim` and `timeout-minutes: 15` for both jobs.
  `ubuntu-slim` is a standard GitHub-hosted runner with a 15-minute hard job
  limit, so the publication steps must fit within that limit.
- Give the release job `contents: write` and `pull-requests: write`; give the
  publication job `contents: write` and `packages: write`.
- Run `googleapis/release-please-action` with the pinned v4 SHA,
  `release-type: node`, and `target-branch: master` in the release job.
- In the publication job, check out the tag from the release event or the
  release-please job output, configure Node.js 20, install dependencies from
  the normal npm registry, run the existing lint, typecheck, test, and build
  scripts, then configure GitHub Packages and publish with `GITHUB_TOKEN`.
  Keeping registry setup after dependency installation prevents unscoped
  public dependencies from being requested from GitHub Packages.
- Before publishing, query the exact package name and version and skip
  `npm publish` when that version already exists. This makes reruns safe after
  a successful package publication.
- Create an npm tarball and upload it to the selected GitHub Release with
  `gh release upload --clobber`, passing the tag through the `TAG_NAME`
  environment variable so event data is not interpolated into the shell
  script. This allows an existing asset to be replaced on a retry.
- Pin every third-party action to the SHAs documented by the release workflow
  reference.

The release-please action remains responsible for release PR creation and tag
creation. For a release created by release-please, publication runs as a
dependent job in the same workflow run, so the publication job can be rerun
without rerunning release-please or changing the release tag. The
`release.published` trigger remains available for releases created outside the
release-please workflow with an event-delivering token.

### Error Handling and Security

- A failed build or test stops publication because all packaging steps run
  before `npm publish` in the publication job.
- Release creation and publication are separate jobs for the automatic path,
  so a failed publication can be rerun without recreating the release or
  rerunning release-please.
- Publication checks the exact package version before `npm publish`, and asset
  upload uses `--clobber`, so reruns are idempotent after either step succeeds.
- Authentication uses the ephemeral `GITHUB_TOKEN`; no new repository secret is
  required.
- The release job cannot publish packages because it does not receive
  `packages: write`.
- The package scope matches the GitHub repository owner, as required by GitHub
  Packages.
- No credentials are written to files or command output.

### Verification

- Parse the workflow as YAML and inspect the resulting keys, job outputs,
  dependency, conditions, runner limits, and safe tag handling.
- Run the repository's `npm run lint`, `npm run typecheck`, `npm run test`, and
  `npm run build` commands.
- Run `npm pack --dry-run` to confirm that the scoped package contains the
  built `dist/` files and excludes development files.

## Scope Boundary

The existing CI workflow's `main` branch filter is not changed here. The
release workflow follows the dynamically detected default branch, `master`.
Any CI branch correction should be handled as a separate change after checking
the repository's intended branch policy.
