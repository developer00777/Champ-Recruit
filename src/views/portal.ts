import header from './fragments/header.html';
import careers from './fragments/careers.html';
import applications from './fragments/applications.html';
import footer from './fragments/footer.html';
import type { PublicJob, PublicJobDetail } from '../services/jobs';
import { escapeHtml as esc, jsonForScript } from '../lib/util';

type Boot = { jobs: PublicJob[]; job?: PublicJobDetail; company?: { slug: string; name: string } | null; turnstileSiteKey?: string };

const COUNTRY: Record<string, string> = { bengaluru: 'IN', bangalore: 'IN', mumbai: 'IN', dubai: 'AE', singapore: 'SG', london: 'GB', tokyo: 'JP', emeryville: 'US' };
const countryOf = (loc: string) => COUNTRY[loc.toLowerCase().split(/[ /,]/)[0] ?? ''] ?? 'IN';

const fmtDate = (ts: number | null) =>
  ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const ago = (d: number) => (d === 0 ? 'Today' : d === 1 ? 'Posted yesterday' : `Posted ${d} days ago`);
const li = (a: string[]) => a.map((x) => `<li>${esc(x)}</li>`).join('');

function salaryText(j: PublicJob) {
  if (j.salary) {
    const f = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
    return `${j.salary.currency} ${f(j.salary.min)}–${f(j.salary.max)} a year${j.inc ? ' + incentive' : ''}`;
  }
  return j.inc ? 'Competitive + incentive' : 'Competitive';
}

