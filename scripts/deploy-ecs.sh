#!/usr/bin/env bash
set -euo pipefail

ECS_HOST="${ECS_HOST:-120.24.163.215}"
ECS_USER="${ECS_USER:-root}"
ECS_PORT="${ECS_PORT:-22}"
ECS_KEY="${ECS_KEY:-$HOME/.ssh/hanye_ecs_codex}"
REMOTE_DIR="${REMOTE_DIR:-/opt/hanye-system}"
WEB_PORT="${WEB_PORT:-8081}"
ENABLE_BACKUP="${ENABLE_BACKUP:-1}"

SSH_OPTS=(
  -i "$ECS_KEY"
  -p "$ECS_PORT"
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=10
)

RSYNC_EXCLUDES=(
  --exclude=".git"
  --exclude=".env"
  --exclude=".DS_Store"
  --exclude="node_modules"
  --exclude="web/node_modules"
  --exclude="server/node_modules"
  --exclude="web/dist"
  --exclude="server/dist"
  --exclude="server/data"
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
  "REMOTE_DIR='$REMOTE_DIR' WEB_PORT='$WEB_PORT' ENABLE_BACKUP='$ENABLE_BACKUP' bash -s" <<'REMOTE'
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

if [ "$ENABLE_BACKUP" = "1" ]; then
  docker compose --profile backup up -d --build
else
  docker compose up -d --build
fi

docker compose ps
REMOTE

echo "Done. Open: http://${ECS_HOST}:${WEB_PORT}/"
