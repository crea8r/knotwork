#!/bin/bash
# Syncs source from this repo into the running OpenClaw extension dir.
# Run after any source change, then restart the plugin:
#   ./sync-to-openclaw.sh && openclaw gateway call knotwork.status

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.openclaw/extensions/knotwork-bridge"
CONFIG_PATH="$HOME/.openclaw/openclaw.json"
LOAD_PATH="/home/node/.openclaw/extensions/knotwork-bridge"

if [ ! -d "$DEST" ]; then
  echo "❌ Extension dir not found: $DEST"
  exit 1
fi

rsync -av --exclude='runtime.lock' \
  "$REPO_DIR/src/" "$DEST/src/"

rsync -av "$REPO_DIR/openclaw.plugin.json" "$DEST/openclaw.plugin.json"

if [ -f "$CONFIG_PATH" ]; then
  python3 - <<PY
import json
from pathlib import Path

path = Path("$CONFIG_PATH")
data = json.loads(path.read_text())
plugins = data.setdefault("plugins", {})
load = plugins.setdefault("load", {})
paths = load.setdefault("paths", [])
load_path = "$LOAD_PATH"
if load_path not in paths:
    paths.append(load_path)
    path.write_text(json.dumps(data, indent=2) + "\\n")
    print(f"Added plugins.load.paths entry: {load_path}")
else:
    print(f"plugins.load.paths already contains: {load_path}")
PY
else
  echo "⚠️ Config not found: $CONFIG_PATH"
fi

echo ""
echo "✅ Synced. Restart the plugin to pick up changes:"
echo "   docker restart openclaw-openclaw-gateway-1"
