/**
 * block-buffer.js
 *
 * 功能：暂存 Route A（MCP 风格）发送的 blocks
 * - 按 sessionId 隔离
 * - 支持添加、获取、清除操作
 * - 自动过期清理
 */

// 存储结构: Map<sessionId, { blocks: [], createdAt: timestamp }>
const buffer = new Map();

// 配置
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 会话超时：5 分钟

/**
 * 生成唯一 block ID
 * @param {string} kind - block 类型
 * @param {string} title - block 标题
 * @returns {string} 唯一 ID
 */
function generateBlockId(kind, title) {
  const hash = `${kind}:${title}`.toLowerCase().replace(/\s+/g, '-');
  return hash;
}

/**
 * 清理过期会话
 */
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, data] of buffer.entries()) {
    if (now - data.createdAt > SESSION_TIMEOUT_MS) {
      buffer.delete(sessionId);
      console.log(`[BlockBuffer] 清理过期会话: ${sessionId}`);
    }
  }
}

// 定期清理过期会话
setInterval(cleanupExpiredSessions, 60 * 1000);

/**
 * 添加 block 到指定会话
 * @param {string} sessionId - 会话 ID
 * @param {Object} block - block 对象
 * @returns {Object} 添加后的 block（包含 id）
 */
function addBlock(sessionId, block) {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  // 验证 block
  if (!block || !block.kind) {
    throw new Error('block.kind is required');
  }

  // 生成 block ID（如果没有）
  if (!block.id) {
    block.id = generateBlockId(block.kind, block.title || 'untitled');
  }

  // 获取或创建会话
  let session = buffer.get(sessionId);
  if (!session) {
    session = { blocks: [], createdAt: Date.now() };
    buffer.set(sessionId, session);
  }

  // 检查是否已存在（去重）
  const existingIndex = session.blocks.findIndex(b => b.id === block.id);
  if (existingIndex >= 0) {
    // 更新已存在的 block
    session.blocks[existingIndex] = block;
    console.log(`[BlockBuffer] 更新 block: ${block.id}`);
  } else {
    // 添加新 block
    session.blocks.push(block);
    console.log(`[BlockBuffer] 添加 block: ${block.id}`);
  }

  return block;
}

/**
 * 获取并消费指定会话的所有 blocks
 * 获取后会清空该会话的 blocks
 * @param {string} sessionId - 会话 ID
 * @returns {Array} blocks 数组
 */
function consumeBlocks(sessionId) {
  if (!sessionId) {
    return [];
  }

  const session = buffer.get(sessionId);
  if (!session || session.blocks.length === 0) {
    return [];
  }

  // 取出 blocks 并清空
  const blocks = [...session.blocks];
  session.blocks = [];

  console.log(`[BlockBuffer] 消费 ${blocks.length} 个 blocks: ${sessionId}`);
  return blocks;
}

/**
 * 获取指定会话的所有 blocks（不清空）
 * @param {string} sessionId - 会话 ID
 * @returns {Array} blocks 数组
 */
function getBlocks(sessionId) {
  if (!sessionId) {
    return [];
  }

  const session = buffer.get(sessionId);
  return session ? [...session.blocks] : [];
}

/**
 * 清除指定会话的所有 blocks
 * @param {string} sessionId - 会话 ID
 */
function clearBlocks(sessionId) {
  if (sessionId) {
    buffer.delete(sessionId);
    console.log(`[BlockBuffer] 清除会话: ${sessionId}`);
  }
}

/**
 * 获取缓冲区状态（调试用）
 * @returns {Object} 状态信息
 */
function getStatus() {
  const sessions = [];
  for (const [sessionId, data] of buffer.entries()) {
    sessions.push({
      sessionId,
      blockCount: data.blocks.length,
      age: Math.round((Date.now() - data.createdAt) / 1000) + 's'
    });
  }
  return {
    totalSessions: buffer.size,
    sessions
  };
}

module.exports = {
  addBlock,
  consumeBlocks,
  getBlocks,
  clearBlocks,
  getStatus,
  generateBlockId
};
