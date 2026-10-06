# Compatibility Matrix

## Supported target

| Component | Supported target | Verification |
|---|---|---|
| Node.js | Node.js 22 LTS or newer supported runtime | `node --version`, CI |
| Package format | Native ESM (`"type": "module"`) | `node --check` |
| `@opencode-ai/plugin` | `>=1.18.30 <2.0.0` | `package.json`, CI dependency |
| `@opencode-ai/plugin/tui` | `>=1.18.30 <2.0.0` | Generated TUI smoke test |
| `@opentui/solid` | `>=0.4.5 <0.5.0` | TUI typecheck and renderer smoke test |
| `solid-js` | `^1.9.12` | TUI build and renderer smoke test |
| OpenCode plugin loading | Local plugin or package plugin configuration | OpenCode plugin docs |
| Persisted Target schema | Versions `2` and `3` | Core migration/quarantine tests |

The package keeps `@opencode-ai/plugin` optional at runtime so a local self-contained plugin can
be copied into OpenCode. It is a development dependency for the repository's smoke tests.

The compact inline indicator requires the custom `session_prompt_status` host slot. Stock
OpenCode 1.18.34 does not provide it; the server plugin remains independently usable.
For the Windows host, clone OpenCode v1.18.34 into `.opencode-host` and run
`node scripts/register-host-components.mjs`, then `node scripts/build-host.mjs`.
The shared `host-components.json` records installed components and their versions. The build
checks their files, reconstructs host extensions from upstream, and composes a stable display
version: `1.18.34+patchline.1.2.0+target.0.5.0`, or one suffix when only one is present.
These display versions are not SemVer strings when they contain multiple `+` signs.
Target install/uninstall updates its own entry. Patchline installer integration is pending;
run the registration helper again after changing the installed Patchline package. Installation
of plugin files and successful host binary installation remain separate operations.
Host binary installation is separate from `install.ps1`, which installs the Target plugins.
This custom host suppresses stock binary upgrades to preserve its extensions; rebuild it
explicitly when upgrading. Its build omits the embedded web UI.

## Local environment note

The environment used during this documentation pass contained `@opencode-ai/plugin` `1.15.4`
under the user's global OpenCode configuration. That version is below this project's declared
target and must not be used as compatibility evidence for Target.

Install and verify the repository dependency before running plugin smoke tests:

```text
npm install
npm run check
```

## Platform boundaries

- Linux and macOS default Target state to `~/.local/state/opencode-target/`.
- Windows defaults Target state to `%LOCALAPPDATA%\opencode-target\`.
- User plugin installation uses OpenCode's plugin directory and is distinct from state storage.
- The server plugin and TUI indicator are separate target-exclusive modules. Configure the server
  plugin in `opencode.json` or the server plugin directory, and configure the indicator in
  `tui.json`.
- OpenCode exposes session events and parent/child relationships, but not every native Codex Goal
  hook. Mid-turn native steering and native metrics are therefore not equivalent.
- The indicator uses TUI session status (`busy`, `idle`, and `retry`) plus local Target state. It
  is intended for local OpenCode runs where the TUI and Target state directory share a machine.
- The Target adapter accepts only the SDK's array response shape for session messages and child
  sessions. A successful response with `null`, an object, or another malformed payload is treated
  as a typed host API failure rather than as an empty list.
- Automatic continuation accepts only the SDK prompt response shape containing assistant `info` and
  a `parts` array. Malformed prompt responses are typed failures and follow the configured bounded
  continuation retry policy.
- OpenCode messages, children, and prompt calls are bounded by `host_api_timeout_ms` (30 seconds
  by default). A timeout is surfaced as a typed host failure and follows the same retry/lifecycle
  handling as other transient OpenCode API failures.
- The continuation watchdog measures absence of `session.idle` after asynchronous dispatch, not
  UI health. Pending permission/question requests defer its check. It neither grants permissions
  nor aborts the host and does not cover the initial slash-command turn.
- Release validation installs `@opencode-ai/plugin@1.18.30`, OpenTUI core/solid/keymap `0.4.5`, and
  Solid `1.9.12` into a temporary project and imports the packed package. The host's peer set is
  pinned together so registry updates cannot select an incompatible OpenTUI generation.
- The archive installer is also exercised without dependencies using its bundled JSONC helper.

## Upgrade policy

When changing the OpenCode plugin API range:

1. Update `peerDependencies` and `devDependencies`.
2. Update this matrix and `README.md` if installation behavior changes.
3. Run unit and smoke tests against the lowest supported version when practical.
4. Rebuild and verify `dist/target.js`.
5. Record API behavior changes and platform limitations in `docs/codex-parity.md`.
