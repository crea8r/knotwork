#!/bin/bash
# Syncs source from this repo into the running OpenClaw extension dir.
# Run after any source change, then restart the plugin:
#   ./sync-to-openclaw.sh && openclaw gateway call knotwork.status

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.openclaw/extensions/knotwork-bridge"

if [ ! -d "$DEST" ]; then
  echo "❌ Extension dir not found: $DEST"
  exit 1
fi

rsync -av --exclude='credentials.json' --exclude='runtime.lock' \
  "$REPO_DIR/src/" "$DEST/src/"

rsync -av "$REPO_DIR/openclaw.plugin.json" "$DEST/openclaw.plugin.json"

echo ""
echo "✅ Synced. Restart the plugin to pick up changes:"
echo "   docker restart openclaw-openclaw-gateway-1"
