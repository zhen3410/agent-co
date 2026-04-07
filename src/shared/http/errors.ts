import * as http from 'http';
import { MapHttpErrorOptions, mapHttpError } from './error-mapper';
import { sendJson } from './json';

type SendHttpErrorOptions<TBody> = MapHttpErrorOptions<TBody>;

export function sendHttpError<TBody = { error: string }>(
  res: http.ServerResponse,
  error: unknown,
  options: SendHttpErrorOptions<TBody> = {}
): void {
  const { statusCode, body } = mapHttpError(error, options);
  sendJson(res, statusCode, body);
}
