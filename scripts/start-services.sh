#!/usr/bin/env bash
# start-services.sh — single entrypoint for agent-co (auth-admin + chat)
# Managed by systemd as one unit: agent-co.service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults (overridable via env file)
: "${AUTH_ADMIN_PORT:=3003}"
: "${PORT:=3002}"

AUTH_PID=""
CHAT_PID=""

# ── cleanup on exit ──────────────────────────────────────────────
cleanup() {
  echo "[start-services] shutting down..."
  if [[ -n "$CHAT_PID" ]] && kill -0 "$CHAT_PID" 2>/dev/null; then
    kill "$CHAT_PID" 2>/dev/null || true
    wait "$CHAT_PID" 2>/dev/null || true
  fi
  if [[ -n "$AUTH_PID" ]] && kill -0 "$AUTH_PID" 2>/dev/null; then
    kill "$AUTH_PID" 2>/dev/null || true
    wait "$AUTH_PID" 2>/dev/null || true
  fi
  echo "[start-services] stopped."
}
trap cleanup EXIT SIGTERM SIGINT

# ── 1. start auth-admin (background) ─────────────────────────────
echo "[start-services] starting auth-admin on :${AUTH_ADMIN_PORT}..."
/usr/bin/node "$APP_DIR/dist/auth-admin-server.js" &
AUTH_PID=$!

# ── 2. wait for auth-admin to be ready ───────────────────────────
TIMEOUT=30
ELAPSED=0
until curl -sf "http://127.0.0.1:${AUTH_ADMIN_PORT}/healthz" >/dev/null 2>&1; do
  if [[ $ELAPSED -ge $TIMEOUT ]]; then
    echo "[start-services] ERROR: auth-admin did not become ready within ${TIMEOUT}s" >&2
    exit 1
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done
echo "[start-services] auth-admin ready (${ELAPSED}s)."

# ── 3. start chat (foreground) ───────────────────────────────────
echo "[start-services] starting chat on :${PORT}..."
exec /usr/bin/node "$APP_DIR/dist/server.js"
