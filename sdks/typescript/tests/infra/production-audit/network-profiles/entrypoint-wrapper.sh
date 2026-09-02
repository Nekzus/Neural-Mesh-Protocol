#!/bin/bash
set -e

# Run network shaping if NET_ADMIN is available
if command -v tc >/dev/null 2>&1; then
  /app/network-profiles/apply-profile.sh || echo "[NET] Warning: Failed to apply tc profile (permission or capability issue)"
fi

echo "[INIT] Launching node with args: $@"
exec "$@"
