import { createExponentialBackoffPolicy, ReconnectPolicy } from './reconnect-policy';

export interface RealtimeDisconnectDetail {
  code: number;
  reason: string;
  wasClean: boolean;
}

interface WebSocketLike {
  readyState?: number;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RealtimeClientOptions {
  url: string;
  reconnectPolicy?: ReconnectPolicy;
  webSocketFactory?: (url: string) => WebSocketLike;
  onConnect?: () => void;
  onDisconnect?: (detail: RealtimeDisconnectDetail) => void;
  onMessage?: (payload: any) => void;
  onError?: (error: unknown) => void;
}

export interface RealtimeClient {
  connect(): void;
  disconnect(code?: number, reason?: string): void;
  send(payload: unknown): void;
  isConnected(): boolean;
}

function parseMessageData(data: unknown): unknown {
  if (typeof data !== 'string') {
    return data;
  }

  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const reconnectPolicy = options.reconnectPolicy ?? createExponentialBackoffPolicy();
  const webSocketFactory = options.webSocketFactory ?? ((url: string) => new WebSocket(url));

  let socket: WebSocketLike | null = null;
  let lastSocket: WebSocketLike | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedManually = false;

  const clearReconnectTimer = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = (event: RealtimeDisconnectDetail): void => {
    const nextRetryAttempt = reconnectAttempt;
    if (!reconnectPolicy.shouldReconnect(nextRetryAttempt, event as unknown as CloseEvent)) {
      return;
    }

    const delayMs = reconnectPolicy.getDelayMs(nextRetryAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  };

  const handleOpen = (): void => {
    reconnectAttempt = 0;
    options.onConnect?.();
  };

  const handleMessage = (event: { data: unknown }): void => {
    options.onMessage?.(parseMessageData(event.data));
  };

  const handleClose = (event: RealtimeDisconnectDetail): void => {
    socket = null;
    options.onDisconnect?.(event);

    if (!closedManually) {
      scheduleReconnect(event);
    }
  };

  const handleError = (event: unknown): void => {
    options.onError?.(event);
  };

  const connect = (): void => {
    if (socket) {
      return;
    }

    closedManually = false;
    clearReconnectTimer();

    socket = webSocketFactory(options.url);
    lastSocket = socket;
    socket.addEventListener('open', handleOpen);
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('close', handleClose);
    socket.addEventListener('error', handleError);
  };

  const disconnect = (code = 1000, reason = 'client disconnect'): void => {
    closedManually = true;
    clearReconnectTimer();

    if (socket) {
      socket.close(code, reason);
      return;
    }

    if (lastSocket) {
      lastSocket.close(code, reason);
    }
  };

  const send = (payload: unknown): void => {
    if (!socket) {
      throw new Error('Cannot send realtime message before connection is established');
    }

    if (socket.readyState !== 1) {
      throw new Error('Cannot send realtime message while socket is not OPEN');
    }

    socket.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  };

  const isConnected = (): boolean => {
    return Boolean(socket && socket.readyState === 1);
  };

  return {
    connect,
    disconnect,
    send,
    isConnected
  };
}
