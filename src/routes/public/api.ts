import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { AppEnv } from '../../env';
import { db, schema, audit } from '../../db/client';
import { listOpenJobs, getJobDetail, facets } from '../../services/jobs';
import { parseJson, clientIp, idempotent, verifyTurnstile } from '../../lib/http';
import { rateLimit } from '../../cache/cache';
import { redis } from '../../cache/redis';
import { keys, TTL } from '../../cache/keys';
import { bad, now, uid, sha256Hex, isEmail } from '../../lib/util';
import { createSession, readSession, destroySession } from '../../services/session';
import { sendEmail } from '../../services/email';

export const publicApi = new Hono<AppEnv>();

// Read-only job data is public: company websites call it from the browser (embed widget, custom sites).
publicApi.use('/jobs', cors({ origin: '*', allowMethods: ['GET'] }));
publicApi.use('/jobs/*', cors({ origin: '*', allowMethods: ['GET'] }));

const PROVIDER_SOURCES = new Set(['linkedin_member', 'linkedin_org', 'linkedin_feed', 'indeed', 'naukri', 'google_jobs', 'careers_site', 'embed', 'referral', 'campaign', 'alert', 'community']);

// ---------- Jobs ----------

publicApi.get('/jobs', async (c) => {
  const company = c.req.query('company') ?? 'all';
  const list = await listOpenJobs(c.env, company);
  c.header('cache-control', 'public, s-maxage=60, stale-while-revalidate=300');
  return c.json({ jobs: list, facets: facets(list) });
});

publicApi.get('/jobs/:id', async (c) => {
  const job = await getJobDetail(c.env, c.req.param('id'));
  if (!job) bad('Job not found', 404);
  c.header('cache-control', 'public, s-maxage=60, stale-while-revalidate=300');
  return c.json({ job });
});

// ---------- Uploads (CV, pitch) ----------

const MAX_CV = 5 * 1024 * 1024;
const MAX_PITCH = 25 * 1024 * 1024;
const CV_TYPES = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

publicApi.post('/uploads', async (c) => {
  if (!(await rateLimit(c.env, 'upload', clientIp(c), 20, 3600))) bad('Too many uploads. Try again later.', 429);
  const form = await c.req.formData();
  const kind = form.get('kind') === 'pitch' ? 'pitch' : 'cv';
  const file = form.get('file');
  if (!(file instanceof File)) bad('Attach a file');
  const okType = kind === 'cv' ? CV_TYPES.has(file.type) : /^(audio|video)\//.test(file.type);
  if (!okType) bad(kind === 'cv' ? 'CV must be a PDF or Word document' : 'Pitch must be an audio or video file', 422);
  if (file.size > (kind === 'cv' ? MAX_CV : MAX_PITCH)) bad(`File is too large (max ${kind === 'cv' ? 5 : 25} MB)`, 422);
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const key = `uploads/${kind}/${new Date().toISOString().slice(0, 10)}/${uid()}.${ext}`;
  await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { originalName: file.name.slice(0, 200) } });
  return c.json({ key, name: file.name, size: file.size });
});

// ---------- Apply ----------

const ApplySchema = z.object({
  jobIds: z.array(z.string().min(3)).min(1).max(10),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().refine(isEmail, 'invalid email'),
  phone: z.string().trim().refine((p) => p.replace(/\D/g, '').length >= 10, 'needs at least 10 digits'),
  city: z.string().trim().max(80).optional().default(''),
  expYears: z.union([z.string(), z.number()]).transform(String),
  notice: z.string().max(40).optional().default('Immediate'),
  heardFrom: z.string().max(60).optional(),
  linkedinUrl: z.string().trim().max(300).optional().default(''),
  cvKey: z.string().startsWith('uploads/cv/'),
  pitchKey: z.string().startsWith('uploads/pitch/').optional(),
  proudestNumber: z.string().trim().max(500).optional(),
  consentProcessing: z.literal(true, { message: 'processing consent is required' }),
  consentCampaigns: z.boolean().default(false),
  src: z.string().max(40).optional(),
  postingId: z.string().max(60).optional(),
  turnstileToken: z.string().optional(),
});

