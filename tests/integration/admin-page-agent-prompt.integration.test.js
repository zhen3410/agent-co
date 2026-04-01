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

test('编辑已绑定停用 connection 的 API agent 时仍会保留当前连接选项', () => {
  const htmlPath = path.join(__dirname, '..', '..', 'public-auth', 'admin.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('selectedConnection && !selectedConnection.enabled'), 'should detect disabled selected connection');
  assert.ok(html.includes('（已停用）'), 'should label disabled selected connection clearly');
  assert.ok(html.includes('const enabledOptions = modelConnections'), 'should keep normal enabled options separate');
});

test('聊天首页在加载分组后会默认展开分组并渲染分组头部', () => {
  const htmlPath = path.join(__dirname, '..', '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('function getGroupedAgents()'), 'should build grouped agent list on chat page');
  assert.ok(html.includes('expandedGroups = new Set(groupedAgents.map(group => group.id));'), 'should expand loaded groups by default');
  assert.ok(html.includes('class="agent-group-header'), 'should render group headers in chat sidebar');
});

test('管理后台会加载分组并按分组展示智能体', () => {
  const htmlPath = path.join(__dirname, '..', '..', 'public-auth', 'admin.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes("let groups = [];"), 'should keep group state in admin page');
  assert.ok(html.includes("await loadGroups();"), 'should load groups after token verification');
  assert.ok(html.includes("fetch('/api/groups'"), 'should request group data from admin api');
  assert.ok(html.includes('function getGroupedAgentsForAdmin('), 'should build grouped agent view in admin page');
  assert.ok(html.includes('agent-group-section'), 'should render grouped admin sections');
});

test('管理后台提供分组管理界面和创建分组弹窗', () => {
  const htmlPath = path.join(__dirname, '..', '..', 'public-auth', 'admin.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('分组管理'), 'should render group management section title');
  assert.ok(html.includes('showGroupModal()'), 'should provide create-group trigger');
  assert.ok(html.includes('id="groups-list"'), 'should render groups list container');
  assert.ok(html.includes('id="group-modal"'), 'should render group modal');
  assert.ok(html.includes('id="group-form"'), 'should render group form');
  assert.ok(html.includes('id="group-id"'), 'should render group id input');
  assert.ok(html.includes('id="group-name"'), 'should render group name input');
  assert.ok(html.includes('id="group-icon"'), 'should render group icon input');
  assert.ok(html.includes('id="group-agents-checkboxes"'), 'should render group member checkbox container');
  assert.ok(html.includes("document.getElementById('group-form').addEventListener('submit'"), 'should bind group form submit handler');
  assert.ok(html.includes("fetch(`/api/groups/${encodeURIComponent(id)}`"), 'should delete groups through api');
});
