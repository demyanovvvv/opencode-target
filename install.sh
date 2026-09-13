#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEST="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins"
mkdir -p "$DEST"
cp "$ROOT/dist/mission.js" "$DEST/mission.js"
printf 'Installed OpenCode Mission to %s\nRestart OpenCode and start a new session.\n' "$DEST/mission.js"
