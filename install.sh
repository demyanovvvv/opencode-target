#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
DEST="$CONFIG/plugins"
TUI_DEST="$CONFIG/tui-plugins"
mkdir -p "$DEST" "$TUI_DEST"
cp "$ROOT/dist/target.js" "$DEST/target.js"
cp "$ROOT/dist/target-tui.js" "$TUI_DEST/target.js"
printf 'Installed OpenCode Target to %s\nInstalled Target indicator to %s\n' "$DEST/target.js" "$TUI_DEST/target.js"
printf 'Enable the indicator by adding "./tui-plugins/target.js" to the plugin array in %s/tui.json.\nRestart OpenCode and start a new session.\n' "$CONFIG"
