#!/usr/bin/env bash
# Ubuntu 22.04+/Debian 12+ 一键初始化
# 用法：sudo bash init-server.sh
set -e

if [ "$EUID" -ne 0 ]; then
  echo "请用 root 或 sudo 执行"
  exit 1
fi

echo "→ 系统更新…"
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw git

echo "→ 安装 Docker…"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "→ 启用 docker compose v2 测试…"
docker compose version

# 把当前 sudoer 加到 docker 组（如果是从 root 跑则跳过）
if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
  usermod -aG docker "$SUDO_USER" || true
  echo "→ 已把 $SUDO_USER 加入 docker 组（需要重新登录生效）"
fi

echo "→ 配置 ufw 防火墙…"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp     # HTTP/3
ufw --force enable

echo "→ 启用 BBR 拥塞控制…"
if ! lsmod | grep -q "^tcp_bbr"; then
  echo "tcp_bbr" >> /etc/modules-load.d/modules.conf
  echo -e "net.core.default_qdisc=fq\nnet.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.d/99-bbr.conf
  sysctl --system >/dev/null
fi

echo "→ 配置时区为 Asia/Shanghai…"
timedatectl set-timezone Asia/Shanghai || true

echo ""
echo "✅ 服务器初始化完成。下一步："
echo "   1. 退出并重新登录（让 docker 用户组生效）"
echo "   2. git clone <repo> /opt/polo && cd /opt/polo"
echo "   3. cp .env.prod.example .env.prod && vim .env.prod"
echo "   4. bash deploy/deploy.sh"