publicApi.post('/applications', async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimit(c.env, 'apply', ip, 10, 3600))) bad('Too many applications from this network. Try again in an hour.', 429);
  return idempotent(c, 'apply', async () => {
    const a = await parseJson(c, ApplySchema);
    if (!(await verifyTurnstile(c.env, a.turnstileToken, ip))) bad('Please complete the verification check', 403);

    const d = db(c.env);
    const jobs = await d.select().from(schema.jobs).where(and(inArray(schema.jobs.id, a.jobIds), eq(schema.jobs.status, 'open')));
    if (!jobs.length) bad('None of these roles are open any more', 409);

    const t = now();
    let cand = await d.select().from(schema.candidates).where(eq(schema.candidates.email, a.email)).get();
    const profile = {
      name: a.name, phone: a.phone, city: a.city, expYears: a.expYears, notice: a.notice, linkedinUrl: a.linkedinUrl,
      cvKey: a.cvKey, pitch: a.proudestNumber ?? null, deletedAt: null,
    };
    if (cand) {
      await d.update(schema.candidates).set(profile).where(eq(schema.candidates.id, cand.id));
    } else {
      cand = { id: uid(), email: a.email, createdAt: t, parsedProfile: null, cvText: null, humanOnlyReview: false, ...profile };
      await d.insert(schema.candidates).values(cand);
    }

    const source = a.src && PROVIDER_SOURCES.has(a.src) ? a.src : sourceFromHeard(a.heardFrom);
    const existing = await d.select({ jobId: schema.applications.jobId }).from(schema.applications)
      .where(and(eq(schema.applications.candidateId, cand.id), inArray(schema.applications.jobId, jobs.map((j) => j.id))));
    const already = new Set(existing.map((e) => e.jobId));
    const fresh = jobs.filter((j) => !already.has(j.id));

    const stmts = [];
    const created: { id: string; jobId: string }[] = [];
    for (const j of fresh) {
      const appId = `APP-${uid().slice(0, 8).toUpperCase()}`;
      created.push({ id: appId, jobId: j.id });
      stmts.push(d.insert(schema.applications).values({ id: appId, candidateId: cand.id, jobId: j.id, source, sourcePostingId: a.postingId ?? null, stage: 'Applied', ownerId: j.ownerId, createdAt: t, updatedAt: t }));
      stmts.push(d.insert(schema.stageHistory).values({ id: uid(), applicationId: appId, fromStage: null, toStage: 'Applied', byUser: 'candidate', at: t }));
    }
    stmts.push(d.insert(schema.consents).values({ id: uid(), email: a.email, candidateId: cand.id, type: 'processing', source: 'apply', grantedAt: t }));
    if (a.consentCampaigns) {
      stmts.push(d.insert(schema.consents).values({ id: uid(), email: a.email, candidateId: cand.id, type: 'campaigns', interests: [...new Set(jobs.map((j) => j.department))], frequency: 'When a matching role opens', source: 'apply', grantedAt: t }));
    }
    await d.batch(stmts as [typeof stmts[number], ...typeof stmts]);

    await createSession(c, { candidateId: cand.id, email: a.email });
    c.executionCtx.waitUntil(sendEmail(c.env, {
      to: a.email, tag: 'apply', subject: `Application received · ${jobs.map((j) => j.title).join(', ')}`,
      text: `Hi ${a.name.split(' ')[0]},\n\nThanks for applying to ${jobs.map((j) => `${j.title} (${j.id})`).join(', ')}.\nA recruiter reviews every application within 3 working days. Track your status any time: ${c.env.APP_URL}/#applications\n\nChampions Group never charges a fee at any stage of hiring.`,
    }));
    return { status: 201, body: { applications: created, alreadyApplied: [...already], skippedClosed: a.jobIds.filter((id) => !jobs.some((j) => j.id === id)) } };
  });
});

function sourceFromHeard(h?: string) {
  const m: Record<string, string> = { LinkedIn: 'linkedin_member', Naukri: 'naukri', 'Employee referral': 'referral', 'Talent community': 'community', Campus: 'campus' };
  return (h && m[h]) || 'careers_site';
}

// ---------- Candidate sign-in (email code) ----------

