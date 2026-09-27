# OpenCode Target

**Persistent, verified multi-turn objectives for OpenCode.**

OpenCode Target is a standalone OpenCode plugin inspired by the architecture and behavior of Codex `/goal`. It is not a prompt alias. A Target is durable state with its own lifecycle, token/time accounting, automatic continuation loop, completion audit, budget enforcement, stale-write protection, and runaway-loop circuit breakers.

Primary command:

```text
/target <objective>
```

Short alias:

```text
/t <objective>
```

## Why Target exists

A normal coding-agent request lives inside one model turn. Even a strong instruction such as “keep going until everything passes” can be forgotten after compaction, prematurely summarized, narrowed to an easier subproblem, or simply ended by the model.

Target separates the durable objective from conversation history:

```text
User /target
      |
      v
Persistent Target state
      |
      +--> system policy
      +--> token + time accounting
      +--> verification contract
      +--> circuit breakers
      |
      v
OpenCode turn
      |
      v
session.idle
      |
      +-- Target active? --> start a new physical turn --> repeat
      |
      +-- stopped? --------> stop
```

The model can end a turn. It cannot silently end an active Target.

## Installation

### Local plugin — recommended for this archive

1. Copy `dist/target.js` into either:

```text
~/.config/opencode/plugins/target.js
```

or, for one project:

```text
.opencode/plugins/target.js
```

2. Restart OpenCode. Local plugin files are loaded at startup.

3. Start a **new OpenCode session** after installing or updating the plugin so the session receives the current tool list.

`dist/target.js` is self-contained except for the OpenCode-provided `@opencode-ai/plugin` package.

The plugin installation directory and Target state directory are different locations. On Windows,
the user plugin location is normally `%USERPROFILE%\\.config\\opencode\\plugins\\target.js`; Target
state is stored separately under `%LOCALAPPDATA%\\opencode-target\\`. See
[`docs/operations.md`](docs/operations.md) and [`docs/state-format.md`](docs/state-format.md).

Install scripts are available for archive installs:

```text
sh install.sh
powershell -ExecutionPolicy Bypass -File .\\install.ps1
```

### Package form

The package is private and is not published to npm. Install it from the repository or a locally
built tarball (`npm pack`), then configure:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-target"]
}
```

OpenCode's plugin API also accepts an options tuple. Example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-target",
      {
        "max_target_token_budget": 200000,
        "auto_continue": true,
        "min_continue_interval_ms": 250,
        "verification": [
          { "id": "tests", "command": "npm test", "requirementID": "tests" }
        ]
      }
    ]
  ]
}
```

## Commands

```text
/target <objective>
/t <objective>
```

Create a new active Target. A new Target may replace only a completed Target; an unfinished Target must be completed or cleared first.

```text
/target --budget 120000 <objective>
```

Start with an explicit token budget.

```text
/target
/target status
```

Show current Target state.

```text
/target doctor
```

Diagnose persisted state and the OpenCode message/child-session APIs. Invalid plugin options fail
at startup instead of being silently coerced. A malformed JSON state file is moved into the
`corrupt/` directory under the configured state directory and reported as an error rather than
being treated as an absent Target.

```text
/target edit <new objective>
```

Edit the objective without silently changing lifecycle status. A completed Target is immutable; start a new Target instead, which gives it a fresh `target_id` and resets usage.

```text
/target pause
/target pause waiting for external API access
```

Pause it.

```text
/target resume
```

Resume a paused/blocked/usage-limited Target. Resume resets runtime streak audits. An exhausted Target remains `budget_limited` until its budget is increased or removed.

```text
/target budget
/target budget 250000
/target budget off
```

View/change the token budget. Changing budget does **not** itself resume the Target. `budget off` is available only when `max_target_token_budget` is not configured; when a maximum/default budget is configured, every Target remains capped by that configured limit.

```text
/target clear
```

Delete persisted Target state.

```text
/target help
```

Show command help.

## Model tools

Target registers three tools, intentionally mirroring the authority split of Codex Goal:

When `create_target` receives explicit acceptance requirements, Target persists them and exposes
`add_target_evidence`. Every declared requirement must have evidence before the model can mark the
Target complete. Targets without declared requirements retain the existing completion policy.

### `get_target`

Returns the persisted Target, status, token budget, root/descendant token usage, active time and remaining tokens.

### `create_target`

Creates a Target only when Target mode was explicitly requested. Ordinary tasks must not be silently converted into Targets.

### `update_target`

The model can request only:

```text
complete
blocked
paused
```

It **cannot** use this tool to set:

```text
active
usage_limited
budget_limited
```

Those transitions belong to the user/runtime.

