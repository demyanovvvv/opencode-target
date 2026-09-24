---
name: target-verification
description: >-
  Verify OpenCode Target changes with fresh build, syntax, unit, and plugin continuation
  evidence before reporting success. Use after every behavior, build, or documentation change
  that can affect generated output or release readiness.
---

# Target Verification

## Required gate

Run the repository's complete check from the project root:

```text
npm run check
```

This command must:

- rebuild `dist/target.js` from `src/core.js` and `src/server.js`;
- syntax-check both source modules and the generated plugin;
- run `test/core.test.js`;
- run `test/server-smoke.mjs`;
- run `test/continuation-smoke.mjs`.

## Focused commands

Use these when diagnosing a failure:

```text
npm run test:unit
npm run test:smoke
npm run build:local
node --check src/core.js
node --check src/server.js
node --check dist/target.js
```

## Evidence rules

- Do not claim tests pass without running the relevant command in the current change.
- Read the complete command result and exit code.
- Treat generated `dist/target.js` changes as expected only when caused by source changes.
- If OpenCode API behavior is involved, verify against the target package version documented in `docs/compatibility.md`.