publicApi.post('/auth/otp', async (c) => {
  const { email } = await parseJson(c, z.object({ email: z.string().trim().toLowerCase().refine(isEmail, 'invalid email') }));
  if (!(await rateLimit(c.env, 'otp', clientIp(c), 10, 900)) || !(await rateLimit(c.env, 'otp-email', email, 5, 900))) bad('Too many codes requested. Wait 15 minutes.', 429);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0');
  const k = keys(c.env).otp(await sha256Hex(email));
  await redis(c.env).set(k, JSON.stringify({ hash: await sha256Hex(`${email}:${code}`), attempts: 0 }), { ex: TTL.otp });
  // Same response whether or not the email has applied, so the endpoint can't be used to probe for candidates.
  const cand = await db(c.env).select({ id: schema.candidates.id }).from(schema.candidates).where(eq(schema.candidates.email, email)).get();
  if (cand) {
    c.executionCtx.waitUntil(sendEmail(c.env, { to: email, tag: 'otp', subject: `Your Champions Group sign-in code: ${code}`, text: `Your code is ${code}. It expires in 15 minutes. If you didn't ask for it, ignore this email.` }));
  }
  return c.json({ sent: true, ...(c.env.ENVIRONMENT === 'dev' && cand ? { devCode: code } : {}) });
});

publicApi.post('/auth/verify', async (c) => {
  const { email, code } = await parseJson(c, z.object({ email: z.string().trim().toLowerCase(), code: z.string().regex(/^\d{6}$/) }));
  const k = keys(c.env).otp(await sha256Hex(email));
  const raw = await redis(c.env).get<string>(k);
  if (!raw) bad('That code has expired. Request a new one.', 401);
  const st = JSON.parse(raw) as { hash: string; attempts: number };
  if (st.attempts >= 5) bad('Too many wrong codes. Request a new one.', 429);
  if (st.hash !== (await sha256Hex(`${email}:${code}`))) {
    await redis(c.env).set(k, JSON.stringify({ ...st, attempts: st.attempts + 1 }), { keepTtl: true });
    bad('That code is not right. Check the latest email.', 401);
  }
  await redis(c.env).del(k);
  const cand = await db(c.env).select().from(schema.candidates).where(eq(schema.candidates.email, email)).get();
  if (!cand) bad('No applications found for this email', 404);
  await createSession(c, { candidateId: cand.id, email });
  return c.json({ ok: true });
});

