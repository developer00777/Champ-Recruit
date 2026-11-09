import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { redis } from '../cache/redis';
import { keys, TTL } from '../cache/keys';

const COOKIE = 'cth_sid';
export type CandidateSession = { candidateId: string; email: string };

export async function createSession(c: Context<AppEnv>, s: CandidateSession) {
  const sid = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  await redis(c.env).set(keys(c.env).sess(sid), JSON.stringify(s), { ex: TTL.sess });
  setCookie(c, COOKIE, sid, {
    httpOnly: true, sameSite: 'Lax', path: '/', maxAge: TTL.sess,
    secure: c.env.APP_URL.startsWith('https'),
  });
}

export async function readSession(c: Context<AppEnv>): Promise<CandidateSession | null> {
  const sid = getCookie(c, COOKIE);
  if (!sid) return null;
  try {
    const k = keys(c.env).sess(sid);
    const raw = await redis(c.env).get<string>(k);
    if (!raw) return null;
    // Sliding expiry.
    c.executionCtx.waitUntil(redis(c.env).expire(k, TTL.sess).catch(() => 0));
    return JSON.parse(raw) as CandidateSession;
  } catch {
    return null;
  }
}

export async function destroySession(c: Context<AppEnv>) {
  const sid = getCookie(c, COOKIE);
  if (sid) await redis(c.env).del(keys(c.env).sess(sid)).catch(() => 0);
  deleteCookie(c, COOKIE, { path: '/' });
}
