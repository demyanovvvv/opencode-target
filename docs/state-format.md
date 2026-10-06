# Persisted State Format

Target stores one JSON document per OpenCode session. The file is selected by a URL-safe
base64 encoding of the session ID:

```text
Linux/macOS: ~/.local/state/opencode-target/targets/<encoded-session>.json
Windows:     %LOCALAPPDATA%\opencode-target\targets\<encoded-session>.json
```

The state directory can be overridden with `OPENCODE_TARGET_STATE_DIR`.

Malformed or schema-invalid state is never treated as an absent Target. The runtime atomically
moves it to `<state_dir>/corrupt/<original>.<timestamp>.<id>.corrupt` and reports
`TARGET_STATE_CORRUPT` so an operator can inspect or restore it explicitly.

The persistence implementation uses a dedicated `TargetStore`; this does not change the on-disk
directory layout or the public lifecycle API.

Writes are atomic: state is written to a per-process temporary file and moved into place with
`rename`. On Windows, `rename` can transiently fail with `EPERM`, `EACCES`, or `EBUSY` while
another handle still has the destination open. `TargetStore` retries those codes with bounded
exponential backoff, and uses the same retry for quarantine moves. Non-transient filesystem
errors still fail immediately and are surfaced to the caller.

## Schema

The current persisted schema version is `3`. The implementation normalizes loaded state to the
current shape before using it. Unknown status values are schema corruption: they are quarantined
and never silently revived as `active` after restart. `sessionID` and `targetID` are required
identity fields; the stored `sessionID` must also match the session file being read.

Schema versions `2` and `3` are supported. Version `2` is normalized to the current version when
the state is next written. Missing, older, non-integer, and future schema versions are quarantined
instead of being interpreted with guessed semantics.

| Field | Type | Meaning |
|---|---|---|
| `version` | number | Current schema version, currently `3`. |
| `sessionID` | string | Root OpenCode session owning the Target. |
| `targetID` | string | Unique logical Target generation. Used by stale-write guards. |
| `objective` | string | User-provided objective, normalized and limited to 4000 characters. |
| `status` | string | One of `active`, `paused`, `blocked`, `usage_limited`, `budget_limited`, `complete`. |
| `tokenBudget` | positive integer or null | Target token limit, or unbounded when null. |
| `tokensUsed` | integer | Combined root and descendant billable tokens. |
| `rootTokensUsed` | integer | Billable tokens from the root session. |
| `descendantTokensUsed` | integer | Billable tokens from linked child sessions. |
| `timeUsedSeconds` | integer | Active Target wall-clock time in seconds. |
| `createdAtMs` | number | Target creation timestamp in milliseconds. |
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
| `accounting` | object | Watermark completeness metadata: tracked messages, entry cap, and whether history was truncated. |
| `continuationDeferrals` | integer | Pending one-shot deferrals from control commands. |
| `lastContinuationAtMs` | number or null | Timestamp of the latest continuation start. |
| `lastError` | string or null | Latest runtime error, when present. |
| `stopReason` | string or null | Reason the Target was stopped or blocked. |
| `budgetWrapupSent` | boolean | Whether the one-time budget wrap-up turn was sent. |
| `usageByMessage` | object | Cumulative per-message accounting baselines keyed by `sessionID:messageID`. |
| `runtime` | object | Breaker streaks, evaluated assistant IDs, and latest turn classification. |

`runtime.evaluatedThroughMs` is the completed-message watermark; the bounded recent ID list
deduplicates messages at its boundary. `runtime.pendingAutomaticAtMs` marks an automatic dispatch
whose result is not classified yet. Missing fields normalize to zero/null in schemas 2 and 3.

## Accounting fields

For an assistant message, billable usage is:

```text
max(0, input - cache.read) + output
```

Plan-mode messages are excluded. `usageByMessage` stores the largest observed cumulative value
for each message. Later observations charge only the positive delta, which prevents duplicate
charges when OpenCode exposes partial or streaming token metadata.

For a message whose creation timestamp predates the Target, the first observation is a baseline
even if OpenCode did not expose it during activation. Its current cumulative value is stored without
charge; future positive deltas remain billable.

The map is bounded by the implementation to prevent unbounded state-file growth.
At Target creation, the complete pre-Target snapshot is installed in `usageByMessage` in the same
locked write as the new active state. Creation is rejected with `TARGET_BASELINE_TOO_LARGE` if
that snapshot cannot fit the watermark capacity; no partial Target file is written.

## Safe recovery

- Do not change `targetID` manually while a session may still have callbacks in flight.
- Prefer `/target pause`, `/target budget`, `/target resume`, or `/target clear` over editing JSON.
- Stop OpenCode before moving or archiving state files.
- If a state file is malformed, preserve a copy for diagnosis and use `/target clear` only after confirming that the Target can be discarded.
- A stale lock can normally be recovered automatically after the 15-second stale threshold. Lock
  acquisition waits long enough to cross that threshold before timing out. Do not delete a lock
  while another OpenCode process may still be writing.

There is no general-purpose migration command. Schema changes must be implemented in
`normalizeTarget`, covered by tests, and documented here before release.
