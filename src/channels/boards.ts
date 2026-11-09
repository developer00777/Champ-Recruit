import type { ChannelAdapter, AdapterCtx, PostCopy } from './adapter';
import { call, fillLink, PermanentError } from './adapter';
import { indeedFeed } from './feeds';
import type { PublicJobDetail } from '../services/jobs';
import { hmacHex } from '../lib/util';

/**
 * Job-board adapters that push via API. Each provider issues credentials only after an agreement,
 * so request shapes here follow their partner docs as far as they are public and are isolated in one
 * function per provider — confirm field names against the docs you receive with access, then adjust
 * the `toXxx` mapper only. Locally, connections point `config.apiBase` at tools/mock-channels.
 */

const plainDescription = (j: PublicJobDetail, copy: PostCopy | null, url: string) => {
  if (copy?.text.trim()) return fillLink(copy.text, url);
  const s = j.sections;
  const list = (a: string[]) => a.map((x) => `• ${x}`).join('\n');
  return `${j.sum}\n\n${s.opportunity}\n\nKey responsibilities\n${list(s.responsibilities)}\n\nMust have\n${list(s.mustHave)}${s.niceToHave.length ? `\n\nNice to have\n${list(s.niceToHave)}` : ''}\n\nWhat we offer\n${list(s.offers)}\n\nRequisition ID ${j.id}. We never charge a fee at any stage of hiring.\nApply at ${url}`;
};

const need = (ctx: AdapterCtx, key: string) => {
  const v = ctx.conn.config?.[key];
  if (!v) throw new PermanentError(`${ctx.conn.displayName}: missing "${key}" in the connection settings`);
  return String(v);
};

// ---------- Indeed: Job Sync API (GraphQL) when approved, XML feed otherwise ----------

async function indeedToken(ctx: AdapterCtx) {
  const base = (ctx.conn.config?.apiBase as string) ?? 'https://apis.indeed.com';
  if (base.includes('mock') || base.includes('localhost') || base.includes('9000')) return 'mock';
  const res = await call('Indeed OAuth', `${base}/oauth/v2/tokens`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: need(ctx, 'clientId'), client_secret: ctx.conn.token ?? '', scope: 'employer_access' }),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}

function toIndeedPosting(ctx: AdapterCtx, j: PublicJobDetail, copy: PostCopy | null) {
  return {
    sourcedPostingId: j.id,
    jobPostingMetadata: { jobSource: { companyName: j.ent, sourceName: j.ent, sourceType: 'Employer' }, url: ctx.trackedUrl, datePublished: new Date(j.postedAt ?? Date.now()).toISOString(), contacts: [] },
    body: {
      title: j.title,
      description: plainDescription(j, copy, ctx.trackedUrl),
      descriptionFormatting: 'PLAIN_TEXT',
      location: { country: 'IN', cityRegionPostal: j.loc },
      benefits: j.sections.offers,
      salary: j.salary ? { currency: j.salary.currency, period: 'YEAR', minimumMinor: j.salary.min * 100, maximumMinor: j.salary.max * 100 } : undefined,
    },
  };
}

async function indeedGraphql(ctx: AdapterCtx, operationName: string, query: string, variables: unknown) {
  const base = (ctx.conn.config?.apiBase as string) ?? 'https://apis.indeed.com';
  const token = await indeedToken(ctx);
  const res = await call('Indeed', `${base}/graphql`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ operationName, query, variables }),
  });
  const data = (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (data.errors?.length) throw new PermanentError(`Indeed: ${data.errors.map((e) => e.message).join('; ')}`);
  return data.data ?? {};
}

const CREATE = `mutation createSourcedJobPostings($input: CreateSourcedJobPostingsInput!) { jobsIngest { createSourcedJobPostings(input: $input) { results { jobPosting { sourcedPostingId } } } } }`;
const EXPIRE = `mutation expireSourcedJobsBySourcedPostingId($input: ExpireSourcedJobsBySourcedPostingIdInput!) { jobsIngest { expireSourcedJobsBySourcedPostingId(input: $input) { results { trackingKey } } } }`;

const isApiMode = (ctx: AdapterCtx) => ctx.conn.config?.mode === 'api';

