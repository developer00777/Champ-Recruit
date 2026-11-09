/* eslint-disable */
const I={
 pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>',
 clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
 brief:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
 bld:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 21V5l8-2v18M12 9h8v12M8 8v.01M8 12v.01M8 16v.01M16 13v.01M16 17v.01"/></svg>',
 star:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/></svg>',
 starO:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/></svg>',
 x:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6 6 18"/></svg>',
 check:'<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
};

/* Champions Talent Hub — careers portal front end.
   Ported from the demo (docs/demo.html). Data comes from window.__BOOT__ (server-rendered)
   and /api/public/v1; job pages are server-rendered at /jobs/:id/:slug. */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>document.querySelector(s);
const BOOT=window.__BOOT__||{jobs:[]};
const jobs=BOOT.jobs;
const API='/api/public/v1';
async function api(path,opts={}){
  const res=await fetch(API+path,{credentials:'same-origin',...opts,headers:{'content-type':'application/json',...(opts.headers||{})}});
  let data=null;try{data=await res.json()}catch(e){}
  if(!res.ok)throw new Error((data&&data.error)||`Request failed (${res.status})`);
  return data;
}
const depts=[...new Set(jobs.map(j=>j.dept))];
const locs=[...new Set(jobs.map(j=>j.loc))];
const shifts=[...new Set(jobs.map(j=>j.shift))];
const ents=[...new Set(jobs.map(j=>j.ent))];
const modes=[...new Set(jobs.map(j=>j.mode))];
const expBands=['0–2 yrs','2–5 yrs','5–10 yrs','10+ yrs'];
const byId=id=>jobs.find(j=>j.id===id);
const jobHref=j=>`/jobs/${encodeURIComponent(j.id)}/${encodeURIComponent(j.slug)}`;
// Source attribution: the channel a candidate arrived from (?src=linkedin_org&p=<postingId>) is kept for the session.
(function keepSource(){try{const u=new URL(location.href),s=u.searchParams.get('src'),p=u.searchParams.get('p');if(s)sessionStorage.setItem('cth_src',JSON.stringify({src:s,p}))}catch(e){}})();
const arrivedFrom=()=>{try{return JSON.parse(sessionStorage.getItem('cth_src')||'null')}catch(e){return null}};

/* ---------- STATE ---------- */
const st={area:null,areaName:'',q:'',dept:'',loc:'',shift:'',mode:new Set(),exp:new Set(),ent:new Set(),inc:false,hot:false,savedOnly:false,sort:'rel',saved:new Set()};
try{const s=JSON.parse(localStorage.getItem('cth_saved')||'[]');s.forEach(x=>byId(x)&&st.saved.add(x))}catch(e){}
try{const f=JSON.parse(sessionStorage.getItem('cth_filters')||'null');if(f){Object.assign(st,{...f,mode:new Set(f.mode),exp:new Set(f.exp),ent:new Set(f.ent),saved:st.saved})}}catch(e){}
const persist=()=>{try{localStorage.setItem('cth_saved',JSON.stringify([...st.saved]))}catch(e){}};
const persistFilters=()=>{try{sessionStorage.setItem('cth_filters',JSON.stringify({...st,mode:[...st.mode],exp:[...st.exp],ent:[...st.ent],saved:undefined}))}catch(e){}};
let currentView='careers';
const onCareers=!!$('#searchForm');

