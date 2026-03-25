const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROFESSIONAL_AGENTS = ['Codex架构师', 'BACKEND', 'FRONTEND', 'QA', 'OPS', 'SECURITY', 'PERF'];

function buildPromptFromTemplate(template, agentName) {
  const entry = template.agents[agentName];
  assert.ok(entry, `missing template entry: ${agentName}`);
  return [
    template.shared,
    `职责：${entry.duties}`,
    `边界：${entry.boundaries}`,
    `输出：${entry.output}`
  ].join('');
}

test('专业智能体共享模板保持精简结构，且不会阻止后台继续自定义 prompt', () => {
  const templatePath = path.join(__dirname, '..', '..', 'src', 'professional-agent-prompts.json');
  const filePath = path.join(__dirname, '..', '..', 'data', 'agents.json');
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const activeAgents = Array.isArray(store.activeAgents) ? store.activeAgents : [];

  for (const name of PROFESSIONAL_AGENTS) {
    const expectedPrompt = buildPromptFromTemplate(template, name);
    assert.ok(expectedPrompt.length > 0, `${name} template prompt should exist`);
    assert.ok(expectedPrompt.length < 700, `${name} template prompt should stay compact`);
    assert.ok(!expectedPrompt.includes('凡是满足以下任一条件的信息'), `${name} template should not keep the old verbose collaboration preamble`);
    assert.ok(!expectedPrompt.includes('聊天室沟通规则'), `${name} template should not keep the old repeated chat-room rule block`);
    assert.ok(expectedPrompt.includes('公开聊天室'), `${name} template should still mention public collaboration context`);
    assert.ok(expectedPrompt.includes('职责'), `${name} template should still describe role responsibility`);
    assert.ok(expectedPrompt.includes('边界'), `${name} template should still describe role boundaries`);

    const agent = activeAgents.find(item => item.name === name);
    assert.ok(agent, `missing agent: ${name}`);

    const prompt = String(agent.systemPrompt || '');
    assert.ok(prompt.length > 0, `${name} should keep a system prompt`);
    assert.ok(prompt.length < 700, `${name} stored prompt should stay compact`);
  }
});
