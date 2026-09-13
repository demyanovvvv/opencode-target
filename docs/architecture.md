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

The in-process scheduler deduplicates active work per plugin instance. A persisted owner lease also
coordinates multiple OpenCode plugin processes that share the same local state directory. The
lease has a heartbeat while a turn is in flight, expires after a crash, and is fenced by both
`mission_id` and owner before a continuation is counted or prompted. It is not a distributed lock
for multi-host or network-filesystem operation. Host API failures are explicit errors and are never
represented as empty message or child-session lists, because that would make accounting fail open.

## Accounting

Per assistant message:

```text
billable = max(0, input - cache.read) + output
```

The state stores the maximum previously observed billable count for each `(session_id, message_id)`. A later sample adds only a positive delta. This supports partially updated/streaming token metadata without double-counting.

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

The adapter computes a best-effort worktree fingerprint from Git HEAD and porcelain status before
recording a gate result. A mismatch invalidates prior evidence. Manual checkpoints store metadata
only; they deliberately do not mutate Git history or roll back user files.

- Semantic blocker: model judges the same external/user-input blocker has persisted for 3 consecutive Mission turns.
- Failed-exec breaker: runtime sees 3 qualifying turns with failed execution and no successful tool call.
- Empty-auto breaker: runtime sees 3 automatic continuations with no meaningful activity and no final text.

Runtime failures can stop a Mission immediately; they do not pretend to be the semantic blocker audit.
