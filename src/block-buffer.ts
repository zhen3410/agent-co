/**
 * block-buffer.ts
 *
 * 功能：暂存 Route A（MCP 风格) 发送的 blocks
 */

import { RichBlock, SessionData } from './types';

// 存储结构
const buffer = new Map<string, SessionData>();

// 配置
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 会话超时：5 分钟

/**
 * 生成唯一 block ID
 */
function generateBlockId(kind: string, title: string): string {
  return `${kind}:${title}`.toLowerCase().replace(/\s+/g, '-');
}

/**
 * 清理过期会话
 */
function cleanupExpiredSessions(): void {
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
 */
export function addBlock(sessionId: string, block: RichBlock): RichBlock {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  if (!block || !block.kind) {
    throw new Error('block.kind is required');
  }

  // 生成 block ID（如果没有)
  if (!block.id) {
    block.id = generateBlockId(block.kind, block.title || 'untitled');
  }

  // 获取或创建会话
  let session = buffer.get(sessionId);
  if (!session) {
    session = { blocks: [], createdAt: Date.now() };
    buffer.set(sessionId, session);
  }

  // 检查是否已存在(去重)
  const existingIndex = session.blocks.findIndex(b => b.id === block.id);
  if (existingIndex >= 0) {
    session.blocks[existingIndex] = block;
    console.log(`[BlockBuffer] 更新 block: ${block.id}`);
  } else {
    session.blocks.push(block);
    console.log(`[BlockBuffer] 添加 block: ${block.id}`);
  }

  return block;
}

/**
 * 获取并消费指定会话的所有 blocks
 */
export function consumeBlocks(sessionId: string): RichBlock[] {
  if (!sessionId) {
    return [];
  }

  const session = buffer.get(sessionId);
  if (!session || session.blocks.length === 0) {
    return [];
  }

  const blocks = [...session.blocks];
  session.blocks = [];

  console.log(`[BlockBuffer] 消费 ${blocks.length} 个 blocks: ${sessionId}`);
  return blocks;
}

/**
 * 获取指定会话的所有 blocks(不清空)
 */
export function getBlocks(sessionId: string): RichBlock[] {
  if (!sessionId) {
    return [];
  }

  const session = buffer.get(sessionId);
  return session ? [...session.blocks] : [];
}

/**
 * 清除指定会话的所有 blocks
 */
export function clearBlocks(sessionId: string): void {
  if (sessionId) {
    buffer.delete(sessionId);
    console.log(`[BlockBuffer] 清除会话: ${sessionId}`);
  }
}

/**
 * 获取缓冲区状态
 */
export function getStatus(): { totalSessions: number; sessions: Array<{ sessionId: string; blockCount: number, age: string }> } {
  const sessions: Array<{ sessionId: string; blockCount: number; age: string }> = [];
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