`paused` is allowed only when the user explicitly asks to pause. `blocked` is reserved for a repeated genuine impasse. `complete` requires a verification audit.

## State machine

```text
                         user/runtime
                 +-------------------------+
                 |                         |
                 v                         |
              active --------------------> paused
                |  \                       |
                |   \                      | resume
                |    +-------------------> blocked
                |                           |
                |    +-------------------> usage_limited
                |                           |
                |                           +-------> active
                |
                +---- budget exhausted --> budget_limited
                |
                +---- verified done -----> complete
```

Persisted statuses:

- `active`
- `paused`
- `blocked`
- `usage_limited`
- `budget_limited`
- `complete`

Only `active` is eligible for automatic continuation.

`budget_limited` has precedence over `paused` and `blocked`. A simple resume cannot bypass an exhausted budget.

## Verification semantics

Every automatic continuation receives fresh internal Target context. The policy tells the model to:

- preserve the **full** requested end state rather than shrink scope to an easier green subset;
- inspect authoritative current state (worktree, tests, processes, artifacts, external state) rather than rely on stale narrative context;
- distinguish meaningful progress, verified waiting, and no progress;
- treat completion as unproven until every explicit requirement has matching current evidence;
- avoid equating “I found no obvious problem” with proof that a broad requirement is satisfied;
- call `update_target(complete)` only when all required work is verified complete;
- use `blocked` only after the same genuine blocker persists across at least three consecutive Target turns and no meaningful alternative remains;
- never self-pause merely because work is difficult, lengthy, uncertain, or would benefit from clarification.

The original objective is wrapped as untrusted user task data so the internal control policy remains structurally distinct from the objective text.

## Continuation loop

Target uses `session.idle` as the scheduling boundary.

At idle it:

1. reloads the persisted Target;
2. evaluates newly finished root assistant turns;
3. accounts root and descendant-session token deltas;
4. checks budget/status/circuit breakers;
5. consumes any control-command continuation deferral;
6. if still `active`, atomically records a continuation start;
7. sends a new synthetic Target context with `session.prompt()`;
8. waits for that physical OpenCode turn to finish;
9. accounts and classifies it;
10. schedules the next continuation only if the same `target_id` remains active.

This is deliberately a sequence of separate physical turns rather than recursive prompting inside one turn.

## Stale-write protection

Every Target has a unique `target_id`.

Asynchronous accounting/status operations carry the expected ID. If an old callback from Target A arrives after Target B replaced it, the operation is discarded instead of mutating the new state.

This protects against the classic race:

```text
Target A turn still finishing
          |
          +---------- late usage/status callback
          |
user completes A and starts Target B
          |
          v
Target B must not receive A's mutation
```

## Token accounting

Target follows the important Codex Goal accounting rule as closely as OpenCode's exposed token data allows:

```text
billable target tokens = max(0, input - cached_input) + output
```

Properties:

- cached input is subtracted;
- plan-mode assistant messages are excluded;
- message accounting is delta-based and idempotent, so streaming/partial updates do not double-count;
- a pre-Target assistant turn first exposed after activation establishes a zero-charge watermark, then only later token growth is charged;
- root session and descendant-session usage are tracked separately;
- descendant sessions are discovered recursively through OpenCode parent/child session relationships;
- reaching a traversal depth/session cap fails the accounting pass instead of accepting partial usage;
- Target activation writes the pre-Target usage baseline atomically with the new state;
- the Target budget uses the combined root + descendant total.

The state records per-message cumulative usage keys only for accounting correctness; the map is bounded to prevent unbounded state-file growth.

## Budget enforcement

If accounting crosses the Target token budget while status is active, the same persisted update sets:

```text
status = budget_limited
```

Automatic continuation then stops.

Target sends one budget-wrapup turn instructing the model not to begin new substantive Target work and to report useful progress, remaining work, and a clear next action.

A budget change alone does not reactivate the Target:

```text
/target budget 300000
/target resume
```

If tokens already used are still greater than or equal to the new budget, resume normalizes back to `budget_limited`.

## Runaway-loop protection

Target includes two independent runtime circuit breakers, both defaulting to a threshold of 3.

### Repeated failed execution

When a Target turn has a failed execution tool call and **no successful tool call**, the failed-exec streak increases. A successful tool call resets it. At the threshold, the runtime marks the Target `blocked`.

### Empty automatic continuations

Only automatic Target continuation turns count. If a continuation produces neither meaningful activity nor final text, the empty-auto streak increases. Ordinary user turns do not count. At the threshold, the Target is runtime-blocked.

Turn classification is idempotent by assistant message ID, preventing duplicate event delivery from incrementing streaks twice.

## Interrupt/error behavior

For an active Target:

