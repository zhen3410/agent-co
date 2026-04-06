import * as http from 'http';

export const HTTP_BODY_PARSE_ERROR_KIND = 'http-body-parse-error' as const;

export interface HttpBodyParseError extends Error {
  readonly kind: typeof HTTP_BODY_PARSE_ERROR_KIND;
}

export function createHttpBodyParseError(): HttpBodyParseError {
  return Object.assign(new Error('Invalid JSON'), {
    kind: HTTP_BODY_PARSE_ERROR_KIND
  }) as HttpBodyParseError;
}

export function isHttpBodyParseError(error: unknown): error is HttpBodyParseError {
  return Boolean(
    error
      && typeof error === 'object'
      && 'kind' in error
      && (error as { kind?: unknown }).kind === HTTP_BODY_PARSE_ERROR_KIND
  );
}

export function parseBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(createHttpBodyParseError());
      }
    });
    req.on('error', reject);
  });
}
