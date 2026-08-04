#!/usr/bin/env sh
# Polo Faka API 启动脚本
# 1. 等待 MySQL 就绪
# 2. prisma db push（首次/有变更时同步表）
# 3. 创建默认 admin（幂等）
# 4. 启动 Nest

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

# 桌面安装包目录：确保可写（挂载宿主机目录时若权限不对，上传会失败）
DESKTOP_DIR="${DESKTOP_STATIC_DIR:-/data/desktop-static}"
mkdir -p "$DESKTOP_DIR" 2>/dev/null || true
if [ -d "$DESKTOP_DIR" ] && [ ! -w "$DESKTOP_DIR" ]; then
  echo "[boot] WARN: $DESKTOP_DIR 不可写，后台上传 polo.exe/polo.dmg 会失败。"
  echo "[boot] HINT: 在宿主机执行 chmod 777 deploy/static/desktop 或 chown 到容器用户"
fi

echo "[boot] starting API…"
if [ -f dist/main.js ]; then
  exec node dist/main.js
fi
exec node dist/src/main.js
