import type { ChannelAdapter } from './adapter';
import { call } from './adapter';
import { jobUrl } from '../services/jobs';
import type { Env } from '../env';

/**
 * Google for Jobs: the JobPosting JSON-LD on our job pages does the real work.
 * This adapter pings the Indexing API so Google recrawls on publish and close.
 * Needs GOOGLE_SA_JSON (service account with Indexing API access, verified owner in Search Console).
 */
type SA = { client_email: string; private_key: string };

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function googleToken(sa: SA): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/indexing', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claims}`));
  const res = await call('Google OAuth', 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64url(sig)}` }),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}

async function notify(env: Env & { GOOGLE_SA_JSON?: string }, url: string, type: 'URL_UPDATED' | 'URL_DELETED') {
  if (!env.GOOGLE_SA_JSON) return false;
  const token = await googleToken(JSON.parse(env.GOOGLE_SA_JSON) as SA);
  await call('Google Indexing API', 'https://indexing.googleapis.com/v3/urlNotifications:publish', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ url, type }),
  });
  return true;
}

export const googleJobs: ChannelAdapter = {
  provider: 'google_jobs', label: 'Google for Jobs', mode: 'feed', needsCopy: false,
  capabilities: { update: true, close: true },
  validate: (job) => (job.postedAt || job.status === 'open' ? [] : ['Job has no posted date']),
  async publish(ctx, job) {
    const url = jobUrl(ctx.env, job);
    const pinged = await notify(ctx.env, url, 'URL_UPDATED');
    return { externalId: url, url, note: pinged ? 'Indexing API notified' : 'JobPosting markup live; Indexing API not configured (GOOGLE_SA_JSON)' };
  },
  async update(ctx, _id, job) { await notify(ctx.env, jobUrl(ctx.env, job), 'URL_UPDATED'); },
  async close(ctx, _id, job) { await notify(ctx.env, jobUrl(ctx.env, job), 'URL_UPDATED'); },
};
