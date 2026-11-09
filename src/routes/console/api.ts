import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import type { AppEnv } from '../../env';
import { db, schema, audit } from '../../db/client';
import { requireRecruiter, canWrite, canSeeCompany, assertRole } from '../../services/access';
import { parseJson, idempotent } from '../../lib/http';
import { bad, now, slugify, uid } from '../../lib/util';
import { JdSections } from '../../ai/schemas';
import { draftJd, taskifyJd, reviewJd, channelCopy } from '../../ai/tasks';
import { aiMode } from '../../ai/client';
import { publishJob, closeJob, retryPosting, invalidateJob } from '../../publisher/publish';
import { allAdapters, adapterFor } from '../../channels/registry';
import { encrypt } from '../../lib/crypto';
import { STAGES, EXP_BANDS, WORK_MODES } from '../../db/schema';
import { cached } from '../../cache/cache';
import { keys, TTL } from '../../cache/keys';

export const consoleApi = new Hono<AppEnv>();
consoleApi.use('*', requireRecruiter);

const writer = (c: Context<AppEnv>) => {
  if (!canWrite(c.get('user'))) bad('Your role is read-only', 403);
};

consoleApi.get('/me', (c) => c.json({ user: c.get('user'), ai: aiMode(c.env), env: c.env.ENVIRONMENT, stages: STAGES, expBands: EXP_BANDS, workModes: WORK_MODES }));

consoleApi.get('/companies', async (c) => {
  const u = c.get('user');
  const rows = await db(c.env).select().from(schema.companies);
  return c.json({ companies: rows.filter((r) => canSeeCompany(u, r.id)) });
});

// ---------- Dashboard ----------

consoleApi.get('/dashboard', async (c) => {
  const u = c.get('user');
  const companyId = c.req.query('company') ?? 'all';
  if (companyId !== 'all' && !canSeeCompany(u, companyId)) bad('Not your company', 403);
  const hour = new Date().toISOString().slice(0, 13);
  return c.json(await cached(c.env, keys(c.env).dash(`${companyId}:${u.companyIds?.join(',') ?? '*'}`, hour), TTL.dash, async () => {
    const d = db(c.env);
    const jobs = (await d.select().from(schema.jobs)).filter((j) => canSeeCompany(u, j.companyId) && (companyId === 'all' || j.companyId === companyId));
    const jobIds = new Set(jobs.map((j) => j.id));
    const apps = (await d.select().from(schema.applications)).filter((a) => jobIds.has(a.jobId));
    const order = STAGES.slice(0, 6);
    const reached = (s: string) => apps.filter((a) => {
      if (a.stage === 'Not selected' || a.stage === 'Withdrawn') return false;
      return order.indexOf(a.stage as (typeof order)[number]) >= order.indexOf(s as (typeof order)[number]);
    }).length;
    const sources: Record<string, { applied: number; interviews: number; hired: number }> = {};
    for (const a of apps) {
      const s = (sources[a.source] ??= { applied: 0, interviews: 0, hired: 0 });
      s.applied++;
      if (['Interview', 'Offer', 'Hired'].includes(a.stage)) s.interviews++;
      if (a.stage === 'Hired') s.hired++;
    }
    const open = jobs.filter((j) => j.status === 'open');
    const weekAgo = now() - 7 * 86_400_000;
    const postings = await d.select().from(schema.postings).where(inArray(schema.postings.status, ['failed', 'needs_reauth']));
    return {
      kpis: {
        openRoles: open.length,
        seats: open.reduce((s, j) => s + j.seats, 0),
        applications: apps.length,
        newThisWeek: apps.filter((a) => a.createdAt > weekAgo).length,
        hired: apps.filter((a) => a.stage === 'Hired').length,
        awaitingReview: apps.filter((a) => a.stage === 'Applied' && a.createdAt < now() - 3 * 86_400_000).length,
        postingProblems: postings.filter((p) => jobIds.has(p.jobId)).length,
      },
      funnel: order.map((s) => ({ stage: s, count: s === 'Applied' ? apps.length : reached(s) })),
      sources: Object.entries(sources).map(([source, v]) => ({ source, ...v })).sort((a, b) => b.applied - a.applied),
      requisitions: open.map((j) => ({
        id: j.id, title: j.title, seats: j.seats,
        hired: apps.filter((a) => a.jobId === j.id && a.stage === 'Hired').length,
        offers: apps.filter((a) => a.jobId === j.id && a.stage === 'Offer').length,
      })).sort((a, b) => b.seats - a.seats).slice(0, 12),
    };
  }));
});

