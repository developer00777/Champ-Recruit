import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../../env';
import { db, schema } from '../../db/client';
import { listOpenJobs, getJobDetail, jobUrl } from '../../services/jobs';
import { portalPage, jobPageHtml, jobPostingJsonLd } from '../../views/portal';
import { countClick, countView } from '../../cache/cache';
import { escapeHtml, now } from '../../lib/util';
import { linkedinFeedXml, indeedFeedXml } from '../../channels/feeds';

export const pages = new Hono<AppEnv>();

const HTML_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

pages.get('/', async (c) => {
  const jobs = await listOpenJobs(c.env, 'all');
  c.header('cache-control', HTML_CACHE);
  return c.html(portalPage({ appUrl: c.env.APP_URL, boot: { jobs } }));
});

/** Hosted careers page for one group company, e.g. /c/lakeb2b. */
pages.get('/c/:company', async (c) => {
  const slug = c.req.param('company');
  const co = await db(c.env).select().from(schema.companies).where(eq(schema.companies.slug, slug)).get();
  if (!co) return c.notFound();
  const jobs = await listOpenJobs(c.env, slug);
  c.header('cache-control', HTML_CACHE);
  return c.html(portalPage({
    appUrl: c.env.APP_URL, boot: { jobs, company: { slug, name: co.name } },
    title: `Careers at ${co.name} · Champions Group`, canonical: `${c.env.APP_URL}/c/${slug}`,
  }));
});

pages.get('/jobs/:id/:slug?', async (c) => {
  const id = c.req.param('id');
  const job = await getJobDetail(c.env, id);
  if (!job) return c.html(portalPage({ appUrl: c.env.APP_URL, boot: { jobs: await listOpenJobs(c.env) }, title: 'Role not found', jobHtml: `<div class="wrap jp"><a class="back" href="/#openings">← Back to search results</a><div class="empty"><b>We couldn't find that role.</b><p class="muted" style="margin-top:6px">It may have closed. Browse current openings instead.</p></div></div>` }), 404);
  if (c.req.param('slug') !== job.slug) return c.redirect(`/jobs/${job.id}/${job.slug}${new URL(c.req.url).search}`, 301);

  const src = c.req.query('src');
  c.executionCtx.waitUntil(Promise.all([countView(c.env, id), src ? countClick(c.env, id, src.slice(0, 40)) : Promise.resolve()]));

  const all = await listOpenJobs(c.env);
  const similar = [...all.filter((x) => x.dept === job.dept && x.id !== id), ...all.filter((x) => x.dept !== job.dept && x.tags.some((t) => job.tags.includes(t)))].slice(0, 3);
  const url = jobUrl(c.env, job);
  c.header('cache-control', HTML_CACHE);
  return c.html(portalPage({
    appUrl: c.env.APP_URL,
    boot: { jobs: all, job },
    title: `${job.title} · ${job.ent} · ${job.loc} (${job.id})`,
    description: job.sum,
    canonical: url,
    jsonLd: job.status === 'open' ? jobPostingJsonLd(job, url) : undefined,
    jobHtml: jobPageHtml(job, similar),
  }));
});

pages.get('/sitemap-jobs.xml', async (c) => {
  const jobs = await listOpenJobs(c.env);
  const urls = jobs.map((j) => `<url><loc>${escapeHtml(jobUrl(c.env, j))}</loc>${j.postedAt ? `<lastmod>${new Date(j.postedAt).toISOString()}</lastmod>` : ''}</url>`).join('');
  c.header('content-type', 'application/xml; charset=utf-8');
  c.header('cache-control', 'public, s-maxage=300');
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeHtml(c.env.APP_URL)}/</loc></url>${urls}</urlset>`);
});

pages.get('/robots.txt', (c) =>
  c.text(`User-agent: *\nAllow: /\nDisallow: /console\nDisallow: /api/\nSitemap: ${c.env.APP_URL}/sitemap-jobs.xml\n`));

pages.get('/unsubscribe/:token', async (c) => {
  const token = c.req.param('token');
  const d = db(c.env);
  const alert = await d.select().from(schema.jobAlerts).where(eq(schema.jobAlerts.unsubToken, token)).get();
  if (alert && !alert.stoppedAt) await d.update(schema.jobAlerts).set({ stoppedAt: now() }).where(eq(schema.jobAlerts.id, alert.id));
  return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/assets/portal.css"><div class="wrap" style="padding:60px 16px"><h2>${alert ? 'Alert stopped' : 'Link not recognised'}</h2><p class="muted" style="margin-top:8px">${alert ? `You won't get more emails for "${escapeHtml(alert.label)}".` : 'This alert may already be stopped.'}</p><p style="margin-top:16px"><a class="btn btn-gold" href="/">Browse roles</a></p></div>`);
});

/** Job feeds pulled by LinkedIn (Limited Listings) and Indeed. */
pages.get('/feeds/linkedin.xml', async (c) => {
  c.header('content-type', 'application/xml; charset=utf-8');
  c.header('cache-control', 'public, s-maxage=900');
  return c.body(await linkedinFeedXml(c.env));
});
pages.get('/feeds/indeed.xml', async (c) => {
  c.header('content-type', 'application/xml; charset=utf-8');
  c.header('cache-control', 'public, s-maxage=900');
  return c.body(await indeedFeedXml(c.env));
});
