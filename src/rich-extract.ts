/**
 * rich-extract.ts
 *
 * 功能：从 AI 回复文本中提取 cc_rich 代码块
 */

import { RichBlock, CardBlock, ChecklistBlock, ChecklistItem, Tone } from './types';

/**
 * 生成 block ID
 */
export function generateBlockId(kind: string, title: string): string {
  const hash = `${kind}:${title || 'untitled'}`.toLowerCase().replace(/\s+/g, '-');
  return hash;
}

/**
 * 从文本中提取 cc_rich 代码块
 */
export function extractRichBlocks(rawText: string): { cleanText: string; blocks: RichBlock[] } {
  if (!rawText || typeof rawText !== 'string') {
    return { cleanText: '', blocks: [] };
  }

  const blocks: RichBlock[] = [];
  // 匹配 ```cc_rich ... ``` 代码块（支持多行）
  const regex = /```cc_rich\s*\n?([\s\S]*?)\n?```/g;

  let match: RegExpExecArray | null;

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
          const cardBlock: CardBlock = {
            id: parsed.id || generateBlockId('card', parsed.title),
            kind: 'card',
            title: String(parsed.title),
            body: String(parsed.body),
            tone: (parsed.tone as Tone) || 'info'
          };
          blocks.push(cardBlock);
        } else {
          console.warn('[rich-extract] card 缺少必要字段:', blockContent.substring(0, 50));
        }
      } else if (parsed.kind === 'checklist') {
        // checklist 需要 title 和 items 数组
        if (parsed.title !== undefined && Array.isArray(parsed.items)) {
          const checklistBlock: ChecklistBlock = {
            id: parsed.id || generateBlockId('checklist', parsed.title),
            kind: 'checklist',
            title: String(parsed.title),
            items: parsed.items.map((item: any): ChecklistItem => ({
              text: String(item.text || ''),
              done: Boolean(item.done)
            }))
          };
          blocks.push(checklistBlock);
        } else {
          console.warn('[rich-extract] checklist 缺少必要字段:', blockContent.substring(0, 50));
        }
      } else {
        console.warn('[rich-extract] 未知的 kind 类型:', parsed.kind);
      }
    } catch (e) {
      // JSON 解析失败，跳过该块
      console.warn('[rich-extract] JSON 解析失败，跳过该块:', blockContent.substring(0, 50));
    }
  }

  // 移除所有 cc_rich 块，得到干净的文本
  const cleanText = rawText.replace(regex, '').trim();

  return {
    cleanText,
    blocks
  };
}
