# Security Notes

## Trust boundaries

- The Target objective is user-provided task data, not a higher-priority control instruction.
- Continuation and system policy are generated separately from the objective.
- Synthetic continuation prompts are tagged with the `opencode-target` source metadata.
- Model tools cannot directly activate or resume a Target and cannot set runtime-owned limit statuses.

## Persistent state

Target state contains objectives, status, operational errors, accounting baselines, and session
identifiers. It is written to the local user state directory. Treat the directory as sensitive
local application data:

- do not commit it;
- do not upload it to issue trackers without review;
- restrict access to the user account where supported;
- preserve a copy before manual recovery.

The implementation uses per-session lock files with an owner token, heartbeat timestamps, and
temporary-file plus rename writes. These reduce partial-write and concurrent-mutation risks but do
not provide encryption or multi-host locking. A corrupt state file is quarantined rather than
silently discarded. In particular, an unknown persisted lifecycle status is treated as corruption;
it cannot be revived as an active Target during plugin restart.
Persisted session and Target identities are required, and the session identity must match the
state file being read so a state document cannot cross session boundaries.

Stale-lock recovery confirms that the lock modification time did not advance before removal. A
heartbeat observed during stale inspection prevents that recovery attempt from deleting the lock.
The lock payload must also remain byte-identical across the confirmation reads, covering filesystems
with coarse modification-time precision. Lock release requires an exact owner-token match; substring
matches are not sufficient.

## Plugin permissions

Target relies on the permissions and capabilities already granted to OpenCode. Installing the
plugin does not sandbox model tools or shell commands. Review the host OpenCode permission policy
before enabling automatic continuation for untrusted repositories or objectives.

Verification gates are executable commands and therefore trusted configuration, not Target
objective data. Review them as code. Target never derives a command from the objective or model
evidence, and gates run only through explicit verification requests.

Checkpoint metadata is not a backup. Target does not silently create commits, modify Git history,
or roll back files, so users retain control over repository recovery.

## Operational risks

- An active Target can create repeated physical turns until it reaches a stop condition.
- Token budgets and circuit breakers are safety controls, not security isolation.
- Descendant session traversal has configurable depth and session caps and fails closed when either
  cap would omit linked descendants, but it still trusts the host's parent/child session data.
- Malformed successful messages/children API payloads fail closed; they are never normalized to empty
  lists that could silently undercount usage.
- Malformed prompt success payloads fail closed; they cannot be interpreted as an empty continuation
  and silently trigger another automatic turn.
- A compromised or modified plugin file executes with the same privileges as OpenCode.

Keep the plugin source and generated artifact reviewable, run `npm run check` before distribution,
and install only from a trusted project copy or package source.