// ---------- Jobs ----------

const JobFields = z.object({
  companyId: z.string(),
  title: z.string().trim().min(3).max(120),
  department: z.string().trim().min(2).max(60),
  location: z.string().trim().min(2).max(120),
  workMode: z.enum(WORK_MODES),
  shift: z.string().trim().min(2).max(40),
  expLabel: z.string().trim().min(1).max(20),
  expBand: z.number().int().min(0).max(3),
  seats: z.number().int().min(1).max(500),
  salaryMin: z.number().int().positive().nullable().optional(),
  salaryMax: z.number().int().positive().nullable().optional(),
  salaryCurrency: z.string().length(3).optional(),
  showSalary: z.boolean().optional(),
  incentive: z.boolean(),
  tags: z.array(z.string().max(40)).max(12),
  summary: z.string().trim().min(10).max(300),
  hiringManagerId: z.string().nullable().optional(),
  // Older JDs may not have an assessment line.
  sections: JdSections.extend({ assessment: z.string().default('') }),
  aiRunId: z.string().optional(),
});

async function nextReqCode(env: AppEnv['Bindings']) {
  const year = new Date().getFullYear();
  const row = await db(env).select({ id: schema.jobs.id }).from(schema.jobs).where(like(schema.jobs.id, `CG-${year}-%`)).orderBy(desc(schema.jobs.id)).limit(1).get();
  const n = row ? Number(row.id.split('-')[2]) + 1 : 1001;
  return `CG-${year}-${String(n).padStart(4, '0')}`;
}

async function loadJobForUser(c: Context<AppEnv>, id: string) {
  const job = await db(c.env).select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
  if (!job || !canSeeCompany(c.get('user'), job.companyId)) bad('Job not found', 404);
  return job;
}

consoleApi.get('/jobs', async (c) => {
  const u = c.get('user');
  const status = c.req.query('status');
  const d = db(c.env);
  const rows = await d.select({ j: schema.jobs, co: schema.companies.name }).from(schema.jobs)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.jobs.companyId))
    .where(status ? eq(schema.jobs.status, status as 'open') : undefined)
    .orderBy(desc(schema.jobs.updatedAt));
  const counts = await d.select({ jobId: schema.applications.jobId, n: sql<number>`count(*)` }).from(schema.applications).groupBy(schema.applications.jobId);
  const live = await d.select({ jobId: schema.postings.jobId, provider: schema.postings.provider, status: schema.postings.status }).from(schema.postings);
  return c.json({
    jobs: rows.filter((r) => canSeeCompany(u, r.j.companyId)).map(({ j, co }) => ({
      ...j, company: co, applications: counts.find((x) => x.jobId === j.id)?.n ?? 0,
      channels: live.filter((p) => p.jobId === j.id).map((p) => ({ provider: p.provider, status: p.status })),
    })),
  });
});

consoleApi.get('/jobs/:id', async (c) => {
  const job = await loadJobForUser(c, c.req.param('id'));
  const d = db(c.env);
  const versions = await d.select().from(schema.jobVersions).where(eq(schema.jobVersions.jobId, job.id)).orderBy(desc(schema.jobVersions.version));
  const postings = await d.select({ p: schema.postings, conn: schema.channelConnections.displayName }).from(schema.postings)
    .innerJoin(schema.channelConnections, eq(schema.channelConnections.id, schema.postings.connectionId))
    .where(eq(schema.postings.jobId, job.id)).orderBy(desc(schema.postings.createdAt));
  const company = await d.select().from(schema.companies).where(eq(schema.companies.id, job.companyId)).get();
  return c.json({
    job, company,
    sections: versions.find((v) => v.version === job.currentVersion)?.sections ?? null,
    versions: versions.map((v) => ({ version: v.version, source: v.source, createdAt: v.createdAt, authorId: v.authorId })),
    postings: postings.map(({ p, conn }) => ({ ...p, connection: conn })),
  });
});

