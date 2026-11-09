/*! Champions Talent Hub — embeddable job list for group company websites.
 * Usage:
 *   <div id="champions-jobs"></div>
 *   <script src="https://careers.championsgroup.com/embed.js" data-company="lakeb2b" data-target="#champions-jobs" async></script>
 * Renders inside a Shadow DOM so the host site's CSS can't break it. Apply happens on the official job page,
 * so candidates, consents and source tracking (src=embed) stay in one place.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.src).origin;
  var company = script.getAttribute('data-company') || '';
  var target = document.querySelector(script.getAttribute('data-target') || '#champions-jobs');
  if (!target) { target = document.createElement('div'); script.parentNode.insertBefore(target, script); }
  var accent = script.getAttribute('data-accent') || '#F28C28';
  var root = target.attachShadow ? target.attachShadow({ mode: 'open' }) : target;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  root.innerHTML = '<style>' +
    ':host{all:initial;display:block;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#211C18}' +
    '.top{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}' +
    'input,select{border:1px solid #F0E3D6;border-radius:8px;padding:9px 11px;font:inherit;min-width:0}' +
    'input{flex:1;min-width:180px}' +
    '.job{border:1px solid #F0E3D6;border-radius:12px;padding:14px 16px;margin-bottom:10px;display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap}' +
    '.job h3{margin:0 0 4px;font-size:1.05rem}.job a.t{color:inherit;text-decoration:none}.job a.t:hover{text-decoration:underline}' +
    '.meta{font-size:.82rem;color:#6A6058}.btn{background:' + accent + ';color:#211C18;border-radius:8px;padding:8px 14px;font-weight:700;text-decoration:none;white-space:nowrap}' +
    '.empty{color:#6A6058;padding:16px;border:1px dashed #F0E3D6;border-radius:12px;text-align:center}.foot{font-size:.75rem;color:#6A6058;margin-top:8px}' +
    '</style><div class="top"><input type="search" placeholder="Search roles" aria-label="Search roles"><select aria-label="Department"><option value="">All departments</option></select></div><div class="list" aria-live="polite">Loading roles…</div>' +
    '<p class="foot">We never charge a fee at any stage of hiring. Every genuine role has a requisition ID starting CG-.</p>';

  var list = root.querySelector('.list'), q = root.querySelector('input'), dept = root.querySelector('select');
  var jobs = [];
  function render() {
    var term = q.value.trim().toLowerCase(), d = dept.value;
    var r = jobs.filter(function (j) {
      return (!d || j.dept === d) && (!term || (j.title + ' ' + j.dept + ' ' + j.loc + ' ' + j.id + ' ' + j.tags.join(' ')).toLowerCase().indexOf(term) > -1);
    });
    list.innerHTML = r.length ? r.map(function (j) {
      var url = origin + '/jobs/' + encodeURIComponent(j.id) + '/' + encodeURIComponent(j.slug) + '?src=embed';
      return '<div class="job"><div><h3><a class="t" href="' + url + '" target="_blank" rel="noopener">' + esc(j.title) + '</a></h3><div class="meta">' + esc(j.dept) + ' · ' + esc(j.loc) + ' · ' + esc(j.mode) + ' · ' + esc(j.shift) + ' · ' + esc(j.exp) + (j.seats > 1 ? ' · ' + j.seats + ' positions' : '') + '</div></div><a class="btn" href="' + url + '" target="_blank" rel="noopener">View &amp; apply</a></div>';
    }).join('') : '<div class="empty">No open roles match right now.</div>';
  }
  fetch(origin + '/api/public/v1/jobs' + (company ? '?company=' + encodeURIComponent(company) : ''))
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      jobs = data.jobs;
      Object.keys(data.facets.departments).sort().forEach(function (d) { var o = document.createElement('option'); o.textContent = d; dept.appendChild(o); });
      render();
    })
    .catch(function () { list.innerHTML = '<div class="empty">Roles could not be loaded. <a href="' + origin + '/">See all roles</a>.</div>'; });
  q.addEventListener('input', render);
  dept.addEventListener('change', render);
})();
