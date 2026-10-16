# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-10-16

Automatic native context compaction for active Targets. Set a token or percentage threshold,
and Target requests OpenCode's standard `/compact` while preserving the full durable objective.

### Added

- `/target context 100k` and `/target context 70%` (also `/t context`) to enable threshold-driven
  native compaction for the active root Target. Token units, cached context and model-window
  changes are supported independently of the cumulative Target token budget.
- `context on`, `off`, `status` and `reset`, plus `context default` settings for new sessions.
  Session settings survive restart and goal clearing; the feature starts disabled.
- Durable request fences, bounded retries, restart reconciliation and diagnostic events.
  Manual compaction is observed, pending requests gate continuation, and undersized thresholds
  cannot cause an immediate compaction loop.
- Source and generated-plugin integration coverage for one compaction followed by one configured
  continuation, including the native compaction hooks and disabled automatic continuation.

### Fixed

- Import system-policy and compaction-context helpers in the source server plugin so durable
  Target preservation works consistently in package and self-contained installations.
- Exclude compaction summaries from work-progress streaks and pending automatic-turn classification
  while retaining their normal token accounting.
- Prevent budget wrap-up prompts from overlapping a pending compaction request.

### Install or update

Requires Node.js 22+ and compatible OpenCode; see the [compatibility matrix](https://github.com/demyanovvvv/opencode-target/blob/v0.7.0/docs/compatibility.md).
Download the attached `opencode-target-0.7.0.tgz`, extract it and open the `package` directory.

**Linux / macOS:**

```sh
sh install.sh
```

**Windows PowerShell:**

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Choose the existing local or global scope when updating. Unattended global update:
`sh install.sh --global` or `powershell -ExecutionPolicy Bypass -File .\install.ps1 -Global`.
Goals, scoped state paths and unrelated settings are preserved. Restart OpenCode after updating.

Enable in the current dialogue with `/target context 100k` (or `70%`). Use
`/target context default 100k` for future sessions, and `/target context reset` to apply defaults
to an existing dialogue. No summary profile is needed: OpenCode generates its standard summary.
`context off` leaves OpenCode's own overflow compaction enabled.

Verification: 176 tests, all smoke suites, source/generated integration checks, deterministic
build and isolated archive installation. Provider-facing behavior is covered by a controlled host
client and the tagged OpenCode API contract, not a live provider run.

[English instructions](https://github.com/demyanovvvv/opencode-target/blob/v0.7.0/README.md) ·
[Русская инструкция](https://github.com/demyanovvvv/opencode-target/blob/v0.7.0/README.ru.md)

**Full changelog:** https://github.com/demyanovvvv/opencode-target/compare/v0.6.0...v0.7.0

## [0.6.0] - 2026-10-11

Persistent goals for OpenCode with automatic continuation, token budgets, and evidence-based completion checks.
This release adds scoped installation, archive updates, and complete scoped removal, and ships
the stock OpenCode TUI indicator without rebuilding the host executable.

### Added

- Installers and uninstallers offer local/project or global/user scope, with unattended scope flags.
- Archive updates report old and new versions and preserve scoped state and JSONC settings.
- Local installations isolate goals and take precedence over global plugins in their project.
- Full uninstall removes installation metadata, scoped goals, registrations and empty owned files/directories.
- Include standalone English/Russian uninstall scripts in release packages and verify both scopes.

### Changed

- Use the stock `session_prompt_right` TUI slot with compact status, animation and token usage.
- Account for token usage incrementally at tool boundaries and across descendant sessions.
- Replace host build/coordination integration with self-contained server and TUI plugins.
- Refresh English/Russian documentation, navigation, repository description and relevant topics.

### Fixed

- Prevent overlapping automatic prompts and cancel timed-out prompt transport.
- Preserve custom state paths during uninstall and support legacy version-only installation metadata.
- Resolve the same installation state path for both server and TUI; local installations suppress
  global plugin hooks and indicators in their project.

### Install, update and uninstall

Requires Node.js 22+ and compatible OpenCode; see the [compatibility matrix](https://github.com/demyanovvvv/opencode-target/blob/v0.6.0/docs/compatibility.md).
Download the attached `opencode-target-0.6.0.tgz`, extract it and open the `package` directory.

```sh
sh install.sh
# Russian output: sh install.ru.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
# Russian output: use .\install.ru.ps1
```

Choose local/project or global/user scope. For unattended installation, pass `--local --project-dir <path>`
or `--global` on Shell; `-Local -ProjectDir <path>` or `-Global` on PowerShell.
To update, stop OpenCode and run this archive's installer with the same scope; settings and goals remain.
To remove, stop OpenCode and run `uninstall.sh` / `uninstall.ps1` (or Russian variants) with that scope.
Local goals live in `<project>/.opencode/target/state`; legacy shared goals remain global.
Restart OpenCode and start a new session after installation or update.

[English instructions](https://github.com/demyanovvvv/opencode-target/blob/v0.6.0/README.md) ·
[Русская инструкция](https://github.com/demyanovvvv/opencode-target/blob/v0.6.0/README.ru.md)

**Full changelog:** https://github.com/demyanovvvv/opencode-target/compare/v0.5.0...v0.6.0

## [0.5.0] - 2026-09-30

This release adds separate English and Russian installation paths for OpenCode Target.

### Added

- Added Russian installer scripts `install.ru.sh` and `install.ru.ps1` with Russian terminal output.
- Added smoke coverage for both installer languages, including registration, idempotence, and
  malformed-config protection.

### Documentation

- Updated both READMEs with language-specific installation commands for Linux/macOS and Windows.
- Included all four installer scripts in the package and release checklist.

### Installation

Download the [`v0.5.0` archive](https://github.com/demyanovvvv/opencode-target/releases/tag/v0.5.0)
and extract it. Use `sh install.sh` (Linux/macOS) or
`powershell -ExecutionPolicy Bypass -File .\install.ps1` (Windows) for English; use
`sh install.ru.sh` or `powershell -ExecutionPolicy Bypass -File .\install.ru.ps1` for Russian.
Node.js 22+ is required. Restart OpenCode and create a new session after installation.

See the [English README](https://github.com/demyanovvvv/opencode-target/blob/v0.5.0/README.md)
or [Russian README](https://github.com/demyanovvvv/opencode-target/blob/v0.5.0/README.ru.md).

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

[0.7.0]: https://github.com/demyanovvvv/opencode-target/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/demyanovvvv/opencode-target/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/demyanovvvv/opencode-target/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/demyanovvvv/opencode-target/compare/v0.3.0...v0.4.0
[0.2.0]: https://github.com/demyanovvvv/opencode-target/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/demyanovvvv/opencode-target/compare/v0.1.0...v0.1.1
