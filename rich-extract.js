/**
 * rich-extract.js
 *
 * 功能：从 AI 回复文本中提取 cc_rich 代码块（Route B）
 * - 输入：AI 回复的原始文本
 * - 输出：{ cleanText, blocks }
 * - 用正则匹配 ```cc_rich ... ``` 块
 * - 解析 JSON，验证 kind 字段
 * - 自动生成 block id 用于去重
 * - 容错处理：JSON 解析失败时跳过该块
 */

/**
 * 生成 block ID
 */
function generateBlockId(kind, title) {
  const hash = `${kind}:${title || 'untitled'}`.toLowerCase().replace(/\s+/g, '-');
  return hash;
}

/**
 * 从文本中提取 cc_rich 代码块
 * @param {string} rawText - AI 回复的原始文本
 * @returns {{ cleanText: string, blocks: Array }} 提取结果
 */
function extractRichBlocks(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { cleanText: '', blocks: [] };
  }

  const blocks = [];
  // 匹配 ```cc_rich ... ``` 代码块（支持多行）
  const regex = /```cc_rich\s*\n?([\s\S]*?)\n?```/g;

  // 替换掉所有 cc_rich 块，得到纯文本
  let cleanText = rawText;
  let match;

  while ((match = regex.exec(rawText)) !== null) {
    const blockContent = match[1].trim();

    try {
      // 尝试解析 JSON
      const parsed = JSON.parse(blockContent);

      // 验证必须有 kind 字段
      if (!parsed.kind) {
        console.warn('[rich-extract] 跳过缺少 kind 字段的块:', blockContent.substring(0, 50));
        continue;
      }

      // 根据 kind 进行基本验证
      if (parsed.kind === 'card') {
        // card 需要基本的 title 和 body
        if (parsed.title !== undefined && parsed.body !== undefined) {
          blocks.push({
            id: parsed.id || generateBlockId('card', parsed.title),
            kind: 'card',
            title: String(parsed.title),
            body: String(parsed.body),
            tone: parsed.tone || 'info' // 默认 info
          });
        } else {
          console.warn('[rich-extract] card 缺少必要字段:', blockContent.substring(0, 50));
        }
      } else if (parsed.kind === 'checklist') {
        // checklist 需要 title 和 items 数组
        if (parsed.title !== undefined && Array.isArray(parsed.items)) {
          blocks.push({
            id: parsed.id || generateBlockId('checklist', parsed.title),
            kind: 'checklist',
            title: String(parsed.title),
            items: parsed.items.map(item => ({
              text: String(item.text || ''),
              done: Boolean(item.done)
            }))
          });
        } else {
          console.warn('[rich-extract] checklist 缺少必要字段:', blockContent.substring(0, 50));
        }
      } else {
        console.warn('[rich-extract] 未知的 kind 类型:', parsed.kind);
      }
    } catch (e) {
      // JSON 解析失败，跳过该块
      console.warn('[rich-extract] JSON 解析失败，跳过该块:', blockContent.substring(0, 50));
      console.warn('[rich-extract] 错误:', e.message);
    }
  }

  // 移除所有 cc_rich 块，得到干净的文本
  cleanText = rawText.replace(regex, '').trim();

  return {
    cleanText,
    blocks
  };
}

module.exports = { extractRichBlocks, generateBlockId };
