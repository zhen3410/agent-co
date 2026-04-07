import { AppErrorCode, getAppErrorStatusCode } from './app-error-codes';

export interface AppErrorOptions {
  code: AppErrorCode;
  statusCode?: number;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;

  constructor(message: string, options: AppErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.code = options.code;
    this.statusCode = options.statusCode ?? getAppErrorStatusCode(options.code);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
