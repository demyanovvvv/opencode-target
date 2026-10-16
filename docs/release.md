# Release Checklist

## Prepare

1. Review user-visible changes and update `README.md` and `README.ru.md`, including reciprocal
   language links and installation instructions.
2. Add the release entry to `CHANGELOG.md` and update the comparison links.
3. Update `docs/architecture.md`, `docs/state-format.md`, `docs/compatibility.md`, or
   `docs/codex-parity.md` when the corresponding behavior changes.
4. Update the package version in `package.json` according to the release type.
5. Review the package `files` list and confirm it contains both READMEs, source, generated server
    and TUI plugins, docs, changelog, and English and Russian installers.

## Verify

Run from a clean checkout or clean working tree:

```text
npm install
npm run check
npm run release:check
```

Confirm that:

- source and generated plugin pass syntax checks;
- the generated TUI plugin passes typecheck and OpenTUI renderer smoke coverage;
- unit tests and all smoke suites pass, including budget-wrap-up and restart recovery coverage;
- source/generated compaction integration, settings persistence, threshold/retry/duplicate fences,
  native hook preservation and compaction/budget continuation gating pass;
- `dist/target.js`, `dist/target-tui.js`, and the bundled installer helper contain the current
  source behavior;
- installer scripts automatically register the TUI plugin without deleting existing TUI settings;
- English and Russian installer and uninstaller variants are included in the release archive and
  smoke-tested for global/local scopes, interactive selection, updates and isolated state removal;
- no state files, lock files, credentials, or local configuration are packaged.
- two consecutive local builds produce the same generated artifact hash;
- the packed tarball installs into a temporary project and contains no tests, state, lock files, or
  project-local agent configuration.
- `scripts/extract-changelog.mjs <version>` prints the intended English GitHub release description.

Project-local agent skills under `.opencode/skills/` are repository guidance for maintainers and
agents. They are intentionally not part of the package artifact; consumers use the plugin and the
published user-facing documentation instead.

## Publish or distribute

Releases are distributed through GitHub Releases. The package is private and is not published to npm.
The repository includes `.github/workflows/release.yml`, a manually dispatched workflow with a
dry-run option. A local verified release is also supported by the process below. Use one publication
path per version to avoid racing two publishers for the same tag.

1. Confirm `package.json` is private and its version matches the version you intend to release.
2. Add the matching `## [<version>]` section to `CHANGELOG.md`; the extraction script uses it as the
   release notes and fails if the section is missing or empty.
3. Run `npm run release:check` and inspect the result; it builds, tests, checks deterministic output,
   packs a temporary archive, installs it and exercises the bundled scripts.
4. Run `npm pack --pack-destination <release-dir>` and
   `node scripts/extract-changelog.mjs <version> <release-dir>/release-notes.md`.
5. Commit the intended source, docs, version/lockfile and generated artifacts, then push the commit.
6. Create and push tag `v<version>` at that exact verified commit.
7. Publish with `gh release create v<version> <release-dir>/opencode-target-<version>.tgz
   --verify-tag --title "v<version>" --notes-file <release-dir>/release-notes.md --latest`.
8. Verify the published tag, release body, latest marker and attached archive before announcing it.

For workflow publication, first commit and push the versioned source/docs/artifacts, then run:

```text
gh workflow run release.yml --ref main -f version=0.7.0 -f dry_run=true
```

Inspect the run with `gh run view` or `gh run watch`; dispatch again with `dry_run=false` to publish
from the same verified commit. The workflow performs checks, packs the archive, extracts the
matching changelog section and creates the release. After either publication path, check the
release URL, latest tag, asset name/version and that the tag points to the intended commit.

For local archive distribution:

1. Download `opencode-target-<version>.tgz` from the GitHub release, or run `npm pack` locally.
2. Provide the packed archive containing both READMEs, `dist/target.js`, `dist/target-tui.js`, and
    `dist/install-config.mjs` together with all eight English and Russian install/uninstall scripts.
3. Verify install scripts copy both plugins and register the indicator without a dependency install.
4. Tell users to restart OpenCode and create a new session.

## Post-release

- Record the released version and tested OpenCode/plugin version.
- Monitor runtime logs for plugin-load and continuation errors.
- Document any compatibility issue in `docs/compatibility.md`.
