import { createLogger } from './logger.js';

const logger = createLogger('retry');

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  retryIf?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'retryIf' | 'onRetry'>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
};

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Retry on rate limits, timeouts, and transient errors
    if (message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('503') ||
        message.includes('500')) {
      return true;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const shouldRetry = opts.retryIf || isRetryableError;

  let lastError: unknown;
  let delay = opts.initialDelay;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt > opts.maxRetries || !shouldRetry(error)) {
        throw error;
      }

      logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms`, error);
      opts.onRetry?.(error, attempt);

      await sleep(delay);
      delay = Math.min(delay * opts.backoffFactor, opts.maxDelay);
    }
  }

  throw lastError;
}

export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

export function createRateLimiter(requestsPerMinute: number) {
  const minInterval = 60000 / requestsPerMinute;
  let lastRequest = 0;

  return async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const elapsed = now - lastRequest;

    if (elapsed < minInterval) {
      await sleep(minInterval - elapsed);
    }

    lastRequest = Date.now();
    return fn();
  };
}
