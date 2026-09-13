# Persisted State Format

Mission stores one JSON document per OpenCode session. The file is selected by a URL-safe
base64 encoding of the session ID:

```text
Linux/macOS: ~/.local/state/opencode-mission/missions/<encoded-session>.json
Windows:     %LOCALAPPDATA%\opencode-mission\missions\<encoded-session>.json
```

The state directory can be overridden with `OPENCODE_MISSION_STATE_DIR`.

Malformed or schema-invalid state is never treated as an absent Mission. The runtime atomically
moves it to `<state_dir>/corrupt/<original>.<timestamp>.<id>.corrupt` and reports
`MISSION_STATE_CORRUPT` so an operator can inspect or restore it explicitly.

## Schema

The current persisted schema version is `3`. The implementation normalizes loaded state to the
current shape before using it.

| Field | Type | Meaning |
|---|---|---|
| `version` | number | Current schema version, currently `3`. |
| `sessionID` | string | Root OpenCode session owning the Mission. |
| `missionID` | string | Unique logical Mission generation. Used by stale-write guards. |
| `objective` | string | User-provided objective, normalized and limited to 4000 characters. |
| `status` | string | One of `active`, `paused`, `blocked`, `usage_limited`, `budget_limited`, `complete`. |
| `tokenBudget` | positive integer or null | Mission token limit, or unbounded when null. |
| `tokensUsed` | integer | Combined root and descendant billable tokens. |
| `rootTokensUsed` | integer | Billable tokens from the root session. |
| `descendantTokensUsed` | integer | Billable tokens from linked child sessions. |
| `timeUsedSeconds` | integer | Active Mission wall-clock time in seconds. |
| `createdAtMs` | number | Mission creation timestamp in milliseconds. |
| `updatedAtMs` | number | Last persisted update timestamp. |
| `lastStatusChangeAtMs` | number | Timestamp of the latest lifecycle status change. |
| `activeStartedAtMs` | number or null | Start of the current active interval. |
| `accumulatedActiveMs` | number | Completed active intervals in milliseconds. |
| `continuationCount` | integer | Number of automatic continuation turns started. |
| `schedulerLease` | object or null | Current continuation owner, acquisition time, and expiry. Only the matching owner may renew, release, or start the leased turn. |
| `limits` | object | Persisted runtime limits: `maxAutomaticTurns`, `maxActiveSeconds`, and `maxNoProgressTurns`; each is a positive integer or null. |
| `requirements` | array | Declared acceptance requirements. Each item has an `id`, `text`, `status`, and bounded evidence list. |
| `verification` | array | Trusted configured gates with `id`, `command`, optional `requirementID`, and bounded retry policy. |
| `evidenceFingerprint` | string or null | Last worktree fingerprint associated with evidence. A changed fingerprint invalidates prior evidence. |
| `journal` | array | Bounded lifecycle decision history, limited to the most recent 200 events. |
| `checkpoints` | array | Bounded manual checkpoint metadata; checkpoints never create commits or perform rollback. |
| `verificationSummary` | object | Report-only aggregate of persisted verification events: total, passed, failed, and attempts. |
| `continuationDeferrals` | integer | Pending one-shot deferrals from control commands. |
| `lastContinuationAtMs` | number or null | Timestamp of the latest continuation start. |
| `lastError` | string or null | Latest runtime error, when present. |
| `stopReason` | string or null | Reason the Mission was stopped or blocked. |
| `budgetWrapupSent` | boolean | Whether the one-time budget wrap-up turn was sent. |
| `usageByMessage` | object | Cumulative per-message accounting baselines keyed by `sessionID:messageID`. |
| `runtime` | object | Breaker streaks, evaluated assistant IDs, and latest turn classification. |

## Accounting fields

For an assistant message, billable usage is:

```text
max(0, input - cache.read) + output
```

Plan-mode messages are excluded. `usageByMessage` stores the largest observed cumulative value
for each message. Later observations charge only the positive delta, which prevents duplicate
charges when OpenCode exposes partial or streaming token metadata.

The map is bounded by the implementation to prevent unbounded state-file growth.

## Safe recovery

- Do not change `missionID` manually while a session may still have callbacks in flight.
- Prefer `/mission pause`, `/mission budget`, `/mission resume`, or `/mission clear` over editing JSON.
- Stop OpenCode before moving or archiving state files.
- If a state file is malformed, preserve a copy for diagnosis and use `/mission clear` only after confirming that the Mission can be discarded.
- A stale lock can normally be recovered automatically after the lock timeout. Do not delete a lock while another OpenCode process may still be writing.

There is no general-purpose migration command. Schema changes must be implemented in
`normalizeMission`, covered by tests, and documented here before release.
