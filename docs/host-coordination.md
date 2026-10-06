# Shared host coordination (work in progress)

`host-components.json` separates installed component intent (`components`) from
the last successfully installed and version-verified host (`host`). Display
versions have ordered `+patchline.<version>+target.<version>` suffixes; SemVer
operations use a distinct single-`+` representation. Installed package metadata
supplies versions. Existing executable suffixes do not identify installed plugins.

Manifest writes and host reconciliation use `.host-components.lock`. It contains
owner metadata and is not stolen on timeout. Inspect the owner before recovering
a lock left by a terminated installer. Binary rollback refuses external changes.

Target distributions now carry their own coordinator in `dist/host-*.mjs` and
deploy it into the OpenCode configuration directory. No Patchline installation
or neighbouring checkout is required for legacy migration. New Target registrations declare
`requiresHost: false`, use the upstream `session_prompt_right` slot, and do not rebuild OpenCode.
For a tracked legacy `+target` host, the coordinator reconstructs upstream without Target's
custom slot while retaining required Patchline changes. This one-time build requires Git, Bun
and upstream native compilation dependencies. Host suffixes exclude stock-slot Target versions.

Target wrapper scripts delegate file copying to the locked helper. Module tests
cover failed builds, verification rollback, both component orders, updates,
removals, missing files, concurrency and path guards. A clean 1.18.34 checkout
has produced the combined display version. Full archive-only installer smoke,
crash journaling and real install/uninstall executable transitions are pending;
do not treat the current implementation as a completed release contract.
