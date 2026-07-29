#!/bin/sh
set -eu

interval="${BACKUP_INTERVAL_SECONDS:-86400}"

while true; do
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="/backups/hanye-${stamp}.sql.gz"
  echo "Creating PostgreSQL backup: ${file}"
  pg_dump --clean --if-exists --no-owner --no-privileges | gzip > "${file}"
  find /backups -name 'hanye-*.sql.gz' -type f -mtime +14 -delete
  sleep "${interval}"
done
