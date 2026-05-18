#!/usr/bin/env bash
# Polo Faka · 一键发布脚本
# 用法：cd /opt/polo && bash deploy/deploy.sh
set -e

cd "$(dirname "$0")/.."

if [ ! -f .env.prod ]; then
  echo "❌ .env.prod 不存在。请先 cp .env.prod.example .env.prod 并填值"
  exit 1
fi

# 校验关键变量
for k in DOMAIN MYSQL_ROOT_PASSWORD MYSQL_PASSWORD REDIS_PASSWORD JWT_SECRET POOL_ENCRYPTION_KEY ADMIN_DEFAULT_PASSWORD; do
  val=$(grep -E "^${k}=" .env.prod | head -1 | cut -d= -f2-)
  if [ -z "$val" ] || echo "$val" | grep -q CHANGEME; then
    echo "❌ .env.prod 中 ${k} 还是默认值或为空，必须修改"
    exit 1
  fi
done

echo "→ git pull"
git fetch --all
git pull --ff-only || echo "(跳过 git pull)"

echo "→ build images（首次可能较慢）"
docker compose -f docker-compose.prod.yml --env-file .env.prod build

echo "→ up -d"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

echo "→ 等待 API 健康…"
for i in {1..30}; do
  if docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api node -e "require('http').get('http://localhost:4000/api/site-settings/public',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
    echo "✅ API up"
    break
  fi
  sleep 2
  if [ "$i" = "30" ]; then
    echo "⚠️  API 启动慢，请检查日志：docker compose -f docker-compose.prod.yml logs api"
  fi
done

echo ""
echo "✅ 部署完成。"
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
echo ""
echo "查看日志：docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api"
echo "访问站点：https://$(grep ^DOMAIN= .env.prod | cut -d= -f2)"
