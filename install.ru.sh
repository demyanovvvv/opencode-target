#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONFIG="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
DEST="$CONFIG/plugins"
TUI_DEST="$CONFIG/tui-plugins"
mkdir -p "$DEST" "$TUI_DEST"
cp "$ROOT/dist/target.js" "$DEST/target.js"
cp "$ROOT/dist/target-tui.js" "$TUI_DEST/target.js"
CONFIG_TOOL="$ROOT/dist/install-config.mjs"
node "$CONFIG_TOOL" --config-dir "$CONFIG"
printf 'OpenCode Target установлен в %s\nИндикатор Target установлен в %s\nTUI-индикатор Target зарегистрирован автоматически.\nПерезапустите OpenCode и создайте новую сессию.\n' "$DEST/target.js" "$TUI_DEST/target.js"
