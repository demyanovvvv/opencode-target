# Codex Goal -> OpenCode Mission parity map

Target: OpenCode / `@opencode-ai/plugin` 1.18.30.

| Codex Goal behavior | Mission implementation | Parity |
|---|---|---|
| Persist objective outside chat history | Per-session JSON Mission store | Equivalent semantics |
| `goal_id` logical version | `mission_id` UUID | Direct |
| `active`, `paused`, `blocked`, `usage_limited`, `budget_limited`, `complete` | Same six statuses | Direct |
| Model tools: get/create/update | `get_mission`, `create_mission`, `update_mission` | Direct, renamed |
| Model may set complete/blocked/paused only | Same authority restriction | Direct |
| New logical Goal only after previous complete | New Mission only after previous complete | Direct |
| Automatic continuation when thread idle | `session.idle` + awaited `session.prompt()` loop | Equivalent at OpenCode boundary |
| Fresh continuation steering each turn | Synthetic Mission continuation context | Equivalent semantics |
| Requirement-by-requirement completion audit | Mission continuation/system policy | Direct semantics |
| Same blocker >=3 consecutive turns before semantic blocked | Mission policy | Direct semantics |
| Repeated exec failure breaker at 3 | OpenCode execution-tool failure breaker at 3 | Adapted tool names |
| Empty automatic continuation breaker at 3 | Same | Direct semantics |
| Plan turn excluded from token budget | `mode/agent == plan` excluded | Direct semantics |
| Goal token formula: input - cached + output | Same formula over OpenCode token fields | Direct |
| Descendant agent usage charged to root | Recursive parent/child session accounting | Equivalent where sessions are linked |
| Reset token baseline when Goal activates | Seed current root/descendant per-message baselines | Direct semantics |
| Wall-clock active-time accounting | Process-local active wall-clock baseline persisted in JSON | Equivalent semantics |
| Budget crossing -> budget_limited | Same persisted transition during accounting | Direct |
| budget_limited prevents pause/blocked override | Same | Direct |
| usage_limited can supersede budget_limited | Same | Direct |
| complete can supersede just-crossed budget_limited | Same | Direct |
| Resume cannot bypass exhausted budget | Same normalization | Direct |
| Stale async mutation guard by expected goal ID | expected `mission_id` on async writes | Direct |
| Compaction restores from persisted Goal state | Compaction hook injects persisted Mission state | Equivalent |
| Generic compaction continuation disabled while Goal owns loop | `experimental.compaction.autocontinue = false` while active | Direct |
| User interrupt pauses Goal | `session.error` abort/cancel -> paused | Closest exposed hook |
| Mid-turn native steering injection | Not exposed equivalently to external plugins | Platform limitation |
| Native DB/events/metrics | JSON store + structured plugin log | Platform limitation |

## Important implementation distinctions

Mission keeps model lifecycle authority separate from runtime lifecycle authority. Runtime transitions and budget normalization are deterministic code, not prompt requests.

Mission's `mission_id` is not cosmetic: accounting, status updates, continuation admission and baseline seeding all accept an expected ID so late work from a previous Mission cannot mutate its replacement.

The two runtime circuit breakers are independent from the model's semantic blocked audit. A runtime execution failure can stop a Mission immediately when its breaker threshold is reached; a semantic blocker still follows the repeated-blocker contract in the model policy.

## Primary references

- https://github.com/openai/codex/tree/main/codex-rs/ext/goal
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/accounting.rs
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/runtime.rs
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/spec.rs
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/tool.rs
- https://github.com/openai/codex/blob/main/codex-rs/state/src/runtime/goals.rs
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/templates/goals/continuation.md
- https://github.com/anomalyco/opencode/blob/v1.18.30/packages/plugin/src/index.ts
- https://opencode.ai/docs/plugins/
- https://opencode.ai/docs/sdk/
