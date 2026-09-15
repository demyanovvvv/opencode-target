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
- `dist/mission.js` contains the current source behavior;
- no state files, lock files, credentials, or local configuration are packaged.
- two consecutive local builds produce the same generated artifact hash;
- the packed tarball installs into a temporary project and contains no tests, state, lock files, or
  project-local agent configuration.

Project-local agent skills under `.opencode/skills/` are repository guidance for maintainers and
agents. They are intentionally not part of the npm package artifact; npm consumers use the plugin
and the published user-facing documentation instead.

## Publish or distribute

For local archive distribution:

1. Provide the rebuilt `dist/mission.js`.
2. Ensure `install.sh` and `install.ps1` point to the documented OpenCode plugin directory.
3. Tell users to restart OpenCode and create a new session.

For npm distribution:

1. Run `npm pack --dry-run` and inspect the file list.
2. Confirm the peer dependency range and README installation instructions.
3. Publish only after the target OpenCode/plugin version has been smoke-tested.

## Post-release

- Record the released version and tested OpenCode/plugin version.
- Monitor runtime logs for plugin-load and continuation errors.
- Document any compatibility issue in `docs/compatibility.md`.
