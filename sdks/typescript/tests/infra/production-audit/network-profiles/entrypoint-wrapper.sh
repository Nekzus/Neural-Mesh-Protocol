#!/bin/bash
set -e

# Run network shaping if NET_ADMIN is available
if command -v tc >/dev/null 2>&1; then
  /app/network-profiles/apply-profile.sh || echo "[NET] Warning: Failed to apply tc profile (permission or capability issue)"
fi

# Fallback to test runner if no args provided
if [ $# -eq 0 ]; then
  echo "[INIT] No arguments provided. Defaulting to test runner: vitest run --config tests/vitest.audit.config.ts"
  set -- vitest run --config tests/vitest.audit.config.ts
fi

echo "[INIT] Launching node with args: $@"
exec "$@"