consoleApi.post('/jobs', async (c) => {
  writer(c);
  const u = c.get('user');
  const f = await parseJson(c, JobFields);
  if (!canSeeCompany(u, f.companyId)) bad('Not your company', 403);
  const id = await nextReqCode(c.env);
  const t = now();
  const d = db(c.env);
  await d.batch([
    d.insert(schema.jobs).values({
      id, companyId: f.companyId, title: f.title, slug: slugify(f.title), department: f.department, location: f.location, workMode: f.workMode,
      shift: f.shift, expLabel: f.expLabel, expBand: f.expBand, seats: f.seats, salaryMin: f.salaryMin ?? null, salaryMax: f.salaryMax ?? null,
      salaryCurrency: f.salaryCurrency ?? 'INR', showSalary: f.showSalary ?? false, incentive: f.incentive, tags: f.tags, summary: f.summary,
      status: 'draft', currentVersion: 1, ownerId: u.id, hiringManagerId: f.hiringManagerId ?? null, createdAt: t, updatedAt: t,
    }),
    d.insert(schema.jobVersions).values({ id: uid(), jobId: id, version: 1, sections: f.sections, source: f.aiRunId ? 'ai' : 'human', aiRunId: f.aiRunId ?? null, authorId: u.id, createdAt: t }),
  ]);
  await audit(c.env, u.email, 'job.create', 'job', id);
  return c.json({ id }, 201);
});

consoleApi.put('/jobs/:id', async (c) => {
  writer(c);
  const u = c.get('user');
  const job = await loadJobForUser(c, c.req.param('id'));
  const f = await parseJson(c, JobFields.omit({ companyId: true }));
  const d = db(c.env);
  const current = await d.select().from(schema.jobVersions).where(and(eq(schema.jobVersions.jobId, job.id), eq(schema.jobVersions.version, job.currentVersion))).get();
  const sectionsChanged = JSON.stringify(current?.sections) !== JSON.stringify(f.sections);
  const version = sectionsChanged ? job.currentVersion + 1 : job.currentVersion;
  const t = now();
  const stmts = [
    d.update(schema.jobs).set({
      title: f.title, slug: job.status === 'draft' ? slugify(f.title) : job.slug, department: f.department, location: f.location, workMode: f.workMode, shift: f.shift,
      expLabel: f.expLabel, expBand: f.expBand, seats: f.seats, salaryMin: f.salaryMin ?? null, salaryMax: f.salaryMax ?? null, salaryCurrency: f.salaryCurrency ?? 'INR',
      showSalary: f.showSalary ?? false, incentive: f.incentive, tags: f.tags, summary: f.summary, hiringManagerId: f.hiringManagerId ?? null, currentVersion: version, updatedAt: t,
    }).where(eq(schema.jobs.id, job.id)),
  ];
  if (sectionsChanged) {
    stmts.push(d.insert(schema.jobVersions).values({ id: uid(), jobId: job.id, version, sections: f.sections, source: f.aiRunId ? 'ai' : 'human', aiRunId: f.aiRunId ?? null, authorId: u.id, createdAt: t }) as never);
    // Social posts can't be edited after posting; flag them so the recruiter can re-share.
    stmts.push(d.update(schema.postings).set({ status: 'stale', updatedAt: t }).where(and(eq(schema.postings.jobId, job.id), eq(schema.postings.status, 'live'), inArray(schema.postings.provider, ['linkedin_member', 'linkedin_org']))) as never);
  }
  await d.batch(stmts as [typeof stmts[number], ...typeof stmts]);
  await invalidateJob(c.env, job.id);
  // Listings that support updates get re-synced.
  if (job.status === 'open') {
    const live = await d.select().from(schema.postings).where(and(eq(schema.postings.jobId, job.id), eq(schema.postings.status, 'live')));
    const updatable = live.filter((p) => adapterFor(p.provider)?.capabilities.update);
    if (updatable.length) await c.env.PUBLISH_QUEUE.sendBatch(updatable.map((p) => ({ body: { kind: 'update' as const, postingId: p.id } })) as never);
  }
  await audit(c.env, u.email, 'job.update', 'job', job.id, { version, sectionsChanged });
  return c.json({ id: job.id, version });
});

