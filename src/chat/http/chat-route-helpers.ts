function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function buildChatRateLimitBody(resetAt: number, now = Date.now()): { error: string; retryAfter: number } {
  return {
    error: '请求过于频繁，请稍后再试',
    retryAfter: Math.ceil((resetAt - now) / 1000)
  };
}

export function normalizeBodyText(value: unknown): string {
  return asString(value);
}

export function normalizeSessionId(value: unknown): string {
  return asString(value).trim();
}

export function normalizeWorkdirSelection(body: { agentName?: unknown; workdir?: unknown }): { agentName: string; workdir: string | null } {
  const agentName = asString(body.agentName);
  const workdir = asString(body.workdir).trim();
  return {
    agentName,
    workdir: workdir || null
  };
}
