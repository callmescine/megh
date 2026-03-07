#!/bin/bash
# Reads the Claude Code OAuth token from macOS Keychain and writes it to
# secrets/oauth-token so the API container can read it (Docker can't access Keychain).
#
# Usage:
#   ./scripts/refresh-oauth-token.sh          # one-shot
#   ./scripts/refresh-oauth-token.sh --watch   # refresh every 5 minutes

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TOKEN_FILE="$PROJECT_DIR/secrets/oauth-token"

refresh() {
  local raw
  raw=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null) || {
    echo "[refresh-oauth-token] No Claude Code credentials in Keychain. Run 'claude' to authenticate."
    return 1
  }

  local token expires_at
  token=$(echo "$raw" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('claudeAiOauth',{}).get('accessToken',''))")
  expires_at=$(echo "$raw" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('claudeAiOauth',{}).get('expiresAt',''))")

  if [ -z "$token" ]; then
    echo "[refresh-oauth-token] No OAuth token found in credentials. Run 'claude' to authenticate."
    return 1
  fi

  # Check if token changed
  local current=""
  [ -f "$TOKEN_FILE" ] && current=$(cat "$TOKEN_FILE" 2>/dev/null || true)

  if [ "$token" = "$current" ]; then
    echo "[refresh-oauth-token] Token unchanged (expires: $(python3 -c "from datetime import datetime; print(datetime.fromtimestamp($expires_at/1000))" 2>/dev/null || echo 'unknown'))"
    return 0
  fi

  echo "$token" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "[refresh-oauth-token] Token updated (expires: $(python3 -c "from datetime import datetime; print(datetime.fromtimestamp($expires_at/1000))" 2>/dev/null || echo 'unknown'))"
}

if [ "${1:-}" = "--watch" ]; then
  echo "[refresh-oauth-token] Watching for token changes every 5 minutes..."
  while true; do
    refresh || true
    sleep 300
  done
else
  refresh
fi
