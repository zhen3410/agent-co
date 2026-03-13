/**
 * rich-digest.ts
 *
 * 功能：将 rich blocks 转换为简短摘要，用于放回 prompt
 */

import { Message, RichBlock } from './types';

/**
 * 将单个 block 转换为摘要
 */
function digestBlock(block: RichBlock): string {
  if (!block || !block.kind) {
    return '';
  }

  if (block.kind === 'card') {
    return `[卡片: ${block.title || '无标题'}]`;
  } else if (block.kind === 'checklist') {
    const total = block.items ? block.items.length : 0;
    const done = block.items ? block.items.filter(item => item.done).length : 0;
    return `[清单: ${block.title || '无标题'}, ${done}/${total} 完成]`;
  } else {
    return `[未知块: ${(block as { kind: string }).kind}]`;
  }
}

/**
 * 将消息中的 rich blocks 转换为摘要文本
 */
function digestMessage(message: Message): string {
  const parts: string[] = [];

  if (message.text && message.text.trim()) {
    parts.push(message.text.trim());
  }

  if (message.blocks && Array.isArray(message.blocks)) {
    for (const block of message.blocks) {
      const digest = digestBlock(block);
      if (digest) {
        parts.push(digest);
      }
    }
  }

  return parts.join('\n');
}

/**
 * 将历史消息数组转换为摘要格式
 */
export function digestHistory(history: Message[]): string {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }

  return history.map((msg, index) => {
    const role = msg.role === 'user' ? '用户' : 'AI';
    const sender = msg.sender || role;
    const content = digestMessage(msg);
    return `[${index + 1}] ${sender}(${role}): ${content}`;
  }).join('\n\n');
}
