export interface ReconnectPolicy {
  shouldReconnect(retryAttempt: number, event?: CloseEvent | null): boolean;
  getDelayMs(retryAttempt: number): number;
}

export interface ExponentialBackoffPolicyOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  jitterRatio?: number;
  random?: () => number;
}

export function createExponentialBackoffPolicy(options: ExponentialBackoffPolicyOptions = {}): ReconnectPolicy {
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const maxAttempts = options.maxAttempts ?? 5;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const random = options.random ?? Math.random;

  return {
    shouldReconnect(retryAttempt: number): boolean {
      return retryAttempt < maxAttempts;
    },
    getDelayMs(retryAttempt: number): number {
      const normalizedAttempt = Math.max(0, retryAttempt);
      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** normalizedAttempt));
      const jitterRange = exponentialDelay * jitterRatio;
      const jitter = (random() * 2 - 1) * jitterRange;
      return Math.max(0, Math.round(exponentialDelay + jitter));
    }
  };
}
