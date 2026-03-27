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
  assert.ok(html.includes('await loadWorkdirHierarchy();'), 'should load workdir options after token verification');
  assert.ok(html.includes('initializeWorkdirSelectors();'), 'should initialize placeholder selectors before admin token verification');
  assert.ok(html.includes('loadWorkdirHierarchy(agent.workdir || \'\')'), 'should restore saved workdir hierarchy when editing');
  assert.ok(html.includes("document.getElementById('agentCli').value"), 'should read and restore cli type in the form');
  assert.ok(html.includes("(agent.cli || 'claude').toUpperCase()"), 'should show current cli type in agent list');
  assert.ok(html.includes('data-agent-prompt="${escapeHtml(agent.name)}"'), 'should bind prompt editor to agent name');
  assert.ok(html.includes('保存提示词'), 'should provide save prompt action');
  assert.ok(html.includes('const promptInput = document.querySelector(`[data-agent-prompt="${cssEscape(name)}"]`);'), 'should read prompt from inline textarea');
});

test('管理后台包含 API connection 管理和 agent API 模式配置 UI', () => {
  const htmlPath = path.join(__dirname, '..', '..', 'public-auth', 'admin.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('模型连接'), 'should render model connection management section');
  assert.ok(html.includes('/api/model-connections'), 'should call model connection CRUD endpoints');
  assert.ok(html.includes('id="agentExecutionMode"'), 'should render execution mode selector');
  assert.ok(html.includes('id="agentApiConnectionId"'), 'should render api connection selector');
  assert.ok(html.includes('id="agentApiModel"'), 'should render api model input');
  assert.ok(html.includes('id="agentApiTemperature"'), 'should render api temperature input');
  assert.ok(html.includes('id="agentApiMaxTokens"'), 'should render api max tokens input');
  assert.ok(html.includes('toggleAgentExecutionFields('), 'should toggle CLI/API field visibility');
  assert.ok(html.includes("executionMode: document.getElementById('agentExecutionMode').value"), 'should submit execution mode');
  assert.ok(html.includes("apiConnectionId: document.getElementById('agentApiConnectionId').value"), 'should submit api connection id');
  assert.ok(html.includes("apiModel: document.getElementById('agentApiModel').value.trim()"), 'should submit api model');
  assert.ok(html.includes("apiTemperature: parseOptionalNumber(document.getElementById('agentApiTemperature').value)"), 'should submit api temperature');
  assert.ok(html.includes("apiMaxTokens: parseOptionalInteger(document.getElementById('agentApiMaxTokens').value)"), 'should submit api max tokens');
  assert.ok(html.includes("agent.executionMode === 'api'"), 'should render API mode summary in agent cards');
  assert.ok(html.includes('API · ${escapeHtml(connectionName)} · ${escapeHtml(agent.apiModel || \'\')}'), 'should show API summary in agent list');
});