/* ---------- HERO + FILTERS ---------- */
function opts(sel,label,vals){if(sel)sel.innerHTML=`<option value="">${label}</option>`+vals.map(v=>`<option>${esc(v)}</option>`).join('')}
function initCareers(){
opts($('#fDept'),'All departments',depts);opts($('#fLoc'),'All locations',locs);opts($('#fShift'),'Any shift',shifts);
$('#fDept').value=st.dept;$('#fLoc').value=st.loc;$('#fShift').value=st.shift;$('#q').value=st.q;$('#sort').value=st.sort;
$('#fInc').checked=st.inc;$('#fHot').checked=st.hot;$('#fSaved').checked=st.savedOnly;
$('#sbRoles').textContent=jobs.length;
$('#sbSeats').textContent=jobs.reduce((a,j)=>a+j.seats,0);
$('#sbEnt').textContent=ents.length;
$('#sbLoc').textContent=new Set(jobs.flatMap(j=>j.loc.split(' / '))).size;
if(BOOT.company){const e=document.querySelector('.hero .eyebrow');if(e)e.textContent=`Careers at ${BOOT.company.name}`}
$('#arenaChips').addEventListener('click',e=>{const b=e.target.closest('[data-d]');if(!b)return;st.dept=b.dataset.d;st.area=null;$('#fDept').value=st.dept;renderAll()});
checks($('#fsMode'),modes,st.mode,v=>jobs.filter(j=>j.mode===v).length);
checks($('#fsExp'),expBands,st.exp,v=>jobs.filter(j=>bandOf(j)===v).length);
checks($('#fsEnt'),ents,st.ent,v=>jobs.filter(j=>j.ent===v).length);
$('#fInc').onchange=e=>{st.inc=e.target.checked;renderJobs()};
$('#fHot').onchange=e=>{st.hot=e.target.checked;renderJobs()};
$('#fSaved').onchange=e=>{st.savedOnly=e.target.checked;renderJobs()};
$('#sort').onchange=e=>{st.sort=e.target.value;renderJobs()};
$('#q').addEventListener('input',e=>{st.q=e.target.value;renderJobs()});
['fDept','fLoc','fShift'].forEach(id=>$('#'+id).onchange=e=>{st[{fDept:'dept',fLoc:'loc',fShift:'shift'}[id]]=e.target.value;if(id==='fDept')st.area=null;renderAll()});
$('#moreOpt').onclick=()=>{const b=$('#moreBox'),open=b.hidden;b.hidden=!open;$('#moreOpt').setAttribute('aria-expanded',open);$('#moreOpt').textContent=open?'Fewer options':'More options'};
$('#clearS').onclick=()=>{['fDept','fLoc','fShift'].forEach(id=>$('#'+id).value='');Object.assign(st,{dept:'',loc:'',shift:'',area:null,areaName:''});renderAll()};
$('#searchForm').onsubmit=e=>{e.preventDefault();document.getElementById('openings').scrollIntoView({behavior:'smooth'})};
$('#clearF').onclick=()=>{Object.assign(st,{area:null,areaName:'',q:'',dept:'',loc:'',shift:'',inc:false,hot:false,savedOnly:false});st.mode.clear();st.exp.clear();st.ent.clear();
  ['q','fDept','fLoc','fShift'].forEach(id=>$('#'+id).value='');['fInc','fHot','fSaved'].forEach(id=>$('#'+id).checked=false);
  document.querySelectorAll('.filters input[data-v]').forEach(i=>i.checked=false);renderAll()};
$('#activeF').addEventListener('click',e=>{const b=e.target.closest('[data-rm]');if(!b)return;const k=b.dataset.rm,v=b.dataset.rv;
  if(k==='area'){st.area=null;st.areaName=''}
  else if(st[k] instanceof Set){st[k].delete(v);document.querySelectorAll('.filters input[data-v]').forEach(i=>{if(i.dataset.v===v)i.checked=false})}
  else if(typeof st[k]==='boolean'){st[k]=false;$({inc:'#fInc',hot:'#fHot',savedOnly:'#fSaved'}[k]).checked=false}
  else{st[k]='';$({q:'#q',dept:'#fDept',loc:'#fLoc',shift:'#fShift'}[k]).value=''}
  renderAll()});
renderAreas();renderStages();renderAll();renderInt();initQuiz();initCv();initCommunity();
}
function renderChips(){
  const counts=d=>jobs.filter(j=>j.dept===d).length;
  $('#arenaChips').innerHTML=`<button type="button" class="chip" data-d="" aria-pressed="${!st.dept}">All <i>${jobs.length}</i></button>`+
   depts.map(d=>`<button type="button" class="chip" data-d="${esc(d)}" aria-pressed="${st.dept===d}">${esc(d)} <i>${counts(d)}</i></button>`).join('');
}
const IC={trend:'<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',hand:'<path d="M3 12l4-4 5 3 5-3 4 4-9 7-9-7Z"/>',mega:'<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1ZM17 9a4 4 0 0 1 0 6"/>',data:'<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',code:'<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 6l-2 12"/>',people:'<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>',star:'<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/>'};
const svgI=k=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
const AREAS=[
 ['Sales & Business Development',['Sales','Leadership'],'Open doors, run the deal and close it. Every number you hit shows on the leaderboard and in your incentive.','trend'],
 ['Lead Generation',['Lead Generation'],'Find the right buyer before anyone else does. The fastest way into a B2B sales career.','target'],
 ['Account Management',['Account Management'],'Keep our biggest clients growing, renewing and coming back for more.','hand'],
 ['Marketing',['Marketing'],'Create demand for data and marketing brands that sell worldwide.','mega'],
 ['Data & Research',['Data & Research'],'Build the accurate B2B data our clients run their campaigns on.','data'],
 ['Technology',['IT'],'Build and run the platforms behind our sales floors, data delivery and this portal.','code'],
 ['People & Learning',['HR','Recruitment','L&D'],'Hire, train and look after the people who power the group.','people'],
 ['Customer Experience',['Customer Service'],'Be the voice clients and guests remember, from data delivery to Dubai Marina.','star']];
function renderAreas(){$('#areaGrid').innerHTML=AREAS.map(([n,d,p,i],k)=>{const js=jobs.filter(j=>d.includes(j.dept)),s=js.reduce((a,j)=>a+j.seats,0);
  return `<button type="button" class="area" data-area="${k}"><span class="emblem">${svgI(i)}</span><b>${esc(n)}</b><p>${esc(p)}</p><span class="go">Explore ${js.length} role${js.length===1?'':'s'} · ${s} seat${s===1?'':'s'} →</span></button>`}).join('')}
const STAGEC=[
 ['Students & freshers','Start strong','Entry roles in sales, lead generation and data, with training from week one.','0–2 yrs'],
 ['Experienced professionals','2 – 5 years','Step up to specialist roles where your track record counts.','2–5 yrs'],
 ['Senior professionals','5 – 10 years','Lead teams, own targets and shape how we sell.','5–10 yrs'],
 ['Leaders','10+ years','Run a function or a business line across the group.','10+ yrs'],
 ['Career returners','Coming back','Returning after a break? Join the community and we will match you to the right role.','']];
function renderStages(){$('#stageGrid').innerHTML=STAGEC.map(([n,t,p,b],k)=>{const c=b?jobs.filter(j=>bandOf(j)===b).length:0;
  return `<button type="button" class="stage" data-stage="${k}"><span>${esc(t)}</span><b>${esc(n)}</b><p>${esc(p)}</p><span style="margin-top:4px">${b?`${c} open role${c===1?'':'s'} →`:'Join the talent community →'}</span></button>`}).join('')}
const jump=id=>{const el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth',block:'start'})};
function checks(fs,vals,set,countFn){
  const lg=fs.querySelector('legend').outerHTML;
  fs.innerHTML=lg+vals.map((v,i)=>`<label class="check"><input type="checkbox" data-v="${esc(v)}" ${set.has(v)?'checked':''} id="${fs.id}-${i}"> ${esc(v)} <em>${countFn(v)}</em></label>`).join('');
  fs.onchange=e=>{const v=e.target.dataset.v;e.target.checked?set.add(v):set.delete(v);renderJobs()};
}
const bandOf=j=>expBands[j.expBand];

/* ---------- SEARCH ---------- */
const SYN={bd:'business development',bde:'business development',bdm:'business development',kam:'key account',cro:'chief revenue',ta:'talent acquisition',cs:'customer success',leadgen:'lead generation','lead-gen':'lead generation',dev:'developer'};
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const has=(h,w)=>w.length<=3?new RegExp('(^|[^a-z])'+reEsc(w)+'([^a-z]|$)').test(h):h.includes(w);
function parseQ(q){const phrases=[];q=q.replace(/"([^"]+)"/g,(_,p)=>{phrases.push(p.toLowerCase().trim());return ' '});
  const words=q.toLowerCase().split(/\s+/).filter(Boolean).map(w=>SYN[w]||w);return{phrases,words,empty:!phrases.length&&!words.length}}
