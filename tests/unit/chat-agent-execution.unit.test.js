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

test('会为 agent 注入当前会话启用名单与仅可 invoke 已启用 agent 的约束', () => {
  const { buildSessionScopedAgentPrompt } = requireBuiltModule('chat', 'application', 'chat-agent-execution.js');

  const prompt = buildSessionScopedAgentPrompt(
    '你是 CPO战略官。',
    ['创意猎手', '用户研究员', '增长黑客']
  );

  assert.match(prompt, /当前会话启用的智能体/);
  assert.match(prompt, /创意猎手、用户研究员、增长黑客/);
  assert.match(prompt, /只能通过 invokeAgents 调度上述已启用智能体/);
  assert.match(prompt, /不要调度未启用的智能体/);
});
