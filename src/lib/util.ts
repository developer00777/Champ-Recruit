import { HTTPException } from 'hono/http-exception';

export const now = () => Date.now();
export const uid = () => crypto.randomUUID();

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 80);
}

export function bad(message: string, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503 = 400): never {
  throw new HTTPException(status, { message });
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable JSON stringify (sorted keys) — used for hashing request inputs. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

export const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** For embedding JSON in a <script> tag safely. */
const LINE_SEPARATORS = /[\u2028\u2029]/g;
export const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(LINE_SEPARATORS, '');

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export function daysAgo(ts: number | null | undefined): number {
  if (!ts) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
}
