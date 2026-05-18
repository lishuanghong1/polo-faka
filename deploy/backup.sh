#!/usr/bin/env bash
# Polo Faka · 数据库定时备份
# 配合 crontab：
#   0 3 * * * /opt/polo/deploy/backup.sh >> /var/log/polo-backup.log 2>&1
set -e

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
set -a; source .env.prod; set +a

BACKUP_DIR=${BACKUP_DIR:-/var/backups/polo}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

OUT="$BACKUP_DIR/polo_${DATE}.sql.gz"

echo "[backup] dumping → $OUT"
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T mysql \
  mysqldump --single-transaction --quick --routines --triggers \
    -upolo -p"$MYSQL_PASSWORD" polo_faka \
  | gzip > "$OUT"

if [ ! -s "$OUT" ]; then
  echo "[backup] ❌ 备份为空，请检查 MySQL 凭证"
  rm -f "$OUT"
  exit 1
fi

echo "[backup] ✅ $(du -h "$OUT" | cut -f1)"

echo "[backup] 清理 ${KEEP_DAYS} 天之前的旧备份…"
find "$BACKUP_DIR" -name "polo_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete

# 可选：上传到 S3 / 阿里云 OSS
# if command -v aws >/dev/null; then
#   aws s3 cp "$OUT" s3://your-bucket/polo/ --storage-class STANDARD_IA
# fi
