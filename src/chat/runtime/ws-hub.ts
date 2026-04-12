import { SessionEventEnvelope } from '../domain/session-events';

export interface WsHubDependencies {
  listSessionEvents(sessionId: string, afterSeq?: number): SessionEventEnvelope[];
}

export interface WsHubSubscribeParams {
  subscriberId: string;
  sessionId: string;
  afterSeq?: number;
  onSessionEvent(event: SessionEventEnvelope): void;
}

export interface WsHubSubscribeResult {
  sessionId: string;
  latestSeq: number;
  deliveredBackfill: number;
}

export interface WsHub {
  subscribe(params: WsHubSubscribeParams): WsHubSubscribeResult;
  unsubscribe(subscriberId: string): void;
  publish(event: SessionEventEnvelope): void;
  close(): void;
}

interface WsSubscription {
  subscriberId: string;
  sessionId: string;
  onSessionEvent(event: SessionEventEnvelope): void;
}

function normalizeAfterSeq(afterSeq: number | undefined): number {
  if (!Number.isInteger(afterSeq) || Number(afterSeq) < 0) {
    return 0;
  }
  return Number(afterSeq);
}

function deliverEvent(subscription: WsSubscription, event: SessionEventEnvelope): void {
  try {
    subscription.onSessionEvent(event);
  } catch {
    // ignore subscriber callback errors to avoid interrupting hub fanout
  }
}

export function createWsHub(deps: WsHubDependencies): WsHub {
  const subscriptionsById = new Map<string, WsSubscription>();
  const subscriptionsBySession = new Map<string, Map<string, WsSubscription>>();

  function detach(subscription: WsSubscription): void {
    const sessionSubscriptions = subscriptionsBySession.get(subscription.sessionId);
    if (!sessionSubscriptions) {
      return;
    }

    sessionSubscriptions.delete(subscription.subscriberId);
    if (sessionSubscriptions.size === 0) {
      subscriptionsBySession.delete(subscription.sessionId);
    }
  }

  function subscribe(params: WsHubSubscribeParams): WsHubSubscribeResult {
    const subscriberId = params.subscriberId.trim();
    const sessionId = params.sessionId.trim();
    if (!subscriberId) {
      throw new Error('subscriberId is required');
    }
    if (!sessionId) {
      throw new Error('sessionId is required');
    }

    unsubscribe(subscriberId);

    const subscription: WsSubscription = {
      subscriberId,
      sessionId,
      onSessionEvent: params.onSessionEvent
    };

    subscriptionsById.set(subscriberId, subscription);

    let sessionSubscriptions = subscriptionsBySession.get(sessionId);
    if (!sessionSubscriptions) {
      sessionSubscriptions = new Map<string, WsSubscription>();
      subscriptionsBySession.set(sessionId, sessionSubscriptions);
    }
    sessionSubscriptions.set(subscriberId, subscription);

    const normalizedAfterSeq = normalizeAfterSeq(params.afterSeq);
    const backfillEvents = deps.listSessionEvents(sessionId, normalizedAfterSeq);
    for (const event of backfillEvents) {
      deliverEvent(subscription, event);
    }

    return {
      sessionId,
      latestSeq: backfillEvents.length > 0
        ? backfillEvents[backfillEvents.length - 1].seq
        : normalizedAfterSeq,
      deliveredBackfill: backfillEvents.length
    };
  }

  function unsubscribe(subscriberId: string): void {
    const normalizedSubscriberId = subscriberId.trim();
    if (!normalizedSubscriberId) {
      return;
    }

    const existing = subscriptionsById.get(normalizedSubscriberId);
    if (!existing) {
      return;
    }

    subscriptionsById.delete(normalizedSubscriberId);
    detach(existing);
  }

  function publish(event: SessionEventEnvelope): void {
    const sessionSubscriptions = subscriptionsBySession.get(event.sessionId);
    if (!sessionSubscriptions || sessionSubscriptions.size === 0) {
      return;
    }

    for (const subscription of sessionSubscriptions.values()) {
      deliverEvent(subscription, event);
    }
  }

  function close(): void {
    subscriptionsById.clear();
    subscriptionsBySession.clear();
  }

  return {
    subscribe,
    unsubscribe,
    publish,
    close
  };
}
