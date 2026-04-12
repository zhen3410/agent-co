import { createHttpClient, HttpRequestOptions } from './http-client';

export interface JsonRequestOptions extends HttpRequestOptions {
  fetch?: typeof fetch;
}

export async function requestJson<T = unknown>(url: string, options: JsonRequestOptions = {}): Promise<T> {
  const { fetch: fetchImpl, headers, ...requestOptions } = options;
  const client = createHttpClient({
    fetch: fetchImpl,
    headers
  });

  return client.request<T>(url, {
    ...requestOptions,
    headers
  });
}
