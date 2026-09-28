# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-09-28

This release adds a live Target indicator to the OpenCode TUI and installs both plugin components
automatically from the release archive.

### Added

- Added the optional `opencode-target-tui` plugin with an animated Target status indicator under the
  OpenCode TUI prompt. It shows working, waiting, retrying, needs input, paused, blocked, budget
  limit, usage limit, complete, and unavailable states without changing persisted Target state.
- Added generated `dist/target-tui.js`, TUI build/typecheck/smoke commands, and OpenTUI renderer
  coverage for animation, session switching, narrow terminals, clear, corrupt state, and disposal.
- Added fully automatic archive installation. `install.sh` and `install.ps1` now install both
  plugins and register the TUI plugin in `tui.json` or `tui.jsonc` without manual edits or npm
  dependencies.
- Added JSONC-preserving, idempotent installer configuration. Existing comments, settings, plugin
  options, and entries remain intact; duplicate Target entries are avoided and a disabled Target
  TUI entry is re-enabled.
- Added custom configuration support through `OPENCODE_CONFIG_DIR` and `OPENCODE_TUI_CONFIG`.
- Added a self-contained `dist/install-config.mjs` helper requiring only Node.js 22+ in release
  archives.

### Changed

- Release validation now pins the compatible OpenTUI `0.4.5` and Solid `1.9.12` peer set and tests
  the installers from isolated archive artifacts.

### Documentation

- Added [Russian README](https://github.com/demyanovvvv/opencode-target/blob/v0.4.0/README.ru.md)
  with Russian installation, usage, lifecycle, TUI, and
  troubleshooting guidance.
- Added language links between the English and Russian README files.

### Installation

Download the [`v0.4.0` archive](https://github.com/demyanovvvv/opencode-target/releases/tag/v0.4.0),
extract it, and run `sh install.sh` (Linux/macOS) or
`powershell -ExecutionPolicy Bypass -File .\install.ps1` (Windows). Node.js 22+ is required.
The installer installs the Target runtime, enables the TUI indicator, and preserves existing
OpenCode TUI settings. Restart OpenCode and start a new session.

For more details, see the [English README](https://github.com/demyanovvvv/opencode-target/blob/v0.4.0/README.md)
or the [Russian README](https://github.com/demyanovvvv/opencode-target/blob/v0.4.0/README.ru.md).

## [0.3.0] - 2026-09-27

### Fixed

- Fixed local plugin slash-command execution so `/target` commands no longer fail with an
  undefined handler in the generated artifact.
- Accepted OpenCode SDK `session.deleted` events whose session ID is stored at
  `properties.info.id`.
- Made `/target help` use configured `command_name` and `alias` values.
- Enforced terminal immutability for completed Targets.
- Extended generated-plugin verification to execute the slash-command hook.
- Added a bounded `host_api_timeout_ms` for OpenCode messages, children, and prompt calls so a
  hanging host API cannot leave continuation in flight forever.
- Made continuation failure handling fail-closed: typed host/provider failures pause after bounded
  retries and unexpected continuation exceptions block the Target instead of leaving it active.

## [0.2.0] - 2026-09-24

### Changed

- **Breaking:** renamed the plugin from Mission to Target. The slash command is now `/target`
  (alias `/t`), model tools are `get_target` / `create_target` / `update_target` /
  `add_target_evidence` / `verify_target_gate`, options use `max_target_token_budget`, the generated
  artifact is `dist/target.js`, and the default state directory is `opencode-target`. Update
  `opencode.json`, install scripts, and any `mission-*` plugin path references.
- Split `src/server.js` into focused modules — `commands`, `context-hooks`, `continuation`,
  `error-lifecycle`, `errors`, `event-routing`, `host`, `options`, `repository`, `tool-accounting`,
  `verification`, and `verification-gate` — each with dedicated unit coverage. `server.js` now holds
  only OpenCode hook wiring and thin dependency-binding wrappers (802 → ~484 lines).

### Added

- `SchedulerState.whenIdle` / `isSettled` and a `hooks.whenIdle` seam so embedders and tests can
  await the real continuation-completion signal instead of polling.
- `scripts/check-dist.mjs`, wired into `npm run check`, which imports the generated plugin and
  performs a real create/verify flow.
- Deterministic unit coverage for every extracted module and for the scheduler idle seam.
- `docs/remaining-work.md` tracking was retired; all listed items are complete.

### Fixed

- Smoke suites now await completion signals rather than fixed `Date.now()` deadlines, removing
  load-dependent flakiness.
- `TargetStore` retries transient Windows `rename` failures (`EPERM` / `EACCES` / `EBUSY`) with
  bounded exponential backoff for `write`, `read`, and `quarantine`, so continuation work is no
  longer discarded when another handle briefly holds the destination open.

## [0.1.1] - 2026-09-21

### Added

- Report verification totals and auto-refresh evidence fingerprints.

## [0.1.0]

### Added

- Initial persistent Goal-style runtime: durable objective state, six-status lifecycle, token/time
  accounting, automatic continuation loop, completion audit, budget enforcement, stale-write
  protection, descendant-session accounting, verification gates, and runaway-loop circuit breakers.

[0.4.0]: https://github.com/demyanovvvv/opencode-target/compare/v0.3.0...v0.4.0
[0.2.0]: https://github.com/demyanovvvv/opencode-target/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/demyanovvvv/opencode-target/compare/v0.1.0...v0.1.1
