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
```

The `get_mission` model tool returns the same persisted state with root and descendant usage.
Runtime logs are written through `client.app.log` and use the `opencode-mission` plugin identity.

## Mission is not continuing

Check these in order:

1. `/mission status` must report `active`.
2. Confirm `auto_continue` is not `false`.
3. Confirm the token budget has not reached `budget_limited`.
4. Check for `usage_limited`, `paused`, or `blocked` with `/mission status`.
5. Check whether a control command intentionally deferred one continuation.
6. Inspect OpenCode logs for a runtime error or a continuation scheduling failure.
7. If the Mission is paused or blocked, resolve the reason and run `/mission resume`.

Do not mark a Mission active by hand in JSON while a previous turn may still be finishing.

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
