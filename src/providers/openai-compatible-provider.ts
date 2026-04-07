import type { ApiConnectionConfig, AgentInvokeResult, Message } from '../types';
import type { InvokeAgentParams } from '../agent-invocation/agent-invoker-types';
import { extractRichBlocks } from '../rich-extract';

const API_REQUEST_TIMEOUT_MS = 15 * 60_000;

type OpenAICompatibleMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

function isVisibleAssistantHistoryText(message: Message, content: string): boolean {
  if (message.role !== 'assistant') {
    return true;
  }

  return !content.startsWith('API 调用失败：');
}

function historyAlreadyContainsCurrentUserMessage(params: InvokeAgentParams): boolean {
  if (!params.includeHistory) {
    return false;
  }

  const current = params.userMessage.trim();
  if (!current) {
    return false;
  }

  for (let index = params.history.length - 1; index >= 0; index -= 1) {
    const item = params.history[index];
    const content = typeof item.text === 'string' ? item.text.trim() : '';
    if (!content) {
      continue;
    }
    if (item.role !== 'user') {
      return false;
    }
    return content === current;
  }

  return false;
}

function buildMessages(params: InvokeAgentParams): OpenAICompatibleMessage[] {
  const messages: OpenAICompatibleMessage[] = [
    {
      role: 'system',
      content: params.agent.systemPrompt
    }
  ];

  if (params.includeHistory) {
    for (const item of params.history) {
      const role = normalizeHistoryRole(item);
      const content = typeof item.text === 'string' ? item.text.trim() : '';
      if (!content) {
        continue;
      }
      if (!isVisibleAssistantHistoryText(item, content)) {
        continue;
      }
      messages.push({ role, content });
    }
  }

  if (!historyAlreadyContainsCurrentUserMessage(params)) {
    messages.push({
      role: 'user',
      content: params.userMessage
    });
  }

  return messages;
}

function normalizeHistoryRole(message: Message): 'user' | 'assistant' {
  return message.role === 'assistant' ? 'assistant' : 'user';
}

function extractTextContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map(item => extractTextContent(item))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;

  if (typeof record.text === 'string' && record.text.trim()) {
    return record.text;
  }

  if (typeof record.content === 'string' && record.content.trim()) {
    return record.content;
  }

  return '';
}

function extractFinishReason(choice: unknown): string | undefined {
  if (!choice || typeof choice !== 'object') {
    return undefined;
  }

  const record = choice as Record<string, unknown>;
  if (typeof record.finish_reason === 'string') {
    return record.finish_reason;
  }
  if (typeof record.finishReason === 'string') {
    return record.finishReason;
  }
  return undefined;
}

function buildErrorDetail(payload: unknown, rawText: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const errorValue = record.error;

    if (typeof errorValue === 'string' && errorValue.trim()) {
      return errorValue.trim();
    }

    if (errorValue && typeof errorValue === 'object') {
      const errorRecord = errorValue as Record<string, unknown>;
      if (typeof errorRecord.message === 'string' && errorRecord.message.trim()) {
        return errorRecord.message.trim();
      }
      if (typeof errorRecord.code === 'string' && errorRecord.code.trim()) {
        return errorRecord.code.trim();
      }
    }

    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
  }

  if (rawText.trim()) {
    return rawText.trim().slice(0, 500);
  }

  return '上游未返回更多错误信息';
}

function parseUsage(payload: unknown): AgentInvokeResult['usage'] | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const usage = (payload as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }

  const usageRecord = usage as Record<string, unknown>;
  const inputTokens = typeof usageRecord.prompt_tokens === 'number' ? usageRecord.prompt_tokens : undefined;
  const outputTokens = typeof usageRecord.completion_tokens === 'number' ? usageRecord.completion_tokens : undefined;
  const totalTokens = typeof usageRecord.total_tokens === 'number' ? usageRecord.total_tokens : undefined;

  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens
  };
}

function extractChoiceRecord(choice: unknown): Record<string, unknown> | null {
  if (!choice || typeof choice !== 'object') {
    return null;
  }
  return choice as Record<string, unknown>;
}

function extractStreamChoiceText(choice: unknown): string {
  const record = extractChoiceRecord(choice);
  if (!record) {
    return '';
  }

  const delta = record.delta;
  if (delta && typeof delta === 'object') {
    const content = extractTextContent((delta as Record<string, unknown>).content);
    if (content) {
      return content;
    }
  }

  const message = record.message;
  if (message && typeof message === 'object') {
    return extractTextContent((message as Record<string, unknown>).content);
  }

  return '';
}

function buildRequestBody(params: InvokeAgentParams, stream: boolean): string {
  return JSON.stringify({
    model: params.agent.apiModel,
    messages: buildMessages(params),
    temperature: params.agent.apiTemperature,
    max_tokens: params.agent.apiMaxTokens,
    stream
  });
}