const hay=j=>[j.title,j.dept,j.id,j.ent,j.loc,j.shift,j.sum,...j.tags].join(' ').toLowerCase();
function matchQ(j,P){if(P.empty)return true;const h=hay(j);return P.phrases.every(p=>h.includes(p))&&P.words.every(w=>has(h,w))}
function rel(j,P){if(P.empty)return 0;const t=j.title.toLowerCase(),tg=j.tags.join(' ').toLowerCase(),h=hay(j);let s=0;
  [...P.phrases,...P.words].forEach(w=>{s+=has(t,w)?5:has(tg,w)?2:has(h,w)?1:0});return s}
function filtered(){
  const P=parseQ(st.q);
  let r=jobs.filter(j=>matchQ(j,P)
   &&(!st.dept||j.dept===st.dept)&&(!st.area||st.area.includes(j.dept))&&(!st.loc||j.loc===st.loc)&&(!st.shift||j.shift===st.shift)
   &&(!st.mode.size||st.mode.has(j.mode))&&(!st.exp.size||st.exp.has(bandOf(j)))&&(!st.ent.size||st.ent.has(j.ent))
   &&(!st.inc||j.inc)&&(!st.hot||j.seats>=5)&&(!st.savedOnly||st.saved.has(j.id)));
  const s={rel:(a,b)=>rel(b,P)-rel(a,P)||a.days-b.days,new:(a,b)=>a.days-b.days,seats:(a,b)=>b.seats-a.seats,az:(a,b)=>a.title.localeCompare(b.title)}[st.sort];
  return r.sort(s);
}
const ago=d=>d===0?'Today':d===1?'Posted yesterday':`Posted ${d} days ago`;
function jobCard(j){
  const saved=st.saved.has(j.id);
  return `<article class="job">
   <div class="job-main">
    <div class="job-top"><span class="mono muted">${esc(j.id)}</span>${j.seats>=5?'<span class="tag hot">Bulk hiring</span>':''}${j.inc?'<span class="tag inc">Incentive-eligible</span>':''}</div>
    <h3><a href="${jobHref(j)}">${esc(j.title)}</a></h3>
    <div class="meta"><span>${I.brief}${esc(j.dept)}</span><span>${I.bld}${esc(j.ent)}</span><span>${I.pin}${esc(j.loc)} · ${esc(j.mode)}</span><span>${I.clock}${esc(j.shift)} · ${esc(j.exp)}</span></div>
    <p class="sum">${esc(j.sum)}</p>
   </div>
   <div class="job-side">
    <div class="seats"><b>${j.seats}</b><span>${j.seats>1?'positions':'position'} · ${ago(j.days)}</span></div>
    <div class="job-actions">
     <button type="button" class="save" data-save="${esc(j.id)}" aria-pressed="${saved}" aria-label="${saved?'Remove from saved':'Save role'}">${saved?I.star:I.starO}</button>
     <a class="btn btn-ink btn-sm" href="${jobHref(j)}">View &amp; apply</a>
    </div>
   </div></article>`;
}
function activeList(){const a=[];if(st.area)a.push(['area','',st.areaName]);if(st.q.trim())a.push(['q','',`“${st.q.trim()}”`]);
  ['dept','loc','shift'].forEach(k=>{if(st[k])a.push([k,'',st[k]])});
  ['mode','exp','ent'].forEach(k=>st[k].forEach(v=>a.push([k,v,v])));
  if(st.inc)a.push(['inc','','Incentive-eligible']);if(st.hot)a.push(['hot','','Bulk hiring']);if(st.savedOnly)a.push(['savedOnly','','Saved only']);return a}
const xs=I.x.replace('width="18" height="18"','width="12" height="12"');
function renderJobs(){
  if(!onCareers)return;
  persistFilters();
  const r=filtered();$('#resCount').textContent=r.length;
  const a=activeList();$('#fCount').textContent=a.length?`· ${a.length} active`:'';
  const af=$('#activeF');af.hidden=!a.length;af.innerHTML=a.map(([k,v,l])=>`<button type="button" data-rm="${k}" data-rv="${esc(v)}" aria-label="Remove filter ${esc(l)}">${esc(l)} ${xs}</button>`).join('');
  $('#jobList').innerHTML=r.length?r.map(jobCard).join(''):`<div class="empty"><b>No roles match this search yet.</b><p style="margin-top:6px">Remove a filter above, or get an email the moment a matching role opens.</p><div style="display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap"><button class="btn btn-ink btn-sm" type="button" data-alert>Alert me when it opens</button><button class="btn btn-ghost btn-sm" type="button" id="clearF2">Clear all filters</button></div></div>`;
  const c2=$('#clearF2');if(c2)c2.onclick=()=>$('#clearF').click();
}
function renderAll(){if(!onCareers)return;renderChips();renderJobs()}