- abort/cancel/interruption -> `paused`;
- rate/quota/usage-limit error -> `usage_limited`;
- other session runtime error -> `blocked`;
- an explicit rate/quota/usage-limit error may supersede `budget_limited`, matching Codex; pause/blocked transitions do not.

This coupling matters because aborting inference while leaving the Target `active` would cause the idle scheduler to immediately restart it.

## Compaction

The JSON Target state, not conversation history, is the source of truth. During OpenCode compaction the plugin injects a durable Target summary containing ID, objective, status, budget/usage, elapsed time and continuation count.

While an active Target owns continuation, OpenCode's generic compaction auto-continue is disabled to avoid two competing continuation mechanisms.

## Persistence

Default state location:

Linux/macOS:

```text
~/.local/state/opencode-target/
```

Windows:

```text
%LOCALAPPDATA%\\opencode-target\\
```

Override:

```text
OPENCODE_TARGET_STATE_DIR=/some/path
```

Each session has one JSON state file. Writes use a per-session file lock plus temporary-file rename. Stale locks are recoverable after a timeout. Automatic continuation also uses a persisted owner lease, preventing two OpenCode plugin processes that share the same local state directory from starting the same physical turn.

## Plugin options

| Option | Default | Meaning |
|---|---:|---|
| `auto_continue` | `true` | Automatically create another physical turn when an active Target becomes idle |
| `host_api_timeout_ms` | `30000` | Maximum time for an OpenCode messages, children, or prompt API call before it becomes a retryable host failure |
| `max_target_token_budget` | none | Maximum and default budget for newly created Targets, matching Codex's `max_goal_token_budget` behavior |
| `min_continue_interval_ms` | `250` | Minimum interval between automatic continuations |
| `failed_exec_threshold` | `3` | Consecutive qualifying failed-exec Target turns before runtime block |
| `empty_auto_threshold` | `3` | Consecutive empty automatic continuations before runtime block |
| `descendant_max_depth` | `6` | Maximum child-session depth; accounting fails closed if deeper descendants exist |
| `descendant_max_sessions` | `96` | Session safety cap; accounting fails closed before returning a partial snapshot |
| `accounting_retry` | `{ maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5000 }` | Bounded retry policy for transient OpenCode messages/children/prompt API failures |
| `scheduler_lease_ms` | `30000` | Persisted continuation ownership lease; minimum 1000 ms |
| `max_automatic_turns` | none | Runtime limit for automatic physical turns per Target |
| `max_active_seconds` | none | Runtime limit for active wall-clock seconds |
| `max_no_progress_turns` | none | Runtime limit for consecutive automatic turns with no activity or final text |
| `state_dir` | platform state dir | Override persisted Target directory |
| `command_name` | `target` | Main slash command |
| `alias` | `t` | Short slash alias; set `false` to disable |
| `verification` | `[]` | Trusted verification gates; commands are never read from Target objective data |

Configured gates run explicitly with `/target verify` or `/target verify <gate-id>`. They execute
in the current OpenCode project directory and record pass/fail evidence for the linked requirement.
Verification is not started automatically by continuation.

Verification evidence includes a best-effort worktree fingerprint made from `git HEAD` and
`git status --porcelain`. When the fingerprint changes, previous evidence becomes stale and the
linked requirement must be verified again. Use `/target checkpoint [summary]` to save bounded
checkpoint metadata without creating commits or rolling files back.
Target also refreshes the fingerprint automatically at session idle and before a model completion
request, so evidence can become stale without `/target verify` being the next command.

Verification gates may define a bounded retry policy:

```json
{ "id": "tests", "command": "npm test", "requirementID": "tests",
  "retry": { "maxAttempts": 3, "baseDelayMs": 250, "maxDelayMs": 5000 } }
```

Only transient timeout and network/provider errors are retried. A normal non-zero command exit is
recorded as failed without repeating the command.

`/target report` includes verification totals, total attempts, missing/stale evidence, failed gates,
and runtime stop reasons.

## Source layout

```text
src/core.js               durable state machine, accounting, prompts, command parser
src/store.js              atomic state store, locks, quarantine, Windows rename retry
src/repository.js         persistence repository mutation seam
src/ledger.js             token extraction, delta watermarks, root/descendant accounting
src/adapter.js            typed OpenCode and best-effort Git integration seams
src/scheduler.js          continuation exclusion, rechecks, heartbeats, whenIdle settling
src/traversal.js          complete bounded child-session usage traversal
src/continuation.js       continuation phase decisions and recheck behavior
src/verification.js       normalized verification result contract
src/verification-gate.js  trusted verification gate execution
src/options.js            plugin option parsing and validation
src/host.js               OpenCode host session adapter
src/errors.js             typed error classification
src/error-lifecycle.js    session.error lifecycle handling
src/event-routing.js      session event to action routing
src/context-hooks.js      compaction auto-continue suppression
src/tool-accounting.js    tool-boundary token accounting
src/commands.js           slash command handling
src/server.js             OpenCode hook wiring and dependency-binding wrappers
dist/target.js            self-contained local-plugin build
test/*.test.js            focused per-module unit tests
scripts/build-local.mjs
scripts/check-dist.mjs
```

