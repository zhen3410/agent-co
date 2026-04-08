#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "$EUID" -ne 0 ]]; then
  echo "请使用 root 运行：sudo bash scripts/one-click-deploy.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "[1/6] 安装基础依赖..."
apt-get update -y
apt-get install -y curl ca-certificates gnupg redis-server

if ! command -v node >/dev/null 2>&1; then
  echo "[2/6] 安装 Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "[2/6] 检测到 Node.js: $(node -v)"
fi

echo "[3/6] 启用并启动 Redis..."
systemctl enable redis-server
systemctl restart redis-server

if ! redis-cli ping | grep -q PONG; then
  echo "Redis 启动失败"
  exit 1
fi

# 初始化运行配置（可按需调整）
redis-cli HSET agent-co:config chat_sessions_key agent-co:chat:sessions:v1 >/dev/null

echo "[4/6] 安装依赖并构建..."
cd "$APP_DIR"
npm install
npm run build

echo "[5/6] 安装 systemd 服务..."
bash "$APP_DIR/scripts/install-systemd.sh"

echo "[6/6] 完成，服务状态："
systemctl --no-pager --full status redis-server || true
systemctl --no-pager --full status agent-co.service || true

echo "一键部署完成。"