document.addEventListener('click',e=>{
  const s=e.target.closest('[data-save]');if(s){toggleSave(s.dataset.save);return}
  const al=e.target.closest('[data-alert]');if(al){openAlert(al.dataset.alert);return}
  const apb=e.target.closest('[data-apply]');if(apb){const id=apb.dataset.apply;openApply([...new Set([id,...st.saved])],id);return}
  const ar=e.target.closest('[data-area]');if(ar){const a=AREAS[+ar.dataset.area];st.area=a[1];st.areaName=a[0];st.dept='';$('#fDept').value='';renderAll();jump('openings');return}
  const sg=e.target.closest('[data-stage]');if(sg){const b=STAGEC[+sg.dataset.stage][3];if(!b){jump('community');return}
    st.exp.clear();st.exp.add(b);document.querySelectorAll('#fsExp input').forEach(i=>i.checked=i.dataset.v===b);renderAll();jump('openings');return}
  const sc=e.target.closest('[data-scroll]');if(sc){jump(sc.dataset.scroll);return}
  const ua=e.target.closest('[data-unal]');if(ua){api(`/alerts/${encodeURIComponent(ua.dataset.unal)}/stop`,{method:'POST'}).then(()=>{toast('Alert stopped');loadMe()}).catch(err=>toast(err.message));return}
  const wd=e.target.closest('[data-wd]');if(wd){withdraw(wd);return}
  const g=e.target.closest('[data-go]');if(g){go(g.dataset.go)}
});
function toggleSave(id){st.saved.has(id)?st.saved.delete(id):st.saved.add(id);persist();renderJobs();renderTray();
  document.querySelectorAll(`#jobPage [data-save="${CSS.escape(id)}"]`).forEach(b=>{if(b.classList.contains('btn'))b.textContent=st.saved.has(id)?'Saved · remove':'Save and apply with others'})}
function renderTray(){
  const n=st.saved.size;$('#tray').hidden=!n||currentView==='applications';
  $('#trayN').textContent=n+(n===1?' role':' roles');
  $('#trayList').innerHTML=[...st.saved].map(id=>`<span class="pill">${esc(byId(id)?.title||id)}</span>`).join('');
}
$('#trayClear').onclick=()=>{st.saved.clear();persist();renderJobs();renderTray()};
$('#trayApply').onclick=()=>openApply([...st.saved]);
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#modalScrim').hidden=true});

/* ---------- JOB PAGE (server-rendered; wire up the buttons) ---------- */
function initJobPage(){
  const sh=$('#dShare');if(!sh)return;
  sh.onclick=()=>{const url=location.origin+location.pathname;const show=()=>{const p=$('#dLink');p.hidden=false;p.textContent=url};
    try{navigator.clipboard.writeText(url).then(()=>toast('Job link copied'),show)}catch(e){show()}};
  if(BOOT.job&&st.saved.has(BOOT.job.id))document.querySelectorAll('#jobPage .btn[data-save]').forEach(b=>b.textContent='Saved · remove');
}

