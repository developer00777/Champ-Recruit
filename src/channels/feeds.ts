import { and, eq, inArray } from 'drizzle-orm';
import type { Env } from '../env';
import type { ChannelAdapter } from './adapter';
import { db, schema } from '../db/client';
import { getJobDetail, jobUrl, type PublicJobDetail } from '../services/jobs';
import { cached, getVersion } from '../cache/cache';
import { keys, TTL } from '../cache/keys';

/**
 * Pull-based channels: the job board fetches an XML feed from us on its own schedule.
 *  - LinkedIn "Limited Listings" (free basic jobs): /feeds/linkedin.xml — picked up every ~6–12h.
 *  - Indeed XML feed (fallback while Job Sync API access is pending): /feeds/indeed.xml
 * A job is in a feed when it is open and has a live/queued posting for that feed's connection.
 * Field names follow the providers' published feed formats; validate with each provider's feed checker
 * when the feed is registered (LinkedIn support / Indeed).
 */

const cdata = (s: string) => `<![CDATA[${String(s).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
const COUNTRY: Record<string, string> = { bengaluru: 'IN', bangalore: 'IN', mumbai: 'IN', dubai: 'AE', singapore: 'SG', london: 'GB', tokyo: 'JP' };
const country = (loc: string) => COUNTRY[loc.toLowerCase().split(/[ /,]/)[0] ?? ''] ?? 'IN';
const WORKPLACE: Record<string, string> = { Onsite: 'On-site', Hybrid: 'Hybrid', Remote: 'Remote' };
const EXP_LEVEL = ['ENTRY_LEVEL', 'ASSOCIATE', 'MID_SENIOR_LEVEL', 'DIRECTOR'];

function htmlDescription(j: PublicJobDetail) {
  const li = (a: string[]) => `<ul>${a.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  const s = j.sections;
  return `<p>${j.sum}</p><p>${s.opportunity}</p><h3>Key responsibilities</h3>${li(s.responsibilities)}<h3>Must have</h3>${li(s.mustHave)}${s.niceToHave.length ? `<h3>Nice to have</h3>${li(s.niceToHave)}` : ''}<h3>What we offer</h3>${li(s.offers)}<p>Requisition ID ${j.id}. We never charge a fee at any stage of hiring.</p>`;
}

async function feedJobs(env: Env, provider: 'linkedin_feed' | 'indeed') {
  const d = db(env);
  const rows = await d.select({ jobId: schema.postings.jobId, postingId: schema.postings.id, config: schema.channelConnections.config, connStatus: schema.channelConnections.status })
    .from(schema.postings)
    .innerJoin(schema.channelConnections, eq(schema.channelConnections.id, schema.postings.connectionId))
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.postings.jobId))
    .where(and(eq(schema.postings.provider, provider), inArray(schema.postings.status, ['live', 'queued', 'posting']), eq(schema.jobs.status, 'open')));
  const seen = new Set<string>();
  const out: { job: PublicJobDetail; postingId: string; config: Record<string, unknown> | null; ownerEmail: string | null }[] = [];
  for (const r of rows) {
    if (seen.has(r.jobId) || r.connStatus === 'revoked') continue;
    if (provider === 'indeed' && r.config?.mode === 'api') continue; // API-mode Indeed jobs must not also be in the feed (single-source policy)
    seen.add(r.jobId);
    const job = await getJobDetail(env, r.jobId);
    const owner = await d.select({ email: schema.users.email }).from(schema.jobs).innerJoin(schema.users, eq(schema.users.id, schema.jobs.ownerId)).where(eq(schema.jobs.id, r.jobId)).get();
    if (job) out.push({ job, postingId: r.postingId, config: r.config, ownerEmail: owner?.email ?? null });
  }
  return out;
}

