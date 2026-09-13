---
name: mission-plugin-development
description: >-
  Develop OpenCode Mission without breaking its persistent lifecycle, token accounting,
  continuation scheduler, authority boundaries, or generated local plugin. Use for changes
  to src/core.js, src/server.js, plugin configuration, and lifecycle behavior.
---

# Mission Plugin Development

## Scope

OpenCode Mission is a JavaScript ESM plugin with two source layers:

- `src/core.js` owns durable state, locking, accounting, lifecycle transitions, command parsing, and prompts.
- `src/server.js` owns OpenCode hooks, model tools, event handling, child-session traversal, and scheduling.

Keep platform integration out of the core layer unless the behavior cannot be represented as a state operation.

## Invariants

- Only `active` missions are eligible for automatic continuation.
- User commands and runtime code own activation, resume, usage limits, and budget limits.
- Model tools may request only `complete`, `blocked`, or `paused`.
- `complete` requires a requirement-by-requirement verification audit in the model policy.
- `blocked` represents a repeated genuine blocker; runtime circuit breakers remain distinct.
- Every asynchronous mutation that can race a replacement mission must carry `expectedMissionID`.
- Token accounting is `max(0, input - cache.read) + output`, excludes plan-mode messages, and is delta-based per session/message.
- `dist/mission.js` is generated and must never be edited directly.

## Change workflow

1. Read `docs/architecture.md`, `docs/state-format.md`, and the relevant tests before editing.
2. Add or update a focused test in `test/core.test.js` or a server smoke test.
3. Preserve the existing authority split and stale-write guards.
4. Update `README.md` and the relevant docs when public behavior changes.
5. Run `npm run check`; this rebuilds `dist/mission.js` and runs unit plus smoke tests.

## Compatibility

The package targets `@opencode-ai/plugin >=1.18.30 <2.0.0`. Check `docs/compatibility.md` before changing hook or SDK usage.