/* ---------- APPLY FLOW ---------- */
let ap={};
function openApply(ids,primary){ap={step:0,ids:new Set(primary?[primary]:ids),pool:ids.filter(byId),name:me?.name||'',email:me?.email||'',phone:'',city:me?.city||'',exp:me?.expYears||'',notice:'Immediate',source:'Careers portal',li:'',cv:null,pitch:null,win:'',proc:false,camp:false,busy:false,idem:crypto.randomUUID()};renderApply();$('#modalScrim').hidden=false}
const STEPN=['Choose roles','Your profile','Show your edge','Consent & submit'];
function renderApply(){
  const m=$('#modal'),s=ap.step;
  if(s===4){m.innerHTML=`<div class="modal-body"><div class="success"><div class="ring">${I.check}</div><h3 style="font-size:1.5rem">Application received</h3><p class="muted" style="max-width:44ch">You applied for ${ap.result.length} ${ap.result.length>1?'roles':'role'} with one profile. Track each one in My applications. A recruiter will review within 3 working days.</p><p class="mono muted">${ap.result.map(a=>esc(a.id)).join(' · ')}</p>${ap.already?.length?`<p class="muted" style="font-size:.85rem">You had already applied to ${ap.already.length} of these roles.</p>`:''}<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn btn-ink" type="button" id="toApps">View my applications</button></div></div></div>`;
    $('#toApps').onclick=()=>{$('#modalScrim').hidden=true;go('applications')};return}
  const pool=[...new Set([...ap.pool,...ap.ids])];
  let body='';
  if(s===0)body=`<p class="muted">Pick every role you want to be considered for. You fill in your details once.</p>
    ${pool.map(id=>{const j=byId(id);return j?`<label class="pick"><input type="checkbox" data-pid="${esc(id)}" ${ap.ids.has(id)?'checked':''}><b>${esc(j.title)}</b><span class="muted" style="font-size:.8rem">${esc(j.dept)} · ${j.seats} seats</span></label>`:''}).join('')}
    <div class="field"><label for="addRole">Add another role</label><select id="addRole"><option value="">Choose a role…</option>${jobs.filter(j=>!pool.includes(j.id)).map(j=>`<option value="${esc(j.id)}">${esc(j.title)} (${esc(j.dept)})</option>`).join('')}</select></div>`;
  if(s===1)body=`<div class="grid2">
    <div class="field"><label for="aName">Full name *</label><input id="aName" value="${esc(ap.name)}" autocomplete="name"></div>
    <div class="field"><label for="aEmail">Email *</label><input id="aEmail" type="email" value="${esc(ap.email)}" autocomplete="email"></div>
    <div class="field"><label for="aPhone">Mobile *</label><input id="aPhone" type="tel" value="${esc(ap.phone)}" autocomplete="tel" placeholder="+91"></div>
    <div class="field"><label for="aCity">Current city</label><input id="aCity" value="${esc(ap.city)}"></div>
    <div class="field"><label for="aExp">Total experience (years) *</label><input id="aExp" type="number" min="0" step="0.5" value="${esc(ap.exp)}"></div>
    <div class="field"><label for="aNotice">Notice period</label><select id="aNotice">${['Immediate','15 days','30 days','60 days','90 days'].map(o=>`<option ${o===ap.notice?'selected':''}>${o}</option>`).join('')}</select></div>
    <div class="field"><label for="aSource">How did you hear about us?</label><select id="aSource">${['Careers portal','LinkedIn','Naukri','Indeed','Employee referral','Talent community','Campus'].map(o=>`<option ${o===ap.source?'selected':''}>${o}</option>`).join('')}</select></div>
    <div class="field"><label for="aLi">LinkedIn URL</label><input id="aLi" value="${esc(ap.li)}" placeholder="linkedin.com/in/…"></div></div>
    <div class="drop"><div style="flex:1;min-width:180px"><b>Upload CV *</b><p class="muted" style="font-size:.8rem">PDF or Word, up to 5 MB.</p></div><input type="file" id="aCv" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></div>
    <p class="muted" style="font-size:.82rem" id="aCvState">${ap.cv?`Attached: ${esc(ap.cv.name)}`:''}</p><p class="err" id="aErr" hidden></p>`;
  if(s===2){const sales=[...ap.ids].some(id=>['Sales','Lead Generation','Account Management','Leadership'].includes(byId(id)?.dept));
    body=`<p class="muted">Optional, but it moves you up the queue${sales?' for sales roles':''}.</p>
    <div class="drop"><div style="flex:1;min-width:180px"><b>60-second pitch</b><p class="muted" style="font-size:.8rem">Record a short voice note or video: who you are and why you'd win in this role.</p></div><input type="file" id="aPitch" accept="audio/*,video/*"></div>
    <p class="muted" style="font-size:.82rem" id="aPitchState">${ap.pitch?`Attached: ${esc(ap.pitch.name)}`:''}</p>
    <div class="field"><label for="aWin">Your proudest number</label><textarea id="aWin" rows="3" placeholder="e.g. Booked 42 meetings in a quarter against a target of 30">${esc(ap.win)}</textarea></div><p class="err" id="aErr" hidden></p>`}
  if(s===3)body=`<div class="panel" style="padding:16px;background:var(--surface-2);border:0"><b>Summary</b><p class="muted" style="font-size:.88rem">${esc(ap.name)} · ${esc(ap.email)} · ${esc(ap.exp)} yrs</p><div class="chips">${[...ap.ids].map(id=>`<span class="tag">${esc(byId(id)?.title||id)}</span>`).join('')}</div></div>
    <label class="consent"><input type="checkbox" id="aProc" ${ap.proc?'checked':''}> <span><b>Required.</b> I agree that Champions Group may process my details to assess this application, and to contact me about it. <u>Privacy notice</u></span></label>
    <label class="consent"><input type="checkbox" id="aCamp" ${ap.camp?'checked':''}> <span><b>Optional.</b> Also email me about future roles in the same departments. I can unsubscribe from any email.</span></label>
    <p class="note muted">The second box starts unticked on purpose: applying never signs anyone up for campaign emails.</p><p class="err" id="aErr" hidden></p>`;
  m.innerHTML=`<div class="modal-head"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><span class="eyebrow">Step ${s+1} of 4</span><h3 style="font-size:1.35rem;margin-top:4px">${STEPN[s]}</h3></div><button class="x" type="button" id="mClose" aria-label="Close">${I.x}</button></div><div class="steps">${[0,1,2,3].map(i=>`<div class="${i<=s?'on':''}"></div>`).join('')}</div></div>
   <div class="modal-body">${body}</div>
   <div class="modal-foot"><button class="btn btn-ghost" type="button" id="mBack" ${s===0?'disabled':''}>Back</button><button class="btn btn-gold" type="button" id="mNext" ${(s===0&&!ap.ids.size)||ap.busy?'disabled':''}>${ap.busy?'Please wait…':s===3?'Submit application':'Continue'}</button></div>`;
  $('#mClose').onclick=()=>$('#modalScrim').hidden=true;
  $('#mBack').onclick=()=>{save();ap.step--;renderApply()};
  $('#mNext').onclick=next;
  if(s===0){m.querySelectorAll('[data-pid]').forEach(c=>c.onchange=()=>{c.checked?ap.ids.add(c.dataset.pid):ap.ids.delete(c.dataset.pid);$('#mNext').disabled=!ap.ids.size});
    $('#addRole').onchange=e=>{if(e.target.value){ap.ids.add(e.target.value);ap.pool=[...ap.pool,e.target.value];renderApply()}}}
  if(s===1)$('#aCv').onchange=e=>upload(e.target.files[0],'cv');
  if(s===2)$('#aPitch').onchange=e=>upload(e.target.files[0],'pitch');
}
async function upload(file,kind){
  if(!file)return;const stEl=$(kind==='cv'?'#aCvState':'#aPitchState'),err=$('#aErr');
  stEl.textContent=`Uploading ${file.name}…`;err.hidden=true;ap.busy=true;$('#mNext').disabled=true;
  try{const fd=new FormData();fd.append('file',file);fd.append('kind',kind);
    const res=await fetch(API+'/uploads',{method:'POST',body:fd});const data=await res.json();
    if(!res.ok)throw new Error(data.error||'Upload failed');
    ap[kind]={key:data.key,name:file.name};stEl.textContent=`Attached: ${file.name}`;
  }catch(e){stEl.textContent='';err.hidden=false;err.textContent=e.message}
  finally{ap.busy=false;$('#mNext').disabled=false}
}
function save(){
  if(ap.step===1){['name','email','phone','city','exp','li'].forEach(k=>ap[k]=$('#a'+k[0].toUpperCase()+k.slice(1)).value.trim());ap.notice=$('#aNotice').value;ap.source=$('#aSource').value}
  if(ap.step===2){ap.win=$('#aWin').value.trim()}
  if(ap.step===3){ap.proc=$('#aProc').checked;ap.camp=$('#aCamp').checked}
}
async function next(){
  if(ap.busy)return;save();const err=$('#aErr');
  if(ap.step===1){const miss=[];if(!ap.name)miss.push('full name');if(!/^\S+@\S+\.\S+$/.test(ap.email))miss.push('a valid email');if(ap.phone.replace(/\D/g,'').length<10)miss.push('a 10-digit mobile number');if(ap.exp==='')miss.push('experience');if(!ap.cv)miss.push('your CV');
    if(miss.length){err.hidden=false;err.textContent='Please add '+miss.join(', ')+' to continue.';return}}
  if(ap.step===3){if(!ap.proc){err.hidden=false;err.textContent='Tick the required consent so we can process your application.';return}
    const from=arrivedFrom();
    ap.busy=true;renderApply();
    try{const r=await api('/applications',{method:'POST',headers:{'idempotency-key':ap.idem},body:JSON.stringify({
        jobIds:[...ap.ids],name:ap.name,email:ap.email,phone:ap.phone,city:ap.city,expYears:ap.exp,notice:ap.notice,heardFrom:ap.source,linkedinUrl:ap.li,
        cvKey:ap.cv.key,pitchKey:ap.pitch?.key,proudestNumber:ap.win||undefined,consentProcessing:true,consentCampaigns:ap.camp,src:from?.src,postingId:from?.p||undefined})});
      ap.result=r.applications;ap.already=r.alreadyApplied;ap.busy=false;
      st.saved.clear();persist();renderJobs();renderTray();loadMe();
    }catch(e){ap.busy=false;renderApply();const er=$('#aErr');er.hidden=false;er.textContent=e.message;return}
  }
  ap.step++;renderApply();
}
$('#modalScrim').addEventListener('click',e=>{if(e.target.id==='modalScrim')$('#modalScrim').hidden=true});