publicApi.post('/auth/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

// ---------- My applications ----------

publicApi.get('/me', async (c) => {
  const s = await readSession(c);
  if (!s) return c.json({ signedIn: false });
  const d = db(c.env);
  const cand = await d.select().from(schema.candidates).where(eq(schema.candidates.id, s.candidateId)).get();
  if (!cand || cand.deletedAt) return c.json({ signedIn: false });
  const apps = await d.select({ a: schema.applications, j: schema.jobs, co: schema.companies })
    .from(schema.applications)
    .innerJoin(schema.jobs, eq(schema.applications.jobId, schema.jobs.id))
    .innerJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
    .where(eq(schema.applications.candidateId, cand.id))
    .orderBy(desc(schema.applications.createdAt));
  const alerts = await d.select().from(schema.jobAlerts).where(and(eq(schema.jobAlerts.email, cand.email), isNull(schema.jobAlerts.stoppedAt)));
  const camp = await d.select().from(schema.consents)
    .where(and(eq(schema.consents.email, cand.email), eq(schema.consents.type, 'campaigns'), isNull(schema.consents.withdrawnAt))).get();
  return c.json({
    signedIn: true,
    me: { name: cand.name, email: cand.email, city: cand.city, expYears: cand.expYears, campaigns: !!camp, humanOnlyReview: cand.humanOnlyReview },
    applications: apps.map(({ a, j, co }) => ({
      id: a.id, stage: a.stage, createdAt: a.createdAt,
      job: { id: j.id, slug: j.slug, title: j.title, ent: co.name, loc: j.location, status: j.status },
    })),
    alerts: alerts.map((x) => ({ id: x.id, label: x.label, frequency: x.frequency, email: x.email, unsubToken: x.unsubToken })),
  });
});

publicApi.post('/me/applications/:id/withdraw', async (c) => {
  const s = await readSession(c);
  if (!s) bad('Sign in first', 401);
  const d = db(c.env);
  const app = await d.select().from(schema.applications).where(and(eq(schema.applications.id, c.req.param('id')), eq(schema.applications.candidateId, s.candidateId))).get();
  if (!app) bad('Application not found', 404);
  if (['Hired', 'Withdrawn', 'Not selected'].includes(app.stage)) bad(`This application is already ${app.stage.toLowerCase()}`, 409);
  const t = now();
  await d.batch([
    d.update(schema.applications).set({ stage: 'Withdrawn', updatedAt: t }).where(eq(schema.applications.id, app.id)),
    d.insert(schema.stageHistory).values({ id: uid(), applicationId: app.id, fromStage: app.stage, toStage: 'Withdrawn', byUser: 'candidate', at: t }),
  ]);
  return c.json({ ok: true });
});

publicApi.post('/me/preferences', async (c) => {
  const s = await readSession(c);
  if (!s) bad('Sign in first', 401);
  const p = await parseJson(c, z.object({ campaigns: z.boolean().optional(), humanOnlyReview: z.boolean().optional() }));
  const d = db(c.env);
  const t = now();
  if (p.humanOnlyReview !== undefined) {
    await d.update(schema.candidates).set({ humanOnlyReview: p.humanOnlyReview }).where(eq(schema.candidates.id, s.candidateId));
    await audit(c.env, s.email, p.humanOnlyReview ? 'human_only_on' : 'human_only_off', 'candidate', s.candidateId);
  }
  if (p.campaigns !== undefined) {
    const active = await d.select().from(schema.consents)
      .where(and(eq(schema.consents.email, s.email), eq(schema.consents.type, 'campaigns'), isNull(schema.consents.withdrawnAt))).get();
    if (p.campaigns && !active) {
      const depts = await d.select({ dept: schema.jobs.department }).from(schema.applications)
        .innerJoin(schema.jobs, eq(schema.applications.jobId, schema.jobs.id)).where(eq(schema.applications.candidateId, s.candidateId));
      await d.insert(schema.consents).values({ id: uid(), email: s.email, candidateId: s.candidateId, type: 'campaigns', interests: [...new Set(depts.map((x) => x.dept))], source: 'preferences', grantedAt: t });
    } else if (!p.campaigns && active) {
      await d.update(schema.consents).set({ withdrawnAt: t }).where(eq(schema.consents.id, active.id));
    }
  }
  return c.json({ ok: true });
});

// ---------- Alerts & talent community ----------

publicApi.post('/alerts', async (c) => {
  if (!(await rateLimit(c.env, 'alert', clientIp(c), 20, 3600))) bad('Too many alerts created. Try later.', 429);
  const a = await parseJson(c, z.object({
    email: z.string().trim().toLowerCase().refine(isEmail, 'invalid email'),
    label: z.string().trim().min(1).max(200),
    query: z.record(z.string(), z.unknown()).default({}),
    frequency: z.enum(['Instantly', 'Daily digest', 'Weekly digest']),
    consent: z.literal(true, { message: 'consent is required' }),
  }));
  const id = uid();
  const unsubToken = uid().replace(/-/g, '');
  await db(c.env).insert(schema.jobAlerts).values({ id, email: a.email, label: a.label, query: a.query, frequency: a.frequency, unsubToken, createdAt: now() });
  c.executionCtx.waitUntil(sendEmail(c.env, { to: a.email, tag: 'alert', subject: `Job alert created: ${a.label}`, text: `We'll email you ${a.frequency.toLowerCase()} when new roles match "${a.label}".\nStop this alert: ${c.env.APP_URL}/unsubscribe/${unsubToken}` }));
  return c.json({ id }, 201);
});

publicApi.post('/alerts/:id/stop', async (c) => {
  const s = await readSession(c);
  if (!s) bad('Sign in first', 401);
  await db(c.env).update(schema.jobAlerts).set({ stoppedAt: now() }).where(and(eq(schema.jobAlerts.id, c.req.param('id')), eq(schema.jobAlerts.email, s.email)));
  return c.json({ ok: true });
});

publicApi.post('/community', async (c) => {
  if (!(await rateLimit(c.env, 'community', clientIp(c), 10, 3600))) bad('Too many sign-ups from this network. Try later.', 429);
  const a = await parseJson(c, z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().refine(isEmail, 'invalid email'),
    interests: z.array(z.string().max(60)).min(1).max(20),
    frequency: z.string().max(60),
    consent: z.literal(true, { message: 'consent is required' }),
  }));
  await db(c.env).insert(schema.consents).values({ id: uid(), email: a.email, type: 'campaigns', interests: a.interests, frequency: a.frequency, source: `community:${a.name}`, grantedAt: now() });
  return c.json({ ok: true }, 201);
});
