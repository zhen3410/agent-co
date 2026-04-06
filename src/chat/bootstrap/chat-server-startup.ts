import * as http from 'http';
import { AIAgent } from '../../types';

export interface ChatServerSecurityConfig {
  nodeEnv: string | undefined;
  authAdminToken: string | undefined;
  defaultPassword: string | undefined;
}

export interface ChatServerStartupConfig {
  server: http.Server;
  hydrate(): Promise<void>;
  port: number;
  agentDataFile: string;
  listAgents(): AIAgent[];
  authEnabled: boolean;
  authAdminBaseUrl: string;
  redisDisabled: boolean;
  redisUrl: string;
  redisChatSessionsKey: string;
  security: ChatServerSecurityConfig;
}

function performSecurityChecks(config: ChatServerSecurityConfig): void {
  const isProduction = config.nodeEnv === 'production';
  const warnings: string[] = [];
  const adminToken = config.authAdminToken;

  if (isProduction) {
    if (!adminToken) {
      console.error('❌ 生产环境必须设置 AUTH_ADMIN_TOKEN 环境变量');
      process.exit(1);
    }
    if (adminToken.length < 32) {
      console.error('❌ AUTH_ADMIN_TOKEN 长度不能少于 32 字符');
      process.exit(1);
    }
    if (adminToken === 'change-me-in-production') {
      console.error('❌ AUTH_ADMIN_TOKEN 不能使用默认值');
      process.exit(1);
    }
  } else if (!adminToken || adminToken === 'change-me-in-production') {
    warnings.push('⚠️ AUTH_ADMIN_TOKEN 未设置或使用默认值（仅开发环境允许）');
  }

  const defaultPassword = config.defaultPassword;
  if (isProduction && defaultPassword) {
    if (defaultPassword.length < 12) {
      console.error('❌ 生产环境 BOT_ROOM_DEFAULT_PASSWORD 长度不能少于 12 字符');
      process.exit(1);
    }
    const hasLower = /[a-z]/.test(defaultPassword);
    const hasUpper = /[A-Z]/.test(defaultPassword);
    const hasNumber = /[0-9]/.test(defaultPassword);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(defaultPassword);
    if (!(hasLower && hasUpper && hasNumber && hasSpecial)) {
      console.error('❌ 生产环境 BOT_ROOM_DEFAULT_PASSWORD 必须包含大小写字母、数字和特殊字符');
      process.exit(1);
    }
  }

  if (warnings.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('🔒 安全检查警告');
    console.log('='.repeat(60));
    warnings.forEach(warning => console.log(warning));
    console.log('='.repeat(60) + '\n');
  }
}

function logStartupBanner(config: ChatServerStartupConfig): void {
  console.log('='.repeat(60));
  console.log('🚀 多 AI 智能体聊天室已启动');
  console.log('='.repeat(60));
  console.log(`📍 地址: http://localhost:${config.port}`);
  console.log('');
  console.log(`📁 智能体配置: ${config.agentDataFile}`);
  console.log('可用的 AI 智能体:');
  config.listAgents().forEach(agent => {
    console.log(`  - ${agent.avatar} ${agent.name}`);
  });
  console.log('');
  console.log('API 端点:');
  console.log('  GET  /api/agents       - 获取智能体列表');
  console.log('  POST /api/chat        - 发送消息');
  console.log('  POST /api/chat-resume - 继续执行中断后剩余链路');
  console.log('  POST /api/chat-summary - 手动触发 peer 讨论总结');
  console.log('  GET  /api/history    - 获取历史记录');
  console.log('  POST /api/clear      - 清空历史');
  console.log('  POST /api/login      - 登录鉴权');
  console.log('  POST /api/logout     - 登出');
  console.log('  GET  /api/auth-status - 鉴权状态');
  console.log('  POST /api/create-block - Route A: 创建 block');
  console.log('  GET  /api/block-status - 查看 BlockBuffer 状态');
  console.log('  GET  /api/dependencies/status - 查看依赖服务状态');
  console.log('  POST /api/callbacks/post-message - AI 主动发送聊天室消息');
  console.log('  GET  /api/callbacks/thread-context?sessionid=xxx - 获取会话历史');
  console.log('  GET  /api/verbose/agents - 查看 verbose 日志智能体列表');
  console.log('  GET  /api/dependencies/logs?startDate=2026-03-01&endDate=2026-03-18&keyword=timeout - 查询依赖日志');
  console.log('  GET  /api/verbose/logs?agent=xxx - 查看智能体日志文件列表');
  console.log('  GET  /api/verbose/log-content?file=xxx.log - 查看日志文件内容');
  console.log('');
  console.log('使用方式:');
  console.log('  - 输入 @Claude 可以召唤 Claude');
  console.log('  - 输入 @Codex架构师 可以召唤 Codex 架构师');
  console.log('  - 输入 @Alice 可以召唤 Alice');
  console.log('  - 输入 @Bob 可以召唤 Bob');
  console.log('');
  console.log('💡 提示: 如果 Claude/Codex CLI 不可用,会自动使用模拟回复');
  if (config.authEnabled) {
    console.log(`🔐 鉴权已启用: 依赖独立鉴权服务 ${config.authAdminBaseUrl}`);
  } else {
    console.log('🔓 鉴权未启用: 设置 BOT_ROOM_AUTH_ENABLED=false');
  }
  if (config.redisDisabled) {
    console.log('🧠 Redis 会话持久化已禁用: BOT_ROOM_DISABLE_REDIS=true');
  } else {
    console.log(`🧠 Redis 会话持久化已启用: url=${config.redisUrl}, key=${config.redisChatSessionsKey}`);
  }
  console.log('='.repeat(60));
}

export async function startChatServer(config: ChatServerStartupConfig): Promise<void> {
  performSecurityChecks(config.security);
  await config.hydrate();

  await new Promise<void>((resolve, reject) => {
    config.server.once('error', reject);
    config.server.listen(config.port, () => {
      logStartupBanner(config);
      resolve();
    });
  });
}
