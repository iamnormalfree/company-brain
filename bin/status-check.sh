#!/usr/bin/env bash
# status-check.sh — report the up/down state of kongming-related systemd user
# services and the cloudflared tunnel. Run by hand or via status-check.timer.
#
# Exit codes: 0 = all healthy, 1 = one or more not active.
# Logs to /tmp/opencode/status-check.log when run from the timer; to stdout
# when run by hand.

set -uo pipefail

LOG_FILE="${STATUS_CHECK_LOG:-/tmp/opencode/status-check.log}"
TIMESTAMP="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
FAIL=0
LINES=()

note() { LINES+=("$1"); }

# --- systemd user services ---
SERVICES=(bd-bridge.service kongming-dev.service cass-index.timer sync-experiments.timer)
for svc in "${SERVICES[@]}"; do
    state="$(systemctl --user is-active "$svc" 2>&1 || true)"
    if [ "$state" = "active" ]; then
        note "[ok]    $svc  state=$state"
    else
        note "[FAIL]  $svc  state=$state"
        FAIL=1
    fi
done

# --- cloudflared (not a systemd service) ---
if ss -tln 2>/dev/null | grep -q '127.0.0.1:20241'; then
    note "[ok]    cloudflared  port=127.0.0.1:20241 listening"
else
    note "[FAIL]  cloudflared  port=127.0.0.1:20241 NOT listening"
    FAIL=1
fi

# --- kongming public reachability (sanity, not a service) ---
status="$(curl -sS --max-time 4 -o /dev/null -w '%{http_code}' https://kongming.brentnotes.com/health 2>&1 || echo '000')"
if [ "$status" = "200" ]; then
    note "[ok]    kongming public /health: 200"
else
    note "[WARN]  kongming public /health: $status  (public tunnel or worker may be down)"
    # Don't FAIL on this — could be a transient cloudflared hiccup that
    # the bridge check already covers. But log it for visibility.
fi

# --- emit ---
OUTPUT="${TIMESTAMP} ${LINES[*]}"
if [ "$FAIL" -eq 0 ]; then
    OUTPUT="$OUTPUT  -> all healthy"
else
    OUTPUT="$OUTPUT  -> DEGRADED"
fi

if [ "${STATUS_CHECK_QUIET:-0}" = "1" ]; then
    printf '%s\n' "$OUTPUT" >> "$LOG_FILE"
else
    printf '%s\n' "$OUTPUT" | tee -a "$LOG_FILE"
fi

exit "$FAIL"