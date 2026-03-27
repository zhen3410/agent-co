#!/bin/bash
#
# redis-forensics.sh
#
# 这个脚本用于对 Redis 进行只读取证检查。
# - 连接指定端口的 Redis（默认 6399）
# - 打印 dbsize
# - 按 namespace 统计 key 数量
# - 抽样显示 key 内容
#
# 重要：此脚本只执行只读操作，不会写入任何数据
#

set -e

# 默认端口
REDIS_PORT="${1:-6399}"
REDIS_CLI="redis-cli -p $REDIS_PORT"

echo "=================================================="
echo "Redis 取证检查工具"
echo "=================================================="
echo "目标端口: $REDIS_PORT"
echo ""

# 检查 Redis 是否可连接
if ! $REDIS_CLI ping > /dev/null 2>&1; then
    echo "错误: 无法连接到 Redis 端口 $REDIS_PORT"
    exit 1
fi

echo "连接状态: OK"
echo ""

# 打印 dbsize
echo "--------------------------------------------------"
echo "1. 数据库大小 (DBSIZE)"
echo "--------------------------------------------------"
DBSIZE=$($REDIS_CLI DBSIZE)
echo "总 key 数量: $DBSIZE"
echo ""

# 按 namespace 统计 key 数量
echo "--------------------------------------------------"
echo "2. Key 分布统计 (按 namespace)"
echo "--------------------------------------------------"

# 统计 demo:msg:*
MSG_COUNT=$($REDIS_CLI KEYS 'demo:msg:*' | wc -l)
echo "  demo:msg:*    : $MSG_COUNT 个"

# 统计 demo:thread:*
THREAD_COUNT=$($REDIS_CLI KEYS 'demo:thread:*' | wc -l)
echo "  demo:thread:* : $THREAD_COUNT 个"

# 统计其他 key
TOTAL_KEYS=$($REDIS_CLI DBSIZE | grep -oE '[0-9]+')
OTHER_COUNT=$((TOTAL_KEYS - MSG_COUNT - THREAD_COUNT))
if [ "$OTHER_COUNT" -gt 0 ]; then
    echo "  其他          : $OTHER_COUNT 个"
fi
echo ""

# 抽样显示 3 个 key 的内容
echo "--------------------------------------------------"
echo "3. 数据抽样 (随机 3 个 key)"
echo "--------------------------------------------------"

# 获取所有 key 并随机选 3 个
ALL_KEYS=$($REDIS_CLI KEYS '*')

if [ -z "$ALL_KEYS" ]; then
    echo "数据库为空，没有可显示的 key"
else
    # 随机选择 3 个 key
    SAMPLE_KEYS=$(echo "$ALL_KEYS" | shuf -n 3 2>/dev/null || echo "$ALL_KEYS" | head -n 3)

    COUNT=1
    while IFS= read -r key; do
        if [ -n "$key" ]; then
            echo ""
            echo "[样本 $COUNT] Key: $key"
            echo "类型: $($REDIS_CLI TYPE "$key")"
            echo "内容:"

            # 根据类型获取内容
            KEY_TYPE=$($REDIS_CLI TYPE "$key")
            case "$KEY_TYPE" in
                string)
                    $REDIS_CLI GET "$key"
                    ;;
                list)
                    $REDIS_CLI LRANGE "$key" 0 -1
                    ;;
                set)
                    $REDIS_CLI SMEMBERS "$key"
                    ;;
                zset)
                    $REDIS_CLI ZRANGE "$key" 0 -1 WITHSCORES
                    ;;
                hash)
                    $REDIS_CLI HGETALL "$key"
                    ;;
                *)
                    echo "(未知类型)"
                    ;;
            esac
            COUNT=$((COUNT + 1))
        fi
    done <<< "$SAMPLE_KEYS"
fi

echo ""
echo "=================================================="
echo "取证检查完成 (仅执行只读操作)"
echo "=================================================="
