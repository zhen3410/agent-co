export interface RuntimeConfig {
  apiBaseUrl?: string;
  realtimeBaseUrl?: string;
  page?: string;
  [key: string]: unknown;
}

export const PAGE_BOOTSTRAP_SCRIPT_ID = 'page-bootstrap-config';

function parseJsonObject(text: string | null | undefined): Record<string, unknown> {
  if (!text) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  if (typeof window === 'undefined') {
    return {};
  }

  const candidate = (window as Window & { __AGENT_CO_RUNTIME_CONFIG__?: RuntimeConfig }).__AGENT_CO_RUNTIME_CONFIG__;
  if (!candidate || typeof candidate !== 'object') {
    return {};
  }

  return candidate;
}

export function getPageBootstrapConfig(scriptId = PAGE_BOOTSTRAP_SCRIPT_ID): Record<string, unknown> {
  if (typeof document === 'undefined') {
    return {};
  }

  const script = document.getElementById(scriptId);
  return parseJsonObject(script?.textContent);
}

export function getMergedRuntimeConfig(scriptId = PAGE_BOOTSTRAP_SCRIPT_ID): RuntimeConfig {
  return {
    ...getRuntimeConfig(),
    ...getPageBootstrapConfig(scriptId)
  };
}
