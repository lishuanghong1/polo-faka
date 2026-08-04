#!/usr/bin/env sh
# Polo Faka API 启动脚本
# 1. 等待 MySQL 就绪
# 2. prisma db push（首次/有变更时同步表）
# 3. 创建默认 admin（幂等）
# 4. 修正桌面安装包目录权限后，降权启动 Nest

set -e

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

echo "[boot] waiting for database…"
ATTEMPTS=0
until node -e "
const url = process.env.DATABASE_URL;
const m = url.match(/^mysql:\/\/[^:]+:[^@]+@([^:/]+):(\d+)\//);
if (!m) { process.exit(0); }
require('net').createConnection({ host: m[1], port: Number(m[2]) }, ()=>process.exit(0))
  .on('error', ()=>process.exit(1));
"; do
  ATTEMPTS=$((ATTEMPTS+1))
  if [ "$ATTEMPTS" -ge 60 ]; then
    echo "[boot] database not reachable, give up after 60s"
    exit 1
  fi
  sleep 1
done
echo "[boot] database reachable"

echo "[boot] prisma db push…"
# pnpm hoist: prisma 在 /repo/node_modules/.pnpm/...，用 npx 走 PATH 最稳
npx --no-install prisma db push --schema=prisma/schema.prisma --skip-generate --accept-data-loss

echo "[boot] seeding default admin…"
node scripts/post-deploy.cjs || echo "[boot] seed failed (continuing)"

# 桌面安装包目录：bind mount 常为 root 所有，需在降权前 chown，否则后台上传 500
DESKTOP_DIR="${DESKTOP_STATIC_DIR:-/data/desktop-static}"
mkdir -p "$DESKTOP_DIR"
if [ "$(id -u)" = "0" ]; then
  chown -R nodeapp:nodeapp "$DESKTOP_DIR" 2>/dev/null \
    && echo "[boot] desktop dir ownership → nodeapp: $DESKTOP_DIR" \
    || echo "[boot] WARN: chown $DESKTOP_DIR failed"
  chmod 775 "$DESKTOP_DIR" 2>/dev/null || true
fi

echo "[boot] starting API…"
if [ -f dist/main.js ]; then
  MAIN_JS="dist/main.js"
else
  MAIN_JS="dist/src/main.js"
fi

if [ "$(id -u)" = "0" ] && command -v su-exec >/dev/null 2>&1; then
  exec su-exec nodeapp node "$MAIN_JS"
fi
exec node "$MAIN_JS"