export const indeed: ChannelAdapter = {
  provider: 'indeed', label: 'Indeed', mode: 'api', needsCopy: false,
  capabilities: { update: true, close: true },
  validate: indeedFeed.validate,
  async publish(ctx, job, copy) {
    if (!isApiMode(ctx)) return indeedFeed.publish(ctx, job, copy);
    await indeedGraphql(ctx, 'createSourcedJobPostings', CREATE, { input: { jobPostings: [toIndeedPosting(ctx, job, copy)] } });
    return { externalId: job.id, note: 'Sent to Indeed Job Sync API' };
  },
  async update(ctx, _id, job, copy) {
    if (!isApiMode(ctx)) return;
    // Job Sync upserts by sourcedPostingId: re-sending the posting updates it.
    await indeedGraphql(ctx, 'createSourcedJobPostings', CREATE, { input: { jobPostings: [toIndeedPosting(ctx, job, copy)] } });
  },
  async close(ctx, externalId) {
    if (!isApiMode(ctx)) return;
    await indeedGraphql(ctx, 'expireSourcedJobsBySourcedPostingId', EXPIRE, { input: { sourcedPostingIds: [externalId] } });
  },
};

// ---------- Naukri: integration webhooks (endpoints + key issued by Naukri's integration team) ----------

function toNaukri(ctx: AdapterCtx, j: PublicJobDetail, copy: PostCopy | null) {
  const [min, max] = (j.exp.match(/\d+/g) ?? ['0', '2']).map(Number);
  return {
    referenceCode: j.id, title: j.title, companyName: j.ent, description: plainDescription(j, copy, ctx.trackedUrl),
    locations: j.loc.split(' / '), workMode: j.mode, minExperience: min ?? 0, maxExperience: max ?? (min ?? 0) + 2,
    vacancies: j.seats, keySkills: j.sections.skills, functionalArea: j.dept,
    salary: j.salary ? { currency: j.salary.currency, min: j.salary.min, max: j.salary.max, hide: false } : { hide: true },
    applyUrl: ctx.trackedUrl, recruiterEmail: ctx.conn.config?.recruiterEmail ?? null,
  };
}

const naukriHeaders = (ctx: AdapterCtx) => {
  if (!ctx.conn.token) throw new PermanentError('Naukri connection has no API key');
  return { 'content-type': 'application/json', 'x-api-key': ctx.conn.token };
};

export const naukri: ChannelAdapter = {
  provider: 'naukri', label: 'Naukri', mode: 'api', needsCopy: false,
  capabilities: { update: true, close: true },
  validate: (job) => (job.sections.skills.length ? [] : ['Naukri needs key skills (add skills/tags to the JD)']),
  async publish(ctx, job, copy) {
    const res = await call('Naukri', `${need(ctx, 'apiBase')}/jobs`, { method: 'POST', headers: naukriHeaders(ctx), body: JSON.stringify(toNaukri(ctx, job, copy)) });
    const data = (await res.json()) as { jobId: string; url?: string };
    return { externalId: data.jobId, url: data.url };
  },
  async update(ctx, id, job, copy) {
    await call('Naukri', `${need(ctx, 'apiBase')}/jobs/${encodeURIComponent(id)}`, { method: 'PUT', headers: naukriHeaders(ctx), body: JSON.stringify(toNaukri(ctx, job, copy)) });
  },
  async close(ctx, id) {
    await call('Naukri', `${need(ctx, 'apiBase')}/jobs/${encodeURIComponent(id)}`, { method: 'DELETE', headers: naukriHeaders(ctx) });
  },
};

// ---------- Generic signed webhook (any other board, Slack/Teams relay, internal referral bot) ----------

async function sendWebhook(ctx: AdapterCtx, event: string, job: PublicJobDetail, copy: PostCopy | null) {
  const body = JSON.stringify({ event, at: new Date().toISOString(), job: { ...job, url: ctx.trackedUrl }, text: copy ? fillLink(copy.text, ctx.trackedUrl) : null });
  const ts = Math.floor(Date.now() / 1000);
  const sig = ctx.conn.token ? await hmacHex(ctx.conn.token, `${ts}.${body}`) : '';
  return call('Webhook', need(ctx, 'url'), { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-talenthub-event': event, 'x-talenthub-signature': `t=${ts},v1=${sig}` } });
}

export const webhookChannel: ChannelAdapter = {
  provider: 'webhook', label: 'Custom webhook', mode: 'api', needsCopy: true,
  capabilities: { update: true, close: true },
  validate: () => [],
  async publish(ctx, job, copy) { await sendWebhook(ctx, 'job.published', job, copy); return { externalId: `${job.id}@${ctx.conn.id}` }; },
  async update(ctx, _id, job, copy) { await sendWebhook(ctx, 'job.updated', job, copy); },
  async close(ctx, _id, job) { await sendWebhook(ctx, 'job.closed', job, null); },
};
