import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import type { Env } from '../../src/env';
import { linkedinFeedXml, indeedFeedXml } from '../../src/channels/feeds';
import { releaseScheduled } from '../../src/publisher/scheduler';

const E = env as unknown as Env;

beforeAll(async () => {
  const t = Date.now();
  const sections = JSON.stringify({ opportunity: 'o', responsibilities: ['Call 60 prospects a day'], mustHave: ['English'], niceToHave: [], whatWeLookFor: [], first90Days: [], offers: ['Training'], skills: ['CRM'], assessment: 'Mock call' });
  const profile = JSON.stringify({ offers: ['Training'], locations: ['Bengaluru'], shifts: ['US shift'] });
  await E.DB.batch([
    E.DB.prepare(`INSERT OR IGNORE INTO companies (id,slug,name,accent,profile,require_approval,created_at) VALUES ('co_p2','p2','P2 Co','#F59A3C',?,0,?)`).bind(profile, t),
    E.DB.prepare(`INSERT OR IGNORE INTO users (id,email,name,role,created_at) VALUES ('usr_p2','p2@championsmail.com','P2','admin',?)`).bind(t),
    ...['CG-2026-2001', 'CG-2026-2002'].map((id, i) => E.DB.prepare(`INSERT INTO jobs (id,company_id,title,slug,department,location,work_mode,shift,exp_label,exp_band,seats,show_salary,incentive,tags,summary,status,current_version,owner_id,posted_at,created_at,updated_at) VALUES (?,'co_p2',?,?,'Sales','Bengaluru','Onsite','US shift','1–3 yrs',0,2,0,1,'["CRM"]','Sell & win <fast>.',?,1,'usr_p2',?,?,?)`).bind(id, `Role ${i}`, `role-${i}`, i === 0 ? 'open' : 'closed', t, t, t)),
    ...['CG-2026-2001', 'CG-2026-2002'].map((id) => E.DB.prepare(`INSERT INTO job_versions (id,job_id,version,sections,source,created_at) VALUES (?,?,1,?,'human',?)`).bind(`jv_${id}`, id, sections, t)),
    E.DB.prepare(`INSERT INTO channel_connections (id,company_id,provider,account_ref,display_name,status,config,created_at) VALUES ('c_lf','co_p2','linkedin_feed','1','LI feed','active','{"posterEmail":"hr@championsmail.com"}',?)`).bind(t),
    E.DB.prepare(`INSERT INTO channel_connections (id,company_id,provider,account_ref,display_name,status,config,created_at) VALUES ('c_ind_api','co_p2','indeed','1','Indeed API','active','{"mode":"api"}',?)`).bind(t),
    ...[['p1', 'CG-2026-2001', 'c_lf', 'linkedin_feed', 'live'], ['p2', 'CG-2026-2002', 'c_lf', 'linkedin_feed', 'live'], ['p3', 'CG-2026-2001', 'c_ind_api', 'indeed', 'live'], ['p4', 'CG-2026-2001', 'c_lf', 'linkedin_feed', 'scheduled']].map(([id, job, conn, prov, st], i) =>
      E.DB.prepare(`INSERT INTO postings (id,job_id,connection_id,provider,run,status,scheduled_at,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, job, conn, prov, i + 1, st, st === 'scheduled' ? t - 1000 : null, `k${id}`, t, t)),
  ]);
});

describe('feeds', () => {
  it('LinkedIn feed lists open jobs only, with poster email and a tracked apply URL', async () => {
    const xml = await linkedinFeedXml(E);
    expect(xml).toContain('<partnerJobId><![CDATA[CG-2026-2001]]></partnerJobId>');
    expect(xml).not.toContain('CG-2026-2002');
    expect(xml).toContain('hr@championsmail.com');
    expect(xml).toContain('?src=linkedin_feed&amp;p=p1'.replace('&amp;', '&'));
    expect(xml).toContain('Sell & win <fast>.'); // inside CDATA, not double-escaped
  });
  it('Indeed feed excludes jobs sent through the Job Sync API (single source)', async () => {
    const xml = await indeedFeedXml(E);
    expect(xml).not.toContain('CG-2026-2001');
  });
});

describe('scheduler', () => {
  it('releases due scheduled posts to the queue', async () => {
    const n = await releaseScheduled(E);
    expect(n).toBeGreaterThanOrEqual(1);
    const row = await E.DB.prepare(`SELECT status FROM postings WHERE id = 'p4'`).first<{ status: string }>();
    expect(row?.status).toBe('queued');
  });
});
