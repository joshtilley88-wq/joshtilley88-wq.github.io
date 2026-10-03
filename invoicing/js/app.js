/* Invoicing: app shell, router, modals, email compose, printing, boot. */
'use strict';
const NAV = [
  ['dashboard', 'Dashboard', 'home'], ['invoices', 'Invoices', 'file'], ['customers', 'Customers', 'users'], ['services', 'Services', 'tag'],
  ['expenses', 'Expenses', 'receipt'], ['outbox', 'Email outbox', 'mail'], ['contracts', 'Contracts', 'pen'], ['forms', 'Questionnaires', 'clip'],
  ['reports', 'Reports', 'chart'], ['import', 'Import CSV', 'upload'], ['settings', 'Settings', 'sliders'],
];

function route() { const h = location.hash.replace(/^#\/?/, ''); const [path, qs] = h.split('?'); return { parts: (path || 'dashboard').split('/'), q: new URLSearchParams(qs || '') }; }
const go = h => { location.hash = '#/' + h; };

function renderNav() {
  const cur = route().parts[0]; const due = outboxDue().length;
  const map = { invoice: 'invoices', customer: 'customers', contract: 'contracts', form: 'forms', doc: 'invoices' };
  const on = map[cur] || cur;
  $('#sidebar').innerHTML = `<div class="brand"><img src="icon-192.png" alt="">Invoicing</div>
    <button class="btn pri side-new" data-act="quick-add">${icon('plus')} New</button>
    ${NAV.map(([k, l, i]) => `<a class="nav-a ${on === k ? 'on' : ''}" href="#/${k}">${icon(i)}<span>${l}</span>${k === 'outbox' && due ? `<span class="badge">${due}</span>` : ''}</a>`).join('')}
    <div class="spacer"></div>${syncOn() ? `<a class="tiny sync-pill" href="#/settings?tab=cloud" data-state="${SY.status}" style="padding:10px;text-decoration:none">☁ ${esc(syncStatusText())}</a>` : `<div class="tiny muted" style="padding:10px">Your data is stored only in this browser. Export a backup regularly (Settings → Data).</div>`}`;
  $('#bottomnav').innerHTML = `
    <a href="#/dashboard" class="${on === 'dashboard' ? 'on' : ''}">${icon('home')}Home</a>
    <a href="#/invoices" class="${on === 'invoices' ? 'on' : ''}">${icon('file')}Invoices</a>
    <button class="plus" data-act="quick-add" aria-label="New">${icon('plus')}</button>
    <a href="#/outbox" class="${on === 'outbox' ? 'on' : ''}">${icon('mail')}Emails${due ? `<span class="badge">${due}</span>` : ''}</a>
    <button data-act="more-menu" class="${['dashboard', 'invoices', 'outbox'].includes(on) ? '' : 'on'}">${icon('more')}More</button>`;
}

async function render() {
  if (leaveGuard && !leaveGuard()) return;
  leaveGuard = null;
  CHARTS.forEach(c => c.destroy()); CHARTS = [];
  closeModal();
  const { parts, q } = route();
  const fn = V[parts[0]] || V.dashboard;
  renderNav();
  const view = $('#view');
  try { await fn(view, parts.slice(1), q); } catch (e) { console.error(e); view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p></div>`; }
  try { renderBanners(); } catch (e) { console.warn(e); }
  window.scrollTo(0, 0);
}

/* ---------- modal + toast ---------- */
function openModal({ title, body = '', foot = '', wide = false, onClose }) {
  closeModal();
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="modal-h"><h2>${title}</h2><div class="spacer"></div><button class="btn ghost icon" data-act="close-modal" aria-label="Close">${icon('x')}</button></div><div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div>`;
  bg.addEventListener('mousedown', e => { if (e.target === bg) closeModal(); });
  bg._onClose = onClose; $('#modal-root').appendChild(bg); return bg;
}
function closeModal() { const m = $('#modal-root .modal-bg'); if (m) { m.remove(); m._onClose && m._onClose(); } }
ACT['close-modal'] = () => closeModal();
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }
function confirmBox(msg, okLabel = 'Delete', danger = true) {
  return new Promise(ok => {
    const m = openModal({ title: 'Please confirm', body: `<p>${msg}</p>`, foot: `<button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn ${danger ? 'danger' : 'pri'}" id="cf-ok">${okLabel}</button>`, onClose: () => ok(false) });
    $('#cf-ok', m).onclick = () => { m._onClose = null; closeModal(); ok(true); };
  });
}

/* ---------- email compose (mailto + copy + mark sent) ---------- */
function mailtoURL(to, subject, body) { return 'mailto:' + encodeURIComponent(to || '').replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body.replace(/\r?\n/g, '\r\n')); }
function gmailURL(to, subject, body) { return 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to || '') + '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
/* entry: outbox record (saved or not). opts.onSent callback */
function openCompose(entry, opts = {}) {
  const m0 = composeEmail(entry);
  const inv = entry.invoiceId && byId('invoices', entry.invoiceId);
  const m = openModal({
    title: esc(EMAIL_LABEL[entry.type] || 'Email') + (inv ? ' · ' + esc(inv.number) : ''), wide: true,
    body: `<div class="stack">
      <label class="f">To<input type="email" id="em-to" value="${esc(m0.to)}" placeholder="client@example.com"></label>
      <label class="f">Subject<input type="text" id="em-sub" value="${esc(m0.subject)}"></label>
      <label class="f">Message<textarea id="em-body" style="min-height:260px">${esc(m0.body)}</textarea></label>
      <div class="note" id="em-note">Opens your email app with everything filled in. Attach a PDF if you want one (use <b>View / Print → Save as PDF</b> first). Then come back and tap <b>Mark as sent</b>.</div>
    </div>`,
    foot: `${entry.id ? `<button class="btn ghost" id="em-skip">Skip / dismiss</button>` : ''}<div class="spacer"></div>
      <button class="btn" id="em-copy">${icon('copy')} Copy email</button>
      <a class="btn" id="em-gmail" target="_blank" rel="noopener">Open in Gmail</a>
      <a class="btn out" id="em-open">${icon('send')} Open in email app</a>
      <button class="btn pri" id="em-sent">${icon('check')} Mark as sent</button>`,
  });
  const val = () => ({ to: $('#em-to', m).value.trim(), subject: $('#em-sub', m).value, body: $('#em-body', m).value });
  const upd = () => { const v = val(); const u = mailtoURL(v.to, v.subject, v.body); $('#em-open', m).href = u; $('#em-gmail', m).href = gmailURL(v.to, v.subject, v.body);
    $('#em-note', m).classList.toggle('pink', u.length > 1900); if (u.length > 1900) $('#em-note', m).innerHTML = 'This email is long. Some desktop email apps cut off very long mailto links, so if the text looks cut off, use <b>Copy email</b> and paste it instead. Gmail usually handles it fine.'; };
  m.addEventListener('input', upd); upd();
  $('#em-copy', m).onclick = async () => { const v = val(); toast(await copyText(`To: ${v.to}\nSubject: ${v.subject}\n\n${v.body}`) ? 'Email copied' : 'Copy failed'); };
  const persist = async status => {
    const v = val(); const e = entry;
    if (v.subject !== m0.subject || v.body !== m0.body) { e.subject = v.subject; e.body = v.body; }
    e.to = v.to; if (status) { e.status = status; if (status === 'sent') e.sentAt = new Date().toISOString(); }
    if (!e.scheduledDate) e.scheduledDate = today();
    await save('outbox', e);
  };
  $('#em-sent', m).onclick = async () => {
    await persist('sent');
    if (inv && !inv.sent && ['deposit', 'balance', 'invoice'].includes(entry.type)) { inv.sent = true; inv.sentAt = today(); await save('invoices', inv); }
    if (entry.type === 'contract') { const k = byId('contracts', entry.contractId); if (k && k.status === 'draft') { k.status = 'sent'; k.sentAt = today(); await save('contracts', k); } }
    closeModal(); toast('Marked as sent'); opts.onSent ? opts.onSent() : render();
  };
  const sk = $('#em-skip', m); if (sk) sk.onclick = async () => { await persist('skipped'); closeModal(); toast('Dismissed'); render(); };
  return m;
}

/* ---------- printing ---------- */
function printHTML(html) {
  const pr = $('#print-root'); pr.innerHTML = html; document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); pr.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(() => { if (!window.matchMedia('print').matches) done(); }, 500); }, 60);
}

