#!/bin/bash
  set -e

  TOKEN=$(openssl rand -hex 16)
  PASSWORD="BotRoom$(openssl rand -hex 4)!@#"

  sudo mkdir -p /etc/bot-room

  sudo tee /etc/bot-room/bot-room-chat.env > /dev/null << EOF
NODE_ENV=production
AUTH_ADMIN_TOKEN=${TOKEN}
AUTH_ADMIN_BASE_URL=http://127.0.0.1:3003
PORT=3002
BOT_ROOM_AUTH_ENABLED=true
EOF

  sudo tee /etc/bot-room/bot-room-auth-admin.env > /dev/null << EOF
NODE_ENV=production
AUTH_ADMIN_TOKEN=${TOKEN}
BOT_ROOM_DEFAULT_PASSWORD=${PASSWORD}
AUTH_ADMIN_PORT=3003
EOF

  sudo chmod 600 /etc/bot-room/*.env

  echo "=========================================="
  echo "配置完成！"
  echo "=========================================="
  echo "管理员密码: ${PASSWORD}"
  echo "请妥善保存此密码"
  echo "=========================================="

  # 重启服务
  sudo systemctl daemon-reload
  sudo systemctl restart bot-room-auth-admin bot-room-chat
