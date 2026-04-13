export interface HttpClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export interface HttpRequestOptions extends Omit<RequestInit, 'headers' | 'body'> {
  headers?: Record<string, string>;
  body?: BodyInit | null;
  json?: unknown;
}

export interface HttpResponseErrorShape {
  message?: string;
  code?: string;
  error?: {
    message?: string;
    code?: string;
  };
  [key: string]: unknown;
}

export class HttpClientError extends Error {
  status: number;
  statusText: string;
  code: string | null;
  body: unknown;
  url: string;
  method: string;

  constructor(params: {
    message: string;
    status: number;
    statusText: string;
    code?: string | null;
    body: unknown;
    url: string;
    method: string;
  }) {
    super(params.message);
    this.name = 'HttpClientError';
    this.status = params.status;
    this.statusText = params.statusText;
    this.code = params.code ?? null;
    this.body = params.body;
    this.url = params.url;
    this.method = params.method;
  }
}

function resolveUrl(baseUrl: string | undefined, input: string): string {
  if (/^https?:\/\//i.test(input)) {
    return input;
  }

  if (!baseUrl) {
    return input;
  }

  if (/^https?:\/\//i.test(baseUrl)) {
    const normalizedInput = input.startsWith('/') ? input.slice(1) : input;
    return new URL(normalizedInput, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = input.startsWith('/') ? input : `/${input}`;
  return `${normalizedBase}${normalizedPath}`;
}

function extractErrorMessage(body: unknown, fallback: string): { message: string; code: string | null } {
  if (!body || typeof body !== 'object') {
    return { message: fallback, code: null };
  }

  const payload = body as HttpResponseErrorShape;
  const nestedMessage = payload.error?.message;
  const directMessage = payload.message;
  const message = typeof nestedMessage === 'string'
    ? nestedMessage
    : (typeof directMessage === 'string' ? directMessage : fallback);

  const nestedCode = payload.error?.code;
  const directCode = payload.code;
  const code = typeof nestedCode === 'string'
    ? nestedCode
    : (typeof directCode === 'string' ? directCode : null);

  return { message, code };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.toLowerCase().includes('application/json');

  if (isJson) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    const text = await response.text();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export interface HttpClient {
  request<T = unknown>(path: string, options?: HttpRequestOptions): Promise<T>;
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const fetchImpl = options.fetch ?? fetch;
  const defaultHeaders = options.headers ?? {};
  const baseUrl = options.baseUrl;

  return {
    async request<T = unknown>(path: string, requestOptions: HttpRequestOptions = {}): Promise<T> {
      const url = resolveUrl(baseUrl, path);
      const method = requestOptions.method ?? 'GET';

      const headers: Record<string, string> = {
        ...defaultHeaders,
        ...(requestOptions.headers ?? {})
      };

      let body: BodyInit | null | undefined = requestOptions.body;

      if (typeof requestOptions.json !== 'undefined') {
        headers['content-type'] = headers['content-type'] ?? 'application/json';
        body = JSON.stringify(requestOptions.json);
      }

      const response = await fetchImpl(url, {
        ...requestOptions,
        method,
        headers,
        body
      });

      const parsedBody = await parseResponseBody(response);

      if (!response.ok) {
        const fallbackMessage = response.statusText || `HTTP ${response.status}`;
        const normalized = extractErrorMessage(parsedBody, fallbackMessage);

        throw new HttpClientError({
          message: normalized.message,
          status: response.status,
          statusText: response.statusText,
          code: normalized.code,
          body: parsedBody,
          url,
          method
        });
      }

      return parsedBody as T;
    }
  };
}