export async function linkedinFeedXml(env: Env) {
  const ver = await getVersion(env, keys(env).verJobs('all'));
  return cached(env, keys(env).feed('linkedin', ver), TTL.feed, async () => {
    const items = await feedJobs(env, 'linkedin_feed');
    const jobs = items.map(({ job: j, postingId, config, ownerEmail }) => `<job>
<partnerJobId>${cdata(j.id)}</partnerJobId>
<company>${cdata(j.ent)}</company>
${config?.linkedinCompanyId ? `<companyId>${cdata(String(config.linkedinCompanyId))}</companyId>` : ''}
<title>${cdata(j.title)}</title>
<description>${cdata(htmlDescription(j))}</description>
<applyUrl>${cdata(`${jobUrl(env, j)}?src=linkedin_feed&p=${postingId}`)}</applyUrl>
<location>${cdata(`${j.loc}, ${country(j.loc)}`)}</location>
<city>${cdata(j.loc.split(' / ')[0] ?? j.loc)}</city>
<country>${cdata(country(j.loc))}</country>
<workplaceTypes>${cdata(WORKPLACE[j.mode] ?? 'On-site')}</workplaceTypes>
<jobtype>${cdata('FULL_TIME')}</jobtype>
<experienceLevel>${cdata(EXP_LEVEL[j.expBand] ?? 'ENTRY_LEVEL')}</experienceLevel>
<posterEmail>${cdata(String(config?.posterEmail ?? ownerEmail ?? 'careers@championsgroup.com'))}</posterEmail>
${j.postedAt ? `<listDate>${cdata(new Date(j.postedAt).toISOString().slice(0, 10))}</listDate>` : ''}
</job>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<source>\n<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n<publisherUrl>${env.APP_URL}</publisherUrl>\n<publisher>Champions Group</publisher>\n${jobs}\n</source>\n`;
  });
}

export async function indeedFeedXml(env: Env) {
  const ver = await getVersion(env, keys(env).verJobs('all'));
  return cached(env, keys(env).feed('indeed', ver), TTL.feed, async () => {
    const items = await feedJobs(env, 'indeed');
    const jobs = items.map(({ job: j, postingId, ownerEmail }) => `<job>
<title>${cdata(j.title)}</title>
<date>${cdata(new Date(j.postedAt ?? Date.now()).toUTCString())}</date>
<referencenumber>${cdata(j.id)}</referencenumber>
<requisitionid>${cdata(j.id)}</requisitionid>
<url>${cdata(`${jobUrl(env, j)}?src=indeed&p=${postingId}`)}</url>
<company>${cdata(j.ent)}</company>
<sourcename>${cdata(j.ent)}</sourcename>
<city>${cdata(j.loc.split(' / ')[0] ?? j.loc)}</city>
<country>${cdata(country(j.loc))}</country>
<email>${cdata(ownerEmail ?? 'careers@championsgroup.com')}</email>
<description>${cdata(htmlDescription(j))}</description>
${j.salary ? `<salary>${cdata(`${j.salary.currency} ${j.salary.min}-${j.salary.max} per year`)}</salary>` : ''}
<jobtype>${cdata('fulltime')}</jobtype>
<category>${cdata(j.dept)}</category>
<experience>${cdata(j.exp)}</experience>
${j.mode === 'Remote' ? `<remotetype>${cdata('Fully remote')}</remotetype>` : ''}
</job>`).join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>\n<source>\n<publisher>Champions Group</publisher>\n<publisherurl>${env.APP_URL}</publisherurl>\n<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n${jobs}\n</source>\n`;
  });
}

/** Feed adapters: publishing just puts the job into the feed (the board pulls it later). */
function feedAdapter(provider: 'linkedin_feed' | 'indeed', label: string, path: string): ChannelAdapter {
  return {
    provider, label, mode: 'feed', needsCopy: false,
    capabilities: { update: true, close: true },
    validate: (job) => (job.sections.responsibilities.length && job.sections.mustHave.length ? [] : ['The JD needs responsibilities and must-haves for job boards']),
    async publish(ctx, job) {
      return { externalId: job.id, url: `${ctx.env.APP_URL}${path}`, note: 'Added to the feed. The board picks it up on its next crawl (usually within 6–12 hours).' };
    },
    async update() { /* the feed reflects the latest version automatically */ },
    async close() { /* closed jobs drop out of the feed automatically */ },
  };
}

export const linkedinFeed = feedAdapter('linkedin_feed', 'LinkedIn Jobs (Limited Listings feed)', '/feeds/linkedin.xml');
export const indeedFeed = feedAdapter('indeed', 'Indeed (XML feed)', '/feeds/indeed.xml');