export function jobPostingJsonLd(j: PublicJobDetail, url: string) {
  const s = j.sections;
  const description = [
    `<p>${esc(j.sum)}</p>`, `<p>${esc(s.opportunity)}</p>`,
    `<h3>Key responsibilities</h3><ul>${li(s.responsibilities)}</ul>`,
    `<h3>Must have</h3><ul>${li(s.mustHave)}</ul>`,
    s.niceToHave.length ? `<h3>Nice to have</h3><ul>${li(s.niceToHave)}</ul>` : '',
    `<h3>What we offer</h3><ul>${li(s.offers)}</ul>`,
  ].join('');
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org/', '@type': 'JobPosting',
    title: j.title, description, datePosted: j.postedAt ? new Date(j.postedAt).toISOString() : undefined,
    validThrough: new Date(j.closesAt ?? (j.postedAt ?? Date.now()) + 60 * 86_400_000).toISOString(),
    employmentType: 'FULL_TIME',
    identifier: { '@type': 'PropertyValue', name: j.ent, value: j.id },
    hiringOrganization: { '@type': 'Organization', name: j.ent, sameAs: 'https://championsgroup.com' },
    jobLocation: j.loc.split(' / ').map((l) => ({ '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: l, addressCountry: countryOf(l) } })),
    directApply: true, industry: j.dept, skills: s.skills.join(', '), url,
  };
  if (j.mode === 'Remote') ld.jobLocationType = 'TELECOMMUTE';
  if (j.salary) ld.baseSalary = { '@type': 'MonetaryAmount', currency: j.salary.currency, value: { '@type': 'QuantitativeValue', minValue: j.salary.min, maxValue: j.salary.max, unitText: 'YEAR' } };
  return ld;
}

function jobCardHtml(j: PublicJob) {
  return `<article class="job"><div class="job-main"><div class="job-top"><span class="mono muted">${esc(j.id)}</span>${j.seats >= 5 ? '<span class="tag hot">Bulk hiring</span>' : ''}${j.inc ? '<span class="tag inc">Incentive-eligible</span>' : ''}</div>
    <h3><a href="/jobs/${esc(j.id)}/${esc(j.slug)}">${esc(j.title)}</a></h3>
    <div class="meta"><span>${esc(j.dept)}</span><span>${esc(j.ent)}</span><span>${esc(j.loc)} · ${esc(j.mode)}</span><span>${esc(j.shift)} · ${esc(j.exp)}</span></div>
    <p class="sum">${esc(j.sum)}</p></div>
    <div class="job-side"><div class="seats"><b>${j.seats}</b><span>${j.seats > 1 ? 'positions' : 'position'} · ${ago(j.days)}</span></div>
    <div class="job-actions"><a class="btn btn-ink btn-sm" href="/jobs/${esc(j.id)}/${esc(j.slug)}">View &amp; apply</a></div></div></article>`;
}

/** Server-rendered job description page (same markup as the demo's job view). */
export function jobPageHtml(j: PublicJobDetail, similar: PublicJob[]) {
  const s = j.sections;
  const closed = j.status !== 'open';
  const applyRow = closed
    ? `<div class="apply-row"><span class="tag">This role is closed</span><a class="btn btn-ghost" href="/#openings">See open roles</a></div>`
    : `<div class="apply-row"><button class="btn btn-gold" type="button" data-apply="${esc(j.id)}">Apply now</button><button class="btn btn-ghost" type="button" data-save="${esc(j.id)}">Save and apply with others</button></div>`;
  return `<div class="wrap jp">
   <a class="back" href="/#openings">← Back to search results</a>
   <div class="jp-grid">
    <article style="min-width:0">
     <header class="jp-head"><span class="eyebrow">${esc(j.ent)} · ${esc(j.dept)}</span><h1>${esc(j.title)}</h1>
      <dl class="jp-meta"><div><dt>Location</dt><dd>${esc(j.loc)}</dd></div><div><dt>Work mode</dt><dd>${esc(j.mode)} · ${esc(j.shift)}</dd></div><div><dt>Salary</dt><dd>${esc(salaryText(j))}</dd></div><div><dt>Experience</dt><dd>${esc(j.exp)}</dd></div><div><dt>Date posted</dt><dd>${fmtDate(j.postedAt)}</dd></div><div><dt>Requisition ID</dt><dd class="mono">${esc(j.id)}</dd></div></dl>
      ${applyRow}
     </header>
     <div class="jd">
      <p class="jd-lead">${esc(j.sum)}</p>
      <h2>The opportunity</h2><p>${esc(s.opportunity)}</p>
      <h2>Your key responsibilities</h2><ul>${li(s.responsibilities)}</ul>
      <h2>To qualify for the role you must have</h2><ul>${li(s.mustHave)}</ul>
      ${s.niceToHave.length ? `<h2>Ideally, you'll also have</h2><ul>${li(s.niceToHave)}</ul>` : ''}
      ${s.whatWeLookFor.length ? `<h2>What we look for</h2>${s.whatWeLookFor.map((p) => `<p>${esc(p)}</p>`).join('')}` : ''}
      ${s.first90Days.length ? `<h2>Your first 90 days</h2><div class="d90">${s.first90Days.map((x) => `<div><b>By day ${esc(x.by)}:</b> ${esc(x.outcome)}${x.measure ? ` <span class="muted">(${esc(x.measure)})</span>` : ''}</div>`).join('')}</div>` : ''}
      <h2>What working at ${esc(j.ent)} offers</h2><ul>${li(s.offers)}</ul>
      ${s.assessment ? `<h2>How we'll assess you</h2><p>${esc(s.assessment)}</p>` : ''}
      <h2>Skills on this role</h2><div class="chips">${s.skills.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <p class="jd-note">Champions Group is an equal opportunity employer. We hire on skills and potential and welcome everyone who meets the requirements. Tell us if you need any adjustment during the hiring process. We never charge a fee at any stage.</p>
      ${closed ? '' : `<div class="jd-cta"><b style="font-size:1.15rem">Ready to make your mark?</b><p class="muted">Apply today. A recruiter reviews every application within 3 working days.</p>${applyRow}</div>`}
     </div>
    </article>
    <aside class="jp-side">
     <div class="side-card"><b>${esc(j.title)}</b><span class="muted" style="font-size:.86rem">${j.seats} position${j.seats > 1 ? 's' : ''} · ${esc(j.exp)} · ${ago(j.days)}</span>
      ${closed ? '' : `<button class="btn btn-gold" type="button" data-apply="${esc(j.id)}">Apply now</button>`}
      <div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" style="flex:1" type="button" id="dShare">Copy link</button></div>
      <p class="mono muted" id="dLink" hidden style="word-break:break-all;font-size:.75rem"></p></div>
     <div class="side-card"><span class="eyebrow">Job alert</span><p style="font-size:.9rem">Get new ${esc(j.dept)} roles by email as soon as they open.</p><button class="btn btn-ghost btn-sm" type="button" data-alert="${esc(j.dept)}">Create alert</button></div>
    </aside>
   </div>
   ${similar.length ? `<section class="similar"><h2>Find similar jobs</h2><div class="jobs">${similar.map(jobCardHtml).join('')}</div></section>` : ''}
  </div>`;
}

export function portalPage(opts: {
  appUrl: string; boot: Boot; title?: string; description?: string; canonical?: string; jsonLd?: unknown; jobHtml?: string;
}) {
  const { boot } = opts;
  const title = opts.title ?? 'Careers at Champions Group · Talent Hub';
  const description = opts.description ?? 'Open roles across Champions Group businesses. Apply once, track every step, and get alerts when your kind of role opens.';
  const canonical = opts.canonical ?? `${opts.appUrl}/`;
  // Careers listing is server-rendered too, so the page works (and is indexable) before JS loads.
  const careersHtml = careers.replace('<div class="jobs" id="jobList"></div>', `<div class="jobs" id="jobList">${boot.jobs.map(jobCardHtml).join('')}</div>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(opts.appUrl)}/assets/og-default.png"><meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/assets/portal.css">
${opts.jsonLd ? `<script type="application/ld+json">${jsonForScript(opts.jsonLd)}</script>` : ''}
</head><body>
${header}
<main>
${opts.jobHtml ? careersHtml.replace('<div class="view" id="v-careers">', '<div class="view" id="v-careers" hidden>') : careersHtml}
${applications}
<div class="view" id="v-job"${opts.jobHtml ? '' : ' hidden'}><div id="jobPage">${opts.jobHtml ?? ''}</div></div>
</main>
${footer}
<script>window.__BOOT__=${jsonForScript(boot)}</script>
<script src="/assets/portal.js" defer></script>
</body></html>`;
}
