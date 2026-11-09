import type { Context } from 'hono';
import type { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Env } from '../env';
import { redis, soft } from '../cache/redis';
import { keys, TTL } from '../cache/keys';

export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'Body must be JSON' });
  }
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HTTPException(422, { message: msg });
  }
  return r.data;
}

export const clientIp = (c: Context) => c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

/**
 * Idempotency-Key support for side-effecting POSTs: a repeated key within 24h
 * replays the first response instead of doing the work twice.
 */
export async function idempotent(c: Context<AppEnv>, scope: string, run: () => Promise<{ status: number; body: unknown }>) {
  const key = c.req.header('idempotency-key');
  if (!key) {
    const r = await run();
    return c.json(r.body as object, r.status as 200);
  }
  const k = keys(c.env).idem(`${scope}:${key}`);
  const prior = await soft(() => redis(c.env).get<string>(k), null);
  if (prior) {
    const p = JSON.parse(prior) as { status: number; body: unknown };
    c.header('idempotent-replay', 'true');
    return c.json(p.body as object, p.status as 200);
  }
  const r = await run();
  if (r.status < 500) await soft(() => redis(c.env).set(k, JSON.stringify(r), { ex: TTL.idem }), null);
  return c.json(r.body as object, r.status as 200);
}

/** Cloudflare Turnstile. Skipped when no secret is configured (local dev). */
export async function verifyTurnstile(env: Env & { TURNSTILE_SECRET?: string }, token: string | undefined, ip: string) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const data = (await res.json()) as { success: boolean };
  return data.success;
}
