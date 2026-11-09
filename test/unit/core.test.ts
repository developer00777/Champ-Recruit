import { describe, it, expect, beforeAll } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import type { Env } from '../../src/env';
import { encrypt, decrypt } from '../../src/lib/crypto';
import { jsonForScript, stableJson } from '../../src/lib/util';
import { escapeLittleText } from '../../src/channels/linkedin';
import { keys } from '../../src/cache/keys';
import { jobPostingJsonLd } from '../../src/views/portal';
import { processPosting } from '../../src/publisher/consumer';

const E = env as unknown as Env;
const worker = (exports as unknown as { default: { fetch: (r: Request) => Promise<Response> } }).default;
const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`http://localhost${path}`, init));
const json = (body: unknown, extra: Record<string, string> = {}) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...extra } });

async function seed() {
  const t = Date.now();
  const profile = JSON.stringify({ offers: ['Structured onboarding'], locations: ['Bengaluru'], shifts: ['Day shift'] });
  const sections = JSON.stringify({ opportunity: 'x', responsibilities: ['Do things'], mustHave: ['A'], niceToHave: [], whatWeLookFor: [], first90Days: [], offers: ['Structured onboarding'], skills: ['CRM'], assessment: '' });
  await E.DB.batch([
    E.DB.prepare(`INSERT INTO companies (id,slug,name,accent,profile,require_approval,created_at) VALUES ('co_champions','champions-group','Champions Group','#F59A3C',?,0,?)`).bind(profile, t),
    E.DB.prepare(`INSERT INTO companies (id,slug,name,accent,profile,require_approval,created_at) VALUES ('co_strict','strict-co','Strict Co','#F59A3C',?,1,?)`).bind(profile, t),
    E.DB.prepare(`INSERT INTO users (id,email,name,role,created_at) VALUES ('usr_dev','recruiter@championsmail.com','Dev','admin',?)`).bind(t),
    E.DB.prepare(`INSERT INTO users (id,email,name,role,created_at) VALUES ('usr_view','viewer@championsmail.com','Viewer','viewer',?)`).bind(t),
    E.DB.prepare(`INSERT INTO jobs (id,company_id,title,slug,department,location,work_mode,shift,exp_label,exp_band,seats,show_salary,incentive,tags,summary,status,current_version,owner_id,posted_at,created_at,updated_at) VALUES ('CG-2026-1001','co_champions','Lead Generation Executive','lead-generation-executive','Lead Generation','Bengaluru','Onsite','US shift','0–2 yrs',0,5,0,1,'["CRM"]','Book first meetings.','open',1,'usr_dev',?,?,?)`).bind(t, t, t),
    E.DB.prepare(`INSERT INTO job_versions (id,job_id,version,sections,source,created_at) VALUES ('jv1','CG-2026-1001',1,?,'human',?)`).bind(sections, t),
    E.DB.prepare(`INSERT INTO jobs (id,company_id,title,slug,department,location,work_mode,shift,exp_label,exp_band,seats,show_salary,incentive,tags,summary,status,current_version,owner_id,created_at,updated_at) VALUES ('CG-2026-1002','co_strict','Draft Role','draft-role','Sales','Bengaluru','Onsite','Day shift','1–3 yrs',0,1,0,0,'[]','A draft role here.','draft',1,'usr_dev',?,?)`).bind(t, t),
    E.DB.prepare(`INSERT INTO job_versions (id,job_id,version,sections,source,created_at) VALUES ('jv2','CG-2026-1002',1,?,'human',?)`).bind(sections, t),
    E.DB.prepare(`INSERT INTO channel_connections (id,company_id,provider,account_ref,display_name,status,created_at) VALUES ('conn_site','co_champions','owned_site','site','Official careers sites','active',?)`).bind(t),
    E.DB.prepare(`INSERT INTO channel_connections (id,company_id,provider,account_ref,display_name,status,created_at) VALUES ('conn_google','co_champions','google_jobs','gsc','Google for Jobs','active',?)`).bind(t),
  ]);
}

beforeAll(seed);

