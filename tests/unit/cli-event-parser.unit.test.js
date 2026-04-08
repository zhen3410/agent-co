const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCliEventLine } = require('../../dist/cli-event-parser.js');

test('parseCliEventLine 能识别 assistant message 文本事件', () => {
  const parsed = parseCliEventLine('{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}');

  assert.equal(parsed.kind, 'json');
  assert.deepEqual(parsed.event, {
    type: 'assistant_text',
    text: 'hello'
  });
});

test('parseCliEventLine 能识别 response_item.message.content 中的 output_text', () => {
  const parsed = parseCliEventLine('{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"nested ok"}]}}');

  assert.equal(parsed.kind, 'json');
  assert.deepEqual(parsed.event, {
    type: 'assistant_text',
    text: 'nested ok'
  });
});

test('parseCliEventLine 能识别 item.completed 里的 agent_message 文本', () => {
  const parsed = parseCliEventLine('{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"agent message ok"}}');

  assert.equal(parsed.kind, 'json');
  assert.deepEqual(parsed.event, {
    type: 'assistant_text',
    text: 'agent message ok'
  });
});

test('parseCliEventLine 能识别 result 文本事件', () => {
  const parsed = parseCliEventLine('{"type":"result","result":"final answer"}');

  assert.equal(parsed.kind, 'json');
  assert.deepEqual(parsed.event, {
    type: 'result_text',
    text: 'final answer'
  });
});

test('parseCliEventLine 不会把用户 input_text 识别为 assistant 文本', () => {
  const parsed = parseCliEventLine('{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"secret user prompt"}]}}');

  assert.equal(parsed.kind, 'json');
  assert.equal(parsed.event, null);
});

test('parseCliEventLine 对非 JSON 行返回 non_json', () => {
  const parsed = parseCliEventLine('progress line');

  assert.deepEqual(parsed, {
    kind: 'non_json',
    raw: 'progress line'
  });
});
