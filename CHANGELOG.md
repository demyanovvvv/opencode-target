# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/demyanovvvv/opencode-target/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/demyanovvvv/opencode-target/compare/v0.1.0...v0.1.1
