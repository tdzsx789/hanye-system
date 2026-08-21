#!/usr/bin/env bash
set -euo pipefail

ECS_HOST="${ECS_HOST:-120.24.163.215}"
ECS_USER="${ECS_USER:-root}"
ECS_PORT="${ECS_PORT:-22}"
ECS_KEY="${ECS_KEY:-$HOME/.ssh/hanye_ecs_codex}"
REMOTE_DIR="${REMOTE_DIR:-/opt/hanye-system}"
WEB_PORT="${WEB_PORT:-8081}"

SSH_OPTS=(
  -i "$ECS_KEY"
  -p "$ECS_PORT"
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=10
)

RSYNC_EXCLUDES=(
  --exclude=".git"
  --exclude=".db-backups"
  --exclude=".env"
  --exclude=".DS_Store"
  --exclude="node_modules"
  --exclude="web/node_modules"
  --exclude="server/node_modules"
  --exclude="web/dist"
  --exclude="server/dist"
  --exclude="server/data"
  --exclude="*.traineddata"
  --exclude="*.sqlite"
  --exclude="*.sqlite-shm"
  --exclude="*.sqlite-wal"
)

echo "Deploying to ${ECS_USER}@${ECS_HOST}:${REMOTE_DIR}"

ssh "${SSH_OPTS[@]}" "${ECS_USER}@${ECS_HOST}" "mkdir -p '$REMOTE_DIR'"

rsync -az --delete \
  "${RSYNC_EXCLUDES[@]}" \
  -e "ssh -i '$ECS_KEY' -p '$ECS_PORT' -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10" \
  ./ "${ECS_USER}@${ECS_HOST}:${REMOTE_DIR}/"

ssh "${SSH_OPTS[@]}" "${ECS_USER}@${ECS_HOST}" \
  "REMOTE_DIR='$REMOTE_DIR' WEB_PORT='$WEB_PORT' bash -s" <<'REMOTE'
set -euo pipefail

cd "$REMOTE_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
fi

if grep -q '^WEB_PORT=' .env; then
  sed -i "s/^WEB_PORT=.*/WEB_PORT=${WEB_PORT}/" .env
else
  printf '\nWEB_PORT=%s\n' "$WEB_PORT" >> .env
fi

if grep -q '^STARTUP_DB_MAINTENANCE=' .env; then
  sed -i "s/^STARTUP_DB_MAINTENANCE=.*/STARTUP_DB_MAINTENANCE=0/" .env
else
  printf '\nSTARTUP_DB_MAINTENANCE=0\n' >> .env
fi

if grep -q '^SEED_DEMO_DATA=' .env; then
  sed -i "s/^SEED_DEMO_DATA=.*/SEED_DEMO_DATA=0/" .env
else
  printf '\nSEED_DEMO_DATA=0\n' >> .env
fi

docker compose up -d --build --no-deps server server-standby web

docker compose ps server server-standby web
REMOTE

echo "Done. Open: http://${ECS_HOST}:${WEB_PORT}/"
