#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIST_DIR="$ROOT_DIR/dist/frontend"

mkdir -p "$ROOT_DIR/data"
mkdir -p "$ROOT_DIR/logs/ai-cli-verbose"

if [[ ! -f "$ROOT_DIR/.env" && -f "$ROOT_DIR/.env.example" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "[init] 已生成 .env（来自 .env.example）"
else
  echo "[init] 保留现有 .env"
fi

echo "[init] 已确保 data/ 与 logs/ai-cli-verbose/ 存在"
echo "[init] React 多页面静态产物会输出到: $FRONTEND_DIST_DIR"
echo "[init] 下一步可执行："
echo "  npm install"
echo "  set -a"
echo "  source .env"
echo "  set +a"
echo "  # 终端 1：启动 Vite 本地前端开发循环"
echo "  npm run dev:frontend"
echo "  # 终端 2：重新构建 dist/frontend 后启动聊天服务"
echo "  npm run build"
echo "  npm run dev"
echo "  # 终端 3（需要后台页时）"
echo "  npm run start:auth"
echo "[init] 注意：Node 服务始终从 dist/frontend 读取页面；修改 frontend/ 后请重新执行 npm run build。"
