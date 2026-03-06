#!/usr/bin/env bash
set -euo pipefail

# Database backup script for Megh
# Usage: ./scripts/backup.sh [backup_dir]
# Cron example (daily at 2 AM): 0 2 * * * /path/to/cloud-agent-network/scripts/backup.sh

BACKUP_DIR="${1:-./backups}"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="can_backup_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[Backup] Starting PostgreSQL backup..."

docker compose exec -T postgres pg_dump -U can -d can | gzip > "${BACKUP_DIR}/${FILENAME}"

if [ $? -eq 0 ]; then
  SIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
  echo "[Backup] Created: ${BACKUP_DIR}/${FILENAME} (${SIZE})"
else
  echo "[Backup] ERROR: Backup failed!"
  exit 1
fi

# Clean up old backups
echo "[Backup] Cleaning up backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "can_backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

REMAINING=$(ls -1 "${BACKUP_DIR}"/can_backup_*.sql.gz 2>/dev/null | wc -l)
echo "[Backup] Done. ${REMAINING} backup(s) retained."
