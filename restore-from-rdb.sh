#!/bin/bash
#
# restore-from-rdb.sh
#
# 这个脚本用于从 RDB 文件恢复 Redis 数据。
# - 接受 --source 参数指定 RDB 文件路径
# - 恢复前先备份当前 dump
# - 关闭 Redis → 替换 dump.rdb → 重启 Redis
# - 恢复后打印 dbsize 和 key 分布统计
#
# 用法:
#   ./restore-from-rdb.sh --source /path/to/dump.rdb --yes  # 实际执行
#   ./restore-from-rdb.sh --source /path/to/dump.rdb        # 只打印计划
#

set -e

# 默认配置
REDIS_PORT=6399
REDIS_CLI="redis-cli -p $REDIS_PORT"
SOURCE_FILE=""
EXECUTE=false

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --source)
            SOURCE_FILE="$2"
            shift 2
            ;;
        --yes)
            EXECUTE=true
            shift
            ;;
        --port)
            REDIS_PORT="$2"
            REDIS_CLI="redis-cli -p $REDIS_PORT"
            shift 2
            ;;
        -h|--help)
            echo "用法: $0 --source <rdb文件路径> [--port <端口>] [--yes]"
            echo ""
            echo "参数:"
            echo "  --source  指定要恢复的 RDB 文件路径"
            echo "  --port    Redis 端口 (默认: 6399)"
            echo "  --yes     实际执行恢复 (不加此参数只打印计划)"
            echo ""
            exit 0
            ;;
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
done

# 检查必要参数
if [ -z "$SOURCE_FILE" ]; then
    echo "错误: 必须指定 --source 参数"
    echo "用法: $0 --source <rdb文件路径> [--yes]"
    exit 1
fi

# 检查源文件是否存在
if [ ! -f "$SOURCE_FILE" ]; then
    echo "错误: 源文件不存在: $SOURCE_FILE"
    exit 1
fi

# 获取 Redis 配置中的 dir 和 dbfilename
REDIS_DIR=$($REDIS_CLI CONFIG GET dir | tail -n 1)
REDIS_DBFILENAME=$($REDIS_CLI CONFIG GET dbfilename | tail -n 1)
CURRENT_RDB="$REDIS_DIR/$REDIS_DBFILENAME"
BACKUP_RDB="${CURRENT_RDB}.bak.$(date +%Y%m%d_%H%M%S)"

echo "=================================================="
echo "Redis RDB 恢复工具"
echo "=================================================="
echo "目标端口    : $REDIS_PORT"
echo "源 RDB 文件 : $SOURCE_FILE"
echo "当前 RDB    : $CURRENT_RDB"
echo "备份位置    : $BACKUP_RDB"
echo "执行模式    : $([ "$EXECUTE" = true ] && echo "实际执行" || echo "仅打印计划")"
echo ""

# 显示恢复计划
echo "--------------------------------------------------"
echo "恢复计划"
echo "--------------------------------------------------"
echo "1. 备份当前 dump.rdb → $BACKUP_RDB"
echo "2. 关闭 Redis 服务"
echo "3. 复制源 RDB 文件到 $CURRENT_RDB"
echo "4. 重启 Redis 服务"
echo "5. 验证恢复结果"
echo ""

# 如果没有 --yes 参数，只打印计划然后退出
if [ "$EXECUTE" != true ]; then
    echo "=================================================="
    echo "这是恢复计划，未实际执行"
    echo "要执行恢复，请添加 --yes 参数"
    echo "=================================================="
    exit 0
    # 不再执行后续操作
fi

# 实际执行恢复
echo "=================================================="
echo "开始执行恢复..."
echo "=================================================="

# 步骤 1: 备份当前 RDB
echo ""
echo "[1/5] 备份当前 RDB 文件..."
if [ -f "$CURRENT_RDB" ]; then
    cp "$CURRENT_RDB" "$BACKUP_RDB"
    echo "✓ 备份完成: $BACKUP_RDB"
else
    echo "! 当前 RDB 文件不存在，跳过备份"
fi

# 步骤 2: 关闭 Redis
echo ""
echo "[2/5] 关闭 Redis 服务..."
$REDIS_CLI SHUTDOWN NOSAVE 2>/dev/null || true
sleep 2
echo "✓ Redis 已关闭"

# 步骤 3: 替换 RDB 文件
echo ""
echo "[3/5] 复制源 RDB 文件..."
cp "$SOURCE_FILE" "$CURRENT_RDB"
echo "✓ RDB 文件已替换"

# 步骤 4: 重启 Redis
echo ""
echo "[4/5] 重启 Redis 服务..."
# 注意: 这里假设 Redis 作为服务运行，需要根据实际情况调整
# 如果是 Docker 容器，需要用 docker restart
# 如果是 systemd 服务，用 systemctl restart redis

# 尝试检测 Redis 是如何运行的
if command -v systemctl &> /dev/null && systemctl list-units --full -all 2>/dev/null | grep -q "redis"; then
    # systemd 服务
    echo "检测到 systemd 服务，尝试重启..."
    sudo systemctl restart "redis*"
elif pgrep -f "redis-server.*$REDIS_PORT" > /dev/null 2>&1; then
    # 已经在运行（可能是自动重启）
    echo "Redis 进程已存在"
else
    # 尝试直接启动
    echo "请手动重启 Redis 服务"
    echo "等待 Redis 启动..."
fi

# 等待 Redis 可用
MAX_WAIT=30
WAIT_COUNT=0
while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    if $REDIS_CLI ping > /dev/null 2>&1; then
        echo "✓ Redis 已启动"
        break
    fi
    printf "."
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done
echo ""

if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
    echo "警告: Redis 未能及时启动，请手动检查"
fi

# 步骤 5: 验证恢复结果
echo ""
echo "[5/5] 验证恢复结果..."
echo ""
echo "--------------------------------------------------"
echo "恢复后数据统计"
echo "--------------------------------------------------"

# 获取 dbsize
DBSIZE=$($REDIS_CLI DBSIZE 2>/dev/null || echo "0")
echo "DBSIZE: $DBSIZE"

# 统计 key 分布
MSG_COUNT=$($REDIS_CLI KEYS 'demo:msg:*' 2>/dev/null | wc -l || echo "0")
THREAD_COUNT=$($REDIS_CLI KEYS 'demo:thread:*' 2>/dev/null | wc -l || echo "0")

echo ""
echo "Key 分布:"
echo "  - demo:msg:*   : $MSG_COUNT 个"
echo "  - demo:thread:*: $THREAD_COUNT 个"

echo ""
echo "=================================================="
echo "恢复完成!"
echo "=================================================="
echo "如需回滚，可使用备份文件: $BACKUP_RDB"
echo ""
