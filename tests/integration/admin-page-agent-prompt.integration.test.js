const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('管理后台智能体列表展示并支持就地修改当前提示词', () => {
  const htmlPath = path.join(__dirname, '..', '..', 'public-auth', 'admin.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('当前提示词'), 'should render current prompt label in agent card');
  assert.ok(html.includes('<select id="agentCli">'), 'should render cli selector for manual agent creation');
  assert.ok(html.includes('<select id="agentWorkdirRoot">'), 'should render workdir root selector');
  assert.ok(html.includes('<select id="agentWorkdirLevel2">'), 'should render workdir level2 selector');
  assert.ok(html.includes('<select id="agentWorkdirLevel3">'), 'should render workdir level3 selector');
  assert.ok(html.includes("fetch(`/api/system/dirs${query}`"), 'should load workdir options from runtime filesystem');
  assert.ok(html.includes('loadWorkdirHierarchy(agent.workdir || \'\')'), 'should restore saved workdir hierarchy when editing');
  assert.ok(html.includes("document.getElementById('agentCli').value"), 'should read and restore cli type in the form');
  assert.ok(html.includes("(agent.cli || 'claude').toUpperCase()"), 'should show current cli type in agent list');
  assert.ok(html.includes('data-agent-prompt="${escapeHtml(agent.name)}"'), 'should bind prompt editor to agent name');
  assert.ok(html.includes('保存提示词'), 'should provide save prompt action');
  assert.ok(html.includes('const promptInput = document.querySelector(`[data-agent-prompt="${cssEscape(name)}"]`);'), 'should read prompt from inline textarea');
});
