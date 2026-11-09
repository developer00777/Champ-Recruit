import { and, eq, inArray, desc } from 'drizzle-orm';
import type { Env, AppUser } from '../env';
import { db, schema, audit } from '../db/client';
import { bumpJobVersions } from '../cache/cache';
import { getJobDetail, jobUrl } from '../services/jobs';
import { adapterFor } from '../channels/registry';
import { bad, now, sha256Hex, uid } from '../lib/util';
import type { PublishMessage } from './types';

/** Group-level connections (careers site, Google for Jobs) live on the parent company and apply to every company. */
export const GROUP_COMPANY_ID = 'co_champions';

/** Purge our own edge cache for a job's pages (best effort). */
export async function purgeEdge(env: Env, job: { id: string; slug: string; entSlug: string }) {
  const urls = [jobUrl(env, job), `${env.APP_URL}/`, `${env.APP_URL}/c/${job.entSlug}`, `${env.APP_URL}/api/public/v1/jobs`, `${env.APP_URL}/api/public/v1/jobs?company=${job.entSlug}`, `${env.APP_URL}/api/public/v1/jobs/${job.id}`];
  try {
    await Promise.all(urls.map((u) => caches.default.delete(u)));
  } catch { /* no edge cache in local dev */ }
}

export async function invalidateJob(env: Env, jobId: string) {
  const row = await db(env).select({ slug: schema.jobs.slug, entSlug: schema.companies.slug })
    .from(schema.jobs).innerJoin(schema.companies, eq(schema.companies.id, schema.jobs.companyId))
    .where(eq(schema.jobs.id, jobId)).get();
  if (!row) return;
  await bumpJobVersions(env, jobId, row.entSlug);
  await purgeEdge(env, { id: jobId, slug: row.slug, entSlug: row.entSlug });
}

export type PublishRequest = {
  connectionIds: string[];
  /** Approved copy per connection (text the recruiter saw in the preview). */
  copies?: Record<string, { text: string; hashtags: string[] }>;
  scheduleAt?: number | null;
};

/**
 * Opens the job (if needed) and creates one posting per selected channel connection.
 * Each posting has a unique idempotency key, so a double click or a retried request can't double post.
 */
export async function publishJob(env: Env, user: AppUser, jobId: string, req: PublishRequest) {
  const d = db(env);
  const job = await d.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!job) bad('Job not found', 404);
  if (['closed', 'filled'].includes(job.status)) bad('This job is closed. Reopen it first.', 409);
  if (job.status === 'draft' || job.status === 'pending_approval') {
    const company = await d.select().from(schema.companies).where(eq(schema.companies.id, job.companyId)).get();
    if (company?.requireApproval) bad(job.status === 'draft' ? 'This company requires approval before publishing. Submit the job for approval first.' : 'Waiting for approval from a hiring manager or admin', 409);
  }

  const conns = req.connectionIds.length
    ? await d.select().from(schema.channelConnections).where(and(inArray(schema.channelConnections.id, req.connectionIds), eq(schema.channelConnections.companyId, job.companyId)))
    : [];
  // The group-level connections (owned site, Google) are stored on the parent company; allow them for every company.
  const groupConns = req.connectionIds.length
    ? await d.select().from(schema.channelConnections).where(and(inArray(schema.channelConnections.id, req.connectionIds), eq(schema.channelConnections.companyId, GROUP_COMPANY_ID)))
    : [];
  const all = [...new Map([...conns, ...groupConns].map((c) => [c.id, c])).values()];
  if (!all.length) bad('Pick at least one channel', 422);

  // Open the job first so the job page (and therefore every link we post) is live.
  const t = now();
  if (job.status !== 'open') {
    await d.update(schema.jobs).set({ status: 'open', postedAt: job.postedAt ?? t, updatedAt: t }).where(eq(schema.jobs.id, jobId));
    await invalidateJob(env, jobId);
  }
  const detail = await getJobDetail(env, jobId);
  if (!detail) bad('Job has no content yet', 409);

  // Pre-flight every channel before creating anything.
  const problems: string[] = [];
  for (const c of all) {
    const a = adapterFor(c.provider);
    if (!a) { problems.push(`${c.displayName}: this channel isn't available yet`); continue; }
    if (c.status === 'expired' || c.status === 'revoked') problems.push(`${c.displayName}: reconnect this account first`);
    const copy = req.copies?.[c.id] ?? null;
    for (const p of a.validate(detail, a.needsCopy ? copy : null)) problems.push(`${c.displayName}: ${p}`);
  }
  if (problems.length) bad(problems.join(' · '), 422);

  const prior = await d.select().from(schema.postings).where(eq(schema.postings.jobId, jobId)).orderBy(desc(schema.postings.run));
  const scheduled = req.scheduleAt && req.scheduleAt > t + 60_000 ? req.scheduleAt : null;
  const created: { id: string; connectionId: string; provider: string; status: string }[] = [];
  const stmts = [];
  for (const c of all) {
    const live = prior.find((p) => p.connectionId === c.id && ['queued', 'posting', 'live', 'scheduled'].includes(p.status));
    if (live && adapterFor(c.provider)!.mode !== 'social') continue; // listings exist once; social posts can be re-shared
    const run = (prior.filter((p) => p.connectionId === c.id).reduce((m, p) => Math.max(m, p.run), 0)) + 1;
    const idempotencyKey = await sha256Hex(`${jobId}|${c.id}|v${job.currentVersion}|run${run}`);
    const postingId = `pst_${uid().replace(/-/g, '').slice(0, 12)}`;
    let copyId: string | null = null;
    const copy = req.copies?.[c.id];
    if (copy) {
      copyId = uid();
      stmts.push(d.insert(schema.postCopies).values({ id: copyId, jobId, provider: c.provider, variant: run, text: copy.text, hashtags: copy.hashtags, status: 'approved', approvedBy: user.id, createdAt: t }));
    }
    const status = scheduled ? 'scheduled' : 'queued';
    stmts.push(d.insert(schema.postings).values({ id: postingId, jobId, connectionId: c.id, provider: c.provider, copyId, run, status, scheduledAt: scheduled, idempotencyKey, createdAt: t, updatedAt: t }).onConflictDoNothing());
    stmts.push(d.insert(schema.postingEvents).values({ id: uid(), postingId, type: status, detail: { by: user.email }, at: t }));
    created.push({ id: postingId, connectionId: c.id, provider: c.provider, status });
  }
  if (stmts.length) await d.batch(stmts as [typeof stmts[number], ...typeof stmts]);
  if (created.length) await invalidateJob(env, jobId); // feeds and listings rebuild with the new postings
  if (!scheduled && created.length) await env.PUBLISH_QUEUE.sendBatch(created.map((p) => ({ body: { kind: 'publish', postingId: p.id } satisfies PublishMessage })));
  await audit(env, user.email, scheduled ? 'job.schedule' : 'job.publish', 'job', jobId, { postings: created.map((p) => p.provider), scheduleAt: scheduled });
  return { postings: created, skipped: all.length - created.length };
}

