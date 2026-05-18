#!/usr/bin/env bash
# Rocky Linux 9 / CentOS Stream 9 / RHEL 9 一键初始化
# 用法：sudo bash init-server-rocky.sh
set -e

if [ "$EUID" -ne 0 ]; then
  echo "请用 root 或 sudo 执行"
  exit 1
fi

echo "→ 系统更新…"
dnf -y update
dnf -y install git curl wget vim tar gzip ca-certificates

echo "→ 安装 Docker（官方仓库）…"
if ! command -v docker >/dev/null; then
  dnf -y install dnf-plugins-core
  dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
docker compose version

# 加 sudoer 进 docker 组（root 跑则跳过）
if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
  usermod -aG docker "$SUDO_USER" || true
  echo "→ 已把 $SUDO_USER 加入 docker 组（需要重新登录生效）"
fi

echo "→ 配置 firewalld…"
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --permanent --add-port=443/udp     # HTTP/3
firewall-cmd --reload

echo "→ 启用 BBR…"
if ! lsmod | grep -q "^tcp_bbr"; then
  echo "tcp_bbr" >> /etc/modules-load.d/modules.conf
  modprobe tcp_bbr || true
  cat > /etc/sysctl.d/99-bbr.conf <<EOF
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
  sysctl --system >/dev/null
fi

echo "→ 时区 Asia/Shanghai…"
timedatectl set-timezone Asia/Shanghai || true

echo "→ SELinux 容器策略…"
# Rocky 默认开启 SELinux，docker 用 :Z 挂载会自动处理；这里宽松配置允许 docker 跑
setsebool -P container_manage_cgroup on 2>/dev/null || true

echo ""
echo "✅ 服务器初始化完成。下一步："
echo "   1. 把代码放到 /opt/polo"
echo "   2. cd /opt/polo && cp .env.prod.example .env.prod && vim .env.prod"
echo "   3. bash deploy/deploy.sh"
