# =========================================================
# Polo Faka · API Dockerfile
# 在仓库根目录 build：
#   docker build -f apps/api/Dockerfile -t polo-api .
#
# 设计取舍：使用单阶段 build。pnpm v10 的 `deploy` 需要额外配置，
# 这里用 install dev → build → install prod 的方式，简单可控。
# =========================================================
FROM node:20-alpine
WORKDIR /repo

# build & runtime 依赖
RUN apk add --no-cache python3 make g++ libc6-compat openssl tini \
 && corepack enable && corepack prepare pnpm@10 --activate

# 先装 dev 依赖（用于编译）
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @polo/api...

# 复制源码 + prisma generate + nest build
COPY apps/api ./apps/api
RUN pnpm --filter @polo/api exec prisma generate \
 && pnpm --filter @polo/api build

# 移除 dev 依赖，再次安装仅 prod（pnpm 会复用 store，几秒钟）
RUN pnpm install --prod --frozen-lockfile --filter @polo/api... \
 && pnpm --filter @polo/api exec prisma generate \
 && pnpm store prune \
 && apk del python3 make g++ \
 && rm -rf /root/.local/share/pnpm/store /root/.cache

# 切到非 root 用户运行
RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp \
 && chown -R nodeapp:nodeapp /repo
USER nodeapp

ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

WORKDIR /repo/apps/api
RUN chmod +x scripts/entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--", "sh", "scripts/entrypoint.sh"]