/* ---------- QUIZ ---------- */
function initQuiz(){
const qa=[null,null,null];
const affinity={hunt:['Sales','Lead Generation','Account Management','Leadership'],people:['Recruitment','HR','L&D','Customer Service'],data:['Data & Research','Marketing','Sales'],build:['IT','Sales']};
document.querySelectorAll('#quiz .opts').forEach(g=>g.addEventListener('click',e=>{const b=e.target.closest('.opt');if(!b)return;
  g.querySelectorAll('.opt').forEach(o=>o.setAttribute('aria-pressed',o===b));qa[+g.dataset.q]=b.dataset.v;renderMatch()}));
function renderMatch(){
  if(qa.some(v=>v===null))return;
  const lvl=+qa[1];
  const scored=jobs.map(j=>{let s=0;const a=affinity[qa[0]];const i=a.indexOf(j.dept);if(i>-1)s+=50-i*8;
    s+=Math.max(0,30-Math.abs(j.expBand-lvl)*15);
    const night=/US|UK|Global/.test(j.shift);s+=qa[2]==='y'?(night?20:12):(night?-30:20);
    return{j,s:Math.max(0,Math.min(99,Math.round(s)))}}).sort((a,b)=>b.s-a.s).slice(0,3);
  $('#matchOut').innerHTML=`<span class="eyebrow">Your best-fit roles</span>`+scored.map(({j,s})=>`<div class="match-row"><b>${esc(j.title)}<br><span class="muted" style="font-weight:500;font-size:.8rem">${esc(j.dept)} · ${esc(j.shift)}</span></b><span class="score">${s}% fit</span><a class="btn btn-ink btn-sm" href="${jobHref(j)}">View</a></div>`).join('');
}}

/* ---------- CV MATCH (runs in the browser; nothing is uploaded) ---------- */
function initCv(){
const SAMPLE_CV=`Business Development Associate, 2.5 years
Inside sales for a US SaaS company on night shift. Cold calling 80+ dials a day, email outreach sequences and LinkedIn prospecting.
Booked 120 meetings in 2025 at 118% of target. Managed pipeline in HubSpot CRM. Comfortable with negotiation and B2B data tools. Advanced Excel.`;
const SKILLS={'cold call':['cold calling'],'calling':['cold calling'],'outreach':['email outreach','sequences'],'sequence':['sequences'],'linkedin':['LinkedIn'],'crm':['CRM'],'hubspot':['CRM'],'salesforce':['CRM'],'negotiat':['negotiation'],'b2b':['B2B data'],'excel':['Excel'],'data quality':['data quality'],'research':['research'],'recruit':['volume hiring','sourcing','screening'],'sourcing':['sourcing'],'screening':['screening'],'training':['sales training','training ops','facilitation'],'onboard':['onboarding'],'lms':['LMS'],'payroll':['payroll inputs'],'hrms':['HRMS'],'employee relations':['employee relations'],'engagement':['engagement'],'customer support':['client support'],'helpdesk':['helpdesk'],'ticket':['ticketing'],'renewal':['renewals','retention'],'upsell':['upsell'],'account manag':['retention','QBRs'],'seo':['SEO'],'google ads':['paid search'],'ppc':['paid search'],'analytics':['analytics'],'email market':['email','automation'],'a/b':['A/B testing'],'react':['React'],'node':['Node.js'],'sql':['SQL'],'network':['networking'],'hospitality':['hospitality','guest care'],'booking':['bookings'],'p&l':['P&L'],'revenue strateg':['revenue strategy'],'go-to-market':['GTM'],'team lead':['team lead','sales management'],'forecast':['forecasting'],'enterprise':['enterprise sales'],'abm':['ABM'],'dashboard':['dashboards'],'incentive':['incentives']};
function cvMatch(){const t=$('#cvText').value.toLowerCase(),out=$('#cvOut');
  if(t.trim().length<30){out.innerHTML='<p class="muted" style="font-size:.88rem">Add a few lines about your experience and skills to see matches.</p>';return}
  const found=new Set();Object.entries(SKILLS).forEach(([k,v])=>{if(t.includes(k))v.forEach(x=>found.add(x))});
  const ym=t.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/),yrs=ym?parseFloat(ym[1]):null;
  const band=yrs==null?null:yrs<2?0:yrs<5?1:yrs<10?2:3,night=/night shift|us shift|uk shift|us market|north america/.test(t);
  const lower=x=>x.toLowerCase();
  const res=jobs.map(j=>{const fl=new Set([...found].map(lower));const hits=j.tags.filter(x=>fl.has(lower(x)));let s=j.tags.length?hits.length/j.tags.length*70:0;
    if(t.includes(j.title.toLowerCase()))s+=10;if(band!=null)s+=Math.max(0,20-Math.abs(j.expBand-band)*12);if(night&&/US|UK/.test(j.shift))s+=8;
    return{j,hits,s:Math.min(98,Math.round(s))}}).filter(r=>r.hits.length).sort((a,b)=>b.s-a.s).slice(0,4);
  out.innerHTML=`<span class="eyebrow">Recognised ${found.size} skill${found.size===1?'':'s'}${yrs!=null?` · ${yrs} yrs experience`:''}${night?' · open to US/UK shift':''}</span>`+
   (res.length?res.map(({j,hits,s})=>`<div class="match-row"><b>${esc(j.title)}<br>${hits.map(h=>`<span class="hit">${esc(h)}</span>`).join('')}</b><span class="score">${s}% fit</span><a class="btn btn-ink btn-sm" href="${jobHref(j)}">View</a></div>`).join('')
    :'<p class="muted" style="font-size:.88rem">No strong matches yet. Add the tools and skills you use, or take the 30-second quiz below.</p>')+
   '<p class="muted" style="font-size:.78rem">Matching runs in your browser. A recruiter still reviews every application.</p>';}
