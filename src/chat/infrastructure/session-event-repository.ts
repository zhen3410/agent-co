import { createSessionEvent, SessionEventDraft, SessionEventEnvelope } from '../domain/session-events';

export interface SessionEventRepositoryDraft extends Omit<SessionEventDraft, 'seq' | 'sessionId'> {
  sessionId?: string;
  seq?: number;
}

export interface SessionEventRepository {
  appendEvent(sessionId: string, draft: SessionEventRepositoryDraft): SessionEventEnvelope;
  appendEvents(sessionId: string, drafts: SessionEventRepositoryDraft[]): SessionEventEnvelope[];
  listEvents(sessionId: string, afterSeq?: number): SessionEventEnvelope[];
  getLatestSeq(sessionId: string): number;
  clearAllSessions(): void;
}

interface SessionEventStoreEntry {
  events: SessionEventEnvelope[];
  lastSeq: number;
}

export function createSessionEventRepository(): SessionEventRepository {
  const sessions = new Map<string, SessionEventStoreEntry>();

  function ensureStore(sessionId: string): SessionEventStoreEntry {
    let entry = sessions.get(sessionId);
    if (!entry) {
      entry = { events: [], lastSeq: 0 };
      sessions.set(sessionId, entry);
    }
    return entry;
  }

  function appendEvent(sessionId: string, draft: SessionEventRepositoryDraft): SessionEventEnvelope {
    const entry = ensureStore(sessionId);
    entry.lastSeq += 1;

    const event = createSessionEvent({
      ...draft,
      sessionId,
      seq: entry.lastSeq,
    });

    entry.events.push(event);
    return event;
  }

  function appendEvents(sessionId: string, drafts: SessionEventRepositoryDraft[]): SessionEventEnvelope[] {
    const results: SessionEventEnvelope[] = [];
    for (const draft of drafts) {
      results.push(appendEvent(sessionId, draft));
    }
    return results;
  }

  function listEvents(sessionId: string, afterSeq = 0): SessionEventEnvelope[] {
    const entry = sessions.get(sessionId);
    if (!entry) {
      return [];
    }

    if (afterSeq <= 0) {
      return entry.events.slice();
    }

    return entry.events.filter((event) => event.seq > afterSeq);
  }

  function getLatestSeq(sessionId: string): number {
    const entry = sessions.get(sessionId);
    return entry ? entry.lastSeq : 0;
  }

  function clearAllSessions(): void {
    sessions.clear();
  }

  return {
    appendEvent,
    appendEvents,
    listEvents,
    getLatestSeq,
    clearAllSessions,
  };
}
