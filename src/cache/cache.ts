import type { Env } from '../env';
import { redis, soft } from './redis';
import { keys, TTL } from './keys';

/** Read the current version of a namespace (0 if never bumped or Redis is down). */
export async function getVersion(env: Env, key: string): Promise<number> {
  return soft(async () => Number((await redis(env).get<string>(key)) ?? 0), 0);
}

/** Bump namespace versions so the next read rebuilds. Old keys simply expire. */
export async function bumpJobVersions(env: Env, jobId: string, companySlug: string) {
  const k = keys(env);
  await soft(async () => {
    const p = redis(env).pipeline();
    p.incr(k.verJob(jobId));
    p.incr(k.verJobs('all'));
    p.incr(k.verJobs(companySlug));
    await p.exec();
  }, undefined);
}

/** Cache-aside: JSON value under `key`, built by `load` on miss. */
export async function cached<T>(env: Env, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = await soft(() => redis(env).get<string>(key), null);
  if (hit != null) {
    try {
      return JSON.parse(hit) as T;
    } catch { /* corrupt entry — rebuild */ }
  }
  const value = await load();
  await soft(() => redis(env).set(key, JSON.stringify(value), { ex: ttl }), null);
  return value;
}

/**
 * Fixed-window rate limit. Returns true when allowed.
 * Fails open by default: during a Redis outage candidates must still be able to apply (Turnstile still applies).
 * Pass failOpen=false for endpoints where brute force matters more than availability.
 */
export async function rateLimit(env: Env, bucket: string, id: string, limit: number, windowSec: number, failOpen = true) {
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const key = keys(env).rl(bucket, id, window);
  const count = await soft(async () => {
    const p = redis(env).pipeline();
    p.incr(key);
    p.expire(key, windowSec);
    const [n] = await p.exec<[number, number]>();
    return n;
  }, failOpen ? 0 : Number.POSITIVE_INFINITY, 'ratelimit');
  return count <= limit;
}

/** Distributed lock (SET NX PX). Returns a release fn, or null if someone else holds it. Null-safe if Redis is down. */
export async function acquireLock(env: Env, key: string, ttlSec = TTL.lockPost): Promise<(() => Promise<void>) | null> {
  const token = crypto.randomUUID();
  const ok = await soft(() => redis(env).set(key, token, { nx: true, ex: ttlSec }), 'DEGRADED' as const, 'lock');
  if (ok === null) return null;
  return async () => {
    await soft(async () => {
      // Release only if we still own it.
      await redis(env).eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        [key],
        [token],
      );
    }, undefined, 'lock');
  };
}

/** Write-behind counters (flushed hourly to D1 by cron). */
export async function countView(env: Env, jobId: string) {
  const hour = new Date().toISOString().slice(0, 13).replace(/[-T]/g, '');
  const k = keys(env).views(hour);
  await soft(async () => {
    const p = redis(env).pipeline();
    p.hincrby(k, jobId, 1);
    p.expire(k, TTL.counters);
    await p.exec();
  }, undefined);
}

export async function countClick(env: Env, jobId: string, source: string) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const k = keys(env).clicks(day);
  await soft(async () => {
    const p = redis(env).pipeline();
    p.hincrby(k, `${jobId}|${source}`, 1);
    p.expire(k, TTL.counters);
    await p.exec();
  }, undefined);
}

export async function redisHealthy(env: Env): Promise<boolean> {
  return soft(async () => (await redis(env).ping()) === 'PONG', false);
}