/* ---------- quick add / more menu ---------- */
ACT['quick-add'] = () => openModal({ title: 'Create new', body: `<div class="list">
  ${[['invoice/new', 'Invoice', 'file', ''], ['invoice/new?kind=quote', 'Quote', 'edit', 'lav'], ['expenses?new=1', 'Expense receipt', 'receipt', 'warn'], ['customer/new', 'Customer', 'user', 'ok'], ['contracts?new=1', 'Contract to sign', 'pen', 'lav'], ['forms?send=1', 'Send questionnaire', 'clip', '']]
    .map(([h, l, i, c]) => `<a class="li" href="#/${h}" style="text-decoration:none;color:inherit"><span class="ic ${c}">${icon(i)}</span><span class="grow t">${l}</span></a>`).join('')}</div>` });
ACT['more-menu'] = () => openModal({ title: 'Menu', body: `<div class="list">${NAV.map(([k, l, i]) => `<a class="li" href="#/${k}" style="text-decoration:none;color:inherit"><span class="ic lav">${icon(i)}</span><span class="grow t">${l}</span></a>`).join('')}</div>` });

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = ACT[el.dataset.act]; if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('click', e => { const a = e.target.closest('a[href^="#/"]'); if (a && $('#modal-root .modal-bg')) closeModal(); }, true);

/* ---------- boot ---------- */
async function boot() {
  const h = location.hash;
  if (/^#(sign|q)=/.test(h)) { await PUBLIC.render(h); return; }   // client-facing pages: never touch the owner's data
  try { await DB.open(); await loadAll(); await loadDevice(); await loadSync(); }
  catch (e) { $('#view').innerHTML = `<div class="card"><h2>Storage unavailable</h2><p>This browser blocked local storage (private mode?). ${esc(e.message || e)}</p></div>`; return; }
  if (isAuthHash(h) && cloudEnabled()) {   // came back from the sign-in link in the email
    history.replaceState(null, '', location.pathname + location.search + '#/settings?tab=cloud');
    try { await cloudAuthFromHash(h); setTimeout(() => toast('Signed in'), 300); } catch (e) { setTimeout(() => toast(e.message), 300); }
  }
  window.addEventListener('hashchange', () => { if (/^#(sign|q)=/.test(location.hash)) { location.reload(); return; } render(); });
  await render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { });
  // background jobs: Drive auto-backup + due-email notification, on open and whenever the app comes back to the front
  const wake = () => { autoBackup().catch(() => { }); dueNotifyCheck().catch(() => { }); if (syncOn()) syncNow('focus').catch(() => { }); };
  startSync();
  wake();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
  window.addEventListener('focus', wake);
}
boot();