/** Close or mark filled: takes the job off our sites and every channel that supports removal. */
export async function closeJob(env: Env, user: AppUser, jobId: string, status: 'closed' | 'filled') {
  const d = db(env);
  const job = await d.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!job) bad('Job not found', 404);
  const t = now();
  await d.update(schema.jobs).set({ status, closesAt: t, updatedAt: t }).where(eq(schema.jobs.id, jobId));
  await invalidateJob(env, jobId);
  const live = await d.select().from(schema.postings).where(and(eq(schema.postings.jobId, jobId), inArray(schema.postings.status, ['live', 'queued', 'scheduled', 'failed', 'stale'])));
  const toClose = live.filter((p) => p.status === 'live' || p.status === 'stale');
  const cancel = live.filter((p) => p.status !== 'live' && p.status !== 'stale');
  const stmts = [
    ...cancel.map((p) => d.update(schema.postings).set({ status: 'closed', closedAt: t, updatedAt: t, lastError: null }).where(eq(schema.postings.id, p.id))),
    ...toClose.map((p) => d.update(schema.postings).set({ status: 'closing', updatedAt: t }).where(eq(schema.postings.id, p.id))),
  ];
  if (stmts.length) await d.batch(stmts as [typeof stmts[number], ...typeof stmts]);
  if (toClose.length) await env.PUBLISH_QUEUE.sendBatch(toClose.map((p) => ({ body: { kind: 'close', postingId: p.id } satisfies PublishMessage })));
  await audit(env, user.email, `job.${status}`, 'job', jobId, { closing: toClose.length, cancelled: cancel.length });
  return { closing: toClose.length, cancelled: cancel.length };
}

export async function retryPosting(env: Env, user: AppUser, postingId: string) {
  const d = db(env);
  const p = await d.select().from(schema.postings).where(eq(schema.postings.id, postingId)).get();
  if (!p) bad('Posting not found', 404);
  if (!['failed', 'needs_reauth'].includes(p.status)) bad(`Only failed postings can be retried (this one is ${p.status})`, 409);
  await d.update(schema.postings).set({ status: 'queued', lastError: null, updatedAt: now() }).where(eq(schema.postings.id, postingId));
  await env.PUBLISH_QUEUE.send({ kind: 'publish', postingId });
  await audit(env, user.email, 'posting.retry', 'posting', postingId);
}
