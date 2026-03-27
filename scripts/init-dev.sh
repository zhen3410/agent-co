#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "$ROOT_DIR/data"
mkdir -p "$ROOT_DIR/logs/claude-verbose"

if [[ ! -f "$ROOT_DIR/.env" && -f "$ROOT_DIR/.env.example" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "[init] 已生成 .env（来自 .env.example）"
else
  echo "[init] 保留现有 .env"
fi

echo "[init] 已确保 data/ 与 logs/claude-verbose/ 存在"
echo "[init] 下一步可执行："
echo "  source .env"
echo "  npm run build"
echo "  npm run dev"
