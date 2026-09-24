# Release Checklist

## Prepare

1. Review user-visible changes and update `README.md`.
2. Update `docs/architecture.md`, `docs/state-format.md`, `docs/compatibility.md`, or
   `docs/codex-parity.md` when the corresponding behavior changes.
3. Update the package version in `package.json` according to the release type.
4. Review the package `files` list and confirm it contains source, generated plugin, docs, and installers.

## Verify

Run from a clean checkout or clean working tree:

```text
npm install
npm run check
npm run release:check
```

Confirm that:

- source and generated plugin pass syntax checks;
- unit tests and all smoke suites pass, including budget-wrap-up and restart recovery coverage;
- `dist/target.js` contains the current source behavior;
- no state files, lock files, credentials, or local configuration are packaged.
- two consecutive local builds produce the same generated artifact hash;
- the packed tarball installs into a temporary project and contains no tests, state, lock files, or
  project-local agent configuration.

Project-local agent skills under `.opencode/skills/` are repository guidance for maintainers and
agents. They are intentionally not part of the package artifact; consumers use the plugin and the
published user-facing documentation instead.

## Publish or distribute

Releases run through the manual `Release` GitHub Actions workflow
(`.github/workflows/release.yml`). The package is private, so the workflow never publishes to npm.

1. Confirm `package.json` is private and its version matches the version you intend to release.
2. Trigger the workflow from the Actions tab (`workflow_dispatch`) with the target `version`.
3. Leave `dry_run` enabled to build and verify only. Disable it to upload the packed archive as a
   workflow artifact.
4. The workflow requires the protected `release` environment, runs `npm run check` and
   `npm run release:check`, then runs `npm pack` and (unless `dry_run`) uploads the tarball.

For local archive distribution:

1. Download the `opencode-target-<version>` workflow artifact, or run `npm pack` locally.
2. Provide the rebuilt `dist/target.js` and the packed archive.
3. Ensure `install.sh` and `install.ps1` point to the documented OpenCode plugin directory.
4. Tell users to restart OpenCode and create a new session.

## Post-release

- Record the released version and tested OpenCode/plugin version.
- Monitor runtime logs for plugin-load and continuation errors.
- Document any compatibility issue in `docs/compatibility.md`.
