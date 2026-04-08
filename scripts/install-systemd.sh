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
CHAT_UNIT_SRC="$APP_DIR/systemd/agent-co-chat.service"
AUTH_UNIT_SRC="$APP_DIR/systemd/agent-co-auth-admin.service"

if [[ "$EUID" -ne 0 ]]; then
  echo "请使用 root 运行：sudo bash scripts/install-systemd.sh"
  exit 1
fi

mkdir -p "$ENV_DIR"

if [[ ! -d "$APP_DIR/systemd" ]]; then
  echo "未找到部署目录中的 systemd 配置：$APP_DIR/systemd"
  exit 1
fi

if [[ ! -f "$AUTH_UNIT_SRC" || ! -f "$CHAT_UNIT_SRC" ]]; then
  echo "未找到 systemd unit 文件，请确认部署目录完整：$APP_DIR/systemd"
  exit 1
fi

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

render_and_install_unit "$AUTH_UNIT_SRC" "$SYSTEMD_DIR/agent-co-auth-admin.service"
render_and_install_unit "$CHAT_UNIT_SRC" "$SYSTEMD_DIR/agent-co-chat.service"
chmod 0644 "$SYSTEMD_DIR/agent-co-auth-admin.service" "$SYSTEMD_DIR/agent-co-chat.service"

if [[ ! -f "$ENV_DIR/agent-co-auth-admin.env" ]]; then
  install -m 0640 "$APP_DIR/systemd/agent-co-auth-admin.env.example" "$ENV_DIR/agent-co-auth-admin.env"
  echo "已生成 $ENV_DIR/agent-co-auth-admin.env，请修改默认密钥后继续。"
fi

systemctl daemon-reload
systemctl enable --now agent-co-auth-admin.service
systemctl enable --now agent-co-chat.service

systemctl --no-pager --full status agent-co-auth-admin.service || true
systemctl --no-pager --full status agent-co-chat.service || true

echo "systemd 安装完成。"
