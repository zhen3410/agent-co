const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('Claude CLI 在具备 callback 环境时会挂载 bot-room MCP 配置并允许工具调用', { concurrency: false }, async () => {
  const { callClaudeCLI } = require('../../dist/claude-cli.js');
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-claude-mcp-'));
  const argsFile = join(tempDir, 'claude-args.txt');
  const fakeClaude = join(tempDir, 'claude');

  writeFileSync(fakeClaude, `#!/usr/bin/env bash
printf '%s\n' "$@" > "${argsFile}"
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}\n'
`, 'utf8');
  chmodSync(fakeClaude, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${tempDir}:${originalPath || ''}`;

  try {
    const agent = {
      name: 'Claude',
      avatar: '🤖',
      systemPrompt: '你是测试助手',
      color: '#3b82f6',
      cli: 'claude'
    };

    const response = await callClaudeCLI('请处理任务', agent, [], {
      includeHistory: false,
      extraEnv: {
        BOT_ROOM_API_URL: 'http://127.0.0.1:3002',
        BOT_ROOM_SESSION_ID: 's_test',
        BOT_ROOM_AGENT_NAME: 'Claude',
        BOT_ROOM_CALLBACK_TOKEN: 'token123'
      }
    });

    assert.equal(response.text, 'ok');

    const args = readFileSync(argsFile, 'utf8').trim().split('\n');
    assert.ok(args.includes('--mcp-config'));
    assert.ok(args.includes('--allowedTools'));

    const configIndex = args.indexOf('--mcp-config');
    const configJson = JSON.parse(args[configIndex + 1]);
    const serverConfig = configJson.mcpServers['bot-room'];
    assert.equal(serverConfig.command, 'node');
    assert.ok(serverConfig.args[0].endsWith('/dist/bot-room-mcp-server.js'));
    assert.equal(serverConfig.env.BOT_ROOM_SESSION_ID, 's_test');
    assert.equal(serverConfig.env.BOT_ROOM_API_URL, 'http://127.0.0.1:3002');

    const toolsIndex = args.indexOf('--allowedTools');
    const tools = args[toolsIndex + 1];
    assert.equal(tools, 'mcp__bot-room__bot_room_post_message,mcp__bot-room__bot_room_get_context');
  } finally {
    process.env.PATH = originalPath;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Codex CLI 在具备 callback 环境时会挂载 bot-room MCP 配置并允许工具调用', { concurrency: false }, async () => {
  const { callClaudeCLI } = require('../../dist/claude-cli.js');
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-codex-mcp-'));
  const argsFile = join(tempDir, 'codex-args.txt');
  const fakeCodex = join(tempDir, 'codex');

  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '%s\n' "$@" > "${argsFile}"
printf '{"output_text":"ok"}\\n'
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${tempDir}:${originalPath || ''}`;

  try {
    const agent = {
      name: 'Codex架构师',
      avatar: '🏗️',
      systemPrompt: '你是测试架构师',
      color: '#8b5cf6',
      cli: 'codex'
    };

    const response = await callClaudeCLI('请处理任务', agent, [], {
      includeHistory: false,
      extraEnv: {
        BOT_ROOM_API_URL: 'http://127.0.0.1:3002',
        BOT_ROOM_SESSION_ID: 's_test',
        BOT_ROOM_AGENT_NAME: 'Codex架构师',
        BOT_ROOM_CALLBACK_TOKEN: 'token123'
      }
    });

    assert.equal(response.text, 'ok');

    const args = readFileSync(argsFile, 'utf8').trim().split('\n');
    assert.equal(args[0], 'exec');
    assert.ok(args.includes('--json'));
    assert.ok(args.includes('mcp_servers.botroom.command="node"'));
    assert.ok(args.includes('tools.allowed=["mcp__botroom__bot_room_post_message","mcp__botroom__bot_room_get_context"]'));

    const mcpArgsEntry = args.find(item => item.startsWith('mcp_servers.botroom.args='));
    assert.ok(mcpArgsEntry, 'should include bot-room mcp server args');
    assert.ok(mcpArgsEntry.includes('/dist/bot-room-mcp-server.js'));

    const mcpEnvEntry = args.find(item => item.startsWith('mcp_servers.botroom.env='));
    assert.ok(mcpEnvEntry, 'should include bot-room mcp server env');
    assert.ok(mcpEnvEntry.includes('BOT_ROOM_SESSION_ID="s_test"'));
    assert.ok(mcpEnvEntry.includes('BOT_ROOM_API_URL="http://127.0.0.1:3002"'));
  } finally {
    process.env.PATH = originalPath;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Codex CLI 能解析 response_item.message.content 里的 output_text 事件', { concurrency: false }, async () => {
  const { callClaudeCLI } = require('../../dist/claude-cli.js');
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-codex-json-'));
  const fakeCodex = join(tempDir, 'codex');

  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"nested ok"}]}}\\n'
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${tempDir}:${originalPath || ''}`;

  try {
    const agent = {
      name: 'Codex架构师',
      avatar: '🏗️',
      systemPrompt: '你是测试架构师',
      color: '#8b5cf6',
      cli: 'codex'
    };

    const response = await callClaudeCLI('请处理任务', agent, []);
    assert.equal(response.text, 'nested ok');
  } finally {
    process.env.PATH = originalPath;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Codex CLI 不会把 response_item 中的用户 input_text 拼接到最终回复', { concurrency: false }, async () => {
  const { callClaudeCLI } = require('../../dist/claude-cli.js');
  const tempDir = mkdtempSync(join(tmpdir(), 'bot-room-codex-filter-'));
  const fakeCodex = join(tempDir, 'codex');

  writeFileSync(fakeCodex, `#!/usr/bin/env bash
printf '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"secret user prompt"}]}}\\n'
printf '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"assistant ok"}]}}\\n'
`, 'utf8');
  chmodSync(fakeCodex, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${tempDir}:${originalPath || ''}`;

  try {
    const agent = {
      name: 'Codex架构师',
      avatar: '🏗️',
      systemPrompt: '你是测试架构师',
      color: '#8b5cf6',
      cli: 'codex'
    };

    const response = await callClaudeCLI('请处理任务', agent, []);
    assert.equal(response.text, 'assistant ok');
  } finally {
    process.env.PATH = originalPath;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
