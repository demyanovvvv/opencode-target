# Target Runtime Architecture

## Core invariant

An assistant turn ending is not equivalent to a Target ending. Only persisted lifecycle state controls whether the scheduler continues.

## Control/data split

```text
CONTROL PLANE
/target, /t, runtime errors, budget enforcement
             |
             v
       Target JSON state
       target_id guard
             |
   +---------+----------+
   |                    |
   v                    v
MODEL PLANE          SCHEDULER
get_target          session.idle
create_target       reload state
update_target       account usage
   |                 evaluate breakers
   |                    |
   +---------+----------+
             v
       next physical turn
```

## Authority table

| Transition | Model | User command | Runtime |
|---|---:|---:|---:|
| create active Target | yes, only when explicitly requested | yes | no |
| complete | yes | no direct shortcut | no |
| semantic blocked | yes, after audit | no | no |
| pause | only explicit user request | yes | interrupt maps here |
| resume -> active | no | yes | validates budget |
| usage_limited | no | no | yes |
| budget_limited | no | no | yes |
| clear persisted state | no | yes | no |

## Logical concurrency

Every asynchronous mutation carries an expected `target_id`. New Targets after completion receive a fresh ID. Late operations from an older lifecycle return without mutation.

## Scheduler boundaries

`session.idle` is the durable continuation boundary. `session.prompt()` is awaited for automatic continuations, giving Target a physical-turn loop rather than an instruction for a single response to self-continue.

## Plugin configuration boundary

`normalizePluginOptions` owns validation and defaulting for the public plugin configuration. The
server integration consumes one frozen, normalized options object; lifecycle code does not parse
raw configuration values while a hook is running. Verification gate definitions and retry
policies are normalized at plugin creation time, so malformed configuration fails before hooks or
tools can mutate Target state.

## Host session boundary

`createHostSessionAdapter` provides a narrow messages/children/prompt interface for OpenCode
session operations. Server hooks and continuation coordination use that boundary rather than
depending on the raw client shape. Prompt envelope normalization remains a pure boundary helper;
host API failure typing and payload validation stay in `src/adapter.js`.

Error text extraction and classification for provider limits, interruptions, and retryable host
accounting failures live in `src/errors.js`. The server uses these classifications to select
existing lifecycle transitions and retry behavior; the module itself does not mutate state or
decide Target status.

`src/event-routing.js` maps host events to a small set of lifecycle actions before the server runs
the associated operation. It handles disposed instances, deleted sessions, idle continuations,
and session errors; routing itself has no state or scheduler side effects.

`src/error-lifecycle.js` owns the session-error transition. `resolveErrorStatus` is a pure
classifier that maps error text plus the current Target status to the next status, honoring that
usage limits supersede a just-crossed budget limit while pause/blocked do not override
`budget_limited`. `handleSessionError` accounts live usage first, rejects stale targets, then
persists the classified stop through injected operations; it never reads files directly and has
no scheduler side effects.

`src/tool-accounting.js` owns the lightweight root-session accounting performed after tool
execution. `accountToolBoundary` skips missing or non-accountable targets (only `active` and
`budget_limited` are accounted), maps root messages to usage samples, and delegates the write to
`accountTargetUsage`. Full descendant-tree accounting remains at idle and control boundaries.

`src/verification-gate.js` owns verification gate execution. `runGateCommand` applies the
normalized retry policy with exponential backoff, retrying only classified transient failures.
`executeVerificationGate` refreshes the worktree fingerprint, normalizes the command result, and
records it against the expected `targetID`, rejecting stale writes. The server retains only the
thin wrapper that binds the OpenCode shell runner and passes the core operations as dependencies.

Context hooks are isolated in `src/context-hooks.js`. They append the active Target policy to the
system transform, preserve Target state across compaction, and disable generic compaction
autocontinuation while an active Target owns the loop. These helpers only mutate OpenCode hook
outputs; persisted Target state remains owned by the core functions they call for reads.

Slash commands are coordinated by `src/commands.js`. The module owns command-to-operation
dispatch, while receiving host and runtime operations as explicit dependencies. `server.js` keeps
the OpenCode command hook and error-to-output adaptation; core state transitions, stale-target
guards, and accounting remain authoritative in their existing modules.

