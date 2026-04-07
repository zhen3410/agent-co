export const APP_ERROR_CODES = {
  VALIDATION_FAILED: 'validation_failed',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  DEPENDENCY_FAILURE: 'dependency_failure',
  INTERNAL_FAILURE: 'internal_failure'
} as const;

export type AppErrorCode = typeof APP_ERROR_CODES[keyof typeof APP_ERROR_CODES];

const DEFAULT_APP_ERROR_STATUS_CODES: Record<AppErrorCode, number> = {
  [APP_ERROR_CODES.VALIDATION_FAILED]: 400,
  [APP_ERROR_CODES.UNAUTHORIZED]: 401,
  [APP_ERROR_CODES.FORBIDDEN]: 403,
  [APP_ERROR_CODES.NOT_FOUND]: 404,
  [APP_ERROR_CODES.CONFLICT]: 409,
  [APP_ERROR_CODES.RATE_LIMITED]: 429,
  [APP_ERROR_CODES.DEPENDENCY_FAILURE]: 503,
  [APP_ERROR_CODES.INTERNAL_FAILURE]: 500
};

export function getAppErrorStatusCode(code: AppErrorCode): number {
  return DEFAULT_APP_ERROR_STATUS_CODES[code];
}

export function getAppErrorCodeForStatusCode(statusCode: number): AppErrorCode {
  switch (statusCode) {
    case 400:
      return APP_ERROR_CODES.VALIDATION_FAILED;
    case 401:
      return APP_ERROR_CODES.UNAUTHORIZED;
    case 403:
      return APP_ERROR_CODES.FORBIDDEN;
    case 404:
      return APP_ERROR_CODES.NOT_FOUND;
    case 409:
      return APP_ERROR_CODES.CONFLICT;
    case 429:
      return APP_ERROR_CODES.RATE_LIMITED;
    case 502:
    case 503:
    case 504:
      return APP_ERROR_CODES.DEPENDENCY_FAILURE;
    default:
      throw new Error(`Unsupported AppError status code: ${statusCode}`);
  }
}
