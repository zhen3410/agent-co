import type { ApiConnectionConfig, AgentInvokeResult, Message } from '../types';
import type { InvokeAgentParams } from '../agent-invoker';
import { extractRichBlocks } from '../rich-extract';

const API_REQUEST_TIMEOUT_MS = 30_000;

type OpenAICompatibleMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

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
      messages.push({ role, content });
    }
  }

  messages.push({
    role: 'user',
    content: params.userMessage
  });

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

export async function invokeOpenAICompatibleProvider(
  params: InvokeAgentParams,
  connection: ApiConnectionConfig
): Promise<AgentInvokeResult> {
  if (!params.agent.apiModel || !params.agent.apiModel.trim()) {
    throw new Error(`Agent ${params.agent.name} 缺少 apiModel 配置`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(new URL('chat/completions', `${connection.baseURL}/`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: params.agent.apiModel,
        messages: buildMessages(params),
        temperature: params.agent.apiTemperature,
        max_tokens: params.agent.apiMaxTokens,
        stream: false
      }),
      signal: controller.signal
    });

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
    const content = extractTextContent(message && typeof message === 'object'
      ? (message as Record<string, unknown>).content
      : undefined);

    if (!content) {
      throw new Error('API provider 返回了不兼容的响应：缺少 choices[0].message.content');
    }

    const extracted = extractRichBlocks(content);
    const finishReason = firstChoice && typeof firstChoice === 'object'
      ? (typeof (firstChoice as Record<string, unknown>).finish_reason === 'string'
        ? (firstChoice as Record<string, unknown>).finish_reason as string
        : typeof (firstChoice as Record<string, unknown>).finishReason === 'string'
          ? (firstChoice as Record<string, unknown>).finishReason as string
          : undefined)
      : undefined;

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
