export type CliEvent =
  | { type: 'assistant_text'; text: string }
  | { type: 'result_text'; text: string };

export type ParsedCliLine =
  | { kind: 'non_json'; raw: string }
  | { kind: 'json'; raw: unknown; event: CliEvent | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function extractTextEntriesFromContent(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .filter(item => (item.type === 'text' || item.type === 'output_text') && typeof item.text === 'string' && item.text)
    .map(item => item.text as string);
}

function extractAssistantTextFromMessageLike(value: unknown): string | null {
  if (!isRecord(value)) return null;

  const role = asNonEmptyString(value.role);
  const messageType = asNonEmptyString(value.type);
  const textEntries = extractTextEntriesFromContent(value.content);

  if ((role === 'assistant' || messageType === 'assistant' || messageType === 'message') && textEntries.length > 0) {
    return textEntries.join('');
  }

  return null;
}

function extractAssistantTextFromItem(value: unknown): string | null {
  if (!isRecord(value)) return null;

  const itemType = asNonEmptyString(value.type);
  if (itemType !== 'agent_message') {
    return null;
  }

  return asNonEmptyString(value.text)
    ?? asNonEmptyString(value.message)
    ?? extractAssistantTextFromMessageLike(value);
}

export function parseCliEventLine(line: string): ParsedCliLine {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) {
    return { kind: 'non_json', raw: line };
  }

  try {
    const raw = JSON.parse(trimmed) as unknown;

    const directAssistantText = extractAssistantTextFromMessageLike(raw);
    if (directAssistantText) {
      return {
        kind: 'json',
        raw,
        event: { type: 'assistant_text', text: directAssistantText }
      };
    }

    if (isRecord(raw)) {
      const messageAssistantText = extractAssistantTextFromMessageLike(raw.message);
      if (messageAssistantText && (raw.type === 'assistant' || raw.type === 'message')) {
        return {
          kind: 'json',
          raw,
          event: { type: 'assistant_text', text: messageAssistantText }
        };
      }

      if ((raw.type === 'assistant' || raw.type === 'message') && isRecord(raw.message)) {
        const nestedTextEntries = extractTextEntriesFromContent(raw.message.content);
        if (nestedTextEntries.length > 0) {
          return {
            kind: 'json',
            raw,
            event: { type: 'assistant_text', text: nestedTextEntries.join('') }
          };
        }
      }

      const topLevelOutputText = asNonEmptyString(raw.output_text);
      if (topLevelOutputText) {
        return {
          kind: 'json',
          raw,
          event: { type: 'assistant_text', text: topLevelOutputText }
        };
      }

      const payloadAssistantText = extractAssistantTextFromMessageLike(raw.payload);
      if (payloadAssistantText) {
        return {
          kind: 'json',
          raw,
          event: { type: 'assistant_text', text: payloadAssistantText }
        };
      }

      const itemAssistantText = extractAssistantTextFromItem(raw.item);
      if (itemAssistantText) {
        return {
          kind: 'json',
          raw,
          event: { type: 'assistant_text', text: itemAssistantText }
        };
      }

      const resultText = asNonEmptyString(raw.result);
      if (resultText) {
        return {
          kind: 'json',
          raw,
          event: { type: 'result_text', text: resultText }
        };
      }
    }

    return { kind: 'json', raw, event: null };
  } catch {
    return { kind: 'non_json', raw: line };
  }
}
