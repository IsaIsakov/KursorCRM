#!/bin/sh
set -eu

DATA_ROOT="${PERSISTENT_DATA_DIR:-/data}"
DB_FILE="${DB_PATH:-$DATA_ROOT/kursor.sqlite}"
FILES_DIR="${FILE_STORAGE_DIR:-$DATA_ROOT/files}"
BACKUPS_DIR="${BACKUP_DIR:-$DATA_ROOT/backups}"

mkdir -p "$DATA_ROOT" "$(dirname "$DB_FILE")" "$FILES_DIR" "$BACKUPS_DIR"
chown -R node:node "$DATA_ROOT"

if ! gosu node test -w "$DATA_ROOT"; then
  echo "[startup] ERROR: Volume $DATA_ROOT недоступен для записи пользователю node" >&2
  exit 1
fi

exec gosu node "$@"
