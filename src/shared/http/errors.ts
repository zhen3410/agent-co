import * as http from 'http';
import { sendJson } from './json';

interface SendHttpErrorOptions<TBody> {
  invalidJsonStatus?: number;
  fallbackStatus?: number;
  mapBody?: (message: string, error: unknown) => TBody;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Internal Server Error';
}

export function sendHttpError<TBody = { error: string }>(
  res: http.ServerResponse,
  error: unknown,
  options: SendHttpErrorOptions<TBody> = {}
): void {
  const message = getErrorMessage(error);
  const statusCode = message === 'Invalid JSON'
    ? (options.invalidJsonStatus ?? 400)
    : (options.fallbackStatus ?? 500);
  const body = options.mapBody
    ? options.mapBody(message, error)
    : ({ error: message } as unknown as TBody);

  sendJson(res, statusCode, body);
}