async function invokeOpenAICompatibleProviderStream(
  response: Response,
  params: InvokeAgentParams
): Promise<AgentInvokeResult> {
  if (!response.body) {
    throw new Error('API provider 返回了空的流式响应体');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason: string | undefined;
  let usage: AgentInvokeResult['usage'] | undefined;

  const processEventChunk = (chunk: string) => {
    const lines = chunk.split(/\r?\n/);
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') {
      return;
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      throw new Error('API provider 返回了无法解析的流式 JSON 响应');
    }

    const parsedUsage = parseUsage(payload);
    if (parsedUsage) {
      usage = parsedUsage;
    }

    const choices = payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>).choices
      : null;
    const firstChoice = Array.isArray(choices) ? choices[0] : null;
    if (!firstChoice) {
      return;
    }

    const nextFinishReason = extractFinishReason(firstChoice);
    if (nextFinishReason) {
      finishReason = nextFinishReason;
    }

    const deltaText = extractStreamChoiceText(firstChoice);
    if (!deltaText) {
      return;
    }

    text += deltaText;
    params.onTextDelta?.(deltaText);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex >= 0) {
      const chunk = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      if (chunk.trim()) {
        processEventChunk(chunk);
      }
      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  buffer = buffer.replace(/\r\n/g, '\n');
  if (buffer.trim()) {
    processEventChunk(buffer);
  }

  if (!text.trim()) {
    if (finishReason === 'length') {
      throw new Error('API provider 输出被截断：message.content 为空，可能是 apiMaxTokens 过低');
    }
    throw new Error('API provider 返回了不兼容的流式响应：未收到可见文本增量');
  }

  const extracted = extractRichBlocks(text);
  return {
    text: extracted.cleanText,
    blocks: extracted.blocks,
    rawText: text,
    finishReason,
    usage
  };
}

export async function invokeOpenAICompatibleProvider(
  params: InvokeAgentParams,
  connection: ApiConnectionConfig
): Promise<AgentInvokeResult> {
  if (!params.agent.apiModel || !params.agent.apiModel.trim()) {
    throw new Error(`Agent ${params.agent.name} 缺少 apiModel 配置`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  const stream = typeof params.onTextDelta === 'function';

  try {
    const response = await fetch(new URL('chat/completions', `${connection.baseURL}/`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: buildRequestBody(params, stream),
      signal: controller.signal
    });

    if (stream) {
      if (!response.ok) {
        const rawText = await response.text();
        let payload: unknown = null;
        if (rawText) {
          try {
            payload = JSON.parse(rawText) as unknown;
          } catch {
            throw new Error('API provider 返回了无法解析的 JSON 响应');
          }
        }

        const detail = buildErrorDetail(payload, rawText);
        if (response.status === 401 || response.status === 403) {
          throw new Error(`API provider 鉴权失败（HTTP ${response.status}）: ${detail}`);
        }
        throw new Error(`API provider 请求失败（HTTP ${response.status}）: ${detail}`);
      }

      return await invokeOpenAICompatibleProviderStream(response, params);
    }

    const rawText = await response.text();
    let payload: unknown = null;

    if (rawText) {
      try {
        payload = JSON.parse(rawText) as unknown;
      } catch {
        throw new Error('API provider 返回了无法解析的 JSON 响应');
      }
    }

    if (!response.ok) {
      const detail = buildErrorDetail(payload, rawText);
      if (response.status === 401 || response.status === 403) {
        throw new Error(`API provider 鉴权失败（HTTP ${response.status}）: ${detail}`);
      }
      throw new Error(`API provider 请求失败（HTTP ${response.status}）: ${detail}`);
    }

    const choices = payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>).choices
      : null;
    const firstChoice = Array.isArray(choices) ? choices[0] : null;
    const message = firstChoice && typeof firstChoice === 'object'
      ? (firstChoice as Record<string, unknown>).message
      : null;
    const finishReason = extractFinishReason(firstChoice);
    const content = extractTextContent(message && typeof message === 'object'
      ? (message as Record<string, unknown>).content
      : undefined);

    if (!content) {
      if (finishReason === 'length') {
        throw new Error('API provider 输出被截断：message.content 为空，可能是 apiMaxTokens 过低');
      }
      throw new Error('API provider 返回了不兼容的响应：缺少 choices[0].message.content');
    }

    const extracted = extractRichBlocks(content);

    return {
      text: extracted.cleanText,
      rawText: content,
      blocks: extracted.blocks,
      finishReason,
      usage: parseUsage(payload)
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`API provider 请求超时（>${API_REQUEST_TIMEOUT_MS}ms）`);
      }
      throw error;
    }
    throw new Error(`API provider 请求异常: ${String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}
