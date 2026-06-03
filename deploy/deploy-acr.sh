#!/usr/bin/env bash
# =========================================================
# Polo Faka · 从阿里云 ACR 拉镜像并重启服务
#
# 用法（在服务器项目目录下）：
#   bash deploy/deploy-acr.sh           # 拉 web + api 并重启
#   bash deploy/deploy-acr.sh web       # 只拉 web
#   bash deploy/deploy-acr.sh api       # 只拉 api
#
# 适用：已通过 GitHub Actions 把镜像推到 ACR 的场景。服务器只 pull，
#       不在本地 build，省下 1.5–2GB 内存峰值，2GB 小机器也能秒级部署。
#
# 前置（首次需要）：
#   1) .env.prod 里配好 IMAGE_BASE 和 IMAGE_TAG（见 .env.prod.example）
#   2) docker login 已登录 ACR（凭证持久化到 ~/.docker/config.json）
#      如果还没登录：
#        docker login --username=<阿里云账号> registry.cn-xxx.aliyuncs.com
# =========================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.prod ]; then
  echo "❌ .env.prod 不存在"
  exit 1
fi

# 读取 IMAGE_BASE 校验是不是配了 ACR（用 . 加载会污染当前 shell，用 grep 取值）
IMAGE_BASE_VAL=$(grep -E '^IMAGE_BASE=' .env.prod | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
IMAGE_TAG_VAL=$(grep -E '^IMAGE_TAG=' .env.prod | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
IMAGE_TAG_VAL=${IMAGE_TAG_VAL:-latest}

if [ -z "$IMAGE_BASE_VAL" ]; then
  echo "❌ .env.prod 里没配 IMAGE_BASE，这个脚本只用于 ACR 部署"
  echo "   想本地构建请用：bash deploy/deploy.sh"
  exit 1
fi

# 检查 docker 是否已登录到对应 registry（从 IMAGE_BASE 提取 host）
REGISTRY_HOST="${IMAGE_BASE_VAL%%/*}"
if ! grep -q "\"$REGISTRY_HOST\"" ~/.docker/config.json 2>/dev/null; then
  echo "⚠ 还未登录 $REGISTRY_HOST"
  echo "  请先执行：docker login --username=<阿里云账号> $REGISTRY_HOST"
  echo "  密码是 ACR 控制台「访问凭证」里设置的固定密码，不是阿里云账户密码"
  exit 1
fi

# ─── 拉镜像 ───
TARGETS="${1:-}"
case "$TARGETS" in
  ""|both|all)  PULL_SERVICES="api web" ;;
  api)          PULL_SERVICES="api" ;;
  web)          PULL_SERVICES="web" ;;
  *) echo "❌ 未知参数：$TARGETS（可选 web / api / both）"; exit 1 ;;
esac

echo "═══════════════════════════════════════════"
echo "  IMAGE_BASE = $IMAGE_BASE_VAL"
echo "  IMAGE_TAG  = $IMAGE_TAG_VAL"
echo "  目标       = $PULL_SERVICES"
echo "═══════════════════════════════════════════"

echo "→ 拉取镜像…"
# shellcheck disable=SC2086
docker compose -f docker-compose.prod.yml --env-file .env.prod pull $PULL_SERVICES

# ─── 重启 ───
echo "→ 平滑重启…"
# shellcheck disable=SC2086
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d $PULL_SERVICES

# ─── 健康检查 ───
if echo "$PULL_SERVICES" | grep -qw api; then
  echo "→ 等待 API 健康…"
  for i in {1..30}; do
    if docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api \
        sh -c "wget -qO- http://127.0.0.1:4000/api/site-settings/public >/dev/null 2>&1"; then
      echo "  ✅ API up"
      break
    fi
    sleep 2
    [ "$i" = "30" ] && echo "  ⚠ API 启动慢，请查日志：docker compose -f docker-compose.prod.yml logs --tail=80 api"
  done
fi

# ─── 清理 ───
echo "→ 清理悬空镜像（节省磁盘）…"
docker image prune -f >/dev/null

echo
echo "═══════════════════════════════════════════"
echo "✅ 部署完成"
echo "═══════════════════════════════════════════"
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
echo
echo "日志：docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f $PULL_SERVICES"