let cvT;$('#cvText').addEventListener('input',()=>{clearTimeout(cvT);cvT=setTimeout(cvMatch,250)});
$('#cvSample').onclick=()=>{$('#cvText').value=SAMPLE_CV;cvMatch()};
$('#cvFile').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{$('#cvText').value=String(r.result).slice(0,8000);cvMatch()};r.readAsText(f)};
}

/* ---------- JOB ALERTS ---------- */
function openAlert(fixed){const m=$('#modal'),label=fixed||(onCareers?activeList().map(x=>x[2]).join(' · '):'')||'All new roles';
  const query=fixed?{dept:fixed}:{q:st.q,dept:st.dept,loc:st.loc,shift:st.shift,mode:[...st.mode],exp:[...st.exp],ent:[...st.ent],area:st.area};
  m.innerHTML=`<div class="modal-head"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><span class="eyebrow">Job alert</span><h3 style="font-size:1.35rem;margin-top:4px">Get new roles like these by email</h3></div><button class="x" type="button" id="mClose" aria-label="Close">${I.x}</button></div></div>
   <form class="modal-body" id="alForm" novalidate><div class="panel" style="padding:14px;background:var(--surface-2);border:0;gap:4px"><span class="eyebrow">Your search</span><b>${esc(label)}</b></div>
    <div class="grid2"><div class="field"><label for="alMail">Email</label><input id="alMail" type="email" value="${esc(me?.email||'')}" autocomplete="email"></div><div class="field"><label for="alFreq">Frequency</label><select id="alFreq"><option>Instantly</option><option>Daily digest</option><option>Weekly digest</option></select></div></div>
    <label class="consent"><input type="checkbox" id="alOk"> Email me new roles that match this search. I can stop this alert from any email or from My applications.</label>
    <p class="err" id="alErr" hidden></p><div><button class="btn btn-gold" type="submit">Create alert</button></div></form>`;
  $('#modalScrim').hidden=false;$('#mClose').onclick=()=>$('#modalScrim').hidden=true;
  $('#alForm').onsubmit=async e=>{e.preventDefault();const em=$('#alMail').value.trim(),er=$('#alErr');
    if(!/^\S+@\S+\.\S+$/.test(em)){er.hidden=false;er.textContent='Add a valid email address for the alert.';return}
    if(!$('#alOk').checked){er.hidden=false;er.textContent='Tick the box to confirm you want these emails.';return}
    try{await api('/alerts',{method:'POST',body:JSON.stringify({email:em,label,query,frequency:$('#alFreq').value,consent:true})});
      $('#modalScrim').hidden=true;toast('Alert created. We emailed you a link to stop it any time.');loadMe()}
    catch(err){er.hidden=false;er.textContent=err.message}}}

/* ---------- COMMUNITY ---------- */
const cInt=new Set();
function renderInt(){$('#cInterests').innerHTML=depts.map(d=>`<button type="button" class="chip" data-i="${esc(d)}" aria-pressed="${cInt.has(d)}">${esc(d)}</button>`).join('')}
function initCommunity(){
$('#cInterests').addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(!b)return;const d=b.dataset.i;cInt.has(d)?cInt.delete(d):cInt.add(d);renderInt()});
$('#community').onsubmit=async e=>{e.preventDefault();const err=$('#cErr'),n=$('#cName').value.trim(),m=$('#cEmail').value.trim();
  if(!n||!/^\S+@\S+\.\S+$/.test(m)){err.hidden=false;err.textContent='Add your name and a valid email address.';return}
  if(!cInt.size){err.hidden=false;err.textContent='Pick at least one area you want to hear about.';return}
  if(!$('#cConsent').checked){err.hidden=false;err.textContent='Tick the consent box so we can email you about new roles.';return}
  err.hidden=true;
  try{await api('/community',{method:'POST',body:JSON.stringify({name:n,email:m,interests:[...cInt],frequency:$('#cFreq').value,consent:true})});
    toast(`Welcome to the bench, ${n.split(' ')[0]}. We'll email you when a ${[...cInt][0]} role opens.`);e.target.reset();cInt.clear();renderInt()}
  catch(x){err.hidden=false;err.textContent=x.message}};
}

