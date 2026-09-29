#!/usr/bin/env bash
# bd-bridge-launch.sh — single command to (re)start the bd bridge.
#
# Reads BD_BRIDGE_TOKEN from /srv/agents/company-brain/.dev.vars if not already
# in the environment. If missing, generates a fresh one and writes it back so
# the value kongming reads matches what the bridge uses.
#
# This is a thin wrapper: the systemd user unit (bd-bridge.service) calls this
# too. Run by hand for ad-hoc restarts during dev.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dev_vars="$repo_root/.dev.vars"
token_file="/tmp/opencode/bd-bridge-token.txt"

if [ ! -f "$dev_vars" ]; then
    echo "[bd-bridge-launch] missing $dev_vars" >&2
    exit 2
fi

# Extract or generate BD_BRIDGE_TOKEN.
existing="$(grep -E '^BD_BRIDGE_TOKEN=' "$dev_vars" || true)"
if [ -z "$existing" ]; then
    new_token="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
    # Append rather than overwrite other entries.
    printf '\nBD_BRIDGE_TOKEN="%s"\n' "$new_token" >> "$dev_vars"
    export BD_BRIDGE_TOKEN="$new_token"
    echo "[bd-bridge-launch] generated fresh BD_BRIDGE_TOKEN and wrote to $dev_vars" >&2
else
    export BD_BRIDGE_TOKEN="${existing#BD_BRIDGE_TOKEN=}"
    export BD_BRIDGE_TOKEN="${BD_BRIDGE_TOKEN%\"}"
    export BD_BRIDGE_TOKEN="${BD_BRIDGE_TOKEN#\"}"
    echo "[bd-bridge-launch] reusing BD_BRIDGE_TOKEN from $dev_vars" >&2
fi

# Sensible defaults so a bare `bd-bridge-launch.sh` works.
export BD_BRIDGE_URL="${BD_BRIDGE_URL:-http://127.0.0.1:8795}"
export BD_BRIDGE_HOST="${BD_BRIDGE_HOST:-127.0.0.1}"
export BD_BRIDGE_PORT="${BD_BRIDGE_PORT:-8795}"
export BD_RIG_DIR="${BD_RIG_DIR:-/srv/agents/operate}"
export BD_BIN="${BD_BIN:-bd}"

exec python3 "$repo_root/bin/bd-bridge.py"