`SchedulerState` owns instance-scoped in-process exclusion, recheck timers, and lease heartbeat
timers. Session deletion clears that session's timers, while host disposal clears every pending
timer. A persisted owner lease also coordinates multiple OpenCode plugin processes that share the
same local state directory. The
lease has a heartbeat while a turn is in flight, expires after a crash, and is fenced by both
`target_id` and owner before a continuation is counted or prompted. It is not a distributed lock
for multi-host or network-filesystem operation. A heartbeat may renew only a lease that has not
expired; an expired owner must compete through acquisition again. Host API failures, including malformed successful
payloads, are explicit errors and are never represented as empty message or child-session lists,
because that would make accounting fail open.

`collectSessionUsage` builds a complete bounded snapshot before any ledger mutation. Cycles and
duplicate child references are deduplicated. If the host graph extends beyond the configured depth
or session cap, traversal throws `ACCOUNTING_TRAVERSAL_INCOMPLETE`; partial samples are discarded
and automatic continuation does not start from an undercounted budget.

Target creation first obtains that complete snapshot, then writes the new active state and its
message watermarks together under one session lock. A failed baseline read therefore leaves no
partially activated Target that could later charge pre-Target history.

Read-only live-accounting surfaces such as `get_target` fail explicitly when the host snapshot is
unavailable; they do not return a stale-looking success payload. Background accounting hooks retain
their non-blocking behavior, but log a stable error code and phase and never mutate lifecycle state
as a side effect of telemetry failure.

Transient messages/children API failures use bounded exponential rechecks while retaining the
persisted lease fencing on each attempt. Exhausting that policy pauses the Target with an explicit
accounting-unavailable reason. A deterministic incomplete traversal pauses immediately so changing
the traversal configuration and explicitly resuming remain user-controlled operations.

Prompt transport/protocol failures use the same bounded policy with a separate `prompt` retry scope.
An invalid prompt response is never treated as an empty assistant turn.

## Deep module seams

`TargetRepository` owns the persistence protocol: session locks, normalized reads and writes,
validation, quarantine, and the atomic mutation seam. Core lifecycle functions retain the public
API and stale-write guards, but do not need to know the storage choreography. This keeps Target
state transitions close to the aggregate rules while `TargetStore` remains the filesystem adapter.

`runContinuationPhases` in `src/continuation.js` owns the ordered idle-run phases in the plugin
layer: root outcome collection, complete accounting, breaker decisions, budget wrap-up, and one
physical prompt turn. It returns a typed decision (`stop` or `recheck`) and the phase that produced
it. The outer scheduler in `server.js` owns exclusivity, retry policy, lease cleanup, and rechecks.
A phase context is passed to the runner so host failures are classified by the phase that actually
failed, including failures thrown before a phase result can be returned. The coordinator accepts
operation adapters, making phase decisions testable without OpenCode hooks or filesystem state.

Verification commands are normalized through `normalizeVerificationResult` before evidence is
recorded. Target state receives one stable result shape rather than shell-specific exit-code and
output handling.

## Accounting

Per assistant message:

```text
billable = max(0, input - cache.read) + output
```

The state stores the maximum previously observed billable count for each `(session_id, message_id)`. A later sample adds only a positive delta. This supports partially updated/streaming token metadata without double-counting.

Attribution uses the assistant turn's creation time, not completion time. If a turn started before
Target activation but was absent from the activation snapshot, its first later observation installs
a zero-charge watermark. Subsequent growth of the same message is charged normally, preserving
post-activation usage without charging work already performed before the Target existed.

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

Persistence is exposed through the `TargetStore` module. Core lifecycle code remains responsible
for normalization and domain transitions, while the store owns atomic JSON writes, per-session
locking, corruption quarantine, and bounded filesystem recovery. This is the primary seam for
fault-injection and concurrency tests.

Token extraction and delta watermarks are exposed through `UsageLedger`. It owns cached-input
subtraction, plan-mode exclusion, root/descendant splitting, idempotent positive deltas, and the
bounded accounting watermark map. Core persists the resulting deltas and enforces Target budget.

- Semantic blocker: model judges the same external/user-input blocker has persisted for 3 consecutive Target turns.
- Failed-exec breaker: runtime sees 3 qualifying turns with failed execution and no successful tool call.
- Empty-auto breaker: runtime sees 3 automatic continuations with no meaningful activity and no final text.

Runtime failures can stop a Target immediately; they do not pretend to be the semantic blocker audit.