consoleApi.post('/jobs/:id/submit', async (c) => {
  writer(c);
  const job = await loadJobForUser(c, c.req.param('id'));
  if (job.status !== 'draft') bad(`Only drafts can be submitted (this job is ${job.status})`, 409);
  await db(c.env).update(schema.jobs).set({ status: 'pending_approval', updatedAt: now() }).where(eq(schema.jobs.id, job.id));
  await audit(c.env, c.get('user').email, 'job.submit', 'job', job.id);
  return c.json({ ok: true });
});

consoleApi.post('/jobs/:id/approve', async (c) => {
  assertRole(c.get('user'), 'admin', 'hiring_manager');
  const job = await loadJobForUser(c, c.req.param('id'));
  if (job.status !== 'pending_approval') bad('This job is not waiting for approval', 409);
  // Approved jobs are ready to publish; publishing opens them on the careers sites and channels.
  await db(c.env).update(schema.jobs).set({ status: 'approved', updatedAt: now() }).where(eq(schema.jobs.id, job.id));
  await audit(c.env, c.get('user').email, 'job.approve', 'job', job.id);
  return c.json({ ok: true, approved: true });
});

const PublishBody = z.object({
  connectionIds: z.array(z.string()).min(1),
  copies: z.record(z.string(), z.object({ text: z.string().max(4000), hashtags: z.array(z.string().max(60)).max(10) })).optional(),
  scheduleAt: z.number().int().nullable().optional(),
});

consoleApi.post('/jobs/:id/publish', async (c) => {
  writer(c);
  const job = await loadJobForUser(c, c.req.param('id'));
  return idempotent(c, `publish:${job.id}`, async () => {
    const body = await parseJson(c, PublishBody);
    const r = await publishJob(c.env, c.get('user'), job.id, body);
    return { status: 202, body: r };
  });
});

consoleApi.post('/jobs/:id/close', async (c) => {
  writer(c);
  const job = await loadJobForUser(c, c.req.param('id'));
  const { status } = await parseJson(c, z.object({ status: z.enum(['closed', 'filled']) }));
  return c.json(await closeJob(c.env, c.get('user'), job.id, status));
});

consoleApi.post('/jobs/:id/reopen', async (c) => {
  writer(c);
  const job = await loadJobForUser(c, c.req.param('id'));
  if (!['closed', 'filled', 'paused'].includes(job.status)) bad('Only closed jobs can be reopened', 409);
  await db(c.env).update(schema.jobs).set({ status: 'draft', closesAt: null, updatedAt: now() }).where(eq(schema.jobs.id, job.id));
  await invalidateJob(c.env, job.id);
  return c.json({ ok: true });
});

consoleApi.post('/postings/:id/retry', async (c) => {
  writer(c);
  await retryPosting(c.env, c.get('user'), c.req.param('id'));
  return c.json({ ok: true });
});

consoleApi.get('/postings/:id/events', async (c) => {
  const rows = await db(c.env).select().from(schema.postingEvents).where(eq(schema.postingEvents.postingId, c.req.param('id'))).orderBy(desc(schema.postingEvents.at));
  return c.json({ events: rows });
});

// ---------- AI ----------

consoleApi.post('/ai/draft', async (c) => {
  writer(c);
  const b = await parseJson(c, z.object({ companyId: z.string(), brief: z.string().trim().min(10).max(4000), department: z.string().max(60).optional() }));
  if (!canSeeCompany(c.get('user'), b.companyId)) bad('Not your company', 403);
  return c.json(await draftJd(c.env, c.get('user').id, b));
});

const AiJobInput = z.object({ companyId: z.string(), title: z.string(), department: z.string(), summary: z.string().default(''), showSalary: z.boolean().default(false), sections: JdSections.extend({ assessment: z.string().default('') }) });

