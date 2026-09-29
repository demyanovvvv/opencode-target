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
- `dist/target.js`, `dist/target-tui.js`, and the bundled installer helper contain the current
  source behavior;
- installer scripts automatically register the TUI plugin without deleting existing TUI settings;
- English and Russian installer variants are included in the release archive and smoke-tested;
- no state files, lock files, credentials, or local configuration are packaged.
- two consecutive local builds produce the same generated artifact hash;
- the packed tarball installs into a temporary project and contains no tests, state, lock files, or
  project-local agent configuration.
- `scripts/extract-changelog.mjs <version>` prints the intended English GitHub release description.

Project-local agent skills under `.opencode/skills/` are repository guidance for maintainers and
agents. They are intentionally not part of the package artifact; consumers use the plugin and the
published user-facing documentation instead.

## Publish or distribute

Releases run through the manual `Release` GitHub Actions workflow
(`.github/workflows/release.yml`). The package is private, so the workflow never publishes to npm.

1. Confirm `package.json` is private and its version matches the version you intend to release.
2. Add the matching `## [<version>]` section to `CHANGELOG.md`; the workflow extracts it as the
   release notes and fails if the section is missing or empty.
3. Trigger the workflow from the Actions tab (`workflow_dispatch`) with the target `version`.
4. Leave `dry_run` enabled to build and verify only. Disable it to upload the packed archive as a
   workflow artifact **and** publish a GitHub release tagged `v<version>` with the tarball attached
   and marked latest.
5. The workflow requires the protected `release` environment, runs `npm run check` and
   `npm run release:check`, then runs `npm pack` followed by the publish steps.

For local archive distribution:

1. Download the `opencode-target-<version>` workflow artifact, or run `npm pack` locally.
2. Provide the packed archive containing both READMEs, `dist/target.js`, `dist/target-tui.js`, and
    `dist/install-config.mjs` together with all four English and Russian install scripts.
3. Verify install scripts copy both plugins and register the indicator without a dependency install.
4. Tell users to restart OpenCode and create a new session.

## Post-release

- Record the released version and tested OpenCode/plugin version.
- Monitor runtime logs for plugin-load and continuation errors.
- Document any compatibility issue in `docs/compatibility.md`.
