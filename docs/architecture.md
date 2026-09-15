# Mission Runtime Architecture

## Core invariant

An assistant turn ending is not equivalent to a Mission ending. Only persisted lifecycle state controls whether the scheduler continues.

## Control/data split

```text
CONTROL PLANE
/mission, /msn, runtime errors, budget enforcement
             |
             v
       Mission JSON state
       mission_id guard
             |
   +---------+----------+
   |                    |
   v                    v
MODEL PLANE          SCHEDULER
get_mission          session.idle
create_mission       reload state
update_mission       account usage
   |                 evaluate breakers
   |                    |
   +---------+----------+
             v
       next physical turn
```

## Authority table

| Transition | Model | User command | Runtime |
|---|---:|---:|---:|
| create active Mission | yes, only when explicitly requested | yes | no |
| complete | yes | no direct shortcut | no |
| semantic blocked | yes, after audit | no | no |
| pause | only explicit user request | yes | interrupt maps here |
| resume -> active | no | yes | validates budget |
| usage_limited | no | no | yes |
| budget_limited | no | no | yes |
| clear persisted state | no | yes | no |

## Logical concurrency

Every asynchronous mutation carries an expected `mission_id`. New Missions after completion receive a fresh ID. Late operations from an older lifecycle return without mutation.

## Scheduler boundaries

`session.idle` is the durable continuation boundary. `session.prompt()` is awaited for automatic continuations, giving Mission a physical-turn loop rather than an instruction for a single response to self-continue.

`SchedulerState` owns instance-scoped in-process exclusion, recheck timers, and lease heartbeat
timers. Session deletion clears that session's timers, while host disposal clears every pending
timer. A persisted owner lease also coordinates multiple OpenCode plugin processes that share the
same local state directory. The
lease has a heartbeat while a turn is in flight, expires after a crash, and is fenced by both
`mission_id` and owner before a continuation is counted or prompted. It is not a distributed lock
for multi-host or network-filesystem operation. A heartbeat may renew only a lease that has not
expired; an expired owner must compete through acquisition again. Host API failures, including malformed successful
payloads, are explicit errors and are never represented as empty message or child-session lists,
because that would make accounting fail open.

`collectSessionUsage` builds a complete bounded snapshot before any ledger mutation. Cycles and
duplicate child references are deduplicated. If the host graph extends beyond the configured depth
or session cap, traversal throws `ACCOUNTING_TRAVERSAL_INCOMPLETE`; partial samples are discarded
and automatic continuation does not start from an undercounted budget.

Mission creation first obtains that complete snapshot, then writes the new active state and its
message watermarks together under one session lock. A failed baseline read therefore leaves no
partially activated Mission that could later charge pre-Mission history.

Read-only live-accounting surfaces such as `get_mission` fail explicitly when the host snapshot is
unavailable; they do not return a stale-looking success payload. Background accounting hooks retain
their non-blocking behavior, but log a stable error code and phase and never mutate lifecycle state
as a side effect of telemetry failure.

Transient messages/children API failures use bounded exponential rechecks while retaining the
persisted lease fencing on each attempt. Exhausting that policy pauses the Mission with an explicit
accounting-unavailable reason. A deterministic incomplete traversal pauses immediately so changing
the traversal configuration and explicitly resuming remain user-controlled operations.

Prompt transport/protocol failures use the same bounded policy with a separate `prompt` retry scope.
An invalid prompt response is never treated as an empty assistant turn.

## Accounting

Per assistant message:

```text
billable = max(0, input - cache.read) + output
```

The state stores the maximum previously observed billable count for each `(session_id, message_id)`. A later sample adds only a positive delta. This supports partially updated/streaming token metadata without double-counting.

Attribution uses the assistant turn's creation time, not completion time. If a turn started before
Mission activation but was absent from the activation snapshot, its first later observation installs
a zero-charge watermark. Subsequent growth of the same message is charged normally, preserving
post-activation usage without charging work already performed before the Mission existed.

Root and child-session deltas are accumulated separately and combined for the budget.

## Runtime breakers

The model-facing `blocked` audit and runtime circuit breakers are deliberately separate concepts.

Runtime-owned multi-dimensional limits are evaluated independently of token budget: automatic turn
count, active wall-clock seconds, and consecutive no-progress turns. Reaching one persists
`usage_limited` with a specific stop reason and clears the scheduler lease; resume resets only
runtime audit streaks and does not bypass an exhausted limit.

Completion evidence is an opt-in contract. Requirements are user/model-declared task data, while
evidence is persisted through a separate tool. The runtime rejects `complete` when any declared
requirement is still open; it does not execute arbitrary verification commands or treat a model's
free-form completion reason as evidence.

Verification gates are separate trusted configuration. The OpenCode adapter executes only a
configured gate on an explicit request, then records its exit result as evidence. Automatic
continuation does not execute gates implicitly.

Gate retries use bounded exponential backoff and apply only to classified transient execution
errors. Normal command failures are final for that verification request. Attempt count and whether
a retry occurred are recorded in the lifecycle journal.

The adapter computes a best-effort worktree fingerprint from Git HEAD and porcelain status before
recording a gate result. A mismatch invalidates prior evidence. Manual checkpoints store metadata
only; they deliberately do not mutate Git history or roll back user files.

Persistence is exposed through the `MissionStore` module. Core lifecycle code remains responsible
for normalization and domain transitions, while the store owns atomic JSON writes, per-session
locking, corruption quarantine, and bounded filesystem recovery. This is the primary seam for
fault-injection and concurrency tests.

Token extraction and delta watermarks are exposed through `UsageLedger`. It owns cached-input
subtraction, plan-mode exclusion, root/descendant splitting, idempotent positive deltas, and the
bounded accounting watermark map. Core persists the resulting deltas and enforces Mission budget.

- Semantic blocker: model judges the same external/user-input blocker has persisted for 3 consecutive Mission turns.
- Failed-exec breaker: runtime sees 3 qualifying turns with failed execution and no successful tool call.
- Empty-auto breaker: runtime sees 3 automatic continuations with no meaningful activity and no final text.

Runtime failures can stop a Mission immediately; they do not pretend to be the semantic blocker audit.
