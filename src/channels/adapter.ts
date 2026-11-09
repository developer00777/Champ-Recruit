import type { Env } from '../env';
import type { Provider } from '../db/schema';
import type { PublicJobDetail } from '../services/jobs';

export type Connection = {
  id: string; companyId: string; provider: Provider; accountRef: string; displayName: string;
  token: string | null; config: Record<string, unknown> | null; expiresAt: number | null;
};

export type PostCopy = { text: string; hashtags: string[] };

export type AdapterCtx = {
  env: Env;
  conn: Connection;
  /** Absolute job URL with ?src=…&p=<postingId> for attribution. */
  trackedUrl: string;
  postingId: string;
};

export type PublishResult = { externalId: string; url?: string; note?: string };

export interface ChannelAdapter {
  provider: Provider;
  label: string;
  /** api = we push; feed = they pull from us; social = a post, not a listing; owned = our own sites. */
  mode: 'api' | 'feed' | 'social' | 'owned';
  capabilities: { update: boolean; close: boolean };
  /** Does this channel need per-channel copy (social posts, job-board bodies)? */
  needsCopy: boolean;
  /** Pre-flight checks before queueing. Return human-readable problems. */
  validate(job: PublicJobDetail, copy: PostCopy | null): string[];
  publish(ctx: AdapterCtx, job: PublicJobDetail, copy: PostCopy | null): Promise<PublishResult>;
  update?(ctx: AdapterCtx, externalId: string, job: PublicJobDetail, copy: PostCopy | null): Promise<void>;
  close?(ctx: AdapterCtx, externalId: string, job: PublicJobDetail): Promise<void>;
}

// ---------- Error classes the publisher understands ----------

export class RetryableError extends Error {
  constructor(message: string, public retryAfterSec?: number) { super(message); }
}
export class NeedsReauthError extends Error {}
export class PermanentError extends Error {}

/** Map an HTTP response from a provider to the right error class. */
export async function providerError(provider: string, res: Response): Promise<never> {
  const body = (await res.text()).slice(0, 300);
  const msg = `${provider} returned ${res.status}${body ? `: ${body}` : ''}`;
  if (res.status === 401) throw new NeedsReauthError(`${provider}: the connection has expired or was revoked. Reconnect it on the Channels page.`);
  if (res.status === 429) throw new RetryableError(msg, Number(res.headers.get('retry-after')) || 60);
  if (res.status >= 500 || res.status === 408) throw new RetryableError(msg);
  throw new PermanentError(msg);
}

/** Network failures are retryable. */
export async function call(provider: string, input: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (e) {
    throw new RetryableError(`${provider}: network error (${(e as Error).message})`);
  }
  if (!res.ok) await providerError(provider, res);
  return res;
}

export const fillLink = (text: string, url: string) => (text.includes('{{link}}') ? text.replaceAll('{{link}}', url) : `${text}\n${url}`);
