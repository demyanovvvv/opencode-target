# Operations Runbook

## Confirm installation

Run `sh install.sh` or `powershell -ExecutionPolicy Bypass -File .\install.ps1` from the archive.
Node.js 22+ is required. Both plugins and TUI registration are installed in one step, with no
dependency installation or manual JSON editing. The generated installer bundles its JSONC parser.
`OPENCODE_CONFIG_DIR` overrides the destination, followed by `XDG_CONFIG_HOME`; otherwise the
destination is `~/.config/opencode`. `OPENCODE_TUI_CONFIG` selects an explicit TUI config file.

1. Confirm the server plugin file exists in one of OpenCode's plugin locations:

   ```text
   ~/.config/opencode/plugins/target.js
   .opencode/plugins/target.js
   ```

   On Windows, the equivalent user location is normally:

   ```text
   %USERPROFILE%\.config\opencode\plugins\target.js
   ```

2. The install scripts also copy the TUI plugin and automatically register it in the global
   `tui.json` or `tui.jsonc`. Confirm that `target.js` exists under the TUI plugin directory:

   ```text
   ~/.config/opencode/tui-plugins/target.js
   ```

   The resulting registration is equivalent to:

   ```json
   { "$schema": "https://opencode.ai/tui.json", "plugin": ["./tui-plugins/target.js"] }
   ```

3. Restart OpenCode. TUI and server plugins are loaded at startup.
4. Start a new session so the current tool list is loaded.
5. Run `/target help`; the indicator appears under the prompt when the session has a Target.

Repeated installation preserves existing configuration and tuple options and does not append
duplicate plugin entries. It re-enables only `opencode-target-tui` when disabled. If both
`tui.json` and `tui.jsonc` exist, registration goes into `tui.jsonc` while considering entries from
both. Config parse errors stop the installer with a nonzero exit; repair the indicated file and
rerun. Files may already have been copied when configuration fails.

Rerunning an installer replaces both plugin files with the archive's versions and reports an update.
To uninstall completely, stop OpenCode and use `sh install.sh --uninstall` or
`powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall`. This removes installed Target
files, Target entries from all global JSON/JSONC server and TUI layers (plus an explicit TUI config),
and saved Target state. Custom tuple `state_dir` and `OPENCODE_TARGET_STATE_DIR` are also removed.
Configuration is validated before removal; unrelated plugin files and configuration are retained.

The TUI indicator is display-only. It polls the local state file and never performs lifecycle
transitions or state quarantine. A missing Target hides the indicator; an unreadable state shows
`Target · unavailable` until the next successful read.

The plugin state directory is separate from the plugin installation directory. See
`docs/state-format.md`.

## Inspect current state

Use the command inside the affected session:

```text
/target status
/target budget
/target doctor
```

The `get_target` model tool returns the same persisted state with root and descendant usage.
Runtime logs are written through `client.app.log` and use the `opencode-target` plugin identity.

`/target doctor` separately reports persisted state, the messages API, and the child-session API.
An API error is not interpreted as an empty response, because doing so could hide usage or
descendant-session data.

Completed Targets are terminal. If `/target pause`, `/target resume`, or another delayed control
operation is sent after completion, the command is rejected; start a new Target for a new
objective instead.

If state JSON is malformed, Target moves it to `<state_dir>/corrupt/` with a timestamp suffix and
raises a `TARGET_STATE_CORRUPT` diagnostic. Preserve that file before manual recovery.

## Target is not continuing

Check these in order:

1. `/target status` must report `active`.
2. Confirm `auto_continue` is not `false`.
3. Confirm the token budget has not reached `budget_limited`.
4. Check for `usage_limited`, `paused`, or `blocked` with `/target status`.
5. Check whether a control command intentionally deferred one continuation.
6. Inspect OpenCode logs for a runtime error or a continuation scheduling failure.
7. If the Target is paused or blocked, resolve the reason and run `/target resume`.

Host API calls have a bounded `host_api_timeout_ms` (30 seconds by default). A timeout is retried
according to `accounting_retry`; after the retry budget is exhausted, the active Target is paused
with a diagnostic stop reason instead of remaining indefinitely in an in-flight continuation.

