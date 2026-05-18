# =========================================================
# Polo Faka · Web Dockerfile（Vue SPA + Nginx 静态托管）
# 在仓库根目录 build：
#   docker build -f apps/web/Dockerfile -t polo-web .
# =========================================================

FROM node:20-alpine AS builder
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10 --activate \
 && pnpm config set registry https://registry.npmmirror.com

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @polo/web...

COPY apps/web ./apps/web
RUN pnpm --filter @polo/web build

# -------- runtime：nginx 提供静态文件 --------
FROM nginx:1.27-alpine AS runner

# 上游已由外层 Caddy 处理 SSL / gzip / 反代；这里只负责 SPA fallback
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html

# 让 nginx 以非 root 启动会更安全，但官方镜像默认 root，需要调整目录权限。
# 保持默认即可——这个容器不暴露公网端口，只由内网 Caddy 反代访问。

EXPOSE 80