/* ---------- MY APPLICATIONS ---------- */
let me=null;
const STAGES=['Applied','Screening','Assessment','Interview','Offer'];
async function loadMe(){
  try{const r=await api('/me');
    if(!r.signedIn){me=null;$('#meSignin').hidden=false;$('#meArea').hidden=true;$('#myCount').hidden=true;return}
    me=r.me;$('#meSignin').hidden=true;$('#meArea').hidden=false;
    $('#meName').textContent=me.name;$('#meLine').textContent=[me.email,me.city,me.expYears?`${me.expYears} yrs experience`:''].filter(Boolean).join(' · ');
    $('#meConsent').checked=me.campaigns;$('#meHuman').checked=me.humanOnlyReview;
    const active=r.applications.filter(a=>!['Withdrawn','Not selected','Hired'].includes(a.stage)).length;
    $('#myCount').hidden=!r.applications.length;$('#myCount').textContent=active||r.applications.length;
    renderApps(r.applications);renderAlerts(r.alerts);
  }catch(e){console.warn(e)}
}
function renderApps(apps){
  $('#appList').innerHTML=apps.length?apps.map(a=>{const j=a.job,ix=STAGES.indexOf(a.stage),days=Math.floor((Date.now()-a.createdAt)/864e5);
    const next={Applied:'A recruiter will review your profile within 3 working days.',Screening:'Your profile is with the recruiter. Expect a call or an assessment link.',Assessment:'Complete the assessment sent to your email.',Interview:'Interview with the hiring manager is being scheduled. Check your email for a slot.',Offer:'Your offer is ready. Review and respond in your email.',Hired:'Welcome aboard! Joining details are in your email.','Not selected':'Thank you for applying. We kept your profile for future roles if you opted in.',Withdrawn:'You withdrew this application. You can apply again any time.'}[a.stage];
    const canWd=!['Withdrawn','Offer','Hired','Not selected'].includes(a.stage);
    return `<article class="app"><div class="app-top"><div style="display:grid;gap:4px"><span class="mono muted">${esc(a.id)} · ${esc(j.id)}</span><a href="/jobs/${encodeURIComponent(j.id)}/${encodeURIComponent(j.slug)}" style="font-family:var(--f-display);font-size:1.15rem;font-weight:700;color:inherit">${esc(j.title)}</a><span class="muted" style="font-size:.85rem">${esc(j.ent)} · ${esc(j.loc)} · applied ${days?days+' days ago':'today'}</span></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="st st-${a.stage.replace(/\s/g,'')}">${esc(a.stage)}</span>${canWd?`<button class="btn btn-ghost btn-sm" type="button" data-wd="${esc(a.id)}">Withdraw</button>`:''}</div></div>
     ${ix>-1?`<div class="track">${STAGES.map((s,i)=>`<div class="${i<ix?'done':i===ix?'now':''}"><i></i><span>${s}</span></div>`).join('')}</div>`:''}
     <p class="muted" style="font-size:.88rem"><b style="color:var(--ink)">Next:</b> ${next}</p></article>`}).join(''):'<p class="muted">No applications yet.</p>';
}
async function withdraw(btn){
  if(btn.dataset.confirm!=='1'){btn.dataset.confirm='1';btn.textContent='Confirm withdraw';return}
  try{await api(`/me/applications/${encodeURIComponent(btn.dataset.wd)}/withdraw`,{method:'POST'});toast('Application withdrawn');loadMe()}catch(e){toast(e.message)}
}
function renderAlerts(alerts){$('#alertList').innerHTML=`<div class="panel" style="margin-top:18px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><b>Job alerts</b><button class="btn btn-ghost btn-sm" type="button" data-go="careers">Create one from a search</button></div>${alerts.length?alerts.map(a=>`<div class="match-row"><b>${esc(a.label)}<br><span class="muted" style="font-weight:500;font-size:.8rem">${esc(a.frequency)} · ${esc(a.email)}</span></b><button class="btn btn-ghost btn-sm" type="button" data-unal="${esc(a.id)}">Stop alert</button></div>`).join(''):'<p class="muted" style="font-size:.88rem">No alerts. Create one from any search on Find roles.</p>'}</div>`}
$('#meConsent').onchange=e=>api('/me/preferences',{method:'POST',body:JSON.stringify({campaigns:e.target.checked})}).then(()=>toast(e.target.checked?'You will hear about new roles':'Campaign emails turned off')).catch(x=>toast(x.message));
$('#meHuman').onchange=e=>api('/me/preferences',{method:'POST',body:JSON.stringify({humanOnlyReview:e.target.checked})}).then(()=>toast(e.target.checked?'A recruiter will review without AI assistance':'Standard review restored')).catch(x=>toast(x.message));
$('#signOut').onclick=()=>api('/auth/logout',{method:'POST'}).then(loadMe);
let otpStage=0;
$('#otpForm').onsubmit=async e=>{e.preventDefault();const er=$('#otpErr'),email=$('#otpEmail').value.trim();er.hidden=true;
  try{if(otpStage===0){if(!/^\S+@\S+\.\S+$/.test(email))throw new Error('Enter the email you applied with.');
      const r=await api('/auth/otp',{method:'POST',body:JSON.stringify({email})});otpStage=1;$('#otpCodeRow').hidden=false;$('#otpBtn').textContent='Sign in';$('#otpCode').focus();
      toast('If that email has applied, a code is on its way.');if(r.devCode){$('#otpDev').hidden=false;$('#otpDev').textContent=`Local dev: your code is ${r.devCode}`}}
    else{await api('/auth/verify',{method:'POST',body:JSON.stringify({email,code:$('#otpCode').value.trim()})});otpStage=0;$('#otpDev').hidden=true;await loadMe()}
  }catch(x){er.hidden=false;er.textContent=x.message}};

/* ---------- VIEWS ---------- */
function go(v){
  if(v==='careers'&&!onCareers){location.href='/#openings';return}
  if(v==='careers'&&BOOT.job){location.href='/';return}
  currentView=v;['careers','applications','job'].forEach(x=>{const el=$('#v-'+x);if(el)el.hidden=x!==v});
  document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected',t.dataset.view===(v==='job'?'careers':v)));
  renderTray();window.scrollTo({top:0});
  if(!BOOT.job){try{history.replaceState(null,'',v==='careers'?location.pathname:'#'+v)}catch(e){}}
}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>go(t.dataset.view));
let tt;function toast(m){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,3200)}

if(onCareers&&!BOOT.job)initCareers();
loadMe();
if(BOOT.job){currentView='job';initJobPage();document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected',t.dataset.view==='careers'))}
else{const h=location.hash.slice(1);go(h==='applications'?'applications':'careers');if(h==='openings')requestAnimationFrame(()=>jump('openings'))}
renderTray();
