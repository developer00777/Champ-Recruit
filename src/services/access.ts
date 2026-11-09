import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import type { AppEnv, AppUser } from '../env';
import { db, schema } from '../db/client';
import { bad } from '../lib/util';

/**
 * Recruiter auth. In staging/production Cloudflare Access sits in front of /console and /api/console
 * and passes a signed JWT (Cf-Access-Jwt-Assertion); we verify it against the team's public keys.
 * Locally (no ACCESS_TEAM_DOMAIN) we trust DEV_AUTH_EMAIL instead. Roles come from the users table.
 */
type Jwk = JsonWebKey & { kid: string };
let jwksCache: { at: number; keys: Jwk[] } | null = null;

async function accessKeys(team: string): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  const data = (await res.json()) as { keys: Jwk[] };
  jwksCache = { at: Date.now(), keys: data.keys };
  return data.keys;
}

const b64urlToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export async function verifyAccessJwt(token: string, team: string, aud: string): Promise<string> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('malformed token');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h))) as { kid: string; alg: string };
  const jwk = (await accessKeys(team)).find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') throw new Error('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');
  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as { aud: string | string[]; exp: number; email?: string; iss: string };
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud)) throw new Error('wrong audience');
  if (claims.exp * 1000 < Date.now()) throw new Error('expired');
  if (claims.iss !== `https://${team}`) throw new Error('wrong issuer');
  if (!claims.email) throw new Error('no email claim');
  return claims.email.toLowerCase();
}

export const requireRecruiter: MiddlewareHandler<AppEnv> = async (c, next) => {
  let email: string | undefined;
  if (c.env.ACCESS_TEAM_DOMAIN) {
    const token = c.req.header('cf-access-jwt-assertion');
    if (!token) bad('Sign in through Cloudflare Access', 401);
    try {
      email = await verifyAccessJwt(token, c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD);
    } catch (e) {
      bad(`Access token rejected: ${(e as Error).message}`, 401);
    }
  } else if (c.env.ENVIRONMENT === 'dev' || c.env.ENVIRONMENT === 'test') {
    email = (c.req.header('x-dev-user') ?? c.env.DEV_AUTH_EMAIL)?.toLowerCase();
  }
  if (!email) bad('Console auth is not configured', 401);
  const u = await db(c.env).select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (!u) bad(`${email} is not a Talent Hub user. Ask an admin to add you.`, 403);
  c.set('user', { id: u.id, email: u.email, name: u.name, role: u.role, companyIds: u.companyIds } satisfies AppUser);
  await next();
};

export function canWrite(u: AppUser) {
  return u.role === 'admin' || u.role === 'recruiter';
}

export function canSeeCompany(u: AppUser, companyId: string) {
  return !u.companyIds || u.companyIds.includes(companyId);
}

export function assertRole(u: AppUser, ...roles: AppUser['role'][]) {
  if (!roles.includes(u.role)) bad(`Your role (${u.role}) can't do this`, 403);
}
