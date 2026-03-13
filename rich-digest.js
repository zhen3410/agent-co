/**
 * rich-digest.js
 *
 * 功能：将 rich blocks 转换为简短摘要，用于放回 prompt
 * - 输入：包含 rich blocks 的消息对象
 * - 输出：简短的摘要文本
 * - card → [卡片: {title}]
 * - checklist → [清单: {title}, {done}/{total} 完成]
 *
 * 这是 Context Cleaner 的核心——让 AI 知道"我之前发过什么"，
 * 但不浪费 token 存完整 JSON
 */

/**
 * 将消息中的 rich blocks 转换为摘要文本
 * @param {{ text?: string, blocks?: Array }} message - 消息对象
 * @returns {string} 摘要文本
 */
function digestMessage(message) {
  if (!message) {
    return '';
  }

  const parts = [];

  // 添加纯文本部分
  if (message.text && message.text.trim()) {
    parts.push(message.text.trim());
  }

  // 处理 blocks
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
 * 将单个 block 转换为摘要
 * @param {Object} block - block 对象
 * @returns {string} 摘要文本
 */
function digestBlock(block) {
  if (!block || !block.kind) {
    return '';
  }

  switch (block.kind) {
    case 'card':
      // card → [卡片: {title}]
      return `[卡片: ${block.title || '无标题'}]`;

    case 'checklist':
      // checklist → [清单: {title}, {done}/{total} 完成]
      const total = block.items ? block.items.length : 0;
      const done = block.items ? block.items.filter(item => item.done).length : 0;
      return `[清单: ${block.title || '无标题'}, ${done}/${total} 完成]`;

    default:
      return `[未知块: ${block.kind}]`;
  }
}

/**
 * 将历史消息数组转换为摘要格式（用于 prompt）
 * @param {Array<{ role: string, text?: string, blocks?: Array }>} history - 历史消息
 * @returns {string} 格式化的历史摘要
 */
function digestHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }

  return history.map((msg, index) => {
    const role = msg.role === 'user' ? '用户' : 'AI';
    const content = digestMessage(msg);
    return `[${index + 1}] ${role}: ${content}`;
  }).join('\n\n');
}

module.exports = { digestMessage, digestBlock, digestHistory };
