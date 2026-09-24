#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEST="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins"
mkdir -p "$DEST"
cp "$ROOT/dist/target.js" "$DEST/target.js"
printf 'Installed OpenCode Target to %s\nRestart OpenCode and start a new session.\n' "$DEST/target.js"