Provider prompt failures follow the same fail-closed rule. Typed OpenCode prompt failures pause
the Target after bounded retries; unexpected continuation exceptions block it with a bounded
diagnostic reason. Neither path leaves an active Target eligible for an uncontrolled retry loop.

Prompt timeouts signal transport cancellation using the SDK's `AbortSignal`. Cancellation of
the request does not prove that OpenCode stopped its server-side turn. Until the original request
settles, Target refuses overlapping prompts and pauses with `OPENCODE_PROMPT_PENDING` rather than
retrying into an unknown running turn. The scheduler lease is released when this processing ends.
Check the `opencode-target` log entries `Target continuation prompt started`, `finished`, and
`failed`, including `sessionID`, `phase`, and error code. These entries do not include prompt text.
If the TUI cannot accept commands or Ctrl-C, restart OpenCode and inspect its logs before resuming.
The Orca status alone is not evidence that the session is making progress. Isolate server and TUI
plugins in a separate configuration to establish a conflict; no specific third-party conflict is
currently confirmed.

If an OpenCode process exits while owning continuation, its persisted scheduler lease becomes
recoverable after `scheduler_lease_ms` (30 seconds by default). A later `session.idle` event can
then acquire the expired lease. Do not place the state directory on a shared network filesystem;
the lock and lease guarantees target processes on one host with a shared local state directory.

Run configured verification gates explicitly with `/target verify` or `/target verify <gate-id>`.
Gate commands come from trusted plugin configuration and execute in the current project directory.
A failed gate leaves its linked requirement open.

Target also refreshes the Git fingerprint at idle and before model completion. If files changed
after a successful verification, `/target report` and `/target status` expose the resulting stale
or missing evidence and completion is rejected until the requirement is verified again.

Verification retry settings are `maxAttempts`, `baseDelayMs`, and `maxDelayMs`. Keep them bounded;
retries are intended for transient host/provider failures, not for ordinary test or lint failures.
Use `/target explain` to inspect the recorded attempt count.

Use `/target checkpoint [summary]` before a risky phase to save a manual metadata marker. This is
not a Git commit and does not provide automatic rollback. If a later verification reports stale
evidence, rerun the affected gate after the worktree reaches the intended state.

Do not mark a Target active by hand in JSON while a previous turn may still be finishing.

Runtime limits can be configured with `max_automatic_turns`, `max_active_seconds`, and
`max_no_progress_turns`. A reached limit produces `usage_limited` with a specific stop reason.
Changing token budget does not remove these limits; update configuration and explicitly resume only
after confirming the Target should continue.

For evidence-backed Targets, inspect `/target status` before completion. The status output shows
the number of verified requirements. A model must use `add_target_evidence` for each declared
requirement; a completion request with missing evidence is rejected and leaves the Target active.

## Budget limited

Budget exhaustion is a deterministic runtime transition:

```text
/target budget 300000
/target resume
```

Changing the budget alone does not resume a Target. Resume remains `budget_limited` when
`tokensUsed >= tokenBudget`. A one-time wrap-up turn may report progress and the next action,
but it must not start new substantive Target work.

## Usage limited or interrupted

- Rate, quota, and usage-limit errors transition an active Target to `usage_limited`.
- Abort, cancel, and interruption errors transition an active Target to `paused`.
- Other runtime errors transition an active Target to `blocked`.

After the external condition is resolved, use `/target resume`. Resume does not bypass an
exhausted budget.

## Circuit breaker

The runtime can set `blocked` after the configured threshold for either:

- consecutive failed execution turns without a successful tool call;
- consecutive empty automatic turns without meaningful activity or final text.

Inspect `runtime.failedExecStreak` and `runtime.emptyAutomaticStreak` in the status/tool output.
Resolve the underlying issue before resuming. Lowering thresholds can make a loop stop sooner;
raising them should be a deliberate configuration change.

## Stale lock or damaged state

1. Stop OpenCode and preserve the state directory.
2. Copy the affected JSON and lock files to an incident directory.
3. Wait at least the lock stale timeout before retrying if no process is writing.
4. Validate the JSON mechanically without modifying it.
5. Restore the original file or clear the Target only after deciding whether its objective and accounting can be discarded.

The state format and recovery constraints are documented in `docs/state-format.md`.
