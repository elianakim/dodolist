#!/usr/bin/env bash
set -e

PLIST_NAME="todos.plist"
PLIST_LABEL="local.todos"
PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/$PLIST_NAME"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo ""
echo "  todos — setup"
echo "  ─────────────"

# ── Check: macOS only ─────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
  echo "  ✗ This setup script is for macOS only."
  echo "    On other systems, run: node server.js"
  exit 1
fi

# ── Check: node installed ─────────────────────────────────────────
NODE_PATH="$(command -v node 2>/dev/null || true)"
if [[ -z "$NODE_PATH" ]]; then
  echo "  ✗ Node.js not found. Install it from https://nodejs.org or via Homebrew:"
  echo "    brew install node"
  exit 1
fi
echo "  ✓ Node.js found at $NODE_PATH"

# ── Patch plist with the correct node path and project directory ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_PLIST="$(mktemp)"
sed "s|/opt/homebrew/bin/node|$NODE_PATH|g" "$PLIST_SRC" \
  | sed "s|/Users/elianakim/Documents/git/ToDos|$SCRIPT_DIR|g" \
  > "$TMP_PLIST"

# ── Unload existing agent if present ─────────────────────────────
if launchctl list | grep -q "$PLIST_LABEL" 2>/dev/null; then
  echo "  ↻ Unloading existing agent…"
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

# ── Install and load ──────────────────────────────────────────────
cp "$TMP_PLIST" "$PLIST_DEST"
rm "$TMP_PLIST"
launchctl load "$PLIST_DEST"

echo "  ✓ Launch agent installed → $PLIST_DEST"
echo "  ✓ Server started"
echo ""
echo "  Open http://localhost:3000"
echo ""
echo "  Useful commands:"
echo "    Stop:    launchctl unload ~/Library/LaunchAgents/$PLIST_NAME"
echo "    Start:   launchctl load   ~/Library/LaunchAgents/$PLIST_NAME"
echo "    Logs:    tail -f $SCRIPT_DIR/logs/server.log"
echo ""
