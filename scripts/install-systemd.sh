#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="${APP_DIR:-$DEFAULT_APP_DIR}"
if [[ ! -d "$APP_DIR" ]]; then
  echo "部署目录不存在：$APP_DIR"
  exit 1
fi
APP_DIR="$(cd "$APP_DIR" && pwd)"
SYSTEMD_DIR="/etc/systemd/system"
ENV_DIR="/etc/agent-co"
UNIT_SRC="$APP_DIR/systemd/agent-co.service"

if [[ "$EUID" -ne 0 ]]; then
  echo "请使用 root 运行：sudo bash scripts/install-systemd.sh"
  exit 1
fi

mkdir -p "$ENV_DIR"

if [[ ! -d "$APP_DIR/systemd" ]]; then
  echo "未找到部署目录中的 systemd 配置：$APP_DIR/systemd"
  exit 1
fi

if [[ ! -f "$UNIT_SRC" ]]; then
  echo "未找到 systemd unit 文件，请确认部署目录完整：$APP_DIR/systemd"
  exit 1
fi

require_built_artifact() {
  local artifact_path="$1"
  if [[ ! -f "$artifact_path" ]]; then
    echo "缺少构建产物：$artifact_path"
    echo "请先在仓库根目录执行 npm install && npm run build，再安装或重启 systemd 服务。"
    exit 1
  fi
}

require_built_artifact "$APP_DIR/dist/server.js"
require_built_artifact "$APP_DIR/dist/auth-admin-server.js"
require_built_artifact "$APP_DIR/dist/frontend/chat.html"
require_built_artifact "$APP_DIR/dist/frontend/admin.html"
require_built_artifact "$APP_DIR/dist/frontend/deps-monitor.html"
require_built_artifact "$APP_DIR/dist/frontend/verbose-logs.html"

escape_for_sed() {
  printf '%s' "$1" | sed -e 's/[\\&]/\\\\&/g' -e 's|/|\\/|g'
}

render_and_install_unit() {
  local src="$1"
  local dst="$2"
  local escaped_app_dir
  escaped_app_dir="$(escape_for_sed "$APP_DIR")"
  sed "s/__APP_DIR__/$escaped_app_dir/g" "$src" > "$dst"
}

# Remove legacy dual-service units if present
for legacy in agent-co-chat.service agent-co-auth-admin.service bot-room-chat.service bot-room-auth-admin.service; do
  if [[ -f "$SYSTEMD_DIR/$legacy" ]]; then
    systemctl stop "$legacy" 2>/dev/null || true
    systemctl disable "$legacy" 2>/dev/null || true
    rm -f "$SYSTEMD_DIR/$legacy"
    echo "已移除旧服务：$legacy"
  fi
done

render_and_install_unit "$UNIT_SRC" "$SYSTEMD_DIR/agent-co.service"
chmod 0644 "$SYSTEMD_DIR/agent-co.service"

if [[ ! -f "$ENV_DIR/agent-co.env" ]]; then
  # Migrate from legacy split env files if they exist
  if [[ -f "/etc/bot-room/bot-room-chat.env" && -f "/etc/bot-room/bot-room-auth-admin.env" ]]; then
    echo "# Merged from legacy split env files on $(date -I)" > "$ENV_DIR/agent-co.env"
    echo "" >> "$ENV_DIR/agent-co.env"
    cat "/etc/bot-room/bot-room-chat.env" "/etc/bot-room/bot-room-auth-admin.env" >> "$ENV_DIR/agent-co.env"
    echo "已从旧配置合并为 $ENV_DIR/agent-co.env"
  else
    install -m 0640 "$APP_DIR/systemd/agent-co.env.example" "$ENV_DIR/agent-co.env"
    echo "已生成 $ENV_DIR/agent-co.env，请修改默认密钥后继续。"
  fi
fi

# Make start-services.sh executable (in case deployed from git without +x)
chmod +x "$APP_DIR/scripts/start-services.sh"

systemctl daemon-reload
systemctl enable --now agent-co.service

systemctl --no-pager --full status agent-co.service || true

echo "systemd 安装完成。"
