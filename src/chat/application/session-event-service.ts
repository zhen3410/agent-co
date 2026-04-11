import {
  SessionEventActorType,
  SessionEventEnvelope,
} from '../domain/session-events';
import {
  SessionEventRepository,
  SessionEventRepositoryDraft,
} from '../infrastructure/session-event-repository';
import { projectChatTimeline, ChatTimelineRow } from './chat-timeline-projection';
import { projectCallGraph, CallGraphProjection } from './call-graph-projection';
import {
  projectSessionSummary,
  SessionSummarySnapshot,
} from './session-summary-projection';

export type SessionEventWriteDraft = Omit<
  SessionEventRepositoryDraft,
  'actorType' | 'sessionId' | 'seq'
>;

export interface SessionEventServiceDependencies {
  sessionEventRepository: SessionEventRepository;
}

export interface SessionEventService {
  appendCommandEvent(sessionId: string, draft: SessionEventWriteDraft): SessionEventEnvelope;
  appendUserEvent(sessionId: string, draft: SessionEventWriteDraft): SessionEventEnvelope;
  appendAgentEvent(sessionId: string, draft: SessionEventWriteDraft): SessionEventEnvelope;
  appendSystemEvent(sessionId: string, draft: SessionEventWriteDraft): SessionEventEnvelope;
  listSessionEvents(sessionId: string, afterSeq?: number): SessionEventEnvelope[];
  buildSessionTimeline(sessionId: string): ChatTimelineRow[];
  buildSessionCallGraph(sessionId: string): CallGraphProjection;
  buildSessionSummary(sessionId: string): SessionSummarySnapshot;
}

export function createSessionEventService(
  deps: SessionEventServiceDependencies
): SessionEventService {
  const { sessionEventRepository } = deps;

  function appendEvent(
    sessionId: string,
    actorType: SessionEventActorType,
    draft: SessionEventWriteDraft
  ): SessionEventEnvelope {
    return sessionEventRepository.appendEvent(sessionId, {
      ...draft,
      actorType,
    });
  }

  function appendCommandEvent(sessionId: string, draft: SessionEventWriteDraft): SessionEventEnvelope {
    return appendEvent(sessionId, 'system', draft);
  }

  function appendUserEvent(sessionId: string, draft: SessionEventWriteDraft): SessionEventEnvelope {
    return appendEvent(sessionId, 'user', draft);
  }

  function appendAgentEvent(sessionId: string, draft: SessionEventWriteDraft): SessionEventEnvelope {
    return appendEvent(sessionId, 'agent', draft);
  }

  function appendSystemEvent(sessionId: string, draft: SessionEventWriteDraft): SessionEventEnvelope {
    return appendEvent(sessionId, 'system', draft);
  }

  function listSessionEvents(sessionId: string, afterSeq?: number): SessionEventEnvelope[] {
    return sessionEventRepository.listEvents(sessionId, afterSeq);
  }

  function buildSessionTimeline(sessionId: string): ChatTimelineRow[] {
    return projectChatTimeline(listSessionEvents(sessionId));
  }

  function buildSessionCallGraph(sessionId: string): CallGraphProjection {
    return projectCallGraph(listSessionEvents(sessionId));
  }

  function buildSessionSummary(sessionId: string): SessionSummarySnapshot {
    const events = listSessionEvents(sessionId);
    return projectSessionSummary(sessionId, events);
  }

  return {
    appendCommandEvent,
    appendUserEvent,
    appendAgentEvent,
    appendSystemEvent,
    listSessionEvents,
    buildSessionTimeline,
    buildSessionCallGraph,
    buildSessionSummary,
  };
}
