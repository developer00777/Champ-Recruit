import { Redis } from '@upstash/redis/cloudflare';
import type { Env } from '../env';

/**
 * Redis is a cache, never the only copy of anything. Every helper here fails soft:
 * if Redis is unreachable we log and fall through to D1.
 */
const clients = new WeakMap<object, Redis>();
const REDIS_TIMEOUT_MS = 1500;

export function redis(env: Env): Redis {
  let c = clients.get(env);
  if (!c) {
    c = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
      automaticDeserialization: false,
      // Fail fast: a slow or unreachable Redis must never stall a request. Callers fall back to D1.
      retry: { retries: 0 },
      signal: () => AbortSignal.timeout(REDIS_TIMEOUT_MS),
    });
    clients.set(env, c);
  }
  return c;
}

/**
 * Circuit breaker: after a Redis failure, skip Redis for a few seconds (per isolate) so one outage
 * costs one timeout, not one per call. Requests keep working from D1 meanwhile.
 */
let downUntil = 0;
const BREAKER_MS = 10_000;

export function redisAvailable() {
  return Date.now() >= downUntil;
}

export async function soft<T>(fn: () => Promise<T>, fallback: T, what = 'redis'): Promise<T> {
  if (!redisAvailable()) return fallback;
  try {
    return await fn();
  } catch (err) {
    downUntil = Date.now() + BREAKER_MS;
    console.warn(`[${what}] degraded for ${BREAKER_MS / 1000}s:`, (err as Error).message);
    return fallback;
  }
}
