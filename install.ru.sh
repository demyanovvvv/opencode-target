#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONFIG="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
if [ "${1:-}" = "--uninstall" ]; then
  exec node "$ROOT/dist/install-config.mjs" --config-dir "$CONFIG" --uninstall
fi
ACTION=установлен
if [ -f "$CONFIG/plugins/target.js" ] || [ -f "$CONFIG/tui-plugins/target.js" ]; then ACTION=обновлён; fi
DEST="$CONFIG/plugins"
TUI_DEST="$CONFIG/tui-plugins"
mkdir -p "$DEST" "$TUI_DEST"
cp "$ROOT/dist/target.js" "$DEST/target.js"
cp "$ROOT/dist/target-tui.js" "$TUI_DEST/target.js"
CONFIG_TOOL="$ROOT/dist/install-config.mjs"
node "$CONFIG_TOOL" --config-dir "$CONFIG"
printf 'OpenCode Target %s в %s\nИндикатор Target %s в %s\nTUI-индикатор Target зарегистрирован автоматически.\nПерезапустите OpenCode и создайте новую сессию.\n' "$ACTION" "$DEST/target.js" "$ACTION" "$TUI_DEST/target.js"
