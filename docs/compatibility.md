# Compatibility Matrix

## Supported target

| Component | Supported target | Verification |
|---|---|---|
| Node.js | Node.js 22 LTS or newer supported runtime | `node --version`, CI |
| Package format | Native ESM (`"type": "module"`) | `node --check` |
| `@opencode-ai/plugin` | `>=1.18.30 <2.0.0` | `package.json`, CI dependency |
| OpenCode plugin loading | Local plugin or package plugin configuration | OpenCode plugin docs |
| Persisted Target schema | Versions `2` and `3` | Core migration/quarantine tests |

The package keeps `@opencode-ai/plugin` optional at runtime so a local self-contained plugin can
be copied into OpenCode. It is a development dependency for the repository's smoke tests.

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
- OpenCode exposes session events and parent/child relationships, but not every native Codex Goal
  hook. Mid-turn native steering and native metrics are therefore not equivalent.
- The Target adapter accepts only the SDK's array response shape for session messages and child
  sessions. A successful response with `null`, an object, or another malformed payload is treated
  as a typed host API failure rather than as an empty list.
- Automatic continuation accepts only the SDK prompt response shape containing assistant `info` and
  a `parts` array. Malformed prompt responses are typed failures and follow the configured bounded
  continuation retry policy.
- The release validation installs the pinned development target `@opencode-ai/plugin@1.18.30` into
  a temporary project and imports the packed package before release claims are made.

## Upgrade policy

When changing the OpenCode plugin API range:

1. Update `peerDependencies` and `devDependencies`.
2. Update this matrix and `README.md` if installation behavior changes.
3. Run unit and smoke tests against the lowest supported version when practical.
4. Rebuild and verify `dist/target.js`.
5. Record API behavior changes and platform limitations in `docs/codex-parity.md`.
