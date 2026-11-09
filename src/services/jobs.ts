import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Env } from '../env';
import { db, schema } from '../db/client';
import type { JobSections } from '../db/schema';
import { cached, getVersion } from '../cache/cache';
import { keys, TTL } from '../cache/keys';
import { daysAgo } from '../lib/util';

/** Public job card — same field names the demo's front end used. */
export type PublicJob = {
  id: string; slug: string; title: string; dept: string; ent: string; entSlug: string;
  loc: string; mode: string; shift: string; exp: string; expBand: number; seats: number;
  days: number; postedAt: number | null; inc: boolean; tags: string[]; sum: string;
  salary: { min: number; max: number; currency: string } | null;
};
export type PublicJobDetail = PublicJob & { sections: JobSections; status: string; closesAt: number | null; companyAccent: string };

type JobRow = typeof schema.jobs.$inferSelect;
type CompanyRow = typeof schema.companies.$inferSelect;

function toPublic(j: JobRow, c: CompanyRow): PublicJob {
  return {
    id: j.id, slug: j.slug, title: j.title, dept: j.department, ent: c.name, entSlug: c.slug,
    loc: j.location, mode: j.workMode, shift: j.shift, exp: j.expLabel, expBand: j.expBand, seats: j.seats,
    days: daysAgo(j.postedAt), postedAt: j.postedAt, inc: j.incentive, tags: j.tags, sum: j.summary,
    salary: j.showSalary && j.salaryMin && j.salaryMax ? { min: j.salaryMin, max: j.salaryMax, currency: j.salaryCurrency ?? 'INR' } : null,
  };
}

/** All open jobs for a scope ('all' or a company slug). Cached under a versioned key. */
export async function listOpenJobs(env: Env, scope = 'all'): Promise<PublicJob[]> {
  const ver = await getVersion(env, keys(env).verJobs(scope));
  return cached(env, keys(env).jobs(scope, ver), TTL.jobs, async () => {
    const rows = await db(env)
      .select({ j: schema.jobs, c: schema.companies })
      .from(schema.jobs)
      .innerJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
      .where(scope === 'all' ? eq(schema.jobs.status, 'open') : and(eq(schema.jobs.status, 'open'), eq(schema.companies.slug, scope)))
      .orderBy(desc(schema.jobs.postedAt));
    // `days` is recomputed on read so the cache doesn't freeze "posted N days ago".
    return rows.map((r) => toPublic(r.j, r.c));
  }).then((list) => list.map((j) => ({ ...j, days: daysAgo(j.postedAt) })));
}

/** One job with its current JD sections. Returns closed jobs too (the page shows "this role is closed"). */
export async function getJobDetail(env: Env, id: string): Promise<PublicJobDetail | null> {
  const ver = await getVersion(env, keys(env).verJob(id));
  const d = await cached(env, keys(env).job(id, ver), TTL.job, async () => {
    const row = await db(env)
      .select({ j: schema.jobs, c: schema.companies })
      .from(schema.jobs)
      .innerJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
      .where(eq(schema.jobs.id, id))
      .get();
    if (!row || ['draft', 'pending_approval', 'approved'].includes(row.j.status)) return null;
    const v = await db(env).select().from(schema.jobVersions)
      .where(and(eq(schema.jobVersions.jobId, id), eq(schema.jobVersions.version, row.j.currentVersion))).get();
    if (!v) return null;
    return { ...toPublic(row.j, row.c), sections: v.sections, status: row.j.status, closesAt: row.j.closesAt, companyAccent: row.c.accent };
  });
  return d ? { ...d, days: daysAgo(d.postedAt) } : null;
}

export async function getJobsByIds(env: Env, ids: string[]) {
  if (!ids.length) return [];
  return db(env).select().from(schema.jobs).where(inArray(schema.jobs.id, ids));
}

export function facets(list: PublicJob[]) {
  const count = (f: (j: PublicJob) => string) => list.reduce<Record<string, number>>((a, j) => ((a[f(j)] = (a[f(j)] ?? 0) + 1), a), {});
  return {
    roles: list.length,
    seats: list.reduce((a, j) => a + j.seats, 0),
    companies: new Set(list.map((j) => j.ent)).size,
    locations: new Set(list.flatMap((j) => j.loc.split(' / '))).size,
    departments: count((j) => j.dept),
    byLocation: count((j) => j.loc),
    byShift: count((j) => j.shift),
  };
}

export function jobUrl(env: Pick<Env, 'APP_URL'>, j: { id: string; slug: string }) {
  return `${env.APP_URL}/jobs/${j.id}/${j.slug}`;
}
