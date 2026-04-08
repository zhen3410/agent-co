import type { ChatServerSecurityConfig } from './chat-startup-types';

export interface ChatStartupSecurityAnalysis {
  errors: string[];
  warnings: string[];
}

export function analyzeChatStartupSecurity(config: ChatServerSecurityConfig): ChatStartupSecurityAnalysis {
  const isProduction = config.nodeEnv === 'production';
  const warnings: string[] = [];
  const errors: string[] = [];
  const adminToken = config.authAdminToken;

  if (isProduction) {
    if (!adminToken) {
      errors.push('❌ 生产环境必须设置 AUTH_ADMIN_TOKEN 环境变量');
      return { errors, warnings };
    }
    if (adminToken.length < 32) {
      errors.push('❌ AUTH_ADMIN_TOKEN 长度不能少于 32 字符');
      return { errors, warnings };
    }
    if (adminToken === 'change-me-in-production') {
      errors.push('❌ AUTH_ADMIN_TOKEN 不能使用默认值');
      return { errors, warnings };
    }
  } else if (!adminToken || adminToken === 'change-me-in-production') {
    warnings.push('⚠️ AUTH_ADMIN_TOKEN 未设置或使用默认值（仅开发环境允许）');
  }

  const defaultPassword = config.defaultPassword;
  if (isProduction && defaultPassword) {
    if (defaultPassword.length < 12) {
      errors.push('❌ 生产环境 AGENT_CO_DEFAULT_PASSWORD 长度不能少于 12 字符');
      return { errors, warnings };
    }
    const hasLower = /[a-z]/.test(defaultPassword);
    const hasUpper = /[A-Z]/.test(defaultPassword);
    const hasNumber = /[0-9]/.test(defaultPassword);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(defaultPassword);
    if (!(hasLower && hasUpper && hasNumber && hasSpecial)) {
      errors.push('❌ 生产环境 AGENT_CO_DEFAULT_PASSWORD 必须包含大小写字母、数字和特殊字符');
      return { errors, warnings };
    }
  }

  return { errors, warnings };
}

export function formatChatStartupSecurityWarnings(warnings: string[]): string[] {
  if (warnings.length === 0) {
    return [];
  }

  return [
    '\n' + '='.repeat(60),
    '🔒 安全检查警告',
    '='.repeat(60),
    ...warnings,
    '='.repeat(60) + '\n'
  ];
}

export function performChatStartupSecurityChecks(config: ChatServerSecurityConfig): void {
  const analysis = analyzeChatStartupSecurity(config);
  if (analysis.errors.length > 0) {
    console.error(analysis.errors[0]);
    process.exit(1);
  }

  for (const line of formatChatStartupSecurityWarnings(analysis.warnings)) {
    console.log(line);
  }
}
