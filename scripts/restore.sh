#!/usr/bin/env bash
set -euo pipefail

# Database restore script for Megh
# Usage: ./scripts/restore.sh <backup_file.sql.gz>

if [ $# -eq 0 ]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  echo ""
  echo "Available backups:"
  ls -lt backups/can_backup_*.sql.gz 2>/dev/null || echo "  No backups found in ./backups/"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[Restore] ERROR: File not found: ${BACKUP_FILE}"
  exit 1
fi

echo "[Restore] WARNING: This will drop and recreate the 'can' database."
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "[Restore] Aborted."
  exit 0
fi

echo "[Restore] Restoring from ${BACKUP_FILE}..."

# Drop and recreate database
docker compose exec -T postgres psql -U can -d postgres -c "DROP DATABASE IF EXISTS can;"
docker compose exec -T postgres psql -U can -d postgres -c "CREATE DATABASE can OWNER can;"

# Restore
gunzip -c "${BACKUP_FILE}" | docker compose exec -T postgres psql -U can -d can

echo "[Restore] Done."
