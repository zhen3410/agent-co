#!/usr/bin/env node
/**
 * 运行脚本 - 启动 AI 并挂载 MCP 工具
 *
 * 这个脚本演示了如何：
 * 1. 先启动回调服务器
 * 2. 获取凭证
 * 3. 用 spawn 调用 claude CLI，动态挂载 MCP Server
 */

const { spawn } = require('child_process');
const http = require('http');

// 检查回调服务器是否在运行
function checkServer() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3200/', (res) => {
      resolve(res.statusCode !== undefined);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  console.log('\n🐱 猫咖啡馆 - AI 主动说话演示\n');

  // 检查服务器是否运行
  const serverRunning = await checkServer();
  if (!serverRunning) {
    console.log('❌ 回调服务器未运行！');
    console.log('\n请先在另一个终端运行：');
    console.log('  node callback-server.js\n');
    console.log('然后将输出的环境变量设置好，再运行此脚本。\n');
    process.exit(1);
  }

  // 检查凭证文件是否存在
  const credentialsPath = require('path').join(__dirname, '.cat-cafe-credentials.json');
  const hasCredentialsFile = require('fs').existsSync(credentialsPath);

  // 检查环境变量
  const hasEnvVars = process.env.CAT_CAFE_API_URL &&
                      process.env.CAT_CAFE_INVOCATION_ID &&
                      process.env.CAT_CAFE_CALLBACK_TOKEN;

  if (!hasCredentialsFile && !hasEnvVars) {
    console.log('❌ 缺少凭证配置！');
    console.log('\n请先启动 callback-server.js，它会自动生成凭证文件。');
    console.log('或者设置环境变量：');
    console.log('  export CAT_CAFE_API_URL="http://localhost:3200"');
    console.log('  export CAT_CAFE_INVOCATION_ID="your-id"');
    console.log('  export CAT_CAFE_CALLBACK_TOKEN="your-token"\n');
    process.exit(1);
  }

  console.log('✅ 回调服务器已就绪');
  console.log(hasCredentialsFile ? '✅ 凭证文件已找到' : '✅ 环境变量已配置');
  console.log();
  console.log('─'.repeat(60));
  console.log('💡 观察要点：');
  console.log('   - AI 的"思考"在 CLI 内部进行（这里能看到 --verbose 输出）');
  console.log('   - AI 选择性地通过 MCP 工具把消息发到聊天室');
  console.log('   - 回调服务器会显示 AI 发送的消息');
  console.log('─'.repeat(60) + '\n');

  // MCP 配置 - MCP Server 会自动从凭证文件读取，这里只在有环境变量时才传递
  const mcpServerConfig = {
    command: 'node',
    args: [require('path').resolve(__dirname, 'cat-cafe-mcp.js')]
  };

  // 如果有环境变量，也传递给 MCP Server（作为备选）
  if (hasEnvVars) {
    mcpServerConfig.env = {
      CAT_CAFE_API_URL: process.env.CAT_CAFE_API_URL,
      CAT_CAFE_INVOCATION_ID: process.env.CAT_CAFE_INVOCATION_ID,
      CAT_CAFE_CALLBACK_TOKEN: process.env.CAT_CAFE_CALLBACK_TOKEN,
    };
  }

  const mcpConfig = JSON.stringify({
    mcpServers: {
      'cat-cafe': mcpServerConfig
    }
  });

  // AI 的任务提示
  const prompt = `你的任务是写一首关于猫的诗。

在开始写之前，先用 cat_cafe_get_context 获取上下文，了解对话背景。

写完后，用 cat_cafe_post_message 把诗发到聊天室。

重要提示：
- 你的思考过程不需要发送到聊天室
- 只把你认为用户应该看到的最终作品发送
- 你可以自主决定发送什么内容`;

  // 启动 claude CLI
  // --allowedTools 自动授权 MCP 工具，无需手动确认
  const claude = spawn('claude', [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--mcp-config', mcpConfig,
    '--allowedTools', 'mcp__cat-cafe__cat_cafe_post_message,mcp__cat-cafe__cat_cafe_get_context'
  ], {
    stdio: 'inherit', // 直接显示所有输出
    env: { ...process.env }
  });

  claude.on('close', (code) => {
    console.log('\n' + '─'.repeat(60));
    console.log(`🏁 AI 进程结束，退出码: ${code}`);
    console.log('─'.repeat(60) + '\n');
  });

  claude.on('error', (err) => {
    console.error('❌ 启动失败:', err.message);
  });
}

main();
