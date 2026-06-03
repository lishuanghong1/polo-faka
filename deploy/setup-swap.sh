#!/usr/bin/env bash
# =========================================================
# 一键 swap 配置脚本（适用于 2GB / 4GB 轻量服务器）
#
# 用法：
#   sudo bash deploy/setup-swap.sh          # 创建 4GB swap（默认）
#   sudo bash deploy/setup-swap.sh 2        # 创建 2GB swap
#   sudo bash deploy/setup-swap.sh 6        # 创建 6GB swap
#   sudo bash deploy/setup-swap.sh off      # 关闭并删除已有 swap
#
# 作用：
#   - 创建 /swapfile（指定大小，默认 4GB）
#   - 写入 /etc/fstab，重启自动挂载
#   - 设置 swappiness=10（平时少用 swap，急时才用，避免日常性能下降）
#   - 幂等：已有同大小 swap 时直接退出，不破坏数据
#
# 适用场景：
#   docker compose --build 时构建过程吃掉 1.5–2GB 内存，
#   小内存服务器（2GB / 4GB）会 OOM 卡死。swap 把构建峰值
#   溢出部分落到磁盘，慢一点但不死。
# =========================================================
set -euo pipefail

SWAP_FILE="/swapfile"
SWAPPINESS=10

if [ "$EUID" -ne 0 ]; then
  echo "❌ 请用 root 或 sudo 执行：sudo bash $0"
  exit 1
fi

ARG="${1:-4}"

# ─── 关闭模式 ───
if [ "$ARG" = "off" ] || [ "$ARG" = "down" ] || [ "$ARG" = "remove" ]; then
  echo "→ 关闭 swap…"
  if swapon --show=NAME --noheadings | grep -qx "$SWAP_FILE"; then
    swapoff "$SWAP_FILE"
    echo "  已关闭 $SWAP_FILE"
  else
    echo "  $SWAP_FILE 未启用，跳过"
  fi
  if [ -f "$SWAP_FILE" ]; then
    rm -f "$SWAP_FILE"
    echo "  已删除 $SWAP_FILE"
  fi
  if grep -q "^$SWAP_FILE " /etc/fstab; then
    sed -i.bak "\|^$SWAP_FILE |d" /etc/fstab
    echo "  已从 /etc/fstab 清理"
  fi
  echo "✅ swap 已关闭并清理"
  free -h
  exit 0
fi

# ─── 创建模式 ───
SIZE_GB="$ARG"
if ! [[ "$SIZE_GB" =~ ^[1-9][0-9]*$ ]]; then
  echo "❌ 大小参数非法：$SIZE_GB（应为正整数 GB）"
  echo "用法：sudo bash $0 [大小GB|off]"
  exit 1
fi
SIZE_MB=$((SIZE_GB * 1024))

echo "═══════════════════════════════════════════"
echo "  目标：创建 ${SIZE_GB}GB swap @ $SWAP_FILE"
echo "═══════════════════════════════════════════"

# 1. 已存在同大小 swap：直接幂等退出
if [ -f "$SWAP_FILE" ] && swapon --show=NAME --noheadings | grep -qx "$SWAP_FILE"; then
  CURRENT_BYTES=$(stat -c%s "$SWAP_FILE")
  TARGET_BYTES=$((SIZE_MB * 1024 * 1024))
  if [ "$CURRENT_BYTES" -eq "$TARGET_BYTES" ]; then
    echo "✅ $SWAP_FILE 已存在且大小一致（${SIZE_GB}GB），无需操作"
    free -h
    exit 0
  fi
  echo "⚠ 已存在 $SWAP_FILE，但大小不一致（当前 $((CURRENT_BYTES / 1024 / 1024))MB，目标 ${SIZE_MB}MB）"
  echo "→ 先关闭并重新创建…"
  swapoff "$SWAP_FILE" || true
  rm -f "$SWAP_FILE"
fi

# 2. 检查磁盘剩余空间是否够
AVAIL_MB=$(df -m / | awk 'NR==2{print $4}')
if [ "$AVAIL_MB" -lt $((SIZE_MB + 512)) ]; then
  echo "❌ 根分区剩余 ${AVAIL_MB}MB，不足以创建 ${SIZE_MB}MB swap（需预留 512MB 缓冲）"
  exit 1
fi

# 3. 创建文件
echo "→ 创建 ${SIZE_GB}GB 文件 $SWAP_FILE …"
if command -v fallocate >/dev/null && fallocate -l "${SIZE_GB}G" "$SWAP_FILE" 2>/dev/null; then
  : # fallocate 成功（绝大多数 ext4 / xfs 都支持，秒级完成）
else
  echo "  fallocate 不可用，回退到 dd（会慢一些）…"
  dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SIZE_MB" status=progress
fi
chmod 600 "$SWAP_FILE"

# 4. 格式化为 swap
echo "→ 格式化为 swap…"
mkswap "$SWAP_FILE" >/dev/null

# 5. 启用
echo "→ 启用 swap…"
swapon "$SWAP_FILE"

# 6. 写入 fstab（幂等：先清理已有同路径行）
if grep -q "^$SWAP_FILE " /etc/fstab; then
  sed -i.bak "\|^$SWAP_FILE |d" /etc/fstab
fi
echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
echo "→ 已写入 /etc/fstab，重启自动挂载"

# 7. 调 swappiness
echo "→ 设置 vm.swappiness=$SWAPPINESS（平时少用 swap，急时才用）…"
sysctl -w vm.swappiness="$SWAPPINESS" >/dev/null
# 写到 /etc/sysctl.d 比直接改 /etc/sysctl.conf 干净
mkdir -p /etc/sysctl.d
cat > /etc/sysctl.d/99-polo-swap.conf <<EOF
vm.swappiness=$SWAPPINESS
vm.vfs_cache_pressure=50
EOF

echo
echo "═══════════════════════════════════════════"
echo "✅ swap 配置完成"
echo "═══════════════════════════════════════════"
free -h
echo
echo "swappiness: $(cat /proc/sys/vm/swappiness)"
echo
echo "如需关闭：sudo bash $0 off"
