import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { WsHub } from '../runtime/ws-hub';
import { SessionEventEnvelope } from '../domain/session-events';

export const SESSION_EVENT_WS_PATH = '/api/ws/session-events';

export interface WsRouteUpgradeContext {
  userKey: string;
}

export interface WsRoutesDependencies {
  hub: WsHub;
  hasSessionAccess(userKey: string, sessionId: string): boolean;
  heartbeatIntervalMs?: number;
}

export interface WsRoutes {
  readonly path: string;
  handleUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer, context: WsRouteUpgradeContext): boolean;
  shutdown(): void;
}

interface WsConnectionState {
  connectionId: string;
  userKey: string;
  socket: WebSocket;
  heartbeatTimer: NodeJS.Timeout | null;
  isAlive: boolean;
}

interface WsSubscribeClientMessage {
  type: 'subscribe';
  sessionId?: unknown;
  afterSeq?: unknown;
}

interface WsUnsubscribeClientMessage {
  type: 'unsubscribe';
}

interface WsPingClientMessage {
  type: 'ping';
}

type WsClientMessage = WsSubscribeClientMessage | WsUnsubscribeClientMessage | WsPingClientMessage;

function decodeWsPayload(data: RawData): string {
  if (typeof data === 'string') {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }

  return Buffer.from(data as ArrayBuffer).toString('utf8');
}

function parseClientMessage(raw: RawData): WsClientMessage | null {
  const text = decodeWsPayload(raw).trim();
  if (!text) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const type = (parsed as { type?: unknown }).type;
  if (type !== 'subscribe' && type !== 'unsubscribe' && type !== 'ping') {
    return null;
  }

  return parsed as WsClientMessage;
}

function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeAfterSeq(value: unknown): number {
  if (typeof value === 'undefined') {
    return 0;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }

  return 0;
}

function sendWsJson(socket: WebSocket, payload: unknown): boolean {
  if (socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function buildConnectionId(): string {
  return `ws_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function resolveHeartbeatIntervalMs(explicitValue: number | undefined): number {
  if (typeof explicitValue === 'number' && Number.isFinite(explicitValue) && explicitValue > 0) {
    return explicitValue;
  }

  const fromEnv = process.env.AGENT_CO_WS_HEARTBEAT_INTERVAL_MS;
  if (fromEnv && /^\d+$/.test(fromEnv)) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 15_000;
}

export function createWsRoutes(deps: WsRoutesDependencies): WsRoutes {
  const server = new WebSocketServer({ noServer: true });
  const heartbeatIntervalMs = resolveHeartbeatIntervalMs(deps.heartbeatIntervalMs);
  const states = new Map<WebSocket, WsConnectionState>();
  const upgradeContexts = new WeakMap<http.IncomingMessage, WsRouteUpgradeContext>();

  function cleanupState(state: WsConnectionState): void {
    deps.hub.unsubscribe(state.connectionId);
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    states.delete(state.socket);
  }

  function sendSessionEvent(state: WsConnectionState, event: SessionEventEnvelope): void {
    sendWsJson(state.socket, {
      type: 'session_event',
      sessionId: event.sessionId,
      event
    });
  }

  server.on('connection', (socket, req) => {
    const context = upgradeContexts.get(req);
    if (!context) {
      socket.close(1011, 'missing_upgrade_context');
      return;
    }

    const state: WsConnectionState = {
      connectionId: buildConnectionId(),
      userKey: context.userKey,
      socket,
      heartbeatTimer: null,
      isAlive: true
    };

    states.set(socket, state);

    socket.on('pong', () => {
      state.isAlive = true;
    });

    if (heartbeatIntervalMs > 0) {
      state.heartbeatTimer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }

        if (!state.isAlive) {
          socket.terminate();
          return;
        }

        state.isAlive = false;
        socket.ping();
        sendWsJson(socket, {
          type: 'heartbeat',
          timestamp: Date.now()
        });
      }, heartbeatIntervalMs);
      state.heartbeatTimer.unref?.();
    }

    socket.on('message', (raw) => {
      const message = parseClientMessage(raw);
      if (!message) {
        sendWsJson(socket, {
          type: 'error',
          error: 'invalid_message'
        });
        return;
      }

      if (message.type === 'ping') {
        sendWsJson(socket, {
          type: 'pong',
          timestamp: Date.now()
        });
        return;
      }

      if (message.type === 'unsubscribe') {
        deps.hub.unsubscribe(state.connectionId);
        sendWsJson(socket, {
          type: 'unsubscribed',
          success: true
        });
        return;
      }

      const sessionId = normalizeSessionId(message.sessionId);
      if (!sessionId) {
        sendWsJson(socket, {
          type: 'error',
          error: 'invalid_session_id'
        });
        return;
      }

      if (!deps.hasSessionAccess(state.userKey, sessionId)) {
        sendWsJson(socket, {
          type: 'error',
          error: 'session_forbidden',
          sessionId
        });
        return;
      }

      const result = deps.hub.subscribe({
        subscriberId: state.connectionId,
        sessionId,
        afterSeq: normalizeAfterSeq(message.afterSeq),
        onSessionEvent: (event) => sendSessionEvent(state, event)
      });

      sendWsJson(socket, {
        type: 'subscribed',
        sessionId: result.sessionId,
        latestSeq: result.latestSeq,
        backfilled: result.deliveredBackfill
      });
    });

    socket.on('close', () => {
      cleanupState(state);
    });

    socket.on('error', () => {
      cleanupState(state);
    });
  });

  function handleUpgrade(
    req: http.IncomingMessage,
    socket: net.Socket,
    head: Buffer,
    context: WsRouteUpgradeContext
  ): boolean {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (requestUrl.pathname !== SESSION_EVENT_WS_PATH) {
      return false;
    }

    upgradeContexts.set(req, context);
    server.handleUpgrade(req, socket, head, (ws) => {
      server.emit('connection', ws, req);
    });
    return true;
  }

  function shutdown(): void {
    for (const state of states.values()) {
      cleanupState(state);
      if (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING) {
        state.socket.close();
      }
    }
    states.clear();
    server.close();
  }

  return {
    path: SESSION_EVENT_WS_PATH,
    handleUpgrade,
    shutdown
  };
}
