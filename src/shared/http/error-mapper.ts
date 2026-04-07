import { isAppError } from '../errors/app-error';
import { isHttpBodyParseError } from './body';

export interface MapHttpErrorOptions<TBody> {
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

function buildDefaultBody(message: string, error: unknown): { error: string; [key: string]: unknown } {
  return { error: message };
}

export function mapHttpError<TBody = { error: string }>(
  error: unknown,
  options: MapHttpErrorOptions<TBody> = {}
): { statusCode: number; body: TBody } {
  const message = getErrorMessage(error);
  const statusCode = isHttpBodyParseError(error)
    ? (options.invalidJsonStatus ?? 400)
    : isAppError(error)
      ? error.statusCode
      : (options.fallbackStatus ?? 500);
  const body = options.mapBody
    ? options.mapBody(message, error)
    : (buildDefaultBody(message, error) as unknown as TBody);

  return { statusCode, body };
}