consoleApi.post('/ai/taskify', async (c) => {
  writer(c);
  const b = await parseJson(c, AiJobInput);
  return c.json(await taskifyJd(c.env, c.get('user').id, b));
});

consoleApi.post('/ai/review', async (c) => {
  const b = await parseJson(c, AiJobInput);
  return c.json(await reviewJd(c.env, c.get('user').id, b));
});

consoleApi.post('/ai/copy', async (c) => {
  writer(c);
  const b = await parseJson(c, z.object({ jobId: z.string(), provider: z.string() }));
  await loadJobForUser(c, b.jobId);
  return c.json(await channelCopy(c.env, c.get('user').id, b));
});

// ---------- Applications ----------

consoleApi.get('/applications', async (c) => {
  const u = c.get('user');
  const { job, stage, q, consent } = c.req.query();
  const d = db(c.env);
  const rows = await d.select({ a: schema.applications, cand: schema.candidates, j: schema.jobs }).from(schema.applications)
    .innerJoin(schema.candidates, eq(schema.candidates.id, schema.applications.candidateId))
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.applications.jobId))
    .where(and(
      job ? eq(schema.applications.jobId, job) : undefined,
      stage ? eq(schema.applications.stage, stage as 'Applied') : undefined,
      q ? or(like(schema.candidates.name, `%${q}%`), like(schema.candidates.email, `%${q}%`), like(schema.candidates.city, `%${q}%`)) : undefined,
    ))
    .orderBy(desc(schema.applications.createdAt)).limit(500);
  const optIns = new Set((await d.select({ email: schema.consents.email }).from(schema.consents).where(and(eq(schema.consents.type, 'campaigns'), sql`${schema.consents.withdrawnAt} IS NULL`))).map((x) => x.email));
  const list = rows.filter((r) => canSeeCompany(u, r.j.companyId)).map(({ a, cand, j }) => ({
    id: a.id, stage: a.stage, source: a.source, createdAt: a.createdAt, updatedAt: a.updatedAt,
    candidate: { id: cand.id, name: cand.name, email: cand.email, phone: cand.phone, city: cand.city, expYears: cand.expYears, notice: cand.notice, linkedinUrl: cand.linkedinUrl, hasCv: !!cand.cvKey, pitch: cand.pitch, humanOnlyReview: cand.humanOnlyReview, campaigns: optIns.has(cand.email) },
    job: { id: j.id, title: j.title, department: j.department },
  }));
  return c.json({ applications: consent ? list.filter((x) => x.candidate.campaigns === (consent === '1')) : list });
});

consoleApi.patch('/applications/:id', async (c) => {
  writer(c);
  const { stage, note } = await parseJson(c, z.object({ stage: z.enum(STAGES), note: z.string().max(1000).optional() }));
  const d = db(c.env);
  const app = await d.select().from(schema.applications).where(eq(schema.applications.id, c.req.param('id'))).get();
  if (!app) bad('Application not found', 404);
  if (app.stage === stage) return c.json({ ok: true, unchanged: true });
  const t = now();
  await d.batch([
    d.update(schema.applications).set({ stage, updatedAt: t }).where(eq(schema.applications.id, app.id)),
    d.insert(schema.stageHistory).values({ id: uid(), applicationId: app.id, fromStage: app.stage, toStage: stage, byUser: c.get('user').email, note: note ?? null, at: t }),
  ]);
  await audit(c.env, c.get('user').email, 'application.stage', 'application', app.id, { from: app.stage, to: stage });
  return c.json({ ok: true });
});

consoleApi.get('/applications/:id/history', async (c) => {
  const rows = await db(c.env).select().from(schema.stageHistory).where(eq(schema.stageHistory.applicationId, c.req.param('id'))).orderBy(desc(schema.stageHistory.at));
  return c.json({ history: rows });
});

