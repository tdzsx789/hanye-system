#!/usr/bin/env bash
set -euo pipefail

ECS_HOST="${ECS_HOST:-120.24.163.215}"
ECS_USER="${ECS_USER:-root}"
ECS_PORT="${ECS_PORT:-22}"
ECS_KEY="${ECS_KEY:-$HOME/.ssh/hanye_ecs_codex}"
REMOTE_DIR="${REMOTE_DIR:-/opt/hanye-system}"
WEB_PORT="${WEB_PORT:-8081}"
PUBLIC_WEB_ROOT="${PUBLIC_WEB_ROOT:-/var/www/oa.hanyeltd.com}"
STARTUP_DB_MAINTENANCE="${STARTUP_DB_MAINTENANCE:-1}"

SSH_OPTS=(
  -i "$ECS_KEY"
  -p "$ECS_PORT"
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=10
)

RSYNC_EXCLUDES=(
  --exclude=".git"
  --exclude=".db-backups"
  --exclude="backups"
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
  "REMOTE_DIR='$REMOTE_DIR' WEB_PORT='$WEB_PORT' PUBLIC_WEB_ROOT='$PUBLIC_WEB_ROOT' STARTUP_DB_MAINTENANCE='$STARTUP_DB_MAINTENANCE' bash -s" <<'REMOTE'
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

case "${STARTUP_DB_MAINTENANCE:-1}" in
  0|false|False|FALSE|no|No|NO|off|Off|OFF) STARTUP_DB_MAINTENANCE_VALUE=0 ;;
  *) STARTUP_DB_MAINTENANCE_VALUE=1 ;;
esac

if grep -q '^STARTUP_DB_MAINTENANCE=' .env; then
  sed -i "s/^STARTUP_DB_MAINTENANCE=.*/STARTUP_DB_MAINTENANCE=${STARTUP_DB_MAINTENANCE_VALUE}/" .env
else
  printf '\nSTARTUP_DB_MAINTENANCE=%s\n' "$STARTUP_DB_MAINTENANCE_VALUE" >> .env
fi

if grep -q '^SEED_DEMO_DATA=' .env; then
  sed -i "s/^SEED_DEMO_DATA=.*/SEED_DEMO_DATA=0/" .env
else
  printf '\nSEED_DEMO_DATA=0\n' >> .env
fi

export COMPOSE_PARALLEL_LIMIT=1
docker compose build server web
docker compose up -d --no-build --no-deps server server-standby web

if [ -n "${PUBLIC_WEB_ROOT:-}" ]; then
  WEB_CONTAINER="$(docker compose ps -q web)"
  if [ -n "$WEB_CONTAINER" ]; then
    TMP_WEB_ROOT="$(mktemp -d)"
    cleanup() {
      rm -rf "$TMP_WEB_ROOT"
    }
    trap cleanup EXIT
    mkdir -p "$PUBLIC_WEB_ROOT"
    docker cp "${WEB_CONTAINER}:/usr/share/nginx/html/." "$TMP_WEB_ROOT/"
    rsync -a --delete "$TMP_WEB_ROOT/" "$PUBLIC_WEB_ROOT/"
    chmod -R a+rX "$PUBLIC_WEB_ROOT"
    if command -v nginx >/dev/null 2>&1; then
      nginx -t
      if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
        systemctl reload nginx
      else
        nginx -s reload
      fi
    fi
  fi
fi

docker compose ps server server-standby web
REMOTE

echo "Done. Open: http://${ECS_HOST}:${WEB_PORT}/"
