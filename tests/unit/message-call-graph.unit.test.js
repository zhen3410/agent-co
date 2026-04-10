const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');

function requireBuiltModule(...segments) {
  const modulePath = path.join(distDir, ...segments);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('message call graph builds a cyclic local graph around the focus message', () => {
  const { buildMessageCallGraph } = requireBuiltModule('chat', 'domain', 'message-call-graph.js');
  const now = Date.now();
  const history = [
    { id: 'user-1', role: 'user', sender: 'User', text: '@Alice 开始', timestamp: now - 40 },
    {
      id: 'alice-1',
      role: 'assistant',
      sender: 'Alice',
      text: '@@Bob 请补充',
      taskId: 'task-a',
      parentTaskId: 'task-b',
      callerAgentName: 'Bob',
      calleeAgentName: 'Alice',
      timestamp: now - 30
    },
    {
      id: 'bob-1',
      role: 'assistant',
      sender: 'Bob',
      text: '这是 Bob 的回复',
      taskId: 'task-b',
      parentTaskId: 'task-a',
      callerAgentName: 'Alice',
      calleeAgentName: 'Bob',
      timestamp: now - 20
    },
    {
      id: 'review-1',
      role: 'assistant',
      sender: 'Alice',
      text: 'Alice 对 Bob 的调用复核：接受。',
      messageSubtype: 'invocation_review',
      taskId: 'task-b',
      callerAgentName: 'Alice',
      calleeAgentName: 'Bob',
      reviewAction: 'accept',
      timestamp: now - 10
    }
  ];

  const graph = buildMessageCallGraph(history, history[3]);

  assert.ok(graph);
  assert.equal(graph.focusNodeId, 'message:review-1');
  assert.equal(graph.hasCycle, true);
  assert.equal(graph.summary.nodeCount, graph.nodes.length);
  assert.equal(graph.summary.edgeCount, graph.edges.length);
  assert.equal(graph.summary.participantNames.join(','), 'Alice,Bob');
  assert.ok(graph.edges.some(edge => edge.isCycleEdge));
  assert.ok(graph.edges.some(edge => edge.from === 'execution:task-a' && edge.to === 'execution:task-b'));
  assert.ok(graph.edges.some(edge => edge.from === 'execution:task-b' && edge.to === 'execution:task-a'));
  assert.ok(graph.nodes.some(node => node.id === 'message:review-1' && node.isFocus === true));
});

test('message call graph omits graph metadata for plain user messages without related invocation context', () => {
  const { buildMessageCallGraph, enrichMessagesWithCallGraphs } = requireBuiltModule('chat', 'domain', 'message-call-graph.js');
  const history = [
    { id: 'user-1', role: 'user', sender: 'User', text: '你好', timestamp: Date.now() }
  ];

  assert.equal(buildMessageCallGraph(history, history[0]), null);
  const enriched = enrichMessagesWithCallGraphs(history);
  assert.equal(enriched[0].callGraph, undefined);
});