/** CV download: streamed through the Worker after the auth check (the bucket is private). */
consoleApi.get('/candidates/:id/cv', async (c) => {
  const cand = await db(c.env).select().from(schema.candidates).where(eq(schema.candidates.id, c.req.param('id'))).get();
  if (!cand?.cvKey) bad('No CV on file', 404);
  const obj = await c.env.FILES.get(cand.cvKey);
  if (!obj) bad('CV file is missing', 404);
  await audit(c.env, c.get('user').email, 'cv.view', 'candidate', cand.id);
  const ext = cand.cvKey.split('.').pop();
  return new Response(obj.body, {
    headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'content-disposition': `inline; filename="${slugify(cand.name)}-cv.${ext}"`, 'cache-control': 'private, no-store' },
  });
});

// ---------- Channels ----------

consoleApi.get('/channels', async (c) => {
  const u = c.get('user');
  const d = db(c.env);
  const conns = (await d.select().from(schema.channelConnections)).filter((x) => canSeeCompany(u, x.companyId));
  const profiles = await d.select().from(schema.distributionProfiles);
  return c.json({
    connections: conns.map(({ tokenEnc, refreshEnc, ...rest }) => ({ ...rest, hasToken: !!tokenEnc })),
    adapters: allAdapters().map((a) => ({ provider: a.provider, label: a.label, mode: a.mode, needsCopy: a.needsCopy, capabilities: a.capabilities })),
    profiles,
    linkedinConfigured: !!(c.env.LINKEDIN_CLIENT_ID && c.env.LINKEDIN_CLIENT_SECRET),
    mockAvailable: !!c.env.MOCK_CHANNELS_URL && c.env.ENVIRONMENT !== 'production',
    mockBase: c.env.ENVIRONMENT !== 'production' ? c.env.MOCK_CHANNELS_URL : undefined,
  });
});

/** Local development: connect a fake LinkedIn account backed by the mock server. */
consoleApi.post('/channels/mock-linkedin', async (c) => {
  writer(c);
  if (!c.env.MOCK_CHANNELS_URL || c.env.ENVIRONMENT === 'production') bad('Mock channels are only available locally', 403);
  const { companyId, kind } = await parseJson(c, z.object({ companyId: z.string(), kind: z.enum(['linkedin_member', 'linkedin_org']) }));
  const u = c.get('user');
  const id = `conn_${uid().replace(/-/g, '').slice(0, 10)}`;
  await db(c.env).insert(schema.channelConnections).values({
    id, companyId, provider: kind, accountRef: kind === 'linkedin_member' ? 'urn:li:person:mock-member-123' : 'urn:li:organization:999',
    displayName: kind === 'linkedin_member' ? `${u.name} on LinkedIn (mock)` : 'Company page on LinkedIn (mock)',
    tokenEnc: await encrypt(c.env.TOKEN_ENC_KEY, 'mock-token'), config: { apiBase: `${c.env.MOCK_CHANNELS_URL}/linkedin` },
    expiresAt: now() + 60 * 86_400_000, status: 'active', connectedBy: u.id, createdAt: now(),
  });
  return c.json({ id }, 201);
});

/**
 * Key- or config-based channels: LinkedIn Jobs feed, Indeed (feed or Job Sync API), Naukri, custom webhook.
 * Secrets (API keys, client secrets, webhook signing secrets) are encrypted before storage.
 */
const ConnectBody = z.object({
  companyId: z.string(),
  provider: z.enum(['linkedin_feed', 'indeed', 'naukri', 'webhook']),
  displayName: z.string().trim().min(2).max(120),
  accountRef: z.string().trim().min(1).max(200),
  secret: z.string().max(500).optional(),
  config: z.object({
    mode: z.enum(['api', 'feed']).optional(),
    apiBase: z.url().optional(),
    url: z.url().optional(),
    clientId: z.string().max(200).optional(),
    posterEmail: z.email().optional(),
    recruiterEmail: z.email().optional(),
    linkedinCompanyId: z.string().max(40).optional(),
  }).default({}),
});

