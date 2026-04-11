const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionEventRepository } = require('../../dist/chat/infrastructure/session-event-repository.js');
const { createWsHub } = require('../../dist/chat/runtime/ws-hub.js');

function appendSystemEvent(repository, sessionId, eventType = 'session_created') {
  return repository.appendEvent(sessionId, {
    eventType,
    actorType: 'system',
    payload: { source: 'unit-test' }
  });
}

test('ws hub subscribe 会先回放 afterSeq 之后事件，再按会话实时 fanout', () => {
  const repository = createSessionEventRepository();
  appendSystemEvent(repository, 's1');
  const s1Second = appendSystemEvent(repository, 's1', 'session_metadata_updated');
  appendSystemEvent(repository, 's2');

  const hub = createWsHub({
    listSessionEvents: (sessionId, afterSeq) => repository.listEvents(sessionId, afterSeq)
  });

  const received = [];
  hub.subscribe({
    subscriberId: 'client-1',
    sessionId: 's1',
    afterSeq: 1,
    onSessionEvent: (event) => received.push(event)
  });

  assert.deepEqual(received.map((event) => event.seq), [s1Second.seq]);

  const s1Third = appendSystemEvent(repository, 's1', 'session_metadata_updated');
  const s2Second = appendSystemEvent(repository, 's2', 'session_metadata_updated');
  hub.publish(s1Third);
  hub.publish(s2Second);

  assert.deepEqual(received.map((event) => event.seq), [s1Second.seq, s1Third.seq]);
});

test('ws hub 对同一 subscriber 重新订阅会替换旧会话，unsubscribe 会清理订阅', () => {
  const repository = createSessionEventRepository();
  appendSystemEvent(repository, 's1');
  const s2First = appendSystemEvent(repository, 's2');

  const hub = createWsHub({
    listSessionEvents: (sessionId, afterSeq) => repository.listEvents(sessionId, afterSeq)
  });

  const firstSubscriptionEvents = [];
  hub.subscribe({
    subscriberId: 'client-1',
    sessionId: 's1',
    afterSeq: 1,
    onSessionEvent: (event) => firstSubscriptionEvents.push(event)
  });

  const replacedSubscriptionEvents = [];
  hub.subscribe({
    subscriberId: 'client-1',
    sessionId: 's2',
    afterSeq: 0,
    onSessionEvent: (event) => replacedSubscriptionEvents.push(event)
  });

  const s1Second = appendSystemEvent(repository, 's1', 'session_metadata_updated');
  const s2Second = appendSystemEvent(repository, 's2', 'session_metadata_updated');
  hub.publish(s1Second);
  hub.publish(s2Second);

  assert.equal(firstSubscriptionEvents.length, 0);
  assert.deepEqual(replacedSubscriptionEvents.map((event) => event.seq), [s2First.seq, s2Second.seq]);

  hub.unsubscribe('client-1');
  const s2Third = appendSystemEvent(repository, 's2', 'session_metadata_updated');
  hub.publish(s2Third);

  assert.deepEqual(replacedSubscriptionEvents.map((event) => event.seq), [s2First.seq, s2Second.seq]);
});
