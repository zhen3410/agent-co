import { getMergedRuntimeConfig } from '../../shared/config/runtime-config';

export function resolveChatRealtimeUrl(): string {
  if (typeof window === 'undefined') {
    return '/api/ws/session-events';
  }

  const config = getMergedRuntimeConfig();
  const configured = typeof config.realtimeBaseUrl === 'string' ? config.realtimeBaseUrl : '';
  if (configured) {
    if (/^wss?:\/\//i.test(configured)) {
      return configured;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (configured.startsWith('/')) {
      return `${protocol}//${window.location.host}${configured}`;
    }
    return `${protocol}//${window.location.host}/${configured}`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ws/session-events`;
}