consoleApi.post('/channels/connect', async (c) => {
  writer(c);
  const b = await parseJson(c, ConnectBody);
  if (!canSeeCompany(c.get('user'), b.companyId)) bad('Not your company', 403);
  if (b.provider === 'naukri' && (!b.secret || !b.config.apiBase)) bad('Naukri needs the API endpoint and key issued by Naukri', 422);
  if (b.provider === 'webhook' && !b.config.url) bad('Give the webhook URL', 422);
  if (b.provider === 'indeed' && b.config.mode === 'api' && (!b.secret || !b.config.clientId)) bad('Indeed Job Sync needs the client ID and secret from Indeed', 422);
  const id = `conn_${uid().replace(/-/g, '').slice(0, 10)}`;
  await db(c.env).insert(schema.channelConnections).values({
    id, companyId: b.companyId, provider: b.provider, accountRef: b.accountRef, displayName: b.displayName,
    tokenEnc: b.secret ? await encrypt(c.env.TOKEN_ENC_KEY, b.secret) : null, config: b.config, status: 'active', connectedBy: c.get('user').id, createdAt: now(),
  });
  await audit(c.env, c.get('user').email, 'channel.connect', 'connection', id, { provider: b.provider });
  return c.json({ id }, 201);
});

consoleApi.delete('/channels/:id', async (c) => {
  writer(c);
  const d = db(c.env);
  const conn = await d.select().from(schema.channelConnections).where(eq(schema.channelConnections.id, c.req.param('id'))).get();
  if (!conn || !canSeeCompany(c.get('user'), conn.companyId)) bad('Connection not found', 404);
  await d.update(schema.channelConnections).set({ status: 'revoked', tokenEnc: null, refreshEnc: null }).where(eq(schema.channelConnections.id, conn.id));
  await audit(c.env, c.get('user').email, 'channel.disconnect', 'connection', conn.id);
  return c.json({ ok: true });
});

consoleApi.put('/channels/profiles/:companyId', async (c) => {
  writer(c);
  const b = await parseJson(c, z.object({ department: z.string().nullable(), connectionIds: z.array(z.string()), autoPublish: z.boolean(), requirePreview: z.boolean(), repostEveryDays: z.number().int().min(0).max(90).nullable() }));
  const d = db(c.env);
  const companyId = c.req.param('companyId');
  const existing = await d.select().from(schema.distributionProfiles).where(and(eq(schema.distributionProfiles.companyId, companyId), b.department ? eq(schema.distributionProfiles.department, b.department) : sql`${schema.distributionProfiles.department} IS NULL`)).get();
  if (existing) await d.update(schema.distributionProfiles).set(b).where(eq(schema.distributionProfiles.id, existing.id));
  else await d.insert(schema.distributionProfiles).values({ id: uid(), companyId, ...b });
  return c.json({ ok: true });
});

// ---------- Website integration ----------

consoleApi.get('/webhooks', async (c) => {
  const rows = await db(c.env).select().from(schema.webhookEndpoints);
  const deliveries = await db(c.env).select().from(schema.webhookDeliveries).orderBy(desc(schema.webhookDeliveries.at)).limit(50);
  return c.json({ endpoints: rows.map(({ secretEnc, ...r }) => r), deliveries });
});

consoleApi.post('/webhooks', async (c) => {
  assertRole(c.get('user'), 'admin');
  const b = await parseJson(c, z.object({ companyId: z.string(), url: z.url(), events: z.array(z.enum(['job.published', 'job.updated', 'job.closed', '*'])).min(1) }));
  const secret = `whsec_${uid().replace(/-/g, '')}`;
  const id = uid();
  await db(c.env).insert(schema.webhookEndpoints).values({ id, companyId: b.companyId, url: b.url, events: b.events, secretEnc: await encrypt(c.env.TOKEN_ENC_KEY, secret), createdAt: now() });
  return c.json({ id, secret, note: 'Copy this secret now; it is not shown again. Verify the x-talenthub-signature header with HMAC-SHA256 over `${t}.${body}`.' }, 201);
});

consoleApi.delete('/webhooks/:id', async (c) => {
  assertRole(c.get('user'), 'admin');
  await db(c.env).update(schema.webhookEndpoints).set({ active: false }).where(eq(schema.webhookEndpoints.id, c.req.param('id')));
  return c.json({ ok: true });
});
