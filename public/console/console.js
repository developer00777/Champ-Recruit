// Champions Talent Hub — recruiter console. Plain ES module, no build step.
// Talks to /api/console (auth: Cloudflare Access in production, DEV_AUTH_EMAIL locally).

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const app = $('#app');

async function api(path, opts = {}) {
  const res = await fetch('/api/console' + path, { credentials: 'same-origin', ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
const post = (p, body, headers) => api(p, { method: 'POST', body: JSON.stringify(body ?? {}), headers });
const put = (p, body) => api(p, { method: 'PUT', body: JSON.stringify(body) });
let tt;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 3500); }
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const daysAgo = (ts) => { const d = Math.floor((Date.now() - ts) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const badge = (s) => `<span class="badge ${esc(s)}">${esc(String(s).replace('_', ' '))}</span>`;
const SOURCE_LABEL = { careers_site: 'Careers site', linkedin_member: 'LinkedIn (recruiter)', linkedin_org: 'LinkedIn (company page)', linkedin_feed: 'LinkedIn Jobs', naukri: 'Naukri', indeed: 'Indeed', google_jobs: 'Google for Jobs', referral: 'Employee referral', community: 'Talent community', campaign: 'Campaign', campus: 'Campus', mock: 'Mock board', embed: 'Website widget' };
const srcLabel = (s) => SOURCE_LABEL[s] || s;
const lines = (arr) => (arr || []).join('\n');
const unlines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

let ME = null;
let COMPANIES = [];

// ---------------- Router ----------------
const routes = [
  [/^#\/dashboard$/, viewDashboard, 'dashboard'],
  [/^#\/jobs$/, viewJobs, 'jobs'],
  [/^#\/jobs\/new$/, () => viewEditor(null), 'jobs'],
  [/^#\/jobs\/([^/]+)\/distribute$/, (m) => viewDistribute(decodeURIComponent(m[1])), 'jobs'],
  [/^#\/jobs\/([^/?]+)$/, (m) => viewEditor(decodeURIComponent(m[1])), 'jobs'],
  [/^#\/candidates/, viewCandidates, 'candidates'],
  [/^#\/channels/, viewChannels, 'channels'],
];
async function route() {
  const h = location.hash.split('?')[0] || '#/dashboard';
  const r = routes.find(([re]) => re.test(h)) || routes[0];
  $$('[data-nav]').forEach((a) => a.setAttribute('aria-current', a.dataset.nav === r[2] ? 'page' : 'false'));
  app.innerHTML = '<p class="muted"><span class="spin"></span> Loading…</p>';
  try { await r[1](h.match(r[0])); } catch (e) { app.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);

// ---------------- Dashboard ----------------
async function viewDashboard() {
  const d = await api('/dashboard');
  const k = d.kpis;
  const fmax = Math.max(1, ...d.funnel.map((f) => f.count));
  const smax = Math.max(1, ...d.sources.map((s) => s.applied));
  app.innerHTML = `
  <div class="sec-head" style="margin:0"><div><span class="eyebrow">Recruiter console</span><h2 style="margin-top:6px">Hiring at a glance</h2></div>
    <a class="btn btn-gold" href="#/jobs/new">New job</a></div>
  ${k.postingProblems ? `<div class="err-box">${k.postingProblems} channel post${k.postingProblems > 1 ? 's need' : ' needs'} attention. <a href="#/jobs">Open jobs</a> to retry or reconnect.</div>` : ''}
  <div class="kpis">${[[k.openRoles, 'Open roles'], [k.seats, 'Seats to fill'], [k.applications, 'Applications'], [k.newThisWeek, 'New in the last 7 days'], [k.hired, 'Hired'], [k.awaitingReview, 'Waiting over 3 days']].map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('')}</div>
  <div class="charts">
    <div class="panel"><div class="row between"><b>Pipeline funnel</b><span class="muted" style="font-size:.8rem">candidates who reached each stage</span></div>
      <div class="bars">${d.funnel.map((f) => `<div class="bar-row"><span>${esc(f.stage)}</span><div class="trk"><div class="fill ${f.stage === 'Hired' ? 'g' : ''}" style="width:${(f.count / fmax) * 100}%"></div></div><b>${f.count}</b></div>`).join('')}</div></div>
    <div class="panel"><div class="row between"><b>Channels that produce candidates</b><span class="muted" style="font-size:.8rem">applied · interviews · hired</span></div>
      <div class="bars">${d.sources.map((s) => `<div class="bar-row" style="grid-template-columns:150px 1fr 70px"><span>${esc(srcLabel(s.source))}</span><div class="trk"><div class="fill" style="width:${(s.applied / smax) * 100}%"></div></div><b class="mono" style="font-size:.78rem">${s.applied} · ${s.interviews} · ${s.hired}</b></div>`).join('') || '<p class="muted">No applications yet.</p>'}</div></div>
  </div>
  <div class="panel"><div class="row between"><b>Requisition tracker · seats filled vs open</b><div class="legend"><span style="--c:var(--ok)">Hired</span><span style="--c:var(--gold)">Offer out</span><span style="--c:var(--surface-2)">Still open</span></div></div>
    <div class="bars">${d.requisitions.map((r) => { const hw = (Math.min(r.hired, r.seats) / r.seats) * 100, ow = (Math.min(r.offers, Math.max(0, r.seats - r.hired)) / r.seats) * 100;
      return `<div class="req-row"><a href="#/jobs/${encodeURIComponent(r.id)}" style="min-width:0;color:inherit"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title)}</b><span class="muted mono" style="font-size:.74rem">${esc(r.id)}</span></a><div class="req-trk"><i class="h" style="width:${hw}%"></i><i class="p" style="width:${ow}%"></i></div><span class="num">${r.hired}/${r.seats}</span></div>`; }).join('')}</div></div>`;
}

// ---------------- Jobs list ----------------
async function viewJobs() {
  const { jobs } = await api('/jobs');
  const render = (filter) => {
    const list = jobs.filter((j) => !filter || j.status === filter);
    $('#jobRows').innerHTML = list.map((j) => {
      const ch = j.channels.reduce((a, c) => ((a[c.provider] = a[c.provider] === 'live' ? 'live' : c.status), a), {});
      return `<tr><td><a href="#/jobs/${encodeURIComponent(j.id)}"><b>${esc(j.title)}</b></a><div class="muted mono" style="font-size:.74rem">${esc(j.id)} · ${esc(j.company)}</div></td>
      <td>${badge(j.status)}</td><td>${esc(j.department)}</td><td class="num">${j.seats}</td><td class="num">${j.applications}</td>
      <td>${Object.entries(ch).map(([p, s]) => `<span class="badge ${esc(s)}" title="${esc(s)}">${esc(srcLabel(p))}</span>`).join(' ') || '<span class="muted">—</span>'}</td>
      <td style="white-space:nowrap"><a class="btn btn-ghost btn-sm" href="#/jobs/${encodeURIComponent(j.id)}">Edit</a> <a class="btn btn-ink btn-sm" href="#/jobs/${encodeURIComponent(j.id)}/distribute">Publish</a></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No jobs here.</td></tr>';
  };
  app.innerHTML = `
  <div class="sec-head" style="margin:0"><div><span class="eyebrow">Jobs</span><h2 style="margin-top:6px">Requisitions</h2></div><a class="btn btn-gold" href="#/jobs/new">New job</a></div>
  <div class="chips" id="stFilter">${['', 'draft', 'pending_approval', 'approved', 'open', 'closed', 'filled'].map((s) => `<button class="chip" type="button" data-s="${s}" aria-pressed="${s === ''}">${s ? esc(s.replace('_', ' ')) : 'All'} <i>${jobs.filter((j) => !s || j.status === s).length}</i></button>`).join('')}</div>
  <div class="tbl-wrap"><table class="t"><thead><tr><th>Role</th><th>Status</th><th>Department</th><th>Seats</th><th>Applicants</th><th>Channels</th><th></th></tr></thead><tbody id="jobRows"></tbody></table></div>`;
  $('#stFilter').onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; $$('#stFilter .chip').forEach((c) => c.setAttribute('aria-pressed', c === b)); render(b.dataset.s); };
  render('');
}

// ---------------- Job editor + JD studio ----------------
const EMPTY_SECTIONS = { opportunity: '', responsibilities: [], mustHave: [], niceToHave: [], whatWeLookFor: [], first90Days: [], offers: [], skills: [], assessment: '' };
let ed = null; // editor state

async function viewEditor(id) {
  const meta = await api('/me');
  let job, sections, company;
  if (id) {
    const r = await api(`/jobs/${encodeURIComponent(id)}`);
    job = r.job; sections = r.sections || { ...EMPTY_SECTIONS }; company = r.company;
  } else {
    job = { companyId: COMPANIES[0]?.id, title: '', department: '', location: 'Bengaluru', workMode: 'Onsite', shift: 'Day shift', expLabel: '0–2 yrs', expBand: 0, seats: 1, incentive: false, tags: [], summary: '', showSalary: false, salaryMin: null, salaryMax: null, status: 'draft' };
    sections = { ...EMPTY_SECTIONS };
  }
  ed = { id, job, sections, aiRunId: undefined, dirty: false };
  const f = job;
  const co = (cid) => COMPANIES.map((c) => `<option value="${esc(c.id)}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  app.innerHTML = `
  <div class="sec-head" style="margin:0"><div><span class="eyebrow">${id ? `${esc(id)} · ${esc(company?.name || '')}` : 'New job'}</span><h2 style="margin-top:6px">${id ? esc(f.title) : 'Write a job description'}</h2>
    <div class="row" style="margin-top:6px">${badge(f.status)} ${id ? `<a class="muted" style="font-size:.85rem" href="/jobs/${encodeURIComponent(id)}/${encodeURIComponent(f.slug || '')}" target="_blank" rel="noopener">${f.status === 'open' ? 'View live page ↗' : ''}</a>` : ''}</div></div>
    <div class="row" id="edActions"></div></div>
  <div class="ed">
    <form class="panel" id="jobForm" novalidate>
      <div class="grid2">
        <div class="field"><label for="fCo">Company</label><select id="fCo" ${id ? 'disabled' : ''}>${co(f.companyId)}</select></div>
        <div class="field"><label for="fTitle">Job title *</label><input id="fTitle" value="${esc(f.title)}" required></div>
        <div class="field"><label for="fDept">Department *</label><input id="fDept" value="${esc(f.department)}" list="deptList"><datalist id="deptList">${['Sales', 'Lead Generation', 'Account Management', 'Marketing', 'Data & Research', 'IT', 'HR', 'Recruitment', 'L&D', 'Customer Service', 'Leadership'].map((d) => `<option>${d}</option>`).join('')}</datalist></div>
        <div class="field"><label for="fLoc">Location *</label><input id="fLoc" value="${esc(f.location)}"></div>
      </div>
      <div class="grid3">
        <div class="field"><label for="fMode">Work mode</label><select id="fMode">${meta.workModes.map((m) => `<option ${m === f.workMode ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="field"><label for="fShift">Shift</label><input id="fShift" value="${esc(f.shift)}" list="shiftList"><datalist id="shiftList"><option>Day shift</option><option>US shift</option><option>UK shift</option><option>US / UK shift</option><option>Global</option></datalist></div>
        <div class="field"><label for="fSeats">Seats</label><input id="fSeats" type="number" min="1" value="${f.seats}"></div>
        <div class="field"><label for="fExp">Experience (shown)</label><input id="fExp" value="${esc(f.expLabel)}" placeholder="e.g. 1–3 yrs"></div>
        <div class="field"><label for="fBand">Experience band</label><select id="fBand">${meta.expBands.map((b, i) => `<option value="${i}" ${i === f.expBand ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
        <div class="field"><label class="consent" style="margin-top:22px"><input type="checkbox" id="fInc" ${f.incentive ? 'checked' : ''}> Incentive-eligible</label></div>
      </div>
      <div class="grid3">
        <div class="field"><label for="fSalMin">Salary min (₹/yr)</label><input id="fSalMin" type="number" min="0" value="${f.salaryMin ?? ''}"></div>
        <div class="field"><label for="fSalMax">Salary max (₹/yr)</label><input id="fSalMax" type="number" min="0" value="${f.salaryMax ?? ''}"></div>
        <div class="field"><label class="consent" style="margin-top:22px"><input type="checkbox" id="fShowSal" ${f.showSalary ? 'checked' : ''}> Show salary publicly</label></div>
      </div>
      <div class="field"><label for="fSum">Card summary * <span class="hint">one sentence, shown in search results</span></label><input id="fSum" maxlength="300" value="${esc(f.summary)}"></div>
      <div class="field"><label for="sOpp">The opportunity</label><textarea id="sOpp" rows="3">${esc(sections.opportunity)}</textarea></div>
      <div class="field"><label for="sResp">Key responsibilities <span class="hint">one per line</span></label><textarea id="sResp" rows="6">${esc(lines(sections.responsibilities))}</textarea></div>
      <div class="grid2">
        <div class="field"><label for="sMust">Must have <span class="hint">one per line</span></label><textarea id="sMust" rows="5">${esc(lines(sections.mustHave))}</textarea></div>
        <div class="field"><label for="sNice">Nice to have <span class="hint">one per line</span></label><textarea id="sNice" rows="5">${esc(lines(sections.niceToHave))}</textarea></div>
      </div>
      <div class="field"><label for="sLook">What we look for</label><textarea id="sLook" rows="3">${esc(lines(sections.whatWeLookFor))}</textarea></div>
      <div class="field"><label for="s90">First 90 days <span class="hint">one per line: 30 | outcome | measure</span></label><textarea id="s90" rows="3">${esc((sections.first90Days || []).map((x) => `${x.by} | ${x.outcome} | ${x.measure}`).join('\n'))}</textarea></div>
      <div class="field"><label for="sOffers">What we offer <span class="hint">from the company profile; one per line</span></label><textarea id="sOffers" rows="4">${esc(lines(sections.offers))}</textarea></div>
      <div class="grid2">
        <div class="field"><label for="sSkills">Skills / tags <span class="hint">comma separated</span></label><input id="sSkills" value="${esc((sections.skills || []).join(', '))}"></div>
        <div class="field"><label for="sAssess">Assessment</label><input id="sAssess" value="${esc(sections.assessment || '')}"></div>
      </div>
      <p class="err" id="fErr" hidden></p>
    </form>
    <aside class="panel studio" id="studio">
      <div><span class="eyebrow">JD studio · AI assistant ${meta.ai === 'mock' ? '<span class="mock-flag">mock mode</span>' : ''}</span>
        <p class="muted" style="font-size:.84rem;margin-top:4px">${meta.ai === 'mock' ? 'No Claude API key is set, so suggestions are templates. Add ANTHROPIC_API_KEY to .dev.vars for real drafts.' : 'Claude drafts and suggests; you decide what goes in. It never invents pay or benefits.'}</p></div>
      <div class="field"><label for="brief">Brief</label><textarea id="brief" placeholder="e.g. Need 15 Lead Generation Executives for LakeB2B, US shift, Bengaluru, freshers OK, incentive on meetings booked"></textarea></div>
      <div class="row"><button class="btn btn-gold btn-sm" type="button" id="aiDraft">Draft from brief</button><button class="btn btn-ghost btn-sm" type="button" id="aiTask">Make it task-specific</button><button class="btn btn-ghost btn-sm" type="button" id="aiReview">Review</button></div>
      <div class="ai-out" id="aiOut"></div>
    </aside>
  </div>`;
  renderEdActions();
  $('#jobForm').addEventListener('input', () => { ed.dirty = true; });
  $('#aiDraft').onclick = aiDraft;
  $('#aiTask').onclick = aiTaskify;
  $('#aiReview').onclick = aiReview;
}

function renderEdActions() {
  const s = ed.job.status, id = ed.id, role = ME.role;
  const btns = [`<button class="btn btn-ink" type="button" id="bSave">${id ? 'Save changes' : 'Save draft'}</button>`];
  if (id && s === 'draft') btns.push('<button class="btn btn-ghost" type="button" id="bSubmit">Submit for approval</button>');
  if (id && s === 'pending_approval' && (role === 'admin' || role === 'hiring_manager')) btns.push('<button class="btn btn-ghost" type="button" id="bApprove">Approve</button>');
  if (id && !['closed', 'filled'].includes(s)) btns.push(`<a class="btn btn-gold" href="#/jobs/${encodeURIComponent(id)}/distribute">Publish →</a>`);
  if (id && s === 'open') btns.push('<button class="btn btn-ghost" type="button" id="bFilled">Mark filled</button><button class="btn btn-ghost" type="button" id="bClose">Close</button>');
  if (id && ['closed', 'filled'].includes(s)) btns.push('<button class="btn btn-ghost" type="button" id="bReopen">Reopen</button>');
  $('#edActions').innerHTML = btns.join('');
  $('#bSave').onclick = saveJob;
  const on = (sel, fn) => { const b = $(sel); if (b) b.onclick = fn; };
  on('#bSubmit', async () => { await saveJob(); await post(`/jobs/${encodeURIComponent(id)}/submit`); toast('Submitted for approval'); route(); });
  on('#bApprove', async () => { await post(`/jobs/${encodeURIComponent(id)}/approve`); toast('Approved. Ready to publish.'); route(); });
  on('#bFilled', () => closeJob('filled'));
  on('#bClose', () => closeJob('closed'));
  on('#bReopen', async () => { await post(`/jobs/${encodeURIComponent(id)}/reopen`); toast('Reopened as a draft'); route(); });
}

async function closeJob(status) {
  if (!confirm(status === 'filled' ? 'Mark this role filled? It will come off the careers site and every channel that supports removal.' : 'Close this role? It will come off the careers site and every channel that supports removal.')) return;
  const r = await post(`/jobs/${encodeURIComponent(ed.id)}/close`, { status });
  toast(`Closed. Removing from ${r.closing} channel(s).`);
  route();
}

function readForm() {
  const n = (v) => (v === '' ? null : Number(v));
  const ninety = unlines($('#s90').value).map((l) => { const [by, outcome, measure] = l.split('|').map((x) => (x || '').trim()); return { by: ['30', '60', '90'].includes(by) ? by : '30', outcome: outcome || '', measure: measure || '' }; }).filter((x) => x.outcome);
  return {
    companyId: $('#fCo').value, title: $('#fTitle').value.trim(), department: $('#fDept').value.trim(), location: $('#fLoc').value.trim(),
    workMode: $('#fMode').value, shift: $('#fShift').value.trim(), seats: Number($('#fSeats').value) || 1, expLabel: $('#fExp').value.trim(), expBand: Number($('#fBand').value),
    incentive: $('#fInc').checked, salaryMin: n($('#fSalMin').value), salaryMax: n($('#fSalMax').value), showSalary: $('#fShowSal').checked,
    summary: $('#fSum').value.trim(),
    tags: $('#sSkills').value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12),
    sections: {
      opportunity: $('#sOpp').value.trim(), responsibilities: unlines($('#sResp').value), mustHave: unlines($('#sMust').value), niceToHave: unlines($('#sNice').value),
      whatWeLookFor: unlines($('#sLook').value), first90Days: ninety, offers: unlines($('#sOffers').value),
      skills: $('#sSkills').value.split(',').map((x) => x.trim()).filter(Boolean), assessment: $('#sAssess').value.trim(),
    },
    aiRunId: ed.aiRunId,
  };
}

async function saveJob() {
  const body = readForm(), err = $('#fErr');
  const miss = [];
  if (body.title.length < 3) miss.push('a title');
  if (body.department.length < 2) miss.push('a department');
  if (body.summary.length < 10) miss.push('a card summary (10+ characters)');
  if (!body.sections.responsibilities.length) miss.push('at least one responsibility');
  if (miss.length) { err.hidden = false; err.textContent = 'Add ' + miss.join(', ') + '.'; throw new Error('validation'); }
  err.hidden = true;
  try {
    if (ed.id) { await put(`/jobs/${encodeURIComponent(ed.id)}`, body); toast('Saved'); ed.dirty = false; }
    else { const r = await post('/jobs', body); toast(`Draft ${r.id} created`); location.hash = `#/jobs/${encodeURIComponent(r.id)}`; }
  } catch (e) { err.hidden = false; err.textContent = e.message; throw e; }
}

function setBusy(btn, busy, label) { btn.disabled = busy; if (busy) { btn.dataset.l = btn.textContent; btn.innerHTML = `<span class="spin"></span> ${label || 'Working…'}`; } else btn.textContent = btn.dataset.l || btn.textContent; }

function fillSections(s) {
  if (s.opportunity != null) $('#sOpp').value = s.opportunity;
  if (s.responsibilities) $('#sResp').value = lines(s.responsibilities);
  if (s.mustHave) $('#sMust').value = lines(s.mustHave);
  if (s.niceToHave) $('#sNice').value = lines(s.niceToHave);
  if (s.whatWeLookFor) $('#sLook').value = lines(s.whatWeLookFor);
  if (s.first90Days) $('#s90').value = s.first90Days.map((x) => `${x.by} | ${x.outcome} | ${x.measure}`).join('\n');
  if (s.offers) $('#sOffers').value = lines(s.offers);
  if (s.skills) $('#sSkills').value = s.skills.join(', ');
  if (s.assessment != null) $('#sAssess').value = s.assessment;
}

function openQuestions(qs) {
  return qs?.length ? `<div class="oq"><b>Confirm before publishing</b><ul>${qs.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>` : '';
}

async function aiDraft(e) {
  const brief = $('#brief').value.trim();
  if (brief.length < 10) { toast('Write a short brief first (who, how many, where, shift).'); return; }
  if (ed.dirty && !confirm('Replace what is in the form with the AI draft?')) return;
  setBusy(e.target, true, 'Drafting…');
  try {
    const r = await post('/ai/draft', { companyId: $('#fCo').value, brief, department: $('#fDept').value.trim() || undefined });
    const d = r.output;
    $('#fTitle').value = d.title; $('#fDept').value = d.department; $('#fLoc').value = d.location; $('#fMode').value = d.workMode; $('#fShift').value = d.shift;
    $('#fSeats').value = d.seats; $('#fExp').value = d.expLabel; $('#fBand').value = String(Math.max(0, Math.min(3, d.expBand))); $('#fInc').checked = d.incentive; $('#fSum').value = d.summary;
    fillSections(d.sections);
    ed.aiRunId = r.runId; ed.dirty = true;
    $('#aiOut').innerHTML = `<div class="ok-box">Draft filled in${r.cached ? ' (from cache)' : ''}. Read it through and edit anything that isn't right.</div>${openQuestions(d.openQuestions)}`;
  } catch (x) { $('#aiOut').innerHTML = `<div class="err-box">${esc(x.message)}</div>`; }
  finally { setBusy(e.target, false); }
}

function aiInput() {
  const f = readForm();
  return { companyId: f.companyId, title: f.title || 'Untitled role', department: f.department || 'General', summary: f.summary, showSalary: f.showSalary, sections: f.sections };
}

async function aiTaskify(e) {
  const input = aiInput();
  if (!input.sections.responsibilities.length) { toast('Add some responsibilities first, or draft from a brief.'); return; }
  setBusy(e.target, true, 'Thinking…');
  try {
    const { output: o } = await post('/ai/taskify', input);
    const fieldFor = { responsibilities: '#sResp', mustHave: '#sMust', niceToHave: '#sNice' };
    $('#aiOut').innerHTML = `<b>Task-specific rewrites</b>${o.rewrites.length ? '' : '<p class="muted">Every line is already specific.</p>'}
      ${o.rewrites.map((r, i) => `<div class="sugg" data-i="${i}"><del>${esc(r.original)}</del><ins>${esc(r.rewritten)}</ins><span class="why">${esc(r.why)}</span><div class="row"><button class="btn btn-ink btn-sm" type="button" data-acc="${i}">Accept</button><button class="btn btn-ghost btn-sm" type="button" data-skip="${i}">Skip</button></div></div>`).join('')}
      <div class="sugg"><b>First 90 days</b>${o.first90Days.map((x) => `<span>By day ${esc(x.by)}: ${esc(x.outcome)} <span class="why">(${esc(x.measure)})</span></span>`).join('')}<div><button class="btn btn-ghost btn-sm" type="button" id="acc90">Use these</button></div></div>
      <div class="sugg"><b>Assessment</b><span>${esc(o.assessment)}</span><div><button class="btn btn-ghost btn-sm" type="button" id="accAss">Use this</button></div></div>
      ${openQuestions(o.openQuestions)}`;
    $('#aiOut').onclick = (ev) => {
      const a = ev.target.closest('[data-acc]'), s = ev.target.closest('[data-skip]');
      if (a) { const r = o.rewrites[+a.dataset.acc]; const el = $(fieldFor[r.section]); const ls = el.value.split('\n'); const ix = ls.findIndex((l) => l.trim() === r.original.trim()); if (ix > -1) ls[ix] = r.rewritten; else ls.push(r.rewritten); el.value = ls.join('\n'); ed.dirty = true; a.closest('.sugg').remove(); }
      if (s) s.closest('.sugg').remove();
      if (ev.target.id === 'acc90') { $('#s90').value = o.first90Days.map((x) => `${x.by} | ${x.outcome} | ${x.measure}`).join('\n'); ed.dirty = true; toast('First 90 days updated'); }
      if (ev.target.id === 'accAss') { $('#sAssess').value = o.assessment; ed.dirty = true; toast('Assessment updated'); }
    };
  } catch (x) { $('#aiOut').innerHTML = `<div class="err-box">${esc(x.message)}</div>`; }
  finally { setBusy(e.target, false); }
}

async function aiReview(e) {
  setBusy(e.target, true, 'Reviewing…');
  try {
    const { output: o } = await post('/ai/review', aiInput());
    const sc = o.scores;
    $('#aiOut').innerHTML = `<div class="row between"><b>Review</b><span class="score" style="font-size:1rem">${o.overall}/100</span></div><p style="font-size:.88rem">${esc(o.verdict)}</p>
      <div class="scores">${[['Clarity', sc.clarity], ['Specific', sc.specificity], ['Complete', sc.completeness], ['Inclusive', sc.inclusiveLanguage], ['Length', sc.length]].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
      ${o.missing.length ? `<div class="oq"><b>Missing or needs fixing</b><ul>${o.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
      ${o.suggestions.map((s, i) => `<div class="sugg"><span class="eyebrow">${esc(s.kind)} · ${esc(s.section)}</span><del>${esc(s.original)}</del><ins>${esc(s.suggestion)}</ins><span class="why">${esc(s.reason)}</span><div><button class="btn btn-ink btn-sm" type="button" data-rv="${i}">Apply</button></div></div>`).join('')}`;
    $('#aiOut').onclick = (ev) => {
      const b = ev.target.closest('[data-rv]'); if (!b) return;
      const s = o.suggestions[+b.dataset.rv];
      const el = $$('#jobForm textarea, #jobForm input').find((x) => x.value.includes(s.original));
      if (el) { el.value = el.value.replace(s.original, s.suggestion); ed.dirty = true; b.closest('.sugg').remove(); toast('Applied'); }
      else toast('That line has changed since the review. Edit it by hand.');
    };
  } catch (x) { $('#aiOut').innerHTML = `<div class="err-box">${esc(x.message)}</div>`; }
  finally { setBusy(e.target, false); }
}

// ---------------- Distribution ----------------
async function viewDistribute(id) {
  const [{ job, postings, company }, ch] = await Promise.all([api(`/jobs/${encodeURIComponent(id)}`), api('/channels')]);
  const usable = ch.connections.filter((c) => (c.companyId === job.companyId || c.companyId === 'co_champions') && c.status !== 'revoked');
  const adapters = Object.fromEntries(ch.adapters.map((a) => [a.provider, a]));
  const profile = ch.profiles.find((p) => p.companyId === job.companyId && p.department === job.department) || ch.profiles.find((p) => p.companyId === job.companyId && !p.department) || ch.profiles.find((p) => p.companyId === 'co_champions');
  const preselect = new Set(profile ? profile.connectionIds : []);
  const closed = ['closed', 'filled'].includes(job.status);
  app.innerHTML = `
  <div class="sec-head" style="margin:0"><div><span class="eyebrow">${esc(job.id)} · ${esc(company.name)} · Publish</span><h2 style="margin-top:6px">${esc(job.title)}</h2><div class="row" style="margin-top:6px">${badge(job.status)} <a class="muted" href="#/jobs/${encodeURIComponent(id)}" style="font-size:.85rem">← Back to the JD</a></div></div></div>
  ${closed ? '<div class="err-box">This job is closed. Reopen it from the JD page to publish again.</div>' : ''}
  ${['draft', 'pending_approval'].includes(job.status) && company.requireApproval ? '<div class="err-box">This company requires approval before publishing. Submit the job for approval on the JD page.</div>' : ''}
  <div class="panel">
    <div class="row between"><b>Choose channels</b><a class="muted" href="#/channels" style="font-size:.85rem">Connect more channels →</a></div>
    <div class="stack" id="chanList">${usable.map((c) => {
      const a = adapters[c.provider]; const bad = ['expired', 'error'].includes(c.status);
      return `<div class="chan ${a ? '' : 'off'}" data-conn="${esc(c.id)}" data-provider="${esc(c.provider)}">
        <input type="checkbox" aria-label="Post to ${esc(c.displayName)}" ${a && !bad && preselect.has(c.id) ? 'checked' : ''} ${!a || bad || closed ? 'disabled' : ''}>
        <div style="min-width:0"><b>${esc(c.displayName)}</b> <span class="muted" style="font-size:.8rem">${esc(a ? a.label : c.provider)}</span> ${bad ? badge(c.status) : ''}
          ${a?.needsCopy ? `<div class="copy" data-copy="${esc(c.id)}" style="margin-top:8px;display:grid;gap:8px"><div class="row"><button class="btn btn-ghost btn-sm" type="button" data-gen="${esc(c.id)}">Write with AI</button><span class="muted" style="font-size:.78rem">Use <code>{{link}}</code> where the tracked job link goes.</span></div>
            <div class="field"><textarea aria-label="Post text for ${esc(c.displayName)}" data-text="${esc(c.id)}" placeholder="Post text…"></textarea></div><input data-tags="${esc(c.id)}" placeholder="hashtags, comma separated" style="border:1px solid var(--line);border-radius:8px;padding:7px 10px">
            ${c.provider.startsWith('linkedin') ? `<div class="li-preview" data-prev="${esc(c.id)}"><span class="muted">Preview appears here.</span></div>` : ''}</div>` : `<div class="muted" style="font-size:.82rem;margin-top:4px">${a?.mode === 'owned' ? 'Goes live on the careers site and notifies company websites.' : a?.mode === 'feed' ? 'Uses the job page markup; Google is pinged on publish and close.' : ''}</div>`}
        </div><span></span></div>`;
    }).join('') || '<p class="muted">No channels connected for this company yet.</p>'}</div>
    <div class="grid2"><div class="field"><label for="when">When</label><select id="when"><option value="now">Publish now</option><option value="later">Schedule…</option></select></div><div class="field" id="atRow" hidden><label for="at">Date and time</label><input id="at" type="datetime-local"></div></div>
    <p class="err" id="pErr" hidden></p>
    <div class="row"><button class="btn btn-gold" type="button" id="bPublish" ${closed ? 'disabled' : ''}>Publish to selected channels</button></div>
  </div>
  <div class="panel"><div class="row between"><b>Where this job is posted</b><button class="btn btn-ghost btn-sm" type="button" id="bRefresh">Refresh</button></div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Channel</th><th>Status</th><th>Run</th><th>Posted</th><th>Link</th><th></th></tr></thead><tbody id="postRows"></tbody></table></div></div>`;

  const renderPosts = (ps) => {
    $('#postRows').innerHTML = ps.map((p) => `<tr><td>${esc(p.connection)}<div class="muted" style="font-size:.74rem">${esc(srcLabel(p.provider))}</div></td>
      <td>${badge(p.status)}${p.lastError ? `<div class="muted" style="font-size:.76rem;max-width:380px">${esc(p.lastError)}</div>` : ''}${p.status === 'stale' ? '<div class="muted" style="font-size:.76rem">JD changed after posting. Re-share to post the new version.</div>' : ''}</td>
      <td class="num">${p.run}</td><td>${p.publishedAt ? fmtDate(p.publishedAt) : p.scheduledAt ? `scheduled ${fmtDate(p.scheduledAt)}` : '—'}</td>
      <td>${p.externalUrl ? `<a href="${esc(p.externalUrl)}" target="_blank" rel="noopener">Open ↗</a>` : '—'}</td>
      <td>${['failed', 'needs_reauth'].includes(p.status) ? `<button class="btn btn-ghost btn-sm" type="button" data-retry="${esc(p.id)}">${p.status === 'needs_reauth' ? 'Retry after reconnecting' : 'Retry'}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:18px">Not posted anywhere yet.</td></tr>';
  };
  renderPosts(postings);
  const refresh = async () => renderPosts((await api(`/jobs/${encodeURIComponent(id)}`)).postings);
  $('#bRefresh').onclick = refresh;
  $('#postRows').onclick = async (e) => { const b = e.target.closest('[data-retry]'); if (!b) return; try { await post(`/postings/${encodeURIComponent(b.dataset.retry)}/retry`); toast('Retrying'); setTimeout(refresh, 2500); } catch (x) { toast(x.message); } };
  $('#when').onchange = (e) => { $('#atRow').hidden = e.target.value !== 'later'; };

  const preview = (cid) => {
    const el = $(`[data-prev="${CSS.escape(cid)}"]`); if (!el) return;
    const text = $(`[data-text="${CSS.escape(cid)}"]`).value.replaceAll('{{link}}', `${location.origin}/jobs/${job.id}/${job.slug}?src=…`);
    const tags = $(`[data-tags="${CSS.escape(cid)}"]`).value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    el.innerHTML = `${esc(text) || '<span class="muted">Preview appears here.</span>'}${tags.length ? `<div class="tags">${tags.map((t) => '#' + esc(t)).join(' ')}</div>` : ''}<div class="li-card"><div><b>${esc(job.title)} · ${esc(company.name)}</b><br><span class="muted">${esc(location.host)}</span></div></div>`;
  };
  $('#chanList').addEventListener('input', (e) => { const c = e.target.dataset.text || e.target.dataset.tags; if (c) preview(c); });
  $('#chanList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-gen]'); if (!b) return;
    const cid = b.dataset.gen, provider = b.closest('[data-provider]').dataset.provider;
    setBusy(b, true, 'Writing…');
    try {
      const { output } = await post('/ai/copy', { jobId: job.id, provider });
      const box = b.closest('.copy');
      let i = 0;
      const show = () => { const v = output.variants[i]; $(`[data-text="${CSS.escape(cid)}"]`).value = v.text; $(`[data-tags="${CSS.escape(cid)}"]`).value = v.hashtags.join(', '); preview(cid); };
      show();
      if (output.variants.length > 1 && !box.querySelector('[data-var]')) {
        const sw = document.createElement('button'); sw.type = 'button'; sw.className = 'btn btn-ghost btn-sm'; sw.dataset.var = '1'; sw.textContent = 'Try the other version';
        sw.onclick = () => { i = (i + 1) % output.variants.length; show(); };
        b.after(sw);
      }
    } catch (x) { toast(x.message); } finally { setBusy(b, false); }
  });
  $('#bPublish').onclick = async (e) => {
    const err = $('#pErr'); err.hidden = true;
    const chosen = $$('#chanList .chan').filter((el) => el.querySelector('input[type=checkbox]')?.checked);
    if (!chosen.length) { err.hidden = false; err.textContent = 'Pick at least one channel.'; return; }
    const copies = {};
    for (const el of chosen) {
      const cid = el.dataset.conn; const t = el.querySelector(`[data-text]`);
      if (t) copies[cid] = { text: t.value.trim(), hashtags: el.querySelector('[data-tags]').value.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean) };
    }
    let scheduleAt = null;
    if ($('#when').value === 'later') { const v = $('#at').value; if (!v) { err.hidden = false; err.textContent = 'Pick a date and time.'; return; } scheduleAt = new Date(v).getTime(); }
    setBusy(e.target, true, 'Publishing…');
    try {
      const r = await post(`/jobs/${encodeURIComponent(id)}/publish`, { connectionIds: chosen.map((el) => el.dataset.conn), copies, scheduleAt }, { 'idempotency-key': crypto.randomUUID() });
      toast(`${r.postings.length} post${r.postings.length === 1 ? '' : 's'} ${scheduleAt ? 'scheduled' : 'queued'}${r.skipped ? ` · ${r.skipped} already live` : ''}`);
      setTimeout(refresh, 1500); setTimeout(refresh, 5000);
    } catch (x) { err.hidden = false; err.textContent = x.message; }
    finally { setBusy(e.target, false); }
  };
}

// ---------------- Candidates ----------------
async function viewCandidates() {
  const meta = await api('/me');
  const { jobs } = await api('/jobs');
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  app.innerHTML = `
  <div class="sec-head" style="margin:0"><div><span class="eyebrow">Candidates</span><h2 style="margin-top:6px">Applications</h2></div>
    <p class="muted" style="max-width:52ch">A recruiter makes every decision. Candidates marked “human-only” asked not to have AI-assisted matching.</p></div>
  <div class="toolbar"><input id="cq" placeholder="Search name, email, city" aria-label="Search candidates"><select id="cJob" aria-label="Filter by job"><option value="">All jobs</option>${jobs.map((j) => `<option value="${esc(j.id)}" ${params.get('job') === j.id ? 'selected' : ''}>${esc(j.title)} (${esc(j.id)})</option>`).join('')}</select>
    <select id="cStage" aria-label="Filter by stage"><option value="">Any stage</option>${meta.stages.map((s) => `<option>${s}</option>`).join('')}</select>
    <select id="cConsent" aria-label="Filter by consent"><option value="">Any consent</option><option value="1">Opted in to campaigns</option><option value="0">Not opted in</option></select></div>
  <div class="tbl-wrap"><table class="t"><thead><tr><th>Candidate</th><th>Applied for</th><th>Exp</th><th>Source</th><th>Applied</th><th>Opt-in</th><th>Stage</th></tr></thead><tbody id="cRows"></tbody></table></div>
  <p class="muted" style="font-size:.82rem" id="cFoot"></p>`;
  const load = async () => {
    const q = new URLSearchParams({ q: $('#cq').value.trim(), job: $('#cJob').value, stage: $('#cStage').value, consent: $('#cConsent').value });
    [...q.keys()].forEach((k) => { if (!q.get(k)) q.delete(k); });
    const { applications } = await api('/applications?' + q);
    $('#cRows').innerHTML = applications.map((a) => `<tr>
      <td><b>${esc(a.candidate.name)}</b>${a.candidate.humanOnlyReview ? ' <span class="badge stale">human-only</span>' : ''}<div class="muted" style="font-size:.76rem">${esc(a.candidate.email)} · ${esc(a.candidate.phone || '')} · ${esc(a.candidate.city || '')}</div>
        <div class="row" style="gap:6px;margin-top:4px">${a.candidate.hasCv ? `<a class="btn btn-ghost btn-sm" href="/api/console/candidates/${encodeURIComponent(a.candidate.id)}/cv" target="_blank" rel="noopener">CV</a>` : ''}${a.candidate.linkedinUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(/^https?:/.test(a.candidate.linkedinUrl) ? a.candidate.linkedinUrl : 'https://' + a.candidate.linkedinUrl)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>` : ''}<button class="btn btn-ghost btn-sm" type="button" data-hist="${esc(a.id)}">History</button></div>
        ${a.candidate.pitch ? `<div class="muted" style="font-size:.78rem;margin-top:4px">“${esc(a.candidate.pitch)}”</div>` : ''}</td>
      <td><a href="#/jobs/${encodeURIComponent(a.job.id)}">${esc(a.job.title)}</a><div class="muted mono" style="font-size:.72rem">${esc(a.id)}</div></td>
      <td class="num">${esc(a.candidate.expYears ?? '—')}</td><td>${esc(srcLabel(a.source))}</td><td>${daysAgo(a.createdAt)}</td>
      <td>${a.candidate.campaigns ? '✓' : '<span class="muted">—</span>'}</td>
      <td><select data-app="${esc(a.id)}" aria-label="Stage for ${esc(a.candidate.name)}">${meta.stages.map((s) => `<option ${s === a.stage ? 'selected' : ''}>${s}</option>`).join('')}</select>${['Applied', 'Screening'].includes(a.stage) && Date.now() - a.createdAt > 3 * 864e5 ? '<span class="sla" title="Waiting more than 3 days">SLA</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No candidates match these filters.</td></tr>';
    $('#cFoot').textContent = `${applications.length} application${applications.length === 1 ? '' : 's'}`;
  };
  let t;
  $('#cq').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  ['#cJob', '#cStage', '#cConsent'].forEach((s) => ($(s).onchange = load));
  $('#cRows').onchange = async (e) => {
    const s = e.target.closest('[data-app]'); if (!s) return;
    try { await api(`/applications/${encodeURIComponent(s.dataset.app)}`, { method: 'PATCH', body: JSON.stringify({ stage: s.value }) }); toast(`Moved to ${s.value}`); } catch (x) { toast(x.message); load(); }
  };
  $('#cRows').onclick = async (e) => {
    const b = e.target.closest('[data-hist]'); if (!b) return;
    const { history } = await api(`/applications/${encodeURIComponent(b.dataset.hist)}/history`);
    modal(`<div class="modal-head"><div class="row between"><h3>Stage history</h3><button class="x" type="button" data-close aria-label="Close">✕</button></div></div><div class="modal-body">${history.map((h) => `<div class="match-row"><b>${esc(h.fromStage || '—')} → ${esc(h.toStage)}<br><span class="muted" style="font-weight:500;font-size:.78rem">${esc(h.byUser || '')} · ${fmtDate(h.at)}${h.note ? ' · ' + esc(h.note) : ''}</span></b></div>`).join('')}</div>`);
  };
  await load();
}

// ---------------- Channels ----------------
async function viewChannels() {
  const ch = await api('/channels');
  const { endpoints, deliveries } = await api('/webhooks');
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const co = (id) => COMPANIES.find((c) => c.id === id)?.name || id;
  const days = (ts) => Math.ceil((ts - Date.now()) / 864e5);
  app.innerHTML = `
  <div class="sec-head" style="margin:0"><div><span class="eyebrow">Channels</span><h2 style="margin-top:6px">Connected accounts</h2></div>
    <p class="muted" style="max-width:56ch">Connect each channel once. Tokens are encrypted and never leave the server. LinkedIn logins last about 60 days; we remind you to reconnect.</p></div>
  ${params.get('error') ? `<div class="err-box">LinkedIn: ${esc(params.get('error'))}</div>` : ''}${params.get('connected') ? '<div class="ok-box">Connected.</div>' : ''}
  <div class="cards">${ch.connections.filter((c) => c.status !== 'revoked').map((c) => `<div class="card"><div class="row between"><h4>${esc(c.displayName)}</h4>${badge(c.status)}</div>
    <span class="muted" style="font-size:.82rem">${esc(srcLabel(c.provider))} · ${esc(co(c.companyId))}</span>
    ${c.expiresAt ? `<span style="font-size:.82rem">${days(c.expiresAt) > 0 ? `Expires in ${days(c.expiresAt)} days` : 'Expired'}</span>` : ''}
    ${c.lastOkAt ? `<span class="muted" style="font-size:.78rem">Last successful post ${fmtDate(c.lastOkAt)}</span>` : ''}
    ${['owned_site', 'google_jobs'].includes(c.provider) ? '' : `<div class="row">${c.provider.startsWith('linkedin') && ch.linkedinConfigured ? `<a class="btn btn-ghost btn-sm" href="/oauth/linkedin/start?companyId=${encodeURIComponent(c.companyId)}&kind=${encodeURIComponent(c.provider)}${c.provider === 'linkedin_org' ? '&orgUrn=' + encodeURIComponent(c.accountRef) : ''}">Reconnect</a>` : ''}<button class="btn btn-ghost btn-sm" type="button" data-disc="${esc(c.id)}">Disconnect</button></div>`}</div>`).join('')}</div>
  <div class="panel"><b>Connect a channel</b>
    <div class="grid2"><div class="field"><label for="connCo">For company</label><select id="connCo">${COMPANIES.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="orgUrn">Company page URN <span class="hint">only for LinkedIn company pages</span></label><input id="orgUrn" placeholder="urn:li:organization:12345"></div></div>
    <div class="row">
      ${ch.linkedinConfigured ? '<button class="btn btn-ink btn-sm" type="button" id="liMember">Connect my LinkedIn profile</button><button class="btn btn-ghost btn-sm" type="button" id="liOrg">Connect a LinkedIn company page</button>' : '<span class="muted" style="font-size:.85rem">LinkedIn app credentials are not set (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET).</span>'}
      ${ch.mockAvailable ? '<button class="btn btn-ghost btn-sm" type="button" id="mockMember">Connect mock LinkedIn profile</button><button class="btn btn-ghost btn-sm" type="button" id="mockOrg">Connect mock LinkedIn page</button>' : ''}
    </div>
    <div class="row"><button class="btn btn-ghost btn-sm" type="button" data-kc="linkedin_feed">LinkedIn Jobs feed</button><button class="btn btn-ghost btn-sm" type="button" data-kc="indeed">Indeed</button><button class="btn btn-ghost btn-sm" type="button" data-kc="naukri">Naukri</button><button class="btn btn-ghost btn-sm" type="button" data-kc="webhook">Custom webhook</button>
      ${ch.mockAvailable ? '<button class="btn btn-ghost btn-sm" type="button" id="mockBoards">Connect mock Indeed + Naukri</button>' : ''}</div>
    <p class="muted" style="font-size:.8rem">Feeds: register <code>${esc(location.origin)}/feeds/linkedin.xml</code> with LinkedIn (Limited Listings) and <code>/feeds/indeed.xml</code> with Indeed. Naukri and the Indeed Job Sync API need credentials issued by those companies.</p></div>
  <div class="panel"><div class="row between"><b>Company websites (webhooks)</b>${ME.role === 'admin' ? '<button class="btn btn-ghost btn-sm" type="button" id="addHook">Add website</button>' : ''}</div>
    <p class="muted" style="font-size:.84rem">Websites that keep their own copy of jobs get a signed POST on publish, update and close. Others can embed the job list or read <code>/api/public/v1/jobs?company=slug</code>.</p>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Company</th><th>URL</th><th>Events</th><th></th></tr></thead><tbody>${endpoints.filter((e) => e.active).map((e) => `<tr><td>${esc(co(e.companyId))}</td><td class="mono" style="font-size:.78rem">${esc(e.url)}</td><td>${e.events.map(esc).join(', ')}</td><td>${ME.role === 'admin' ? `<button class="btn btn-ghost btn-sm" type="button" data-unhook="${esc(e.id)}">Remove</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:16px">No websites registered.</td></tr>'}</tbody></table></div>
    ${deliveries.length ? `<details><summary class="muted" style="font-size:.84rem">Recent deliveries</summary>${deliveries.slice(0, 10).map((d) => `<div class="mono muted" style="font-size:.76rem">${fmtDate(d.at)} · ${esc(d.event)} · ${d.status || 'no response'} ${d.lastError ? '· ' + esc(d.lastError) : ''}</div>`).join('')}</details>` : ''}</div>`;
  const on = (sel, fn) => { const b = $(sel); if (b) b.onclick = fn; };
  on('#liMember', () => { location.href = `/oauth/linkedin/start?companyId=${encodeURIComponent($('#connCo').value)}&kind=linkedin_member`; });
  on('#liOrg', () => { const u = $('#orgUrn').value.trim(); if (!/^urn:li:organization:\d+$/.test(u)) { toast('Enter the company page URN first'); return; } location.href = `/oauth/linkedin/start?companyId=${encodeURIComponent($('#connCo').value)}&kind=linkedin_org&orgUrn=${encodeURIComponent(u)}`; });
  on('#mockMember', async () => { await post('/channels/mock-linkedin', { companyId: $('#connCo').value, kind: 'linkedin_member' }); toast('Mock LinkedIn profile connected'); route(); });
  on('#mockOrg', async () => { await post('/channels/mock-linkedin', { companyId: $('#connCo').value, kind: 'linkedin_org' }); toast('Mock LinkedIn page connected'); route(); });
  on('#mockBoards', async () => {
    const companyId = $('#connCo').value, base = 'http://localhost:9000';
    // The Worker reaches the mock server by the URL it was configured with (MOCK_CHANNELS_URL).
    const mockBase = ch.mockBase || base;
    await post('/channels/connect', { companyId, provider: 'indeed', displayName: 'Indeed (mock Job Sync API)', accountRef: 'mock-employer', secret: 'mock-secret', config: { mode: 'api', apiBase: `${mockBase}/indeed`, clientId: 'mock-client' } });
    await post('/channels/connect', { companyId, provider: 'naukri', displayName: 'Naukri (mock)', accountRef: 'mock-naukri', secret: 'mock-key', config: { apiBase: `${mockBase}/naukri` } });
    toast('Mock Indeed and Naukri connected'); route();
  });
  app.querySelectorAll('[data-kc]').forEach((b) => (b.onclick = () => connectForm(b.dataset.kc)));
  on('#addHook', () => {
    modal(`<div class="modal-head"><div class="row between"><h3>Add a company website</h3><button class="x" type="button" data-close aria-label="Close">✕</button></div></div>
      <form class="modal-body" id="hookForm"><div class="field"><label for="hCo">Company</label><select id="hCo">${COMPANIES.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="hUrl">Webhook URL</label><input id="hUrl" type="url" placeholder="https://www.lakeb2b.com/wp-json/talenthub/v1/jobs"></div>
      <p class="err" id="hErr" hidden></p><div><button class="btn btn-gold" type="submit">Add</button></div></form>`);
    $('#hookForm').onsubmit = async (e) => {
      e.preventDefault();
      try { const r = await post('/webhooks', { companyId: $('#hCo').value, url: $('#hUrl').value.trim(), events: ['*'] });
        $('#modal').innerHTML = `<div class="modal-body"><h3>Website added</h3><p>Give this signing secret to the website team. It is shown only once.</p><p class="mono" style="word-break:break-all;background:var(--surface-2);padding:10px;border-radius:8px">${esc(r.secret)}</p><p class="muted" style="font-size:.84rem">${esc(r.note)}</p><div><button class="btn btn-ink" type="button" data-close>Done</button></div></div>`;
      } catch (x) { $('#hErr').hidden = false; $('#hErr').textContent = x.message; }
    };
  });
  app.onclick = async (e) => {
    const d = e.target.closest('[data-disc]'), u = e.target.closest('[data-unhook]');
    if (d && confirm('Disconnect this account? Scheduled posts to it will fail until you reconnect.')) { await api(`/channels/${encodeURIComponent(d.dataset.disc)}`, { method: 'DELETE' }); toast('Disconnected'); route(); }
    if (u && confirm('Stop sending jobs to this website?')) { await api(`/webhooks/${encodeURIComponent(u.dataset.unhook)}`, { method: 'DELETE' }); route(); }
  };
}

function connectForm(provider) {
  const F = {
    linkedin_feed: { title: 'LinkedIn Jobs (Limited Listings feed)', fields: [['accountRef', 'LinkedIn company page ID', 'e.g. 1234567'], ['linkedinCompanyId', 'Company ID used in the feed', 'same as above'], ['posterEmail', 'Job poster email (required by LinkedIn)', 'recruiter@championsmail.com']], note: 'Turn on “Enable basic job posting” on the company page and register the feed URL with LinkedIn.' },
    indeed: { title: 'Indeed', fields: [['accountRef', 'Indeed employer ID', ''], ['mode', 'Mode', 'feed|api'], ['clientId', 'Client ID (API mode)', ''], ['secret', 'Client secret (API mode)', '']], note: 'Feed mode works without approval: register /feeds/indeed.xml. API mode needs Job Sync API access from Indeed. Use only one source for Indeed.' },
    naukri: { title: 'Naukri', fields: [['accountRef', 'Naukri client ID', ''], ['apiBase', 'Integration endpoint (from Naukri)', 'https://…'], ['secret', 'API key (from Naukri)', ''], ['recruiterEmail', 'Recruiter email on Naukri', '']], note: 'Naukri issues the endpoint and key with its paid integration module.' },
    webhook: { title: 'Custom webhook', fields: [['accountRef', 'Name of the receiving system', 'e.g. Slack referral bot'], ['url', 'Webhook URL', 'https://…'], ['secret', 'Signing secret (optional)', '']], note: 'We POST job.published / job.updated / job.closed with an HMAC signature.' },
  }[provider];
  modal(`<div class="modal-head"><div class="row between"><h3>Connect ${esc(F.title)}</h3><button class="x" type="button" data-close aria-label="Close">✕</button></div></div>
    <form class="modal-body" id="kcForm"><p class="muted" style="font-size:.86rem">${esc(F.note)}</p>
    <div class="field"><label for="kcCo">Company</label><select id="kcCo">${COMPANIES.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="kcName">Display name</label><input id="kcName" value="${esc(F.title)}"></div>
    ${F.fields.map(([k, l, ph]) => k === 'mode' ? `<div class="field"><label for="kc_mode">${esc(l)}</label><select id="kc_mode"><option value="feed">XML feed</option><option value="api">Job Sync API</option></select></div>` : `<div class="field"><label for="kc_${k}">${esc(l)}</label><input id="kc_${k}" ${k === 'secret' ? 'type="password" autocomplete="off"' : ''} placeholder="${esc(ph)}"></div>`).join('')}
    <p class="err" id="kcErr" hidden></p><div><button class="btn btn-gold" type="submit">Connect</button></div></form>`);
  $('#kcForm').onsubmit = async (e) => {
    e.preventDefault();
    const v = (k) => $(`#kc_${k}`)?.value.trim() || undefined;
    const config = { mode: v('mode'), apiBase: v('apiBase'), url: v('url'), clientId: v('clientId'), posterEmail: v('posterEmail'), recruiterEmail: v('recruiterEmail'), linkedinCompanyId: v('linkedinCompanyId') };
    Object.keys(config).forEach((k) => config[k] === undefined && delete config[k]);
    try { await post('/channels/connect', { companyId: $('#kcCo').value, provider, displayName: $('#kcName').value.trim(), accountRef: v('accountRef') || provider, secret: v('secret'), config }); $('#modalScrim').hidden = true; toast('Connected'); route(); }
    catch (x) { $('#kcErr').hidden = false; $('#kcErr').textContent = x.message; }
  };
}

// ---------------- Modal ----------------
function modal(html) { $('#modal').innerHTML = html; $('#modalScrim').hidden = false; }
$('#modalScrim').addEventListener('click', (e) => { if (e.target.id === 'modalScrim' || e.target.closest('[data-close]')) { $('#modalScrim').hidden = true; if (location.hash.startsWith('#/channels')) route(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modalScrim').hidden = true; });
window.addEventListener('beforeunload', (e) => { if (ed?.dirty && location.hash.startsWith('#/jobs/')) e.preventDefault(); });

// ---------------- Boot ----------------
(async () => {
  try {
    const me = await api('/me');
    ME = me.user;
    COMPANIES = (await api('/companies')).companies;
    $('#whoami').textContent = `${ME.name} · ${ME.role.replace('_', ' ')}${me.env !== 'production' ? ` · ${me.env}` : ''}`;
    await route();
  } catch (e) {
    app.innerHTML = `<div class="panel"><h3>Can't open the console</h3><p class="err-box">${esc(e.message)}</p><p class="muted">Recruiters sign in through the company SSO (Cloudflare Access). If you just got access, ask an admin to add your email as a Talent Hub user.</p></div>`;
  }
})();
