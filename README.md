# OpenCode Target

[English](README.md) · [Русский](README.ru.md)

[Install](#installation) · [Update](#update) · [Uninstall](#uninstall) · [Commands](#commands) · [Options](#plugin-options) · [Troubleshooting](docs/operations.md)

[Releases](https://github.com/demyanovvvv/opencode-target/releases) · [Changelog](CHANGELOG.md) · [Compatibility](docs/compatibility.md) · [Architecture](docs/architecture.md) · [Issues](https://github.com/demyanovvvv/opencode-target/issues) · [MIT license](LICENSE)

**OpenCode plugin for persistent goals, automatic continuation, token budgets, and evidence-based completion checks.**

Latest release: [**v0.6.0**](https://github.com/demyanovvvv/opencode-target/releases/tag/v0.6.0) · [Download archive](https://github.com/demyanovvvv/opencode-target/releases/download/v0.6.0/opencode-target-0.6.0.tgz)

Target saves an objective outside the conversation history and starts another model turn while that
objective remains active. It tracks token usage and elapsed active time, supports requirement evidence
and explicitly requested verification commands, and stops on configured limits or repeated failures.
An animated TUI indicator shows the current state and token usage. Inspired by Codex `/goal`.

Completion is audited by the model using requirements and available evidence; Target does not guarantee
that an objective will be achieved or automatically run every verification command.

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

Choose the language for the installer output:

- [English installation](#automatic-installation--recommended)
- [Русская установка](README.ru.md#установка)

### Automatic installation — recommended

Requires Node.js 22+ and a compatible OpenCode version; see the [compatibility matrix](docs/compatibility.md).
Download [opencode-target-0.6.0.tgz](https://github.com/demyanovvvv/opencode-target/releases/download/v0.6.0/opencode-target-0.6.0.tgz),
extract it, and open the extracted `package` directory. Run the installer there; v0.6.0 includes
local/global scope selection and standalone uninstallers in both languages.

```sh
sh install.sh
```

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### Choose local or global scope

Both installer and uninstaller offer **Local (project)** or **Global (user)** when launched without scope arguments.
Local files go into `<project>/.opencode`; global files go into the user OpenCode config directory.
The local menu asks for a project directory (default: the current directory, not the archive directory).
For unattended runs (quote paths containing spaces):

```sh
sh install.sh --local --project-dir /path/to/project
sh install.sh --global
sh uninstall.sh --local --project-dir /path/to/project
sh uninstall.sh --global
```

```powershell
.\install.ps1 -Local -ProjectDir "C:\Projects\my-project"
.\install.ps1 -Global
.\uninstall.ps1 -Local -ProjectDir "C:\Projects\my-project"
.\uninstall.ps1 -Global
```

### Update

Stop OpenCode, download and extract the newer archive, then rerun its installer with the same scope
and project directory. Both plugins are replaced. Existing configuration
options and saved Targets are preserved; the installer reports the previous and archive versions,
for example `Updated OpenCode Target: 0.5.0 → 0.6.0`. It installs the archive version without downloading another release.
Restart OpenCode after updating.

### Uninstall

Stop OpenCode, then run `sh uninstall.sh` on Linux/macOS or
`powershell -ExecutionPolicy Bypass -File .\uninstall.ps1` on Windows and select the installed scope.
For compatibility, you can also use `sh install.sh --uninstall` on Linux/macOS or
`powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall` on Windows. Russian installers
accept the same flags. Separate `uninstall.sh` / `uninstall.ps1` and Russian variants are included.
Removal deletes both plugin files, Target registrations in the selected server/TUI configuration,
installation metadata, saved state, and empty plugin directories. Installer-created configs are
removed only if no user settings or comments remain. Repeated removal succeeds.
Other plugins and settings are preserved.

Local installations keep goals in `<project>/.opencode/target/state`; global installations retain
the existing system state directory, including legacy shared goals. Local removal never deletes
that legacy global store by default. Installed server and TUI plugins share the stored state path;
a local installation takes precedence over a global installation in its project.
Explicit `state_dir` settings and `--state-dir` / `-StateDir` are supported; deliberately sharing
a custom state directory also shares its deletion lifetime. Updates preserve the recorded state path.

### Installer languages and configuration

The installer prints its progress in English. To use the Russian installer instead, run:

Linux/macOS:

```sh
sh install.ru.sh
```

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ru.ps1
```

The installer copies **both the Target runtime and TUI indicator**, then creates or updates the
TUI configuration automatically. No manual config edit or `npm install` is needed.
Restart OpenCode and start a new session after installation.

Existing JSON/JSONC settings, comments, and plugin options are preserved. Reinstalling updates the
files without duplicating the TUI entry and re-enables `opencode-target-tui` if it was disabled.
When both config files exist, registration is written to `tui.jsonc` (the higher-precedence file).
Malformed config is reported as an installation error and is not overwritten.

For global scope, the destination respects `OPENCODE_CONFIG_DIR`, then `XDG_CONFIG_HOME`, then
`~/.config/opencode`. `OPENCODE_TUI_CONFIG` selects a custom TUI config file when set; the plugin
path is made relative to that file. Project-specific overrides still follow OpenCode's precedence.

### Manual installation

To install the current checkout with automatic scope selection, build the artifacts first:

```sh
npm ci
npm run build:local
```

Then run the installer commands above. Manual copying below installs only the server plugin and
uses the global default state store unless you explicitly configure `state_dir`.

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

### TUI indicator

The repository also builds `dist/target-tui.js`, a separate OpenCode TUI plugin. It uses the
stock `session_prompt_right` slot (verified in OpenCode 1.18.34), beside the prompt controls:
`│ ● Target: working · 16.6k`. No Target-specific OpenCode build is required;
the compact counter is the current Target's spent tokens. Long reasons and budget totals stay
in `/target status`. Narrow terminals drop the status label before the counter, without wrapping.
It reads local state every 500 ms. OpenCode's `animations_enabled` controls animation.

The installer adds this TUI registration automatically. For manual installation, add it to
`tui.json` alongside your existing settings:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["./tui-plugins/target.js"]
}
```

The install scripts copy this artifact to `<config-dir>/tui-plugins/target.js`, where `<config-dir>`
is the selected project `.opencode` or user OpenCode directory, and register it in that scope's `tui.json` or
`tui.jsonc`. Existing settings, comments, and plugin entries are preserved; repeating the
installer is idempotent. Restart OpenCode after installation. The indicator is display-only;
lifecycle control remains `/target pause`, `/target resume`, and the other Target commands.

For a manual installation, copy `dist/target-tui.js` to the path used in `tui.json`. For one project,
use `.opencode/tui-plugins/target.js` and `.opencode/tui.json` with the same relative-path example.
For a locally installed package, use `"plugin": ["opencode-target"]` in `tui.json`; the package's
`./tui` entrypoint resolves to the generated indicator.

Automatic installations use the same stored state path for the server and indicator.
Manually copied plugins use the global default state directory and `OPENCODE_TARGET_STATE_DIR`.
If the server
uses an explicit `state_dir`, supply the same **absolute** directory to the TUI plugin:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [["./tui-plugins/target.js", { "state_dir": "D:/TargetState" }]]
}
```

On Linux/macOS use an absolute path such as `/home/me/.local/state/opencode-target`. The indicator
uses local files and is intended for a local OpenCode instance. `waiting` means the Target is
active but the session is idle; it does not assert that automatic continuation is enabled.
Token figures are the last persisted accounting snapshot, not live token streaming or percentage
of objective completion. Narrow terminals omit token figures first. The line hides when there is
no Target or the TUI is on its home screen.

The plugin installation directory and Target state directory are different locations. On Windows,
the user plugin location is normally `%USERPROFILE%\\.config\\opencode\\plugins\\target.js`; Target
state is stored separately under `%LOCALAPPDATA%\\opencode-target\\`. See
[`docs/operations.md`](docs/operations.md) and [`docs/state-format.md`](docs/state-format.md).

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

### Automatic context compaction

```text
/target context default 100k           Default threshold for new sessions
/target context 100k                   Compact at 100,000 context tokens
/target context 70%                    Compact at 70% of the current model window
/target context [on|off|status|reset]   Control or inspect automatic compaction
```

While a Target is active, Target monitors the most recent completed model step and requests the
native OpenCode `/compact` mechanism through `session.summarize` when the threshold is reached.
OpenCode produces its standard summary; Target preserves the durable objective and resumes through
its existing scheduler. Token inputs accept `100000`, `100_000`, `100k`, `1.5m`; percentages accept
whole numbers from `1%` to `99%` and follow the currently selected model's context window.
The threshold triggers a request, so a busy session can exceed it before compaction is processed.

`/target context` or `status` shows enabled state, source, threshold, last measured context,
model window, pending request, errors and recent diagnostic events. Context size includes cached
tokens and is separate from cumulative Target budget usage. Summary input tokens are never treated
as the post-compaction context measurement. Child-session contexts are not added to the root.

`context 100k` or `70%` enables a session override. `off` retains the chosen threshold; `on` restores
it (a threshold must have been set). `reset` copies the current defaults. `context default` shows
defaults; `context default 70%`, `default off`, and `default on` update them for new sessions.
Defaults are scoped to the installation's state directory. Sessions snapshot defaults on first use
and retain their settings across restarts and `/target clear`; existing sessions use `reset` to
adopt changed defaults. The feature starts disabled. Settings can be changed before creating a goal.

Only active root Targets request compaction. Paused, stopped and completed goals do not trigger it.
With `auto_continue: false`, compaction still works but no new work turn is dispatched automatically.
Manual/native compaction is reconciled, duplicate requests are fenced, and an undersized threshold
does not cause an immediate compaction loop. Increase the threshold if status reports that the
first fresh context is still above it. Three explicit request failures or an uncertain result pause
the affected Target; inspect `context status` and `/target doctor` before resuming.
Disabling this feature does not disable OpenCode's own overflow compaction, which may trigger earlier.

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

Automatic local installation stores goals in `<project>/.opencode/target/state`.
Automatic global installation records its state path in `<config-dir>/target/package.json`;
updates keep that path. Both installed plugins read the same metadata.
The following defaults apply to global installations and manually copied plugins without metadata.

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
| `host_api_timeout_ms` | `30000` | Maximum time for a host API call; prompt timeouts signal transport cancellation. An unsettled previous prompt pauses Target instead of allowing overlapping continuations |
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
| `continuation_watchdog_ms` | `60000` | Check for a missing `session.idle` after async dispatch; pending permission/question requests defer the check |
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
- [Repository description and GitHub Topics](docs/repository-metadata.md)

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
