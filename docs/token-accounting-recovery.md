# Token accounting recovery

The former 12,000-entry watermark cap evicted deduplication identities while retaining
their charges. Full-history continuation scans charged evicted records again. The fix
retains all identities through accounting, normalization, baseline seeding and restart.
`accounting.maxEntries` is now null; historical `truncated: true` remains sticky.

New Targets persist `accounting.tokenSemantics: "opencode-normalized-v1"` and count
`input + cache.write + output + reasoning`: OpenCode already separates cache reads
from input and reasoning from output. States without this marker retain the legacy
formula until explicit reconstruction, avoiding false deltas against old watermarks.
Distinct step-finish IDs identify recorded requests, including paid retries. Their sum
replaces, rather than supplements, the message's latest-request snapshot.

An anonymized live state snapshot contained 2,350,740,149 tokens and 12,000 watermarks,
with truncated=true. Independent unique-message, step-finish and message-event
high-watermark sums agreed on 532,549,680 under the legacy formula (excess:
1,818,190,469). The normalized formula yielded 645,688,912. These are diagnostic
snapshots, not replacement values for a subsequently changed Target.

## Explicit historical reconstruction

1. Install the fixed plugin and restart OpenCode: an already loaded old plugin still
   evicts watermarks. Coordinate a quiet accounting boundary and back up Target JSON.
2. Read a consistent, read-only host database snapshot: linked sessions, message usage,
   unique step-finish parts and necessary usage events. Never export prompts or secrets.
3. Verify completeness, plan exclusions, activation time and actual activation baseline.
   Requests straddling activation need the real baseline, not a guessed proportional split.
   Compare message totals with request totals and report missing records.
4. Produce a dry-run root/descendant report. Missing usage or activation baselines make
   exact reconstruction impossible: explicitly report the unknown boundary. A partial sum
   must not be labeled exact; retries without saved usage must not be assigned invented tokens.
5. After explicit approval, hold the session lock, recheck target ID and state/source
   freshness, and atomically replace totals AND complete watermarks using the documented
   formula and its semantics marker. Clear truncation only after proving completeness.
   Preserve lifecycle status, budget, objective and all other Target metadata.
6. Replay the identical source snapshot: delta must be zero. Verify context and TUI
   against the same saved total before allowing further accounting.

No existing Target was modified or reset during this investigation. Reconstruction is
manual; the plugin does not silently rewrite historical totals on load.
