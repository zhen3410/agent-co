import * as http from 'http';
import { ChatRuntime } from '../runtime/chat-runtime';

export interface ChatSseExecutionResult {
  currentAgent: string | null;
  notice?: string;
  hadVisibleMessages: boolean;
  emptyVisibleMessage?: string;
}

export interface ChatSseCallbacks {
  shouldContinue(): boolean;
  signal?: AbortSignal;
  onUserMessage(message: unknown): void;
  onThinking(agentName: string): void;
  onTextDelta(agentName: string, delta: string): void;
  onMessage(message: unknown): boolean;
}

export async function runChatSse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: {
    runtime: Pick<ChatRuntime, 'appendOperationalLog'>;
    sessionId: string;
    execute(callbacks: ChatSseCallbacks): Promise<ChatSseExecutionResult>;
  }
): Promise<void> {
  const heartbeatIntervalMs = (() => {
    const raw = process.env.AGENT_CO_SSE_HEARTBEAT_INTERVAL_MS;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000;
  })();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no'
  });

  let streamClosed = false;
  let streamCompleted = false;
  const executionController = new AbortController();
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const markStreamClosed = (source: 'req_aborted' | 'req_close' | 'res_close') => {
    if (streamClosed) {
      return;
    }
    streamClosed = true;
    executionController.abort();
    if (!streamCompleted) {
      params.runtime.appendOperationalLog('info', 'chat-exec', `session=${params.sessionId} stage=stream_disconnect reason=client_disconnect source=${source}`);
    }
  };

  req.on('aborted', () => markStreamClosed('req_aborted'));
  req.on('close', () => markStreamClosed('req_close'));
  res.on('close', () => markStreamClosed('res_close'));

  const sendEvent = (event: string, data: unknown): boolean => {
    if (streamClosed || res.writableEnded || res.destroyed) {
      return false;
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush();
    }
    return true;
  };

  if (heartbeatIntervalMs > 0) {
    heartbeatTimer = setInterval(() => {
      sendEvent('heartbeat', { timestamp: Date.now() });
    }, heartbeatIntervalMs);
    heartbeatTimer.unref?.();
  }

  try {
    const result = await params.execute({
      shouldContinue: () => !streamClosed && !res.writableEnded && !res.destroyed,
      signal: executionController.signal,
      onUserMessage: (message) => {
        sendEvent('user_message', message);
      },
      onThinking: (agentName) => {
        sendEvent('agent_thinking', { agent: agentName });
      },
      onTextDelta: (agentName, delta) => {
        sendEvent('agent_delta', { agent: agentName, delta });
      },
      onMessage: (message) => sendEvent('agent_message', message)
    });

    if (streamClosed || res.writableEnded || res.destroyed) {
      return;
    }

    if (!result.hadVisibleMessages) {
      sendEvent('error', { error: result.emptyVisibleMessage || '未返回可见消息，请稍后重试或查看日志。' });
    }
    if (result.notice) {
      sendEvent('notice', { notice: result.notice });
    }
    sendEvent('done', { currentAgent: result.currentAgent });
    streamCompleted = true;
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      throw error;
    }
    res.write(`event: error\ndata: ${JSON.stringify({ error: (error as Error).message })}\n\n`);
    res.end();
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
  }
}
