#!/bin/bash
# freellmapi install on remotebox — native (npm + systemd), matches
# agentos-dashboard pattern. Idempotent: re-running skips already-done steps.
#
# Requires: sudo (one-time, for apt + systemctl). Network access.

set -euo pipefail

cd "$(dirname "$0")"   # ~/agentos/freellmapi

echo "=== STEP 1: system deps (one-time, for native better-sqlite3 build) ==="
if ! dpkg -l python3 make g++ 2>/dev/null | grep -q '^ii'; then
  sudo apt-get update -y
  sudo apt-get install -y python3 make g++
else
  echo "  python3 / make / g++ already installed, skipping"
fi

echo
echo "=== STEP 2: clone upstream (skip if src/ already exists) ==="
if [[ ! -d src ]]; then
  git clone https://github.com/tashfeenahmed/freellmapi.git src
else
  echo "  src/ already exists, skipping clone"
fi

echo
echo "=== STEP 3: install npm deps + build ==="
cd src
if [[ ! -d node_modules ]]; then
  npm ci
else
  echo "  node_modules already exists, skipping npm ci"
fi
npm run build
npm prune --omit=dev
cd ..

echo
echo "=== STEP 4: confirm ENCRYPTION_KEY + .env exist ==="
if [[ ! -s .secrets/encryption_key ]]; then
  echo "  generating fresh ENCRYPTION_KEY (back this up!)"
  mkdir -p .secrets
  openssl rand -hex 32 > .secrets/encryption_key
  chmod 600 .secrets/encryption_key
else
  echo "  .secrets/encryption_key already exists (kept as-is)"
fi
if [[ ! -s .env ]]; then
  echo "  copying .env.example -> .env"
  cp .env.example .env
  chmod 600 .env
else
  echo "  .env already exists (kept as-is)"
fi

echo
echo "=== STEP 5: install systemd unit ==="
if ! systemctl cat freellmapi.service >/dev/null 2>&1; then
  sudo cp freellmapi.service /etc/systemd/system/
  sudo systemctl daemon-reload
else
  echo "  freellmapi.service already installed, reloading anyway"
  sudo systemctl daemon-reload
fi

echo
echo "=== STEP 6: enable + start ==="
sudo systemctl enable --now freellmapi

echo
echo "=== STEP 7: wait for health ==="
for i in {1..15}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3001/api/ping >/dev/null 2>&1; then
    echo "  ✓ freellmapi is responding on http://127.0.0.1:3001"
    curl -sS http://127.0.0.1:3001/api/ping
    echo
    break
  fi
  echo "  waiting... ($i/15)"
  sleep 2
done

echo
echo "=== STEP 8: status ==="
sudo systemctl status freellmapi --no-pager | head -15

echo
echo "=== DONE ==="
echo
echo "Next steps:"
echo "  1. Open http://127.0.0.1:3001 (or http://100.98.6.47:3001 from Tailscale)"
echo "     in your browser. First-run setup will prompt to create admin user."
echo "  2. Add provider keys on the dashboard (Groq, OpenRouter, etc.)."
echo "  3. Generate a unified bearer token (Settings → Tokens)."
echo "  4. Save that token to ~/.hermes/.env as FREELLMAPI_UNIFIED_KEY."
echo "  5. Copy the relevant blocks from hermes-snippet.yaml into"
echo "     ~/.hermes/config.yaml under custom_providers:."
echo
echo "BACKUP REMINDER: copy .secrets/encryption_key somewhere safe NOW."
echo "If you lose it, all stored provider keys become unreadable."
echo "Suggested: 1Password / Bitwarden / password manager, or a sealed envelope."
