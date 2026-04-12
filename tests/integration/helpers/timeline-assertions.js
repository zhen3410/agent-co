const assert = require('node:assert/strict');

async function waitForCondition(check, timeoutMs = 3000, intervalMs = 80) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) {
      return value;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error('condition not met before timeout');
}

function extractTimelineMessages(timelineBody) {
  return Array.isArray(timelineBody && timelineBody.timeline)
    ? timelineBody.timeline
      .filter(item => item && item.kind === 'message' && item.message)
      .map(item => item.message)
    : [];
}

async function fetchTimelineMessages(fixture, sessionId) {
  const response = await fixture.request(`/api/sessions/${sessionId}/timeline`);
  assert.equal(response.status, 200);
  return extractTimelineMessages(response.body);
}

async function waitForTimelineMessages(fixture, sessionId, predicate, timeoutMs = 3000, intervalMs = 80) {
  return waitForCondition(async () => {
    const messages = await fetchTimelineMessages(fixture, sessionId);
    return predicate(messages) ? messages : null;
  }, timeoutMs, intervalMs);
}

module.exports = {
  waitForCondition,
  extractTimelineMessages,
  fetchTimelineMessages,
  waitForTimelineMessages
};
