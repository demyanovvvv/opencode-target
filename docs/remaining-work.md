# Remaining Work

## Current state

The main architectural boundaries have already been extracted:

- persistence and repository;
- usage ledger;
- scheduler;
- continuation coordinator;
- plugin options;
- host session adapter;
- error classification;
- event routing;
- context hooks.

## Possible next steps

### 1. Continue decomposing `src/server.js`

The largest remaining integration areas are:

- slash-command handling (`/target` and `/t`);
- verification gate execution;
- `session.error` lifecycle handling;
- token accounting at tool boundaries.

All four listed integration areas have now been extracted:

- slash-command handling → `src/commands.js`;
- `session.error` lifecycle → `src/error-lifecycle.js`;
- token accounting at tool boundaries → `src/tool-accounting.js`;
- verification gate execution → `src/verification-gate.js`.

`server.js` retains the OpenCode hook wiring and thin dependency-binding wrappers. There is no
remaining high-value extraction target; further splitting would move glue rather than a separate
responsibility.

### 2. Avoid over-fragmentation

Some glue code should remain in `server.js`. Further extraction is worthwhile when the code has a
separate responsibility and can be tested independently without duplicating lifecycle semantics.

### 3. Keep generated build and documentation current

Every new source module must be included in:

- `scripts/build-local.mjs`;
- syntax checks in `package.json`;
- unit-test commands in `package.json`;
- relevant architecture documentation.

### 4. Review the accumulated diff before committing

The working tree contains changes from multiple refactoring stages. Before creating a commit,
review the complete diff and separate the intended changes from earlier work. No commit has been
created yet.

### 5. Windows atomic-write durability

`TargetStore.write` writes to a per-process temp file and renames it over the target. On Windows,
`rename` can transiently fail with `EPERM`/`EACCES`/`EBUSY` while another handle still has the
destination open, which previously discarded continuation work under load. `renameWithRetry`
now applies bounded exponential backoff for those codes and is used by `write`, `read`, and
`quarantine` (see `docs/state-format.md`). Non-transient codes still fail fast.

## Verification requirement

After each behavior or build change, run:

```text
npm run check
```

Also run `git diff --check` before reporting the work as complete.
