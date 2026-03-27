#!/bin/bash
#
# simulate-disaster.sh
#
# 这个脚本用于模拟 Redis 数据丢失灾难场景。
# - 先触发 BGSAVE 确保有一份"灾前备份"
# - 等待 BGSAVE 完成
# - 警告用户并要求确认
# - 执行 FLUSHDB 清空数据
#
# 警告：此操作不可逆！
#

set -e

# 默认端口
REDIS_PORT="${1:-6399}"
REDIS_CLI="redis-cli -p $REDIS_PORT"

echo "=================================================="
echo "Redis 灾难模拟工具"
echo "=================================================="
echo "目标端口: $REDIS_PORT"
echo ""

# 检查 Redis 是否可连接
if ! $REDIS_CLI ping > /dev/null 2>&1; then
    echo "错误: 无法连接到 Redis 端口 $REDIS_PORT"
    exit 1
fi

# 显示当前数据量
echo "当前 DBSIZE: $($REDIS_CLI DBSIZE)"
echo ""

# 步骤 1: 触发 BGSAVE
echo "--------------------------------------------------"
echo "步骤 1: 触发 BGSAVE (创建灾前备份)"
echo "--------------------------------------------------"

# 检查是否已经在进行 BGSAVE
BGSAVE_STATUS=$($REDIS_CLI LASTSAVE)
echo "触发 BGSAVE..."
$REDIS_CLI BGSAVE > /dev/null

# 等待 BGSAVE 完成
echo "等待 BGSAVE 完成..."
sleep 1

# 轮询检查 BGSAVE 是否完成
MAX_WAIT=60
WAIT_COUNT=0
while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    # 检查是否有正在进行的 BGSAVE
    INFO=$($REDIS_CLI INFO persistence)
    if echo "$INFO" | grep -q "rdb_bgsave_in_progress:0"; then
        echo "✓ BGSAVE 完成"
        break
    fi
    printf "."
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done
echo ""

if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
    echo "警告: BGSAVE 超时，但将继续执行"
fi

# 显示 RDB 文件信息
echo ""
echo "RDB 最后保存时间: $(date -d @$($REDIS_CLI LASTSAVE) '+%Y-%m-%d %H:%M:%S')"
echo ""

# 步骤 2: 警告并确认
echo "=================================================="
echo "⚠️  警告 ⚠️"
echo "=================================================="
echo "即将执行 FLUSHDB，这会清空所有数据！"
echo "此操作不可逆！"
echo ""
echo "如果确定要继续，请输入: FLUSH $REDIS_PORT"
echo "输入其他任何内容将取消操作"
echo ""
read -r "请确认: " CONFIRM

# 验证确认输入
if [ "$CONFIRM" != "FLUSH $REDIS_PORT" ]; then
    echo ""
    echo "确认不匹配，操作已取消"
    exit 0
fi

# 步骤 3: 执行 FLUSHDB
echo ""
echo "--------------------------------------------------"
echo "步骤 3: 执行 FLUSHDB"
echo "--------------------------------------------------"

# 记录灾前数据量
PRE_DISASTER_SIZE=$($REDIS_CLI DBSIZE)
echo "灾前 DBSIZE: $PRE_DISASTER_SIZE"

# 执行 FLUSHDB
echo "执行 FLUSHDB..."
$REDIS_CLI FLUSHDB

# 记录灾后数据量
POST_DISASTER_SIZE=$($REDIS_CLI DBSIZE)
echo "灾后 DBSIZE: $POST_DISASTER_SIZE"

echo ""
echo "=================================================="
echo "灾难模拟完成"
echo "=================================================="
echo "数据已清空，可以使用 restore-from-rdb.sh 恢复"
echo ""
