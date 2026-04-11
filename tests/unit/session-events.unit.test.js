const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSessionEvent,
  isVisibleTimelineEvent,
} = require('../../dist/chat/domain/session-events.js');

const { createSessionEventRepository } = require('../../dist/chat/infrastructure/session-event-repository.js');

test('createSessionEvent normalizes required envelope fields', () => {
  const event = createSessionEvent({
    sessionId: 's_1',
    seq: 1,
    eventType: 'user_message_created',
    actorType: 'user',
    actorName: '用户',
    payload: { text: 'hello' },
  });

  assert.equal(event.sessionId, 's_1');
  assert.equal(event.seq, 1);
  assert.equal(event.eventType, 'user_message_created');
  assert.equal(event.actorType, 'user');
  assert.equal(event.actorName, '用户');
  assert.equal(event.payload.text, 'hello');
  assert.equal(typeof event.payload, 'object');
  assert.equal(typeof event.eventId, 'string');
  assert.equal(typeof event.createdAt, 'string');
});

test('createSessionEvent rejects invalid event types', () => {
  assert.throws(
    () =>
      createSessionEvent({
        sessionId: 's_2',
        seq: 2,
        eventType: 'something_else',
        actorType: 'system',
      }),
    /eventType/i,
  );
});

test('createSessionEvent preserves correlation information', () => {
  const event = createSessionEvent({
    sessionId: 's_3',
    seq: 3,
    eventType: 'agent_message_created',
    actorType: 'agent',
    correlationId: 'cid-123',
    causationId: 'caid-456',
    causedByEventId: 'evt-1',
    causedBySeq: 1,
  });

  assert.equal(event.correlationId, 'cid-123');
  assert.equal(event.causationId, 'caid-456');
  assert.equal(event.causedByEventId, 'evt-1');
  assert.equal(event.causedBySeq, 1);
});

test('isVisibleTimelineEvent filters visible message events', () => {
  const visibleEvent = createSessionEvent({
    sessionId: 's_4',
    seq: 4,
    eventType: 'user_message_created',
    actorType: 'user',
    payload: { text: 'needed' },
  });

  const hiddenEvent = createSessionEvent({
    sessionId: 's_4',
    seq: 5,
    eventType: 'session_metadata_updated',
    actorType: 'system',
  });

  assert.equal(isVisibleTimelineEvent(visibleEvent), true);
  assert.equal(isVisibleTimelineEvent(hiddenEvent), false);
});

test('session event repository allocates per-session sequences and can clear', () => {
  const repository = createSessionEventRepository();

  const first = repository.appendEvent('session-a', {
    eventType: 'session_created',
    actorType: 'system',
    metadata: { source: 'test' },
  });

  assert.equal(first.sessionId, 'session-a');
  assert.equal(first.seq, 1);
  assert.equal(repository.getLatestSeq('session-a'), 1);

  repository.appendEvent('session-a', {
    eventType: 'session_metadata_updated',
    actorType: 'system',
  });

  assert.equal(repository.getLatestSeq('session-a'), 2);

  const secondSessionEvent = repository.appendEvent('session-b', {
    eventType: 'session_created',
    actorType: 'system',
  });

  assert.equal(secondSessionEvent.seq, 1);
  assert.equal(repository.getLatestSeq('session-b'), 1);
  assert.equal(repository.getLatestSeq('session-a'), 2);

  repository.clearAllSessions();

  assert.equal(repository.getLatestSeq('session-a'), 0);
  assert.deepEqual(repository.listEvents('session-a'), []);
});

test('session event repository batch append preserves draft order and filters by sequence', () => {
  const repository = createSessionEventRepository();

  const batch = repository.appendEvents('session-c', [
    { eventType: 'session_created', actorType: 'system' },
    { eventType: 'user_message_created', actorType: 'user', payload: { text: 'hi' } },
    { eventType: 'agent_message_created', actorType: 'agent', payload: { text: 'reply' } },
  ]);

  assert.deepEqual(batch.map(evt => evt.seq), [1, 2, 3]);

  const eventsAll = repository.listEvents('session-c');
  assert.deepEqual(eventsAll.map(evt => evt.seq), [1, 2, 3]);

  const eventsAfterTwo = repository.listEvents('session-c', 2);
  assert.deepEqual(eventsAfterTwo.map(evt => evt.seq), [3]);
});
