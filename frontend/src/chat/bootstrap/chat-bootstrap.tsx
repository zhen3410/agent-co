import { getMergedRuntimeConfig, type RuntimeConfig } from '../../shared/config/runtime-config';

export interface ChatAuthStatus {
  authEnabled: boolean;
  authenticated: boolean;
}

export interface LoadInitialChatAuthStatusOptions {
  runtimeConfig?: RuntimeConfig;
  fetchImpl?: typeof fetch;
  authStatusPath?: string;
}

const DEFAULT_AUTH_STATUS: ChatAuthStatus = {
  authEnabled: false,
  authenticated: true
};

function normalizeAuthStatus(payload: unknown): ChatAuthStatus {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return DEFAULT_AUTH_STATUS;
  }

  const authStatus = payload as { authEnabled?: unknown; authenticated?: unknown };
  const authEnabled = Boolean(authStatus.authEnabled);

  return {
    authEnabled,
    authenticated: authEnabled ? Boolean(authStatus.authenticated) : true
  };
}

function resolveAuthStatusUrl(runtimeConfig: RuntimeConfig, authStatusPath: string): string {
  if (/^https?:\/\//i.test(authStatusPath)) {
    return authStatusPath;
  }

  const baseUrl = typeof runtimeConfig.apiBaseUrl === 'string' ? runtimeConfig.apiBaseUrl.trim() : '';
  if (/^https?:\/\//i.test(baseUrl)) {
    return new URL(authStatusPath, baseUrl).toString();
  }

  return authStatusPath;
}

export async function loadInitialChatAuthStatus(
  options: LoadInitialChatAuthStatusOptions = {}
): Promise<ChatAuthStatus> {
  const runtimeConfig = options.runtimeConfig ?? getMergedRuntimeConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const authStatusPath = options.authStatusPath ?? '/api/auth-status';
  const requestUrl = resolveAuthStatusUrl(runtimeConfig, authStatusPath);

  try {
    const response = await fetchImpl(requestUrl, {
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      return DEFAULT_AUTH_STATUS;
    }

    return normalizeAuthStatus(await response.json());
  } catch {
    return DEFAULT_AUTH_STATUS;
  }
}
