# Compatibility Matrix

## Supported target

| Component | Supported target | Verification |
|---|---|---|
| Node.js | Node.js 22 LTS or newer supported runtime | `node --version`, CI |
| Package format | Native ESM (`"type": "module"`) | `node --check` |
| `@opencode-ai/plugin` | `>=1.18.30 <2.0.0` | `package.json`, CI dependency |
| OpenCode plugin loading | Local plugin or npm plugin configuration | OpenCode plugin docs |

The package keeps `@opencode-ai/plugin` optional at runtime so a local self-contained plugin can
be copied into OpenCode. It is a development dependency for the repository's smoke tests.

## Local environment note

The environment used during this documentation pass contained `@opencode-ai/plugin` `1.15.4`
under the user's global OpenCode configuration. That version is below this project's declared
target and must not be used as compatibility evidence for Mission.

Install and verify the repository dependency before running plugin smoke tests:

```text
npm install
npm run check
```

## Platform boundaries

- Linux and macOS default Mission state to `~/.local/state/opencode-mission/`.
- Windows defaults Mission state to `%LOCALAPPDATA%\opencode-mission\`.
- User plugin installation uses OpenCode's plugin directory and is distinct from state storage.
- OpenCode exposes session events and parent/child relationships, but not every native Codex Goal
  hook. Mid-turn native steering and native metrics are therefore not equivalent.

## Upgrade policy

When changing the OpenCode plugin API range:

1. Update `peerDependencies` and `devDependencies`.
2. Update this matrix and `README.md` if installation behavior changes.
3. Run unit and smoke tests against the lowest supported version when practical.
4. Rebuild and verify `dist/mission.js`.
5. Record API behavior changes and platform limitations in `docs/codex-parity.md`.
