#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bot-room}"
SYSTEMD_DIR="/etc/systemd/system"
ENV_DIR="/etc/bot-room"

if [[ "$EUID" -ne 0 ]]; then
  echo "请使用 root 运行：sudo bash scripts/install-systemd.sh"
  exit 1
fi

mkdir -p "$ENV_DIR"

install -m 0644 "$APP_DIR/systemd/bot-room-auth-admin.service" "$SYSTEMD_DIR/bot-room-auth-admin.service"
install -m 0644 "$APP_DIR/systemd/bot-room-chat.service" "$SYSTEMD_DIR/bot-room-chat.service"

if [[ ! -f "$ENV_DIR/bot-room-auth-admin.env" ]]; then
  install -m 0640 "$APP_DIR/systemd/bot-room-auth-admin.env.example" "$ENV_DIR/bot-room-auth-admin.env"
  echo "已生成 $ENV_DIR/bot-room-auth-admin.env，请修改默认密钥后继续。"
fi

if [[ ! -f "$ENV_DIR/bot-room-chat.env" ]]; then
  install -m 0640 "$APP_DIR/systemd/bot-room-chat.env.example" "$ENV_DIR/bot-room-chat.env"
  echo "已生成 $ENV_DIR/bot-room-chat.env。"
fi

systemctl daemon-reload
systemctl enable --now bot-room-auth-admin.service
systemctl enable --now bot-room-chat.service

systemctl --no-pager --full status bot-room-auth-admin.service || true
systemctl --no-pager --full status bot-room-chat.service || true

echo "systemd 安装完成。"
