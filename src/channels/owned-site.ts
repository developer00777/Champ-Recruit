import { and, eq } from 'drizzle-orm';
import type { ChannelAdapter } from './adapter';
import { RetryableError } from './adapter';
import { db, schema } from '../db/client';
import { decrypt } from '../lib/crypto';
import { hmacHex, now, uid } from '../lib/util';
import type { Env } from '../env';
import type { PublicJobDetail } from '../services/jobs';
import { jobUrl } from '../services/jobs';

/**
 * Official careers sites. The job is already live on our own pages once its status is `open`
 * (the publish service bumps the cache). This adapter tells the group companies' websites
 * via signed webhooks, for sites that keep their own copy (WordPress etc.).
 */
export async function sendSiteWebhooks(env: Env, job: PublicJobDetail, event: 'job.published' | 'job.updated' | 'job.closed') {
  const d = db(env);
  const company = await d.select().from(schema.companies).where(eq(schema.companies.slug, job.entSlug)).get();
  if (!company) return { sent: 0, failed: 0 };
  const endpoints = await d.select().from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.companyId, company.id), eq(schema.webhookEndpoints.active, true)));
  let failed = 0;
  for (const ep of endpoints.filter((e) => e.events.includes(event) || e.events.includes('*'))) {
    const body = JSON.stringify({ event, at: new Date().toISOString(), job: { ...job, url: jobUrl(env, job) } });
    const ts = Math.floor(Date.now() / 1000);
    const secret = await decrypt(env.TOKEN_ENC_KEY, ep.secretEnc);
    const sig = await hmacHex(secret, `${ts}.${body}`);
    let status = 0;
    let err: string | null = null;
    try {
      const res = await fetch(ep.url, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-talenthub-event': event, 'x-talenthub-signature': `t=${ts},v1=${sig}` } });
      status = res.status;
      if (!res.ok) err = `HTTP ${res.status}`;
    } catch (e) {
      err = (e as Error).message;
    }
    if (err) failed++;
    await d.insert(schema.webhookDeliveries).values({ id: uid(), endpointId: ep.id, event, status, attempts: 1, lastError: err, at: now() });
  }
  return { sent: endpoints.length - failed, failed };
}

export const ownedSite: ChannelAdapter = {
  provider: 'owned_site', label: 'Official careers sites', mode: 'owned', needsCopy: false,
  capabilities: { update: true, close: true },
  validate: (job) => (job.sections.responsibilities.length ? [] : ['The JD has no responsibilities']),
  async publish(ctx, job) {
    const r = await sendSiteWebhooks(ctx.env, job, 'job.published');
    if (r.failed) throw new RetryableError(`${r.failed} company website webhook(s) failed`);
    return { externalId: job.id, url: jobUrl(ctx.env, job), note: r.sent ? `Notified ${r.sent} website(s)` : 'Live on the careers site' };
  },
  async update(ctx, _id, job) { await sendSiteWebhooks(ctx.env, job, 'job.updated'); },
  async close(ctx, _id, job) { await sendSiteWebhooks(ctx.env, job, 'job.closed'); },
};
