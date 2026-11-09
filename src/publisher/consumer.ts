import { eq } from 'drizzle-orm';
import type { Env } from '../env';
import type { PublishMessage } from './types';
import { db, schema } from '../db/client';
import { adapterFor } from '../channels/registry';
import { NeedsReauthError, RetryableError, type Connection } from '../channels/adapter';
import { acquireLock } from '../cache/cache';
import { keys } from '../cache/keys';
import { decrypt } from '../lib/crypto';
import { getJobDetail, jobUrl } from '../services/jobs';
import { now, uid } from '../lib/util';
import { sendEmail } from '../services/email';

const MAX_ATTEMPTS = 5;
const backoff = (attempt: number) => Math.min(30 * 2 ** (attempt - 1), 1800); // 30s, 60s, 2m, 4m, 8m… capped at 30m

export async function handleQueue(batch: MessageBatch<PublishMessage>, env: Env, _ctx: ExecutionContext) {
  for (const msg of batch.messages) {
    try {
      const body = msg.body;
      if (body.kind === 'publish' || body.kind === 'close' || body.kind === 'update') {
        const outcome = await processPosting(env, body.postingId, body.kind, msg.attempts);
        if (outcome.retryIn != null) msg.retry({ delaySeconds: outcome.retryIn });
        else msg.ack();
      } else {
        msg.ack();
      }
    } catch (err) {
      console.error('[queue] unexpected error', err);
      msg.retry({ delaySeconds: backoff(msg.attempts) });
    }
  }
}

async function loadConnection(env: Env, id: string): Promise<Connection | null> {
  const c = await db(env).select().from(schema.channelConnections).where(eq(schema.channelConnections.id, id)).get();
  if (!c) return null;
  let token: string | null = null;
  if (c.tokenEnc) token = await decrypt(env.TOKEN_ENC_KEY, c.tokenEnc);
  return { id: c.id, companyId: c.companyId, provider: c.provider, accountRef: c.accountRef, displayName: c.displayName, token, config: c.config, expiresAt: c.expiresAt };
}

export async function processPosting(env: Env, postingId: string, kind: 'publish' | 'close' | 'update', attempt: number): Promise<{ retryIn: number | null }> {
  const d = db(env);
  const event = (type: string, detail: Record<string, unknown> = {}) =>
    d.insert(schema.postingEvents).values({ id: uid(), postingId, type, detail: { attempt, ...detail }, at: now() });
  const set = (v: Partial<typeof schema.postings.$inferInsert>) => d.update(schema.postings).set({ ...v, updatedAt: now() }).where(eq(schema.postings.id, postingId));

  const p = await d.select().from(schema.postings).where(eq(schema.postings.id, postingId)).get();
  if (!p) return { retryIn: null };
  if (kind === 'publish' && !['queued', 'scheduled', 'posting'].includes(p.status)) return { retryIn: null }; // already done or cancelled
  if (kind === 'close' && p.status !== 'closing') return { retryIn: null };
  if (kind === 'update' && p.status !== 'live') return { retryIn: null };

  const release = await acquireLock(env, keys(env).lockPost(p.jobId, p.connectionId));
  if (!release) return { retryIn: 30 }; // someone else is working on this job+channel right now

  try {
    const adapter = adapterFor(p.provider);
    const conn = await loadConnection(env, p.connectionId);
    const job = await getJobDetail(env, p.jobId);
    if (!adapter || !conn || !job) {
      await set({ status: 'failed', lastError: 'Channel, connection or job no longer exists' });
      await event('failed', { reason: 'missing' });
      return { retryIn: null };
    }
    if (conn.expiresAt && conn.expiresAt < Date.now()) throw new NeedsReauthError(`${conn.displayName}: the connection expired. Reconnect it on the Channels page.`);

    const copyRow = p.copyId ? await d.select().from(schema.postCopies).where(eq(schema.postCopies.id, p.copyId)).get() : null;
    const copy = copyRow ? { text: copyRow.text, hashtags: copyRow.hashtags ?? [] } : null;
    const ctx = { env, conn, postingId, trackedUrl: `${jobUrl(env, job)}?src=${p.provider}&p=${postingId}` };

    if (kind === 'publish') {
      await set({ status: 'posting', attempts: p.attempts + 1 });
      const r = await adapter.publish(ctx, job, copy);
      await set({ status: 'live', externalId: r.externalId, externalUrl: r.url ?? null, publishedAt: now(), lastError: null });
      await event('live', { externalId: r.externalId, note: r.note });
      await d.update(schema.channelConnections).set({ lastOkAt: now() }).where(eq(schema.channelConnections.id, conn.id));
    } else if (kind === 'update') {
      if (adapter.update && p.externalId) await adapter.update(ctx, p.externalId, job, copy);
      await event('updated');
    } else {
      if (adapter.close && p.externalId) await adapter.close(ctx, p.externalId, job);
      await set({ status: 'closed', closedAt: now() });
      await event('closed');
    }
    return { retryIn: null };
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    if (err instanceof NeedsReauthError) {
      await set({ status: 'needs_reauth', lastError: message });
      await d.update(schema.channelConnections).set({ status: 'expired' }).where(eq(schema.channelConnections.id, p.connectionId));
      await event('needs_reauth', { message });
      await notifyOwner(env, p.jobId, `A post needs you to reconnect a channel`, message);
      return { retryIn: null };
    }
    if (err instanceof RetryableError && attempt < MAX_ATTEMPTS) {
      const delay = Math.max(err.retryAfterSec ?? 0, backoff(attempt));
      await set({ status: kind === 'publish' ? 'queued' : kind === 'close' ? 'closing' : 'live', lastError: `${message} (retrying in ${delay}s)` });
      await event('retry', { message, delay });
      return { retryIn: delay };
    }
    await set({ status: kind === 'publish' ? 'failed' : 'live', lastError: kind === 'close' ? `Could not remove: ${message}` : message });
    await event(kind === 'publish' ? 'failed' : kind + '_failed', { message });
    if (kind === 'publish') await notifyOwner(env, p.jobId, 'A job post failed', message);
    return { retryIn: null };
  } finally {
    await release();
  }
}

async function notifyOwner(env: Env, jobId: string, subject: string, detail: string) {
  const row = await db(env).select({ email: schema.users.email, title: schema.jobs.title })
    .from(schema.jobs).innerJoin(schema.users, eq(schema.users.id, schema.jobs.ownerId)).where(eq(schema.jobs.id, jobId)).get();
  if (row) await sendEmail(env, { to: row.email, tag: 'posting', subject: `${subject}: ${row.title} (${jobId})`, text: `${detail}\n\nOpen the job in the console: ${env.APP_URL}/console#/jobs/${jobId}` });
}
