import { and, eq, lte, gt, isNotNull, inArray, sql } from 'drizzle-orm';
import type { Env } from '../env';
import { db, schema } from '../db/client';
import { redis, soft } from '../cache/redis';
import { keys } from '../cache/keys';
import { now, uid } from '../lib/util';
import { sendEmail } from '../services/email';
import type { PublishMessage } from './types';

const DAY = 86_400_000;

/**
 * Cron entry point (see wrangler.jsonc triggers):
 *  "* * * * *"   every minute  → release due scheduled posts
 *  "5 * * * *"   hourly        → flush Redis counters to D1, connection expiry checks
 *  "30 20 * * *" nightly 02:00 IST → auto-repost, data retention
 */
export async function handleCron(cron: string, env: Env, _ctx: ExecutionContext) {
  if (cron === '* * * * *') return releaseScheduled(env);
  if (cron === '5 * * * *') return Promise.all([flushCounters(env), checkConnections(env)]);
  if (cron === '30 20 * * *') return Promise.all([autoRepost(env), retention(env)]);
}

export async function releaseScheduled(env: Env) {
  const d = db(env);
  const due = await d.select({ id: schema.postings.id }).from(schema.postings)
    .where(and(eq(schema.postings.status, 'scheduled'), lte(schema.postings.scheduledAt, now()))).limit(100);
  if (!due.length) return 0;
  await d.update(schema.postings).set({ status: 'queued', updatedAt: now() }).where(inArray(schema.postings.id, due.map((x) => x.id)));
  await env.PUBLISH_QUEUE.sendBatch(due.map((x) => ({ body: { kind: 'publish', postingId: x.id } satisfies PublishMessage })));
  return due.length;
}

/** Write-behind: hourly hashes of views/clicks in Redis → job_stats_daily in D1. */
export async function flushCounters(env: Env) {
  const k = keys(env);
  const d = db(env);
  const prevHour = new Date(Date.now() - 3_600_000).toISOString().slice(0, 13).replace(/[-T]/g, '');
  const today = new Date().toISOString().slice(0, 10);
  const views = await soft(() => redis(env).hgetall<Record<string, string>>(k.views(prevHour)), null);
  const clicks = await soft(() => redis(env).hgetall<Record<string, string>>(k.clicks(today.replace(/-/g, ''))), null);
  const date = `${prevHour.slice(0, 4)}-${prevHour.slice(4, 6)}-${prevHour.slice(6, 8)}`;
  for (const [jobId, n] of Object.entries(views ?? {})) {
    await d.insert(schema.jobStatsDaily).values({ jobId, date, views: Number(n), clicksBySource: {} })
      .onConflictDoUpdate({ target: [schema.jobStatsDaily.jobId, schema.jobStatsDaily.date], set: { views: sql`${schema.jobStatsDaily.views} + ${Number(n)}` } });
  }
  if (views) await soft(() => redis(env).del(k.views(prevHour)), 0);
  // Clicks are a running total for today; overwrite.
  const byJob: Record<string, Record<string, number>> = {};
  for (const [field, n] of Object.entries(clicks ?? {})) {
    const [jobId, src] = field.split('|');
    if (jobId && src) (byJob[jobId] ??= {})[src] = Number(n);
  }
  for (const [jobId, bySrc] of Object.entries(byJob)) {
    await d.insert(schema.jobStatsDaily).values({ jobId, date: today, views: 0, clicksBySource: bySrc })
      .onConflictDoUpdate({ target: [schema.jobStatsDaily.jobId, schema.jobStatsDaily.date], set: { clicksBySource: bySrc } });
  }
}

