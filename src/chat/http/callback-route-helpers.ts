import * as http from 'http';

function asHeaderString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.join(',');
  }

  return '';
}

export function getCallbackToken(headers: http.IncomingHttpHeaders, headerName: string): string {
  const authHeader = asHeaderString(headers.authorization).trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return asHeaderString(headers[headerName]).trim();
}

export function isCallbackAuthorized(
  headers: http.IncomingHttpHeaders,
  headerName: string,
  callbackAuthToken: string
): boolean {
  return getCallbackToken(headers, headerName) === callbackAuthToken;
}

export function normalizeCallbackSessionId(value: unknown): string {
  return asHeaderString(value).trim();
}

export function normalizeCallbackAgentName(value: unknown): string {
  const rawAgentName = asHeaderString(value).trim() || 'AI';
  try {
    return decodeURIComponent(rawAgentName);
  } catch {
    return rawAgentName;
  }
}

export function normalizeCallbackPostMessageBody(body: {
  content?: unknown;
  invokeAgents?: unknown;
}): { content: string; invokeAgents?: string[] } {
  const content = (typeof body.content === 'string' ? body.content : '').trim();
  const invokeAgents = Array.isArray(body.invokeAgents)
    ? body.invokeAgents.filter((name): name is string => typeof name === 'string' && !!name.trim())
    : undefined;

  return {
    content,
    invokeAgents
  };
}
