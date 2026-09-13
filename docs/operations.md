# Operations Runbook

## Confirm installation

1. Confirm the plugin file exists in one of OpenCode's plugin locations:

   ```text
   ~/.config/opencode/plugins/mission.js
   .opencode/plugins/mission.js
   ```

   On Windows, the equivalent user location is normally:

   ```text
   %USERPROFILE%\.config\opencode\plugins\mission.js
   ```

2. Restart OpenCode.
3. Start a new session so the current tool list is loaded.
4. Run `/mission help`.

The plugin state directory is separate from the plugin installation directory. See
`docs/state-format.md`.

## Inspect current state

Use the command inside the affected session:

```text
/mission status
/mission budget
/mission doctor
```

The `get_mission` model tool returns the same persisted state with root and descendant usage.
Runtime logs are written through `client.app.log` and use the `opencode-mission` plugin identity.

`/mission doctor` separately reports persisted state, the messages API, and the child-session API.
An API error is not interpreted as an empty response, because doing so could hide usage or
descendant-session data.

If state JSON is malformed, Mission moves it to `<state_dir>/corrupt/` with a timestamp suffix and
raises a `MISSION_STATE_CORRUPT` diagnostic. Preserve that file before manual recovery.

## Mission is not continuing

Check these in order:

1. `/mission status` must report `active`.
2. Confirm `auto_continue` is not `false`.
3. Confirm the token budget has not reached `budget_limited`.
4. Check for `usage_limited`, `paused`, or `blocked` with `/mission status`.
5. Check whether a control command intentionally deferred one continuation.
6. Inspect OpenCode logs for a runtime error or a continuation scheduling failure.
7. If the Mission is paused or blocked, resolve the reason and run `/mission resume`.

If an OpenCode process exits while owning continuation, its persisted scheduler lease becomes
recoverable after `scheduler_lease_ms` (30 seconds by default). A later `session.idle` event can
then acquire the expired lease. Do not place the state directory on a shared network filesystem;
the lock and lease guarantees target processes on one host with a shared local state directory.

Run configured verification gates explicitly with `/mission verify` or `/mission verify <gate-id>`.
Gate commands come from trusted plugin configuration and execute in the current project directory.
A failed gate leaves its linked requirement open.

Verification retry settings are `maxAttempts`, `baseDelayMs`, and `maxDelayMs`. Keep them bounded;
retries are intended for transient host/provider failures, not for ordinary test or lint failures.
Use `/mission explain` to inspect the recorded attempt count.

Use `/mission checkpoint [summary]` before a risky phase to save a manual metadata marker. This is
not a Git commit and does not provide automatic rollback. If a later verification reports stale
evidence, rerun the affected gate after the worktree reaches the intended state.

Do not mark a Mission active by hand in JSON while a previous turn may still be finishing.

Runtime limits can be configured with `max_automatic_turns`, `max_active_seconds`, and
`max_no_progress_turns`. A reached limit produces `usage_limited` with a specific stop reason.
Changing token budget does not remove these limits; update configuration and explicitly resume only
after confirming the Mission should continue.

For evidence-backed Missions, inspect `/mission status` before completion. The status output shows
the number of verified requirements. A model must use `add_mission_evidence` for each declared
requirement; a completion request with missing evidence is rejected and leaves the Mission active.

## Budget limited

Budget exhaustion is a deterministic runtime transition:

```text
/mission budget 300000
/mission resume
```

Changing the budget alone does not resume a Mission. Resume remains `budget_limited` when
`tokensUsed >= tokenBudget`. A one-time wrap-up turn may report progress and the next action,
but it must not start new substantive Mission work.

## Usage limited or interrupted

- Rate, quota, and usage-limit errors transition an active Mission to `usage_limited`.
- Abort, cancel, and interruption errors transition an active Mission to `paused`.
- Other runtime errors transition an active Mission to `blocked`.

After the external condition is resolved, use `/mission resume`. Resume does not bypass an
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
5. Restore the original file or clear the Mission only after deciding whether its objective and accounting can be discarded.

The state format and recovery constraints are documented in `docs/state-format.md`.