## Development and operations

Install the pinned development dependency and run the complete verification gate. This includes
unit tests, server/continuation smoke tests, budget-wrap-up retry coverage, and restart recovery:

```text
npm install
npm run check
```

The full test command includes the core unit suite and server, continuation, budget-wrap-up, and
restart recovery smoke suites. Maintainer and
operator procedures are documented in:

- [`CHANGELOG.md`](CHANGELOG.md)
- [`docs/contributing.md`](docs/contributing.md)
- [`docs/operations.md`](docs/operations.md)
- [`docs/release.md`](docs/release.md)
- [`docs/security.md`](docs/security.md)
- [`docs/compatibility.md`](docs/compatibility.md)
- [`docs/state-format.md`](docs/state-format.md)

The project also includes project-local OpenCode skills under `.opencode/skills/` for plugin
development, verification, and documentation maintenance.

## What is intentionally close to Codex `/goal`

- durable objective separate from conversational history;
- six-status lifecycle;
- model/user/runtime authority split;
- automatic new physical turns while active;
- fresh continuation policy every turn;
- strict completion verification contract;
- three-turn semantic blocker rule in model policy;
- billable-token style accounting with cached input removed;
- descendant-agent/session usage in the root budget;
- budget-limited precedence and resume normalization;
- separate failed-exec and empty-auto circuit breakers;
- interrupt -> pause semantics;
- unique logical Target ID and expected-ID stale-write guards;
- compaction recovery from persisted state.

## OpenCode-specific differences / limits

OpenCode does not expose all of Codex's internal Goal runtime primitives, so exact byte-for-byte behavior is impossible from an external plugin.

1. **Slash control commands still create an OpenCode turn.** `command.execute.before` can replace command parts, but it does not expose a universal “handled/no LLM reply” switch. Target therefore produces a short synthetic control acknowledgement and uses continuation deferral so `/target status` or `/target pause` cannot accidentally launch work.

2. **Budget steering occurs at the next safe turn boundary.** Target can persist `budget_limited` at accounting/tool boundaries, but an external plugin cannot inject Codex's native in-flight runtime steering into an already executing model response. It sends one wrap-up turn once the session is idle.

3. **Descendant accounting is reconstructed.** Codex owns internal agent accounting directly. Target traverses OpenCode's parent/child session graph. Detached sessions that are not linked as descendants cannot be attributed safely.

4. **Runtime state is JSON rather than OpenCode's internal DB schema.** The semantics are preserved with atomic-ish file persistence, locking and `target_id` guards, but this is not a native OpenCode database table.

These are platform-boundary differences, not prompt shortcuts.

## Verification

The included test suite covers:

- lifecycle and fresh `target_id` replacement after completion;
- unfinished-Target replacement rejection;
- cached-token accounting formula;
- plan-mode exclusion;
- descendant split and idempotent message deltas;
- seeded activation baselines so pre-Target tokens are excluded;
- atomic budget crossing behavior;
- budget precedence, `usage_limited` override, proven-complete override, and resume normalization;
- stale expected-ID rejection;
- repeated failed-exec circuit breaker;
- empty-auto circuit breaker;
- turn-classification idempotence;
- resume audit reset;
- continuation deferral;
- command parsing;
- remaining-budget snapshots;
- per-module coverage for options, host adapter, error classification, event routing,
  `session.error` lifecycle, tool-boundary accounting, verification gates, context hooks, commands,
  repository, and continuation phases;
- scheduler idle settling (`whenIdle` / `isSettled`) and deterministic smoke completion.

Run:

```bash
npm test
```

or:

```bash
npm run check
```

## Reference architecture

Target was designed after reviewing the current OpenAI Codex Goal implementation (Goal tool spec/executor, runtime scheduler, accounting, persisted goal state and continuation steering) and the current OpenCode plugin/SDK interfaces.

Primary references:

- https://github.com/openai/codex/tree/main/codex-rs/ext/goal
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/spec.rs
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/tool.rs
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/runtime.rs
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/accounting.rs
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/templates/goals/continuation.md
- https://opencode.ai/docs/plugins/
- https://opencode.ai/docs/sdk/

## License

MIT
