# Security Notes

## Trust boundaries

- The Mission objective is user-provided task data, not a higher-priority control instruction.
- Continuation and system policy are generated separately from the objective.
- Synthetic continuation prompts are tagged with the `opencode-mission` source metadata.
- Model tools cannot directly activate or resume a Mission and cannot set runtime-owned limit statuses.

## Persistent state

Mission state contains objectives, status, operational errors, accounting baselines, and session
identifiers. It is written to the local user state directory. Treat the directory as sensitive
local application data:

- do not commit it;
- do not upload it to issue trackers without review;
- restrict access to the user account where supported;
- preserve a copy before manual recovery.

The implementation uses per-session lock files and temporary-file plus rename writes. These reduce
partial-write and concurrent-mutation risks but do not provide encryption or multi-host locking.

## Plugin permissions

Mission relies on the permissions and capabilities already granted to OpenCode. Installing the
plugin does not sandbox model tools or shell commands. Review the host OpenCode permission policy
before enabling automatic continuation for untrusted repositories or objectives.

## Operational risks

- An active Mission can create repeated physical turns until it reaches a stop condition.
- Token budgets and circuit breakers are safety controls, not security isolation.
- Descendant session traversal has configurable depth and session caps, but it trusts the host's
  parent/child session data.
- A compromised or modified plugin file executes with the same privileges as OpenCode.

Keep the plugin source and generated artifact reviewable, run `npm run check` before distribution,
and install only from a trusted project copy or package source.