describe('crypto', () => {
  it('round-trips and uses a fresh IV each time', async () => {
    const a = await encrypt(E.TOKEN_ENC_KEY, 'secret-token');
    const b = await encrypt(E.TOKEN_ENC_KEY, 'secret-token');
    expect(a).not.toEqual(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(await decrypt(E.TOKEN_ENC_KEY, a)).toBe('secret-token');
  });
  it('rejects tampered ciphertext', async () => {
    const a = await encrypt(E.TOKEN_ENC_KEY, 'x');
    const parts = a.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${btoa('nope-nope-nope-nope')}`;
    await expect(decrypt(E.TOKEN_ENC_KEY, tampered)).rejects.toThrow();
  });
});

describe('helpers', () => {
  it('escapes script-breaking characters in embedded JSON', () => {
    const s = jsonForScript({ t: '</script><script>alert(1)</script>' });
    expect(s).not.toContain('</script>');
    expect(JSON.parse(s).t).toBe('</script><script>alert(1)</script>');
  });
  it('escapes LinkedIn little-text reserved characters', () => {
    expect(escapeLittleText('Pay (fixed) + [bonus] @team #1 _x_')).toBe('Pay \\(fixed\\) + \\[bonus\\] \\@team \\#1 \\_x\\_');
  });
  it('builds env-prefixed Redis keys', () => {
    const k = keys({ ENVIRONMENT: 'production' });
    expect(k.job('CG-1', 3)).toBe('cth:production:c:job:CG-1:3');
    expect(k.lockPost('CG-1', 'conn')).toBe('cth:production:lock:post:CG-1:conn');
  });
  it('stableJson is key-order independent', () => {
    expect(stableJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(stableJson({ a: [{ c: 2, d: 1 }], b: 1 }));
  });
});

describe('public site with Redis unavailable (degrades to D1)', () => {
  it('health reports D1 up and Redis down', async () => {
    const r = await call('/health');
    expect(await r.json()).toMatchObject({ d1: true, redis: false });
  });
  it('lists only open jobs', async () => {
    const r = await call('/api/public/v1/jobs');
    const body = (await r.json()) as { jobs: { id: string }[] };
    expect(body.jobs.map((j) => j.id)).toEqual(['CG-2026-1001']);
  });
  it('renders the job page with JobPosting JSON-LD and redirects a wrong slug', async () => {
    const r = await call('/jobs/CG-2026-1001/lead-generation-executive');
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain('"@type":"JobPosting"');
    const wrong = await call('/jobs/CG-2026-1001/old-slug?src=naukri', { redirect: 'manual' });
    expect(wrong.status).toBe(301);
    expect(wrong.headers.get('location')).toBe('/jobs/CG-2026-1001/lead-generation-executive?src=naukri');
  });
  it('does not expose draft jobs', async () => {
    expect((await call('/api/public/v1/jobs/CG-2026-1002')).status).toBe(404);
  });
  it('rejects an application without processing consent', async () => {
    const r = await call('/api/public/v1/applications', json({ jobIds: ['CG-2026-1001'], name: 'A B', email: 'a@b.co', phone: '9845012345', expYears: '1', cvKey: 'uploads/cv/x.pdf', consentProcessing: false }));
    expect(r.status).toBe(422);
  });
});

describe('JSON-LD', () => {
  it('includes salary only when shown', () => {
    const base = { id: 'CG-1', slug: 's', title: 'T', dept: 'Sales', ent: 'LakeB2B', entSlug: 'lakeb2b', loc: 'Bengaluru', mode: 'Onsite', shift: 'Day', exp: '1', expBand: 0, seats: 1, days: 0, postedAt: Date.now(), inc: false, tags: [], sum: 'S', status: 'open', closesAt: null, companyAccent: '#000', sections: { opportunity: '', responsibilities: [], mustHave: [], niceToHave: [], whatWeLookFor: [], first90Days: [], offers: [], skills: [] } };
    expect(jobPostingJsonLd({ ...base, salary: null }, 'u').baseSalary).toBeUndefined();
    expect(jobPostingJsonLd({ ...base, salary: { min: 1, max: 2, currency: 'INR' } }, 'u').baseSalary).toBeTruthy();
  });
});

describe('console', () => {
  it('blocks read-only users from creating jobs', async () => {
    const r = await call('/api/console/jobs', json({}, { 'x-dev-user': 'viewer@championsmail.com' }));
    expect(r.status).toBe(403);
  });
  it('rejects unknown users', async () => {
    const r = await call('/api/console/me', { headers: { 'x-dev-user': 'stranger@example.com' } });
    expect(r.status).toBe(403);
  });
  it('drafts a JD with the AI (mock mode) in the house schema', async () => {
    const r = await call('/api/console/ai/draft', json({ companyId: 'co_champions', brief: 'Need 15 Lead Generation Executives, US shift, freshers OK' }));
    const body = (await r.json()) as { output: { seats: number; shift: string; sections: { first90Days: unknown[] }; openQuestions: string[] }; mode: string };
    expect(body.mode).toBe('mock');
    expect(body.output.seats).toBe(15);
    expect(body.output.shift).toBe('US shift');
    expect(body.output.sections.first90Days).toHaveLength(3);
    expect(body.output.openQuestions.length).toBeGreaterThan(0);
  });
  it('refuses to publish a job that needs approval', async () => {
    const r = await call('/api/console/jobs/CG-2026-1002/publish', json({ connectionIds: ['conn_site'] }));
    expect(r.status).toBe(409);
  });
  it('publishes to the careers site and Google, then does not double-post the same listing', async () => {
    const r1 = await call('/api/console/jobs/CG-2026-1001/publish', json({ connectionIds: ['conn_site', 'conn_google'] }));
    expect(r1.status).toBe(202);
    const b1 = (await r1.json()) as { postings: { id: string; provider: string }[] };
    expect(b1.postings).toHaveLength(2);
    // Run the queue consumer logic directly.
    for (const p of b1.postings) await processPosting(E, p.id, 'publish', 1);
    const rows = await E.DB.prepare(`SELECT provider, status FROM postings WHERE job_id = 'CG-2026-1001' ORDER BY provider`).all<{ provider: string; status: string }>();
    expect(rows.results).toEqual([{ provider: 'google_jobs', status: 'live' }, { provider: 'owned_site', status: 'live' }]);
    const r2 = await call('/api/console/jobs/CG-2026-1001/publish', json({ connectionIds: ['conn_site', 'conn_google'] }));
    expect(((await r2.json()) as { skipped: number }).skipped).toBe(2);
  });
  it('closing a job takes it off the public list', async () => {
    const r = await call('/api/console/jobs/CG-2026-1001/close', json({ status: 'filled' }));
    expect(r.status).toBe(200);
    const list = (await (await call('/api/public/v1/jobs')).json()) as { jobs: unknown[] };
    expect(list.jobs).toHaveLength(0);
  });
});
