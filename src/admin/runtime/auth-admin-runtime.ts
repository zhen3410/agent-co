import * as http from 'http';

export interface AuthAdminRuntimeConfig {
  port: number;
  adminToken: string;
  dataFile: string;
  defaultPassword: string;
  agentDataFile: string;
  nodeEnv?: string;
  publicDir: string;
}

export interface AuthAdminRuntime extends AuthAdminRuntimeConfig {}

export function normalizeAdminToken(rawToken?: string): string {
  const trimmed = (rawToken || '').trim();
  if (!trimmed) {
    return '';
  }

  const isWrappedByQuote =
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''));

  return isWrappedByQuote ? trimmed.slice(1, -1).trim() : trimmed;
}

export function createAuthAdminRuntime(config: AuthAdminRuntimeConfig): AuthAdminRuntime {
  return {
    ...config,
    adminToken: normalizeAdminToken(config.adminToken)
  };
}

function performSecurityChecks(runtime: AuthAdminRuntime): void {
  const isProduction = runtime.nodeEnv === 'production';

  if (isProduction) {
    if (!runtime.adminToken || runtime.adminToken === 'change-me-in-production') {
      console.error('❌ 生产环境必须设置 AUTH_ADMIN_TOKEN 环境变量');
      process.exit(1);
    }
    if (runtime.adminToken.length < 32) {
      console.error('❌ AUTH_ADMIN_TOKEN 长度不能少于 32 字符');
      process.exit(1);
    }

    if (runtime.defaultPassword.length < 12) {
      console.error('❌ 生产环境 BOT_ROOM_DEFAULT_PASSWORD 长度不能少于 12 字符');
      process.exit(1);
    }
    const hasLower = /[a-z]/.test(runtime.defaultPassword);
    const hasUpper = /[A-Z]/.test(runtime.defaultPassword);
    const hasNumber = /[0-9]/.test(runtime.defaultPassword);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(runtime.defaultPassword);
    if (!(hasLower && hasUpper && hasNumber && hasSpecial)) {
      console.error('❌ 生产环境 BOT_ROOM_DEFAULT_PASSWORD 必须包含大小写字母、数字和特殊字符');
      process.exit(1);
    }
    return;
  }

  const warnings: string[] = [];
  if (!runtime.adminToken || runtime.adminToken === 'change-me-in-production') {
    warnings.push('⚠️ AUTH_ADMIN_TOKEN 未设置或使用默认值');
  }
  if (runtime.defaultPassword.length < 12) {
    warnings.push('⚠️ BOT_ROOM_DEFAULT_PASSWORD 长度不足');
  }
  if (warnings.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('🔒 安全检查警告（开发环境）');
    console.log('='.repeat(60));
    warnings.forEach(warning => console.log(warning));
    console.log('='.repeat(60) + '\n');
  }
}

function logStartupBanner(runtime: AuthAdminRuntime): void {
  console.log('='.repeat(60));
  console.log('🔐 鉴权管理服务已启动');
  console.log(`📍 地址: http://localhost:${runtime.port}`);
  console.log(`📁 用户数据: ${runtime.dataFile}`);
  console.log(`📁 智能体数据: ${runtime.agentDataFile}`);
  console.log('');
  console.log('页面:');
  console.log('  GET    /                       管理页面');
  console.log('');
  console.log('API 端点:');
  console.log('  GET    /healthz');
  console.log('  POST   /api/auth/verify');
  console.log('  GET    /api/users               (x-admin-token)');
  console.log('  POST   /api/users               (x-admin-token)');
  console.log('  PUT    /api/users/:name/password (x-admin-token)');
  console.log('  DELETE /api/users/:name         (x-admin-token)');
  console.log('  GET    /api/agents              (x-admin-token)');
  console.log('  POST   /api/agents              (x-admin-token)');
  console.log('  PUT    /api/agents/:name        (x-admin-token)');
  console.log('  PUT    /api/agents/:name/prompt (x-admin-token)');
  console.log('  DELETE /api/agents/:name        (x-admin-token)');
  console.log('  POST   /api/agents/apply-pending (x-admin-token)');
  console.log('  GET    /api/groups             (x-admin-token)');
  console.log('  POST   /api/groups             (x-admin-token)');
  console.log('  PUT    /api/groups/:id         (x-admin-token)');
  console.log('  DELETE /api/groups/:id         (x-admin-token)');
  console.log('='.repeat(60));
}

export async function startAuthAdminServer(server: http.Server, runtime: AuthAdminRuntime): Promise<void> {
  performSecurityChecks(runtime);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(runtime.port, () => {
      logStartupBanner(runtime);
      resolve();
    });
  });
}