/** Mark connections expiring soon and remind whoever connected them at 7, 3 and 1 days. */
export async function checkConnections(env: Env) {
  const d = db(env);
  const t = now();
  const soon = await d.select({ c: schema.channelConnections, email: schema.users.email }).from(schema.channelConnections)
    .leftJoin(schema.users, eq(schema.users.id, schema.channelConnections.connectedBy))
    .where(and(isNotNull(schema.channelConnections.expiresAt), lte(schema.channelConnections.expiresAt, t + 7 * DAY), inArray(schema.channelConnections.status, ['active', 'expiring'])));
  for (const { c, email } of soon) {
    const left = (c.expiresAt ?? 0) - t;
    const status = left <= 0 ? 'expired' : 'expiring';
    if (status !== c.status) await d.update(schema.channelConnections).set({ status }).where(eq(schema.channelConnections.id, c.id));
    const daysLeft = Math.ceil(left / DAY);
    // One reminder per threshold: guard with a Redis key that lives a day.
    if (email && [7, 3, 1].includes(daysLeft)) {
      const guard = `${keys(env).chanHealth(c.id)}:reminded:${daysLeft}`;
      const first = await soft(() => redis(env).set(guard, '1', { nx: true, ex: 2 * DAY / 1000 }), 'OK');
      if (first) await sendEmail(env, { to: email, tag: 'reconnect', subject: `Reconnect ${c.displayName} within ${daysLeft} day${daysLeft > 1 ? 's' : ''}`, text: `Your ${c.displayName} connection expires in ${daysLeft} day(s). Posts to it will pause until you reconnect: ${env.APP_URL}/console#/channels` });
    }
  }
}

/** Re-share open jobs with unfilled seats on social channels every N days (per distribution profile). */
export async function autoRepost(env: Env) {
  const d = db(env);
  const profiles = await d.select().from(schema.distributionProfiles).where(and(isNotNull(schema.distributionProfiles.repostEveryDays), gt(schema.distributionProfiles.repostEveryDays, 0)));
  let queued = 0;
  for (const prof of profiles) {
    const jobs = await d.select().from(schema.jobs).where(and(eq(schema.jobs.companyId, prof.companyId), eq(schema.jobs.status, 'open')));
    for (const job of jobs.filter((j) => !prof.department || j.department === prof.department)) {
      const posts = await d.select().from(schema.postings).where(and(eq(schema.postings.jobId, job.id), inArray(schema.postings.provider, ['linkedin_member', 'linkedin_org']), eq(schema.postings.status, 'live')));
      for (const p of posts) {
        if (!p.publishedAt || p.publishedAt > now() - prof.repostEveryDays! * DAY) continue;
        if (posts.some((q) => q.connectionId === p.connectionId && q.run > p.run)) continue; // only repost from the latest run
        const id = `pst_${uid().replace(/-/g, '').slice(0, 12)}`;
        await d.insert(schema.postings).values({ id, jobId: job.id, connectionId: p.connectionId, provider: p.provider, copyId: p.copyId, run: p.run + 1, status: 'queued', idempotencyKey: `${job.id}|${p.connectionId}|repost|${p.run + 1}`, createdAt: now(), updatedAt: now() }).onConflictDoNothing();
        await env.PUBLISH_QUEUE.send({ kind: 'publish', postingId: id });
        queued++;
      }
    }
  }
  return queued;
}

/** Delete CV files and personal data for candidates past retention who did not opt in to future roles. */
export async function retention(env: Env, months = Number((env as Env & { RETENTION_MONTHS?: string }).RETENTION_MONTHS ?? 12)) {
  const d = db(env);
  const cutoff = now() - months * 30 * DAY;
  const old = await d.select().from(schema.candidates).where(and(lte(schema.candidates.createdAt, cutoff), sql`${schema.candidates.deletedAt} IS NULL`)).limit(200);
  let removed = 0;
  for (const c of old) {
    const optedIn = await d.select().from(schema.consents).where(and(eq(schema.consents.email, c.email), eq(schema.consents.type, 'campaigns'), sql`${schema.consents.withdrawnAt} IS NULL`)).get();
    const active = await d.select().from(schema.applications).where(and(eq(schema.applications.candidateId, c.id), inArray(schema.applications.stage, ['Applied', 'Screening', 'Assessment', 'Interview', 'Offer']))).get();
    if (optedIn || active) continue;
    if (c.cvKey) await env.FILES.delete(c.cvKey);
    await d.update(schema.candidates).set({ phone: null, cvKey: null, cvText: null, linkedinUrl: null, parsedProfile: null, pitch: null, deletedAt: now() }).where(eq(schema.candidates.id, c.id));
    removed++;
  }
  return removed;
}
