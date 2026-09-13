---
name: mission-documentation
description: >-
  Maintain OpenCode Mission documentation for users, maintainers, and operators. Use when
  commands, plugin options, persistence, compatibility, security, release steps, or lifecycle
  semantics change.
---

# Mission Documentation

## Documentation map

- `README.md`: installation, quick start, commands, options, and user-visible semantics.
- `docs/architecture.md`: invariants, authority split, scheduler, accounting, and breakers.
- `docs/codex-parity.md`: behavior comparison and platform limitations.
- `docs/state-format.md`: persisted JSON fields, schema version, and recovery boundaries.
- `docs/operations.md`: diagnostics, state location, recovery, and incident runbooks.
- `docs/compatibility.md`: Node, OpenCode plugin API, and known compatibility boundaries.
- `docs/contributing.md`: development workflow and test expectations.
- `docs/release.md`: generated artifact, package, and release checklist.
- `docs/security.md`: trust boundaries, permissions, and sensitive state handling.

## Rules

- Document behavior, not implementation trivia.
- State the authority for every lifecycle transition.
- Keep examples copyable and use platform-correct paths.
- Update the README when a command or option changes.
- Update architecture/state docs when persistence or lifecycle invariants change.
- Record significant alternatives and constraints in an ADR rather than hiding them in comments.
