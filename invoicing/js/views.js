/* Invoicing: main screens (dashboard, invoices, customers, services, expenses, outbox) + documents. */
'use strict';
const V = {};
const pill = s => `<span class="pill ${s}">${esc(s.replace('-', ' '))}</span>`;
const pageH = (title, sub = '', actions = '', back = '') => `<div class="page-h">${back ? `<a class="btn ghost icon" href="#/${back}" aria-label="Back">${icon('back')}</a>` : ''}<div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="spacer"></div>${actions}</div>`;
const custOptions = (sel, blank = 'Select customer…') => `<option value="">${blank}</option>` + [...S.customers].sort((a, b) => custName(a).localeCompare(custName(b))).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(custName(c))}</option>`).join('');
/* ---------- customer picker: type to filter by name, business, email or phone; add a new customer inline ----------
 * custPicker(id, selectedId) renders a hidden <input id=id> holding the customer id (fires 'change' like a select). */
const custPicker = (id, sel, ph = 'Search name, email or phone…') => { const c = byId('customers', sel);
  return `<div class="cpick" data-for="${id}"><input type="hidden" id="${id}" value="${esc(c ? c.id : '')}"><div class="cpick-box">${icon('search')}<input type="text" class="cpick-q" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="${esc(ph)}" value="${esc(c ? custName(c) : '')}" aria-label="Customer"></div><div class="cpick-list" hidden></div></div>`; };
const CPK = { max: 60 };
const digits = v => String(v || '').replace(/\D/g, '');
function cpIndex() {
  if (CPK.src === S.customers && CPK.n === S.customers.length) return CPK.idx;   // rebuilt each time the list opens
  CPK.idx = [...S.customers].sort((a, b) => custName(a).localeCompare(custName(b))).map(c => ({ c, label: custName(c), n: (custName(c) + ' ' + (c.name || '')).toLowerCase(), hay: [c.name, c.business, c.email, c.phone].join(' ').toLowerCase(), ph: digits(c.phone) }));
  CPK.src = S.customers; CPK.n = S.customers.length; return CPK.idx;
}
function cpFilter(q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean); const all = cpIndex(); if (!toks.length) return all;
  if (/^[\d\s()+-]+$/.test(q) && digits(q).length >= 3) {   // looks like a phone number: compare digits only (+61 4.. = 04..)
    let d = digits(q); const alt = d.startsWith('61') && d.length > 3 ? '0' + d.slice(2) : null;
    return all.filter(x => x.ph.includes(d) || (alt && x.ph.includes(alt)) || x.hay.includes(q.trim().toLowerCase()));
  }
  const out = [];
  for (const x of all) { let okk = true; for (const t of toks) { const d = digits(t); if (!(x.hay.includes(t) || (d.length >= 3 && d.length === t.replace(/[\s()+-]/g, '').length && x.ph.includes(d)))) { okk = false; break; } } if (okk) out.push(x); }
  const t0 = toks[0]; return out.sort((a, b) => (b.n.startsWith(t0) - a.n.startsWith(t0)));
}
function cpOpen(el) {
  const q = $('.cpick-q', el), list = $('.cpick-list', el), cur = $('input[type=hidden]', el).value;
  const typed = q.value.trim(), selName = custName(byId('customers', cur)); const term = cur && typed === selName ? '' : typed;
  const res = cpFilter(term), shown = res.slice(0, CPK.max);
  list.innerHTML = `<div class="cp-row cp-add" data-new="1">${icon('plus')}<div class="grow"><b>Add new customer</b>${term ? ` <span class="muted">“${esc(term)}”</span>` : ''}</div></div>` +
    (shown.map(x => `<div class="cp-row${x.c.id === cur ? ' sel' : ''}" data-cid="${x.c.id}"><div class="grow"><div class="cp-n">${esc(x.label)}</div>${x.c.email || x.c.phone ? `<div class="cp-s">${esc([x.c.email, x.c.phone].filter(Boolean).join(' · '))}</div>` : ''}</div></div>`).join('') ||
      `<div class="cp-none small muted">No customers match “${esc(term)}”.</div>`) +
    (res.length > shown.length ? `<div class="cp-more tiny muted">Showing ${shown.length} of ${res.length}. Keep typing to narrow it down.</div>` : '');
  list.hidden = false; el.classList.add('open'); CPK.hi = -1;
}
function cpClose(el, restore = true) { const list = $('.cpick-list', el); list.hidden = true; el.classList.remove('open'); if (restore) { const c = byId('customers', $('input[type=hidden]', el).value); $('.cpick-q', el).value = c ? custName(c) : ''; } }
function cpChoose(el, id) { const h = $('input[type=hidden]', el); h.value = id; cpClose(el); h.dispatchEvent(new Event('change', { bubbles: true })); }
function cpAddForm(el) {
  const term = $('.cpick-q', el).value.trim(); const isMail = /@/.test(term), isPh = !isMail && digits(term).length >= 6 && /^[\d\s()+-]+$/.test(term);
  const list = $('.cpick-list', el);
  list.innerHTML = `<div class="cp-form"><div class="small" style="font-weight:650;margin-bottom:8px">New customer</div>
    <label class="f">Name<input type="text" data-nk="name" value="${esc(!isMail && !isPh ? term : '')}"></label><label class="f">Email<input type="email" data-nk="email" value="${esc(isMail ? term : '')}"></label><label class="f">Phone<input type="tel" data-nk="phone" value="${esc(isPh ? term : '')}"></label>
    <div class="row" style="margin-top:10px"><button type="button" class="btn pri sm" data-cpadd="1">${icon('check')} Add customer</button><button type="button" class="btn ghost sm" data-cpcancel="1">Cancel</button></div></div>`;
  list.hidden = false; el.classList.add('open', 'adding'); setTimeout(() => $('[data-nk=name]', list).focus(), 0);
}
document.addEventListener('focusin', e => { const q = e.target.closest && e.target.closest('.cpick-q'); if (q) { const el = q.closest('.cpick'); if (!el.classList.contains('adding')) { CPK.src = null; cpOpen(el); q.select(); } } });
document.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('cpick-q')) { const el = e.target.closest('.cpick'); el.classList.remove('adding'); cpOpen(el); } });
document.addEventListener('mousedown', e => { const r = e.target.closest && e.target.closest('.cp-row'); if (r) e.preventDefault(); }, true);
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.cpick-list') && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) e.preventDefault(); }, true);   // the picker sits inside a <label>: stop it refocusing the search box
document.addEventListener('click', async e => {
  const t = e.target.closest && e.target.closest('.cp-row, [data-cpadd], [data-cpcancel]'); if (!t) return; const el = t.closest('.cpick'); if (!el) return;
  if (t.dataset.cid) cpChoose(el, t.dataset.cid);
  else if (t.dataset.new) cpAddForm(el);
  else if (t.dataset.cpcancel) { el.classList.remove('adding'); cpClose(el); }
  else if (t.dataset.cpadd) {
    const o = { createdAt: new Date().toISOString() }; $$('[data-nk]', el).forEach(i => o[i.dataset.nk] = i.value.trim());
    if (!o.name && !o.email) { toast('Enter a name or email'); return; }
    if (!o.name) o.name = o.email.split('@')[0];
    await save('customers', o); CPK.src = null; el.classList.remove('adding'); toast('Customer added'); cpChoose(el, o.id);
  }
});
document.addEventListener('keydown', e => {
  const q = e.target.classList && e.target.classList.contains('cpick-q') ? e.target : null; if (!q) return; const el = q.closest('.cpick'), rows = $$('.cp-row', el);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if ($('.cpick-list', el).hidden) cpOpen(el); CPK.hi = Math.max(0, Math.min(rows.length - 1, (CPK.hi ?? -1) + (e.key === 'ArrowDown' ? 1 : -1))); rows.forEach((r, i) => r.classList.toggle('hi', i === CPK.hi)); rows[CPK.hi]?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter') { e.preventDefault(); const r = rows[CPK.hi >= 0 ? CPK.hi : (rows.length > 1 && q.value.trim() ? 1 : -1)]; if (r) r.click(); }
  else if (e.key === 'Escape') { cpClose(el); q.blur(); }
});
document.addEventListener('focusout', e => { const el = e.target.closest && e.target.closest('.cpick'); if (!el) return; setTimeout(() => { if (!el.contains(document.activeElement)) { el.classList.remove('adding'); cpClose(el); } }, 120); });

const demoBanner = () => S.settings.demo ? `<div class="note pink no-print" style="margin-bottom:16px">${icon('alert')} <b>Demo data is loaded.</b> Everything here is fake sample data. When you're ready to use the app for real, go to Settings → Data → <b>Clear all data</b>.</div>` : '';

/* ======================= DASHBOARD ======================= */
function outboxRow(e, compact = false) {
  const inv = e.invoiceId && byId('invoices', e.invoiceId); const cu = byId('customers', e.customerId || inv?.customerId);
  const rc = isReceipt(e), late = !rc && (e.scheduledDate || '') < today(), due = !rc && (e.scheduledDate || '') <= today();
  const ic = { deposit: ['dollar', ''], balance: ['clock', 'lav'], receipt: ['receipt', 'ok'], contract: ['pen', 'lav'], questionnaire: ['clip', ''], invoice: ['file', ''] }[e.type] || ['mail', ''];
  let amt = '';
  if (inv && e.type === 'deposit') { const c = invCalc(inv); amt = money(Math.max(0, depositAmount(inv, c) - c.paid)); } else if (inv && e.type === 'balance') amt = money(invCalc(inv).balance);
  else if (rc) { const p = byId('payments', e.paymentId); if (p) amt = money(p.amount) + ' paid'; }
  // wording is about sending the email, never about money owing
  const when = rc ? 'Send a receipt? (optional)' : late ? `<b style="color:var(--pink-d)">ready to send</b> · was scheduled for ${fmtD(e.scheduledDate)}` : due ? '<b style="color:var(--pink-d)">send today</b>' : 'scheduled ' + fmtD(e.scheduledDate);
  return `<div class="ob ${due ? 'due' : ''}" data-ob="${e.id}"><span class="ic ${ic[1]}">${icon(ic[0])}</span>
    <div class="grow"><div class="t" style="font-weight:600">${esc(EMAIL_LABEL[e.type] || 'Email')}${inv ? ' · ' + esc(inv.number) : ''} ${amt ? `<span class="num">· ${amt}</span>` : ''}</div>
    <div class="s small muted">${esc(custName(cu))} · ${when}</div></div>
    <button class="btn ghost sm" data-act="skip-email" data-id="${e.id}" title="Skip: take it off the list without sending">Skip</button>
    <button class="btn ${due ? 'pri' : ''} sm" data-act="send-email" data-id="${e.id}">${icon('send')} ${rc ? 'Send receipt' : compact ? 'Send' : 'Open & send'}</button></div>`;
}
ACT['skip-email'] = async el => {
  const e = byId('outbox', el.dataset.id); if (!e) return;
  e.status = 'skipped'; e.skipReason = 'manual'; e.skippedAt = new Date().toISOString(); await save('outbox', e);
  toast(isReceipt(e) ? 'Receipt skipped' : 'Skipped. It\'s under Sent & skipped if you need it'); render();
};
ACT['send-email'] = el => { const e = byId('outbox', el.dataset.id); if (e) openCompose(e); };

V.dashboard = async view => {
  const t = today(), due = outboxDue(), soon = outboxActive().filter(e => !isReceipt(e) && e.scheduledDate > t && e.scheduledDate <= addDays(t, 7));
  const invs = S.invoices.filter(i => i.kind !== 'quote');
  let outstanding = 0, overdueAmt = 0, overdueN = 0;
  for (const i of invs) { const c = invCalc(i); const st = invStatus(i, c); if (st !== 'draft' && c.balance > 0) outstanding += c.balance; if (st === 'overdue') { overdueAmt += c.balance; overdueN++; } }
  const [ms, me] = rangePreset('this-month');
  const recvMonth = S.payments.filter(p => p.date >= ms && p.date <= me).reduce((a, p) => a + num(p.amount), 0);
  const expMonth = S.expenses.filter(x => x.date >= ms && x.date <= me).reduce((a, x) => a + num(x.amount), 0);
  const [fs, fe] = rangePreset('this-fy'); const pl = plData(fs, fe);
  const months = monthsBetween(addDays(ms, -160).slice(0, 8) + '01', me).slice(-6);
  const inc = months.map(k => S.payments.filter(p => monthKey(p.date) === k).reduce((a, p) => a + num(p.amount), 0)); const mx = Math.max(1, ...inc);
  const recent = [...S.invoices].sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 6);
  const name = S.settings.business.name;
  view.innerHTML = `${demoBanner()}${notifyPromptHTML()}${pageH(`Hi${name ? ', ' + esc(name) : ''}`, new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), `<a class="btn pri" href="#/invoice/new">${icon('plus')} New invoice</a>`)}
  <div class="card alert-card" style="margin-bottom:18px">
    <div class="card-h"><span class="ic">${icon('mail')}</span><div><h2>Emails to send ${due.length ? `<span class="badge">${due.length}</span>` : ''}</h2><div class="small muted">Ready to send today. Open each one, send it, then mark it sent (or Skip it).</div></div><div class="spacer"></div><a class="btn ghost sm" href="#/outbox">View outbox</a></div>
    ${due.length ? due.map(e => outboxRow(e)).join('') : `<div class="empty" style="padding:14px">${icon('check')} All caught up. Nothing due today.</div>`}
    ${soon.length ? `<div class="small muted" style="margin:14px 0 8px;font-weight:600">Coming up in the next 7 days</div>${soon.map(e => outboxRow(e, true)).join('')}` : ''}
  </div>
  <div class="grid" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr);margin-bottom:18px" id="dash-top">
    <div class="hero"><div class="lbl">Received this month</div><div class="big num">${money(recvMonth)}</div><div class="small" style="opacity:.85">${money(outstanding)} still outstanding</div>
      <div class="mini">${inc.map((v, i) => `<span class="${i === inc.length - 1 ? 'cur' : ''}" style="height:${Math.max(6, v / mx * 100)}%" title="${money(v)}"></span>`).join('')}</div>
      <div class="mini-l">${months.map(k => `<span>${monthLabel(k).split(' ')[0]}</span>`).join('')}</div></div>
    <div class="grid g-stats" style="gap:18px">
      <a class="card stat" href="#/invoices?f=unpaid" style="text-decoration:none;color:inherit"><div class="row nw"><span class="ic lav">${icon('file')}</span><span class="l">Outstanding</span></div><div class="v num">${money(outstanding)}</div></a>
      <a class="card stat" href="#/invoices?f=overdue" style="text-decoration:none;color:inherit"><div class="row nw"><span class="ic bad">${icon('alert')}</span><span class="l">Overdue (${overdueN})</span></div><div class="v num">${money(overdueAmt)}</div></a>
    </div>
    <div class="grid g-stats" style="gap:18px">
      <a class="card stat" href="#/expenses" style="text-decoration:none;color:inherit"><div class="row nw"><span class="ic warn">${icon('receipt')}</span><span class="l">Expenses this month</span></div><div class="v num">${money(expMonth)}</div></a>
      <a class="card stat" href="#/reports" style="text-decoration:none;color:inherit"><div class="row nw"><span class="ic ok">${icon('trend')}</span><span class="l">Net profit this FY</span></div><div class="v num">${money(pl.net)}</div></a>
    </div>
  </div>
  <div class="grid g2" style="align-items:start">
    <div id="cf-card"></div>
    <div class="card"><div class="card-h"><h2>Recent invoices</h2><div class="spacer"></div><a class="btn ghost sm" href="#/invoices">See all</a></div>
      <div class="list">${recent.length ? recent.map(invRow).join('') : `<div class="empty">No invoices yet.<br><br><a class="btn pri" href="#/invoice/new">Create your first invoice</a> <a class="btn" href="#/settings?tab=data">Load demo data</a></div>`}</div></div>
  </div>`;
  if (window.innerWidth < 1000) $('#dash-top').style.gridTemplateColumns = '1fr';
  renderCashflowCard($('#cf-card'), true);
  bindNotifyPrompt(view);
};
function invRow(i) {
  const c = invCalc(i), st = invStatus(i, c), cu = byId('customers', i.customerId);
  const ic = { paid: 'ok', overdue: 'bad', 'part-paid': 'warn', sent: 'lav' }[st] || '';
  return `<a class="li" href="#/invoice/${i.id}" style="text-decoration:none;color:inherit"><span class="ic ${ic}">${icon(i.kind === 'quote' ? 'edit' : 'file')}</span>
    <div class="grow"><div class="t">${esc(custName(cu))}</div><div class="s">${esc(i.number)} · ${fmtD(i.issueDate)}</div></div>
    <div class="right"><div class="num" style="font-weight:700">${money(c.total)}</div>${i.kind === 'quote' ? pill('quote') : pill(st)}</div></a>`;
}

/* ======================= INVOICES LIST ======================= */
V.invoices = async (view, _, q) => {
  const f = q.get('f') || 'all';
  const filters = [['all', 'All'], ['draft', 'Draft'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['quotes', 'Quotes']];
  view.innerHTML = `${demoBanner()}${pageH('Invoices', 'Create, track and get paid', `<a class="btn" href="#/invoice/new?kind=quote">${icon('plus')} Quote</a><a class="btn pri" href="#/invoice/new">${icon('plus')} New invoice</a>`)}
  <div class="row" style="margin-bottom:16px"><div class="seg">${filters.map(([k, l]) => `<button data-f="${k}" class="${k === f ? 'on' : ''}">${l}</button>`).join('')}</div><div class="spacer"></div><input type="search" class="search" id="inv-s" placeholder="Search number or customer"></div>
  <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Number</th><th>Customer</th><th>Issued</th><th>Due</th><th class="right">Total</th><th class="right">Balance</th><th>Status</th></tr></thead><tbody id="inv-tb"></tbody></table></div></div>`;
  const draw = () => {
    const s = $('#inv-s').value.toLowerCase();
    const rows = [...S.invoices].sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || b.number.localeCompare(a.number, undefined, { numeric: true })).filter(i => {
      const c = invCalc(i), st = invStatus(i, c);
      if (f === 'quotes' ? i.kind !== 'quote' : (f !== 'all' && i.kind === 'quote')) return false;
      if (f === 'draft' && st !== 'draft') return false; if (f === 'paid' && st !== 'paid') return false; if (f === 'overdue' && st !== 'overdue') return false;
      if (f === 'unpaid' && (st === 'paid' || st === 'draft')) return false;
      return !s || (i.number + ' ' + custName(byId('customers', i.customerId))).toLowerCase().includes(s);
    });
    $('#inv-tb').innerHTML = rows.map(i => { const c = invCalc(i); return `<tr class="click" data-href="invoice/${i.id}"><td><b>${esc(i.number)}</b></td><td>${esc(custName(byId('customers', i.customerId)))}</td><td class="num">${fmtD(i.issueDate)}</td><td class="num">${fmtD(i.dueDate)}</td><td class="right num">${money(c.total)}</td><td class="right num">${i.kind === 'quote' ? '' : money(c.balance)}</td><td>${i.kind === 'quote' ? pill('quote') + ' ' : ''}${pill(invStatus(i, c))}</td></tr>`; }).join('') || `<tr><td colspan="7" class="empty">Nothing here yet.</td></tr>`;
  };
  $$('.seg button', view).forEach(b => b.onclick = () => go('invoices?f=' + b.dataset.f));
  $('#inv-s').oninput = draw; draw();
};
document.addEventListener('click', e => { const tr = e.target.closest('tr[data-href]'); if (tr) go(tr.dataset.href); });

/* ======================= INVOICE EDITOR ======================= */
function newInvoice(kind, customerId) {
  const st = S.settings, { number, n } = nextNumber(kind), issue = today();
  return { id: '', kind, number, _n: n, customerId: customerId || '', issueDate: issue, dueDate: addDays(issue, +st.business.termsDays || 14), items: [], notes: '', sent: false,
    deposit: depositDefault(st), depositDue: issue, balanceEmailDate: addDays(issue, +st.business.termsDays || 14), balanceDateManual: false, emailDeposit: true, emailBalance: true, createdAt: new Date().toISOString() };
}
V.invoice = async (view, [id], q) => {
  let inv;
  if (id === 'new') { inv = newInvoice(q.get('kind') === 'quote' ? 'quote' : 'invoice', q.get('customer')); }
  else { inv = byId('invoices', id); if (!inv) { view.innerHTML = '<div class="card empty">Invoice not found.</div>'; return; } inv = structuredClone(inv); }
  let dirty = id === 'new' ? false : false;
  const isQ = () => inv.kind === 'quote';
  const gstOn = S.settings.business.gstRegistered !== false;
  const draw = () => {
    const c = invCalc(inv), st = inv.id ? invStatus(inv, c) : 'draft', pays = S.payments.filter(p => p.invoiceId === inv.id).sort((a, b) => a.date.localeCompare(b.date));
    view.innerHTML = `${pageH(`${inv.id ? '' : 'New '}${isQ() ? 'Quote' : 'Invoice'} <span class="muted" style="font-weight:500">${esc(inv.number)}</span>`, inv.id ? pill(st) : 'Not saved yet', `
      ${inv.id ? `<a class="btn" href="#/doc/invoice/${inv.id}">${icon('printer')} View / Print</a>` : ''}
      <button class="btn pri" id="ie-save">${icon('check')} Save</button>`, 'invoices')}
    <div class="ed-layout">
      <div class="stack">
        <div class="card"><div class="grid g2">
          <label class="f">Customer<div class="row nw">${custPicker('ie-cust', inv.customerId)}<button class="btn icon" id="ie-newcust" title="New customer">${icon('plus')}</button></div></label>
          <label class="f">${isQ() ? 'Quote' : 'Invoice'} number<input type="text" id="ie-num" value="${esc(inv.number)}"></label>
          <label class="f">Issue date<input type="date" id="ie-issue" value="${inv.issueDate || ''}"></label>
          <label class="f">${isQ() ? 'Valid until' : 'Due date'}<input type="date" id="ie-due" value="${inv.dueDate || ''}"></label>
        </div>${!isQ() ? `<div class="row" style="margin-top:14px"><label class="chk"><input type="checkbox" id="ie-sent" ${inv.sent ? 'checked' : ''}> Sent to customer</label><span class="small muted">(drafts are excluded from outstanding totals; overdue = sent and past the due date)</span></div>` : `<div class="row" style="margin-top:14px"><label class="chk"><input type="checkbox" id="ie-sent" ${inv.sent ? 'checked' : ''}> Sent</label><label class="chk"><input type="checkbox" id="ie-acc" ${inv.accepted ? 'checked' : ''}> Accepted</label></div>`}</div>

        <div class="card"><div class="card-h"><h2>Items</h2></div>
          <div class="lines" id="ie-lines">${inv.items.map((it, k) => lineRow(it, k)).join('') || '<div class="lines-empty small muted">No items yet. Tap <b>Add items</b> to pick from your services or add a custom item.</div>'}</div>
          <button type="button" class="btn add-items" id="ie-additems">${icon('plus')} Add items</button>
        </div>
        <div class="card"><label class="f">Notes / terms shown on the ${isQ() ? 'quote' : 'invoice'}<textarea id="ie-notes" placeholder="${esc(S.settings.business.paymentTerms)}">${esc(inv.notes || '')}</textarea></label></div>
        ${!isQ() ? `<div class="card"><div class="card-h"><span class="ic">${icon('mail')}</span><div><h2>Payment emails</h2><div class="small muted">Two scheduled emails go into your outbox. You'll see them on the dashboard on the day.</div></div></div>
          <div class="grid g2">
            <div class="stack"><label class="chk"><input type="checkbox" id="ie-edep" ${inv.emailDeposit !== false ? 'checked' : ''}> <b>1. Deposit email</b></label>
              <div class="row nw"><div class="seg" id="ie-dtype"><button data-v="pct" class="${inv.deposit.type !== 'amt' ? 'on' : ''}">%</button><button data-v="amt" class="${inv.deposit.type === 'amt' ? 'on' : ''}">$</button></div><input type="number" step="any" id="ie-dval" value="${inv.deposit.value}"></div>
              <div class="small">Deposit: <b class="num" id="ie-damt">${money(depositAmount(inv, c))}</b></div>
              <label class="f">Send on<input type="date" id="ie-ddate" value="${inv.depositDue || inv.issueDate}"></label></div>
            <div class="stack"><label class="chk"><input type="checkbox" id="ie-ebal" ${inv.emailBalance !== false ? 'checked' : ''}> <b>2. Remaining balance email</b></label>
              <div class="small muted">Asks for whatever is unpaid on the day you send it.</div>
              <label class="f">Send on<input type="date" id="ie-bdate" value="${(balanceFollowsDue(inv) ? inv.dueDate : inv.balanceEmailDate) || inv.dueDate || ''}"></label>
              <div class="tiny muted" id="ie-bnote">${balanceFollowsDue(inv) ? 'Follows the due date.' : `Custom date (due date is ${fmtD(inv.dueDate)}). <a href="#" id="ie-bfollow">Use the due date</a>`}</div></div>
          </div></div>` : ''}
      </div>
      <div class="stack sticky">
        <div class="card"><div class="totals" style="max-width:none">
          <div class="tr"><span class="muted">Subtotal</span><span class="num" id="t-sub">${money(c.gross)}</span></div>
          ${c.disc ? `<div class="tr"><span class="muted">Discounts</span><span class="num">−${money(c.disc)}</span></div>` : ''}
          <div class="tr"><span class="muted">GST (10%)</span><span class="num" id="t-gst">${money(c.gst)}</span></div>
          <div class="tr big"><span>Total</span><span class="num" id="t-tot">${money(c.total)}</span></div>
          ${!isQ() && inv.id ? `<div class="tr"><span class="muted">Paid</span><span class="num">${money(c.paid)}</span></div><div class="tr due"><span>Balance due</span><span class="num">${money(c.balance)}</span></div>` : ''}
        </div>${!gstOn ? '<div class="small muted">Settings say you are not registered for GST, so new items default to no GST.</div>' : ''}</div>
        ${!isQ() ? `<div class="card"><div class="card-h"><h2>Payments</h2><div class="spacer"></div><button class="btn pri sm" id="ie-pay">${icon('plus')} Record payment</button></div>
          <div class="list">${pays.map(p => `<div class="li" style="cursor:default"><span class="ic ok">${icon('dollar')}</span><div class="grow"><div class="t num">${money(p.amount)}</div><div class="s">${fmtD(p.date)} · ${esc(p.method || '')}</div></div>
            <button class="btn ghost icon" data-act="receipt-menu" data-id="${p.id}" title="Receipt">${icon('receipt')}</button><button class="btn ghost icon" data-act="del-payment" data-id="${p.id}" title="Delete">${icon('trash')}</button></div>`).join('') || '<div class="small muted">No payments yet.</div>'}</div></div>` : ''}
        ${inv.id ? `<div class="card"><h3 style="margin-bottom:10px">Actions</h3><div class="row">
          ${!isQ() ? `<button class="btn sm" data-act="email-pdf" data-id="${inv.id}">${icon('mail')} Email PDF</button>` : `<button class="btn sm" data-act="convert-quote" data-id="${inv.id}">${icon('file')} Convert to invoice</button>`}
          <button class="btn sm" data-act="dup-invoice" data-id="${inv.id}">${icon('copy')} Duplicate</button>
          <button class="btn sm danger" data-act="del-invoice" data-id="${inv.id}">${icon('trash')} Delete</button></div></div>` : ''}
      </div>
    </div>`;
    bind();
  };
  const recalc = () => {
    const c = invCalc(inv); $('#t-sub').textContent = money(c.gross); $('#t-gst').textContent = money(c.gst); $('#t-tot').textContent = money(c.total);
    if ($('#ie-damt')) $('#ie-damt').textContent = money(depositAmount(inv, c));
  };
  const bind = () => {
    const v = id => $('#' + id);
    v('ie-cust').onchange = e => { inv.customerId = e.target.value; dirty = true; };
    v('ie-num').oninput = e => { inv.number = e.target.value.trim(); dirty = true; };
    v('ie-issue').onchange = e => { const old = inv.issueDate; inv.issueDate = e.target.value; if (inv.depositDue === old) inv.depositDue = inv.issueDate; dirty = true; draw(); };
    v('ie-due').onchange = e => { const follow = balanceFollowsDue(inv); inv.dueDate = e.target.value; if (follow) { inv.balanceEmailDate = inv.dueDate; inv.balanceDateManual = false; } dirty = true; draw(); };
    v('ie-sent').onchange = e => { inv.sent = e.target.checked; dirty = true; };
    if (v('ie-acc')) v('ie-acc').onchange = e => { inv.accepted = e.target.checked; dirty = true; };
    v('ie-notes').oninput = e => { inv.notes = e.target.value; dirty = true; };
    $$('#ie-lines .line').forEach(r => r.onclick = () => { const k = +r.dataset.k; itemSheet(inv.items[k], gstOn, it => { inv.items[k] = it; dirty = true; draw(); }, () => { inv.items.splice(k, 1); dirty = true; draw(); }); });
    v('ie-additems').onclick = () => servicePicker(gstOn, items => { inv.items.push(...items); dirty = true; draw(); });
    if (v('ie-edep')) {
      v('ie-edep').onchange = e => { inv.emailDeposit = e.target.checked; dirty = true; };
      v('ie-ebal').onchange = e => { inv.emailBalance = e.target.checked; dirty = true; };
      $$('#ie-dtype button').forEach(b => b.onclick = () => { const c = invCalc(inv); const cur = depositAmount(inv, c); inv.deposit = b.dataset.v === 'amt' ? { type: 'amt', value: cur } : { type: 'pct', value: c.total ? r2(cur / c.total * 100) : S.settings.depositPct }; dirty = true; draw(); });
      v('ie-dval').oninput = e => { inv.deposit.value = num(e.target.value); dirty = true; recalc(); };
      v('ie-ddate').onchange = e => { inv.depositDue = e.target.value; dirty = true; };
      v('ie-bdate').onchange = e => { const d = e.target.value; if (!d || d === inv.dueDate) { inv.balanceEmailDate = inv.dueDate; inv.balanceDateManual = false; } else { inv.balanceEmailDate = d; inv.balanceDateManual = true; } dirty = true; draw(); };
      if (v('ie-bfollow')) v('ie-bfollow').onclick = e => { e.preventDefault(); inv.balanceEmailDate = inv.dueDate; inv.balanceDateManual = false; dirty = true; draw(); };
    }
    v('ie-newcust').onclick = () => editCustomerModal(null, async c => { inv.customerId = c.id; dirty = true; draw(); });
    v('ie-save').onclick = async () => { if (await doSave()) { toast('Saved'); if (id === 'new') { leaveGuard = null; location.replace('#/invoice/' + inv.id); } else draw(); } };
    if (v('ie-pay')) v('ie-pay').onclick = async () => { if (!inv.id || dirty) { if (!await doSave()) return; } recordPaymentModal(byId('invoices', inv.id)); };
  };
  const doSave = async () => {
    if (!inv.number) { toast('Please enter a number'); return false; }
    if (S.invoices.some(x => x.number === inv.number && x.id !== inv.id)) { toast('That number is already used'); return false; }
    if (!inv.customerId) { toast('Please choose a customer'); return false; }
    const isNew = !inv.id; const n = inv._n; delete inv._n;
    await save('invoices', inv);
    if (isNew) { const m = inv.number.match(/(\d+)\s*$/); await bumpNumber(inv.kind, m ? +m[1] : n); }
    await syncInvoiceEmails(inv); dirty = false; renderNav(); return true;
  };
  leaveGuard = () => !dirty || confirm('You have unsaved changes. Leave without saving?');
  leaveGuard.clean = () => !dirty && !!inv.id;   // lets a sync redraw a saved, unchanged invoice
  draw();
};

/* ---------- line item rows, item edit sheet, service picker ---------- */
const fmtQty = q => { const n = num(q); return Number.isInteger(n) ? String(n) : String(+n.toFixed(3)); };
const lineRow = (it, k) => `<button type="button" class="line" data-k="${k}"><div class="grow"><div class="ln-t">${esc(it.desc || 'Untitled item')}</div>${it.details ? `<div class="ln-d">${esc(it.details)}</div>` : ''}<div class="ln-q num">${fmtQty(it.qty)} x ${money(it.price)}${num(it.discountPct) ? ` · ${num(it.discountPct)}% off` : ''}${it.gst ? ' · GST' : ''}</div></div><div class="ln-a num">${money(lineCalc(it).net)}</div>${icon('chev', 'ln-c')}</button>`;
function itemSheet(item, gstOn, onDone, onRemove) {
  const isNew = !item, it = Object.assign({ desc: '', details: '', qty: 1, price: 0, discountPct: 0, gst: gstOn }, structuredClone(item || {}));
  const m = openModal({ title: isNew ? 'Custom item' : 'Edit item', body: `<div class="stack">
    <label class="f">Item<input type="text" id="it-desc" value="${esc(it.desc)}" placeholder="Item name"></label>
    <label class="f">Description<textarea id="it-details" rows="3" placeholder="Optional">${esc(it.details || '')}</textarea></label>
    <div class="grid g2"><label class="f">Quantity<input type="number" inputmode="decimal" step="any" id="it-qty" value="${it.qty}"></label><label class="f">Price (ex GST)<input type="number" inputmode="decimal" step="0.01" id="it-price" value="${it.price}"></label></div>
    <div class="grid g2" style="align-items:end"><label class="f">Discount %<input type="number" inputmode="decimal" step="any" min="0" max="100" id="it-disc" value="${num(it.discountPct) || 0}"></label><label class="chk" style="padding-bottom:10px"><input type="checkbox" id="it-gst" ${it.gst ? 'checked' : ''}> Add GST (10%)</label></div>
    ${isNew ? '<label class="chk"><input type="checkbox" id="it-savesvc"> Also save to my services</label>' : ''}
    <div class="it-total"><span class="muted">Line total (ex GST)</span><b class="num" id="it-tot"></b></div></div>`,
    foot: `${!isNew ? `<button class="btn danger" id="it-rm">${icon('trash')} Remove</button>` : ''}<div class="spacer"></div><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn pri" id="it-ok">${icon('check')} ${isNew ? 'Add item' : 'Done'}</button>` });
  m.classList.add('sheet');
  const read = () => { it.desc = $('#it-desc', m).value.trim(); it.details = $('#it-details', m).value.trim(); it.qty = num($('#it-qty', m).value); it.price = r2(num($('#it-price', m).value)); it.discountPct = Math.min(100, Math.max(0, num($('#it-disc', m).value))); it.gst = $('#it-gst', m).checked; };
  const tot = () => { read(); const c = lineCalc(it); $('#it-tot', m).textContent = money(c.net) + (c.gst ? ` + ${money(c.gst)} GST` : ''); };
  m.addEventListener('input', tot); m.addEventListener('change', tot); tot();
  $('#it-ok', m).onclick = async () => { read(); if (!it.desc) { toast('Enter an item name'); $('#it-desc', m).focus(); return; }
    if (isNew && $('#it-savesvc', m)?.checked) { const sv = await save('services', { name: it.desc, description: it.details, price: it.price, unit: '', gst: it.gst }); it.serviceId = sv.id; }
    closeModal(); onDone(it); };
  if (!isNew) $('#it-rm', m).onclick = () => { closeModal(); onRemove(); };
  if (isNew) setTimeout(() => $('#it-desc', m).focus(), 50);
}
function servicePicker(gstOn, onAdd) {
  const list = [...S.services].sort((a, b) => a.name.localeCompare(b.name)); const added = [];
  const m = openModal({ title: 'Add items', body: `<div class="cpick-box" style="margin-bottom:12px">${icon('search')}<input type="text" id="sp-q" autocomplete="off" placeholder="Search services…"></div>
    <div class="lines" id="sp-list"></div>`,
    foot: `<span class="small muted" id="sp-n"></span><div class="spacer"></div><button class="btn pri" id="sp-done">${icon('check')} Done</button>` });
  m.classList.add('sheet');
  const rowsHTML = q => { const t = q.trim().toLowerCase(); const f = list.filter(x => !t || (x.name + ' ' + (x.description || '')).toLowerCase().includes(t));
    return `<button type="button" class="line sp-custom" data-custom="1"><span class="sp-ic">${icon('plus')}</span><div class="grow"><div class="ln-t">Custom item</div><div class="ln-q">Type your own item, price and description</div></div>${icon('chev', 'ln-c')}</button>` +
      f.map(x => `<button type="button" class="line" data-sid="${x.id}"><div class="grow"><div class="ln-t">${esc(x.name)}</div>${x.description ? `<div class="ln-d">${esc(x.description)}</div>` : ''}<div class="ln-q num">${money(x.price)}${x.unit ? ' / ' + esc(x.unit) : ''}${x.gst !== false && gstOn ? ' · GST' : ''}</div></div><span class="sp-badge" data-badge="${x.id}" hidden></span><span class="sp-ic add">${icon('plus')}</span></button>`).join('') +
      (!f.length && list.length ? `<div class="lines-empty small muted">No services match “${esc(q)}”.</div>` : '') + (!list.length ? '<div class="lines-empty small muted">No services yet. Add them under Services, or add a custom item.</div>' : ''); };
  const draw = () => { $('#sp-list', m).innerHTML = rowsHTML($('#sp-q', m).value); for (const id of new Set(added.map(a => a.serviceId))) { const b = $(`[data-badge="${id}"]`, m); if (b) { b.hidden = false; b.textContent = '✓ ' + added.filter(a => a.serviceId === id).length; } } };
  const finish = () => closeModal();   // _onClose hands over what was added
  $('#sp-q', m).oninput = draw; draw();
  $('#sp-list', m).onclick = e => { const r = e.target.closest('.line'); if (!r) return;
    if (r.dataset.custom) { closeModal(); itemSheet(null, gstOn, it => onAdd([it]), () => { }); return; }
    const sv = byId('services', r.dataset.sid); if (!sv) return;
    added.push({ desc: sv.name, details: sv.description || '', qty: 1, price: num(sv.price), discountPct: 0, gst: sv.gst !== false && gstOn, serviceId: sv.id });
    $('#sp-n', m).textContent = `${added.length} item${added.length === 1 ? '' : 's'} added`; draw(); };
  $('#sp-done', m).onclick = finish; m._onClose = () => { if (added.length) onAdd(added.splice(0)); };
}
ACT['dup-invoice'] = async el => {
  const src = byId('invoices', el.dataset.id); const n = newInvoice(src.kind, src.customerId);
  const copy = Object.assign(structuredClone(src), { id: '', number: n.number, issueDate: n.issueDate, dueDate: n.dueDate, depositDue: n.issueDate, balanceEmailDate: n.balanceEmailDate, balanceDateManual: false, sent: false, accepted: false, sentAt: null, createdAt: new Date().toISOString() });
  await save('invoices', copy); await bumpNumber(src.kind, n._n); await syncInvoiceEmails(copy); toast('Duplicated as ' + copy.number); go('invoice/' + copy.id);
};
ACT['convert-quote'] = async el => {
  const src = byId('invoices', el.dataset.id); const n = newInvoice('invoice', src.customerId);
  const inv = Object.assign(structuredClone(src), { id: '', kind: 'invoice', number: n.number, issueDate: n.issueDate, dueDate: n.dueDate, depositDue: n.issueDate, balanceEmailDate: n.balanceEmailDate, balanceDateManual: false, deposit: n.deposit, emailDeposit: true, emailBalance: true, sent: false, fromQuote: src.number, createdAt: new Date().toISOString() });
  await save('invoices', inv); await bumpNumber('invoice', n._n); src.accepted = true; await save('invoices', src); await syncInvoiceEmails(inv); toast('Created invoice ' + inv.number); go('invoice/' + inv.id);
};
ACT['del-invoice'] = async el => {
  const inv = byId('invoices', el.dataset.id); const np = S.payments.filter(p => p.invoiceId === inv.id).length;
  if (!await confirmBox(`Delete ${esc(inv.number)}${np ? ` and its ${np} payment(s)` : ''}? Its queued emails are removed too. This can't be undone.`)) return;
  for (const p of S.payments.filter(p => p.invoiceId === inv.id)) await remove('payments', p.id);
  for (const e of S.outbox.filter(e => e.invoiceId === inv.id)) await remove('outbox', e.id);
  await remove('invoices', inv.id); leaveGuard = null; toast('Deleted'); go('invoices');
};
ACT['email-pdf'] = el => { const inv = byId('invoices', el.dataset.id); openCompose({ type: 'invoice', invoiceId: inv.id, customerId: inv.customerId, status: 'queued', scheduledDate: today(), createdAt: new Date().toISOString() }); };
ACT['del-payment'] = async el => {
  const p = byId('payments', el.dataset.id); if (!await confirmBox(`Delete the payment of ${money(p.amount)} on ${fmtD(p.date)}?`)) return;
  await remove('payments', p.id); for (const e of S.outbox.filter(e => e.paymentId === p.id && e.status !== 'sent')) await remove('outbox', e.id);
  await settleInvoiceEmails(byId('invoices', p.invoiceId));   // money no longer in: its deposit / balance emails come back
  toast('Payment deleted'); render();
};

/* ---------- payments + receipts ---------- */
function recordPaymentModal(inv) {
  const c = invCalc(inv); const dep = depositAmount(inv, c); const def = c.paid < dep - 0.004 ? r2(dep - c.paid) : c.balance;
  const m = openModal({ title: `Record payment · ${esc(inv.number)}`, body: `<div class="stack">
    <div class="note">Total ${money(c.total)} · paid ${money(c.paid)} · balance <b>${money(c.balance)}</b></div>
    <div class="row"><button class="btn sm" data-amt="${r2(Math.max(0, dep - c.paid))}">Deposit ${money(Math.max(0, dep - c.paid))}</button><button class="btn sm" data-amt="${c.balance}">Full balance ${money(c.balance)}</button></div>
    <div class="grid g2"><label class="f">Amount received<input type="number" step="0.01" id="pm-amt" value="${def}"></label><label class="f">Date<input type="date" id="pm-date" value="${today()}"></label></div>
    <div class="grid g2"><label class="f">Method<select id="pm-meth">${['Bank transfer', 'Card', 'Cash', 'PayID', 'Cheque', 'Other'].map(x => `<option>${x}</option>`).join('')}</select></label><label class="f">Note<input type="text" id="pm-note" placeholder="Optional"></label></div></div>`,
    foot: `<button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn pri" id="pm-ok">${icon('check')} Save payment</button>` });
  $$('[data-amt]', m).forEach(b => b.onclick = () => $('#pm-amt', m).value = b.dataset.amt);
  $('#pm-ok', m).onclick = async () => {
    const amount = r2(num($('#pm-amt', m).value)); if (!(amount > 0)) { toast('Enter an amount'); return; }
    const p = await save('payments', { invoiceId: inv.id, amount, date: $('#pm-date', m).value || today(), method: $('#pm-meth', m).value, note: $('#pm-note', m).value, createdAt: new Date().toISOString() });
    if (!inv.sent) { inv.sent = true; await save('invoices', inv); }
    await settleInvoiceEmails(inv);   // deposit / balance emails for money that's now in are cleared
    closeModal(); paymentDoneModal(p);
  };
}
function paymentDoneModal(p) {
  const inv = byId('invoices', p.invoiceId); const c = invCalc(inv);
  const m = openModal({ title: 'Payment recorded', body: `<div style="text-align:center;padding:10px 0 4px"><span class="ic ok" style="width:64px;height:64px;margin:0 auto">${icon('check')}</span>
    <div style="font-size:28px;font-weight:750;margin-top:12px" class="num">${money(p.amount)}</div><div class="muted">${esc(inv.number)} · ${c.balance > 0.004 ? `balance now <b>${money(c.balance)}</b>` : '<b>paid in full</b>'}</div>
    <p id="pd-q"><b>Send a receipt now?</b></p></div>`,
    foot: `<button class="btn ghost" id="pd-skip">Skip</button><button class="btn" id="pd-print">${icon('printer')} Print receipt</button><button class="btn pri" id="pd-send">${icon('send')} Send receipt</button>`, onClose: () => render() });
  $('#pd-skip', m).onclick = () => { closeModal(); toast('No receipt sent. You can still email one from the payment\'s receipt button'); };
  $('#pd-print', m).onclick = () => printHTML(receiptDoc(p));
  $('#pd-send', m).onclick = async () => { m._onClose = null; const e = await save('outbox', { type: 'receipt', invoiceId: inv.id, customerId: inv.customerId, paymentId: p.id, status: 'queued', scheduledDate: today(), createdAt: new Date().toISOString() }); openCompose(e); };
}
ACT['receipt-menu'] = el => {
  const p = byId('payments', el.dataset.id); const e = S.outbox.find(x => x.paymentId === p.id);
  const m = openModal({ title: 'Receipt · ' + money(p.amount), body: `<div class="doc" style="box-shadow:none;padding:0">${receiptDoc(p)}</div>`, wide: true,
    foot: `<button class="btn" id="rc-print">${icon('printer')} Print / Save PDF</button><button class="btn pri" id="rc-mail">${icon('send')} Email receipt${e && e.status === 'sent' ? ' again' : ''}</button>` });
  $('#rc-print', m).onclick = () => printHTML(receiptDoc(p));
  $('#rc-mail', m).onclick = async () => { const ent = e || await save('outbox', { type: 'receipt', invoiceId: p.invoiceId, paymentId: p.id, customerId: byId('invoices', p.invoiceId)?.customerId, status: 'queued', scheduledDate: today() }); openCompose(ent); };
};

/* ---------- documents (invoice / receipt) ---------- */
function bizBlock() {
  const b = S.settings.business;
  return `<div>${S.settings.logo ? `<img class="d-logo" src="${S.settings.logo}" alt="">` : `<div style="font-size:22px;font-weight:750">${esc(b.name || 'Your business name')}</div>`}
    <div style="margin-top:10px;font-size:13px;line-height:1.5">${S.settings.logo ? `<b>${esc(b.name)}</b><br>` : ''}${b.abn ? 'ABN ' + esc(b.abn) + '<br>' : ''}${esc(b.address).replace(/\n/g, '<br>')}${b.address ? '<br>' : ''}${esc(b.email)}${b.phone ? ' · ' + esc(b.phone) : ''}</div></div>`;
}
function custBlock(cu) {
  if (!cu) return '';
  return `<div style="font-size:13px;line-height:1.5"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:4px">Bill to</div><b>${esc(cu.business || cu.name)}</b><br>${cu.business && cu.name ? esc(cu.name) + '<br>' : ''}${esc(cu.address || '').replace(/\n/g, '<br>')}${cu.address ? '<br>' : ''}${esc(cu.email || '')}${cu.abn ? '<br>ABN ' + esc(cu.abn) : ''}</div>`;
}
function invoiceDoc(inv) {
  const c = invCalc(inv), cu = byId('customers', inv.customerId), b = S.settings.business, isQ = inv.kind === 'quote';
  const title = isQ ? 'QUOTE' : (b.gstRegistered !== false && c.gst > 0 ? 'TAX INVOICE' : 'INVOICE');
  const pays = S.payments.filter(p => p.invoiceId === inv.id);
  return `<div class="doc"><div class="d-head">${bizBlock()}<div><div class="d-title">${title}</div><div style="text-align:right;font-size:13px;margin-top:8px;line-height:1.6">
    <b>${esc(inv.number)}</b><br>Issued: ${fmtD(inv.issueDate)}<br>${isQ ? 'Valid until' : 'Due'}: ${fmtD(inv.dueDate)}</div></div></div>
    <div class="d-band"></div>${custBlock(cu)}
    <table><thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit price</th>${c.disc ? '<th style="text-align:right">Disc</th>' : ''}<th style="text-align:right">GST</th><th style="text-align:right">Amount</th></tr></thead><tbody>
    ${inv.items.map(it => { const l = lineCalc(it); return `<tr><td><b>${esc(it.desc)}</b>${it.details ? `<div style="color:#666;font-size:12px;white-space:pre-wrap">${esc(it.details)}</div>` : ''}</td><td style="text-align:right">${num(it.qty)}</td><td style="text-align:right" class="num">${money(it.price)}</td>${c.disc ? `<td style="text-align:right">${num(it.discountPct) ? num(it.discountPct) + '%' : ''}</td>` : ''}<td style="text-align:right" class="num">${it.gst ? money(l.gst) : '—'}</td><td style="text-align:right" class="num">${money(l.net)}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="d-tot"><div><span>Subtotal (ex GST)</span><span class="num">${money(c.sub)}</span></div><div><span>GST 10%</span><span class="num">${money(c.gst)}</span></div><div class="b"><span>Total ${b.gstRegistered !== false ? '(inc GST)' : ''}</span><span class="num">${money(c.total)}</span></div>
    ${!isQ && c.paid ? `<div><span>Paid</span><span class="num">−${money(c.paid)}</span></div><div class="b" style="color:var(--pink-d)"><span>Balance due</span><span class="num">${money(c.balance)}</span></div>` : ''}
    ${!isQ && !c.paid && inv.emailDeposit !== false ? `<div style="color:#666;font-size:13px"><span>Deposit required</span><span class="num">${money(depositAmount(inv, c))}</span></div>` : ''}</div>
    <div class="d-foot">${inv.notes ? `<div style="white-space:pre-wrap;margin-bottom:12px">${esc(inv.notes)}</div>` : (b.paymentTerms ? `<div style="white-space:pre-wrap;margin-bottom:12px">${esc(b.paymentTerms)}</div>` : '')}
    ${!isQ && bankDetails() ? `<div style="white-space:pre-wrap"><b>${esc(bankDetails()).replace(/\n/, '</b>\n')}\nReference: ${esc(inv.number)}</div>` : ''}
    ${pays.length && !isQ ? `<div style="margin-top:12px;font-size:12px;color:#777">Payments received: ${pays.map(p => fmtD(p.date) + ' ' + money(p.amount)).join(', ')}</div>` : ''}</div></div>`;
}
function receiptDoc(p) {
  const inv = byId('invoices', p.invoiceId), c = invCalc(inv), cu = byId('customers', inv.customerId);
  const idx = S.payments.filter(x => x.invoiceId === inv.id).sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id)).findIndex(x => x.id === p.id) + 1;
  const paidTo = r2(S.payments.filter(x => x.invoiceId === inv.id && (x.date < p.date || (x.date === p.date && x.id <= p.id))).reduce((a, x) => a + num(x.amount), 0));
  const sp = paymentSplit(p);
  return `<div class="doc"><div class="d-head">${bizBlock()}<div><div class="d-title">RECEIPT</div><div style="text-align:right;font-size:13px;margin-top:8px;line-height:1.6"><b>R-${esc(inv.number)}-${idx}</b><br>Date: ${fmtD(p.date)}</div></div></div>
    <div class="d-band"></div>${custBlock(cu).replace('Bill to', 'Received from')}
    <table><tbody><tr><td>Payment received (${esc(p.method || 'payment')})${p.note ? ' – ' + esc(p.note) : ''}</td><td style="text-align:right;font-size:18px;font-weight:750" class="num">${money(p.amount)}</td></tr>
    <tr><td>For invoice ${esc(inv.number)} issued ${fmtD(inv.issueDate)}</td><td></td></tr></tbody></table>
    <div class="d-tot"><div><span>Includes GST</span><span class="num">${money(sp.gst)}</span></div><div><span>Invoice total</span><span class="num">${money(c.total)}</span></div><div><span>Paid to date</span><span class="num">${money(paidTo)}</span></div><div class="b"><span>Balance remaining</span><span class="num">${money(Math.max(0, c.total - paidTo))}</span></div></div>
    <div class="d-foot">Thank you for your payment.</div></div>`;
}
V.doc = async (view, [type, id]) => {
  if (type === 'invoice') {
    const inv = byId('invoices', id); if (!inv) { view.innerHTML = '<div class="card empty">Not found</div>'; return; }
    view.innerHTML = `<div class="doc-actions no-print"><a class="btn" href="#/invoice/${id}">${icon('back')} Back to edit</a><button class="btn pri" id="d-print">${icon('printer')} Print / Save as PDF</button>${inv.kind !== 'quote' ? `<button class="btn" data-act="email-pdf" data-id="${id}">${icon('mail')} Email PDF</button>` : ''}</div>${invoiceDoc(inv)}
      ${inv.kind !== 'quote' ? '<p class="small muted no-print" style="text-align:center"><b>Email PDF</b> makes this invoice as a PDF and attaches it for you.</p>' : ''}`;
    $('#d-print').onclick = () => printHTML(invoiceDoc(inv));
  }
};

/* ======================= CUSTOMERS ======================= */
V.customers = async view => {
  view.innerHTML = `${demoBanner()}${pageH('Customers', S.customers.length + ' saved', `<a class="btn" href="#/import?type=customers">${icon('upload')} Import CSV</a><button class="btn pri" id="c-new">${icon('plus')} New customer</button>`)}
  <div class="row" style="margin-bottom:16px"><input type="search" class="search" id="c-s" placeholder="Search customers"></div><div class="card"><div class="list" id="c-list"></div></div>`;
  const draw = () => {
    const s = $('#c-s').value.toLowerCase();
    const rows = [...S.customers].sort((a, b) => custName(a).localeCompare(custName(b))).filter(c => !s || [c.name, c.business, c.email, c.phone].join(' ').toLowerCase().includes(s));
    $('#c-list').innerHTML = rows.map(c => {
      const invs = S.invoices.filter(i => i.customerId === c.id && i.kind !== 'quote'); const bal = invs.reduce((a, i) => { const k = invCalc(i); return a + (invStatus(i, k) === 'draft' ? 0 : k.balance); }, 0);
      return `<a class="li" href="#/customer/${c.id}" style="text-decoration:none;color:inherit"><span class="ic lav" style="font-weight:700">${esc((c.name || c.business || '?').trim()[0]?.toUpperCase() || '?')}</span><div class="grow"><div class="t">${esc(custName(c))}</div><div class="s">${esc(c.email || c.phone || '')}</div></div><div class="right small"><div>${invs.length} invoice${invs.length === 1 ? '' : 's'}</div>${bal > 0 ? `<div class="num" style="color:var(--pink-d);font-weight:650">${money(bal)} owing</div>` : ''}</div></a>`;
    }).join('') || '<div class="empty">No customers yet.</div>';
  };
  $('#c-s').oninput = draw; draw();
  $('#c-new').onclick = () => editCustomerModal(null, c => go('customer/' + c.id));
};
function editCustomerModal(c, after) {
  const x = c || {}; const F = [['name', 'Contact name'], ['business', 'Business'], ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'], ['abn', 'ABN']];
  const m = openModal({ title: c ? 'Edit customer' : 'New customer', body: `<div class="grid g2">${F.map(([k, l, t]) => `<label class="f">${l}<input type="${t || 'text'}" data-k="${k}" value="${esc(x[k] || '')}"></label>`).join('')}</div>
    <div class="stack" style="margin-top:16px"><label class="f">Address<textarea data-k="address" rows="2" style="min-height:60px">${esc(x.address || '')}</textarea></label><label class="f">Notes<textarea data-k="notes">${esc(x.notes || '')}</textarea></label></div>`,
    foot: `<button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn pri" id="cm-ok">${icon('check')} Save</button>` });
  $('#cm-ok', m).onclick = async () => {
    const o = c ? byId('customers', c.id) : { createdAt: new Date().toISOString() }; $$('[data-k]', m).forEach(i => o[i.dataset.k] = i.value.trim());
    if (!o.name && !o.business) { toast('Enter a name or business'); return; }
    await save('customers', o); m._onClose = null; closeModal(); toast('Customer saved'); after ? after(o) : render();
  };
}
V.customer = async (view, [id]) => {
  if (id === 'new') { await V.customers(view); editCustomerModal(null, c => go('customer/' + c.id)); return; }
  const c = byId('customers', id); if (!c) { view.innerHTML = '<div class="card empty">Customer not found.</div>'; return; }
  const invs = S.invoices.filter(i => i.customerId === id).sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''));
  const real = invs.filter(i => i.kind !== 'quote'); let billed = 0, paid = 0, owing = 0;
  for (const i of real) { const k = invCalc(i); billed += k.total; paid += k.paid; if (invStatus(i, k) !== 'draft') owing += k.balance; }
  const ks = S.contracts.filter(k => k.customerId === id), rs = S.responses.filter(r => r.customerId === id);
  view.innerHTML = `${pageH(esc(custName(c)), esc([c.email, c.phone].filter(Boolean).join(' · ')), `<button class="btn" id="cu-edit">${icon('edit')} Edit</button><a class="btn pri" href="#/invoice/new?customer=${id}">${icon('plus')} New invoice</a>`, 'customers')}
  <div class="grid g3" style="margin-bottom:18px">
    <div class="card stat"><span class="l">Total billed</span><span class="v num">${money(billed)}</span></div>
    <div class="card stat"><span class="l">Paid</span><span class="v num">${money(paid)}</span></div>
    <div class="card stat"><span class="l">Owing</span><span class="v num" style="color:var(--pink-d)">${money(owing)}</span></div></div>
  <div class="grid g2" style="align-items:start">
    <div class="stack"><div class="card"><div class="card-h"><h2>Invoice history</h2></div><div class="list">${invs.map(invRow).join('') || '<div class="empty">No invoices yet.</div>'}</div></div>
      <div class="card"><div class="card-h"><h2>Payments</h2></div><div class="list">${S.payments.filter(p => real.some(i => i.id === p.invoiceId)).sort((a, b) => b.date.localeCompare(a.date)).map(p => `<div class="li" style="cursor:default"><span class="ic ok">${icon('dollar')}</span><div class="grow"><div class="t num">${money(p.amount)}</div><div class="s">${fmtD(p.date)} · ${esc(byId('invoices', p.invoiceId)?.number)}</div></div><button class="btn ghost icon" data-act="receipt-menu" data-id="${p.id}">${icon('receipt')}</button></div>`).join('') || '<div class="small muted">None yet.</div>'}</div></div></div>
    <div class="stack">
      <div class="card"><h2 style="margin-bottom:12px">Details</h2><table class="tbl">${[['Contact', c.name], ['Business', c.business], ['Email', c.email], ['Phone', c.phone], ['ABN', c.abn], ['Address', c.address]].map(([l, v]) => `<tr><td class="muted" style="width:110px">${l}</td><td style="white-space:pre-wrap">${esc(v || '—')}</td></tr>`).join('')}</table>
        ${c.notes ? `<div class="note" style="margin-top:12px;white-space:pre-wrap">${esc(c.notes)}</div>` : ''}<div class="row" style="margin-top:14px"><button class="btn sm danger" id="cu-del">${icon('trash')} Delete customer</button></div></div>
      <div class="card"><div class="card-h"><h2>Contracts</h2><div class="spacer"></div><a class="btn sm" href="#/contracts?new=1&customer=${id}">${icon('plus')} New</a></div><div class="list">${ks.map(contractRow).join('') || '<div class="small muted">None yet.</div>'}</div></div>
      <div class="card"><div class="card-h"><h2>Questionnaires</h2><div class="spacer"></div><button class="btn sm" data-act="import-answers" data-customer="${id}">${icon('download')} Import answers</button><a class="btn sm" href="#/forms?send=1&customer=${id}">${icon('send')} Send</a></div>
        <div class="list">${rs.map(r => `<div class="li" data-act="view-response" data-id="${r.id}"><span class="ic">${icon('clip')}</span><div class="grow"><div class="t">${esc(r.title)}</div><div class="s">Received ${fmtD(r.receivedAt)}</div></div></div>`).join('') || '<div class="small muted">No answers imported yet.</div>'}</div></div>
    </div></div>`;
  $('#cu-edit').onclick = () => editCustomerModal(c);
  $('#cu-del').onclick = async () => {
    if (invs.length) { toast('This customer has invoices. Delete those first.'); return; }
    if (!await confirmBox(`Delete ${esc(custName(c))}?`)) return; await remove('customers', id); go('customers');
  };
};

/* ======================= SERVICES ======================= */
V.services = async view => {
  view.innerHTML = `${pageH('Services', 'Your price list. Pick these when adding invoice lines.', `<button class="btn pri" id="sv-new">${icon('plus')} New service</button>`)}
  <div class="card" style="max-width:820px"><div class="lines">${[...S.services].sort((a, b) => a.name.localeCompare(b.name)).map(sv => `<button type="button" class="line" data-act="edit-service" data-id="${sv.id}"><div class="grow"><div class="ln-t">${esc(sv.name)}</div>${sv.description ? `<div class="ln-d">${esc(sv.description)}</div>` : ''}<div class="ln-q">${sv.gst !== false ? 'GST' : 'No GST'}${sv.unit ? ' · per ' + esc(sv.unit) : ''}</div></div><div class="ln-a num">${money(sv.price)}</div>${icon('chev', 'ln-c')}</button>`).join('') || '<div class="lines-empty small muted">No services yet. Add your usual items and prices so invoices are quick to make.</div>'}</div>
  <button type="button" class="btn add-items" id="sv-new2">${icon('plus')} Add a service</button></div>`;
  $('#sv-new').onclick = $('#sv-new2').onclick = () => editServiceModal(null);
};
ACT['edit-service'] = el => editServiceModal(byId('services', el.dataset.id));
function editServiceModal(s) {
  const x = s || { gst: S.settings.business.gstRegistered !== false };
  const m = openModal({ title: s ? 'Edit service' : 'New service', body: `<div class="stack"><label class="f">Name<input type="text" id="sv-name" value="${esc(x.name || '')}"></label>
    <label class="f">Description<textarea id="sv-desc">${esc(x.description || '')}</textarea></label>
    <div class="grid g2"><label class="f">Price (ex GST)<input type="number" step="0.01" id="sv-price" value="${x.price ?? ''}"></label><label class="f">Unit (optional)<input type="text" id="sv-unit" value="${esc(x.unit || '')}" placeholder="hour, item, m²"></label></div>
    <label class="chk"><input type="checkbox" id="sv-gst" ${x.gst !== false ? 'checked' : ''}> Add GST (10%)</label></div>`,
    foot: `${s ? `<button class="btn danger" id="sv-del">${icon('trash')} Delete</button>` : ''}<div class="spacer"></div><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn pri" id="sv-ok">${icon('check')} Save</button>` });
  $('#sv-ok', m).onclick = async () => {
    const o = s ? byId('services', s.id) : {}; o.name = $('#sv-name', m).value.trim(); if (!o.name) { toast('Enter a name'); return; }
    Object.assign(o, { description: $('#sv-desc', m).value.trim(), price: r2(num($('#sv-price', m).value)), unit: $('#sv-unit', m).value.trim(), gst: $('#sv-gst', m).checked });
    await save('services', o); closeModal(); toast('Saved'); render();
  };
  if (s) $('#sv-del', m).onclick = async () => { if (await confirmBox(`Delete service “${esc(s.name)}”? Existing invoices keep their lines.`)) { await remove('services', s.id); render(); } };
}

/* ======================= EXPENSES ======================= */
V.expenses = async (view, _, q) => {
  let preset = q.get('r') || 'this-fy'; let [from, to] = rangePreset(preset) || [q.get('from'), q.get('to')];
  view.innerHTML = `${demoBanner()}${pageH('Expenses', 'Receipts and business costs', `<a class="btn" href="#/import?type=expenses">${icon('upload')} Import CSV</a><button class="btn pri" id="ex-new">${icon('plus')} Add expense</button>`)}
  <div class="row" style="margin-bottom:16px"><select id="ex-r" style="max-width:220px">${PRESETS.map(([k, l]) => `<option value="${k}" ${k === preset ? 'selected' : ''}>${l}</option>`).join('')}<option value="all" ${preset === 'all' ? 'selected' : ''}>All time</option></select>
    <input type="date" id="ex-from" value="${from || ''}" style="max-width:170px"><input type="date" id="ex-to" value="${to || ''}" style="max-width:170px"><div class="spacer"></div><input type="search" class="search" id="ex-s" placeholder="Search supplier or category"></div>
  <div class="grid g3" style="margin-bottom:16px" id="ex-stats"></div>
  <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Date</th><th>Supplier</th><th>Category</th><th class="right">GST</th><th class="right">Amount</th></tr></thead><tbody id="ex-tb"></tbody></table></div></div>`;
  const draw = () => {
    const s = $('#ex-s').value.toLowerCase(); from = $('#ex-from').value; to = $('#ex-to').value;
    const rows = S.expenses.filter(x => (!from || x.date >= from) && (!to || x.date <= to) && (!s || (x.supplier + ' ' + x.category + ' ' + (x.notes || '')).toLowerCase().includes(s))).sort((a, b) => b.date.localeCompare(a.date));
    const tot = rows.reduce((a, x) => a + num(x.amount), 0), gst = rows.reduce((a, x) => a + num(x.gst), 0);
    $('#ex-stats').innerHTML = `<div class="card stat"><span class="l">Total spent</span><span class="v num">${money(tot)}</span></div><div class="card stat"><span class="l">GST credits</span><span class="v num">${money(gst)}</span></div><div class="card stat"><span class="l">Receipts</span><span class="v">${rows.length} <span class="small muted">(${rows.filter(x => x.fileId).length} with file)</span></span></div>`;
    $('#ex-tb').innerHTML = rows.map(x => `<tr class="click" data-act="edit-expense" data-id="${x.id}"><td style="width:40px">${x.fileId ? `<span class="ic lav" style="width:32px;height:32px">${icon('receipt')}</span>` : `<span class="ic" style="width:32px;height:32px;opacity:.5">${icon('receipt')}</span>`}</td><td class="num">${fmtD(x.date)}</td><td><b>${esc(x.supplier)}</b>${x.notes ? `<div class="small muted">${esc(x.notes)}</div>` : ''}</td><td>${esc(x.category)}</td><td class="right num">${money(x.gst)}</td><td class="right num"><b>${money(x.amount)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No expenses in this range.</td></tr>';
  };
  $('#ex-r').onchange = e => { preset = e.target.value; const r = preset === 'all' ? ['', ''] : rangePreset(preset); if (r) { $('#ex-from').value = r[0]; $('#ex-to').value = r[1]; } draw(); };
  $('#ex-from').onchange = $('#ex-to').onchange = () => { $('#ex-r').value = 'custom'; draw(); };
  $('#ex-s').oninput = draw; draw();
  $('#ex-new').onclick = () => editExpenseModal(null);
  if (q.get('new')) editExpenseModal(null);
};
ACT['edit-expense'] = el => editExpenseModal(byId('expenses', el.dataset.id));
function editExpenseModal(x) {
  const o = x ? structuredClone(x) : { date: today(), supplier: '', category: '', amount: '', gst: '', gstIncl: S.settings.business.gstRegistered !== false, notes: '' };
  let newFile = null, dropFile = false;
  const cats = [...new Set([...S.settings.expenseCategories, ...S.expenses.map(e => e.category).filter(Boolean)])];
  const m = openModal({ title: x ? 'Edit expense' : 'Add expense', wide: true, body: `<div class="grid g2" style="align-items:start"><div class="stack">
    <div class="grid g2"><label class="f">Date<input type="date" id="xe-date" value="${o.date}"></label><label class="f">Supplier<input type="text" id="xe-sup" value="${esc(o.supplier)}" list="xe-sups"></label></div>
    <datalist id="xe-sups">${[...new Set(S.expenses.map(e => e.supplier))].map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <label class="f">Category<input type="text" id="xe-cat" value="${esc(o.category)}" list="xe-cats" placeholder="Choose or type"></label><datalist id="xe-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="grid g2"><label class="f">Total amount (inc GST)<input type="number" step="0.01" id="xe-amt" value="${o.amount}"></label><label class="f">GST included<input type="number" step="0.01" id="xe-gst" value="${o.gst}"></label></div>
    <label class="chk"><input type="checkbox" id="xe-auto" ${o.gstIncl !== false ? 'checked' : ''}> Price includes 10% GST (auto-calculate GST = total ÷ 11)</label>
    <label class="f">Notes<textarea id="xe-notes" rows="2" style="min-height:60px">${esc(o.notes || '')}</textarea></label></div>
    <div class="stack"><div class="card flat" style="text-align:center"><div id="xe-prev" class="muted small">No receipt attached</div>
      <div class="row" style="justify-content:center;margin-top:12px"><button class="btn sm" id="xe-file">${icon('upload')} Photo / PDF</button><button class="btn ghost sm" id="xe-rm" hidden>${icon('trash')} Remove</button></div>
      <div class="tiny muted" style="margin-top:8px">On a phone this can use the camera. Photos are resized to save space. Stored only in this browser.</div></div></div></div>`,
    foot: `${x ? `<button class="btn danger" id="xe-del">${icon('trash')} Delete</button>` : ''}<div class="spacer"></div><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn pri" id="xe-ok">${icon('check')} Save</button>` });
  const autoG = () => { if ($('#xe-auto', m).checked) $('#xe-gst', m).value = r2(num($('#xe-amt', m).value) / 11).toFixed(2); };
  $('#xe-amt', m).oninput = autoG; $('#xe-auto', m).onchange = () => { if ($('#xe-auto', m).checked) autoG(); else $('#xe-gst', m).value = '0.00'; };
  const showPrev = async () => {
    const p = $('#xe-prev', m); let blob = null, type = '';
    if (newFile) { blob = newFile.blob; type = newFile.type; } else if (o.fileId && !dropFile) { p.innerHTML = 'Loading receipt…'; const f = await fileGet(o.fileId); if (f) { blob = f.blob; type = f.type; } else if (o.fileId) { p.innerHTML = 'Receipt not available offline yet'; return; } }
    $('#xe-rm', m).hidden = !blob;
    if (!blob) { p.innerHTML = 'No receipt attached'; return; }
    const u = URL.createObjectURL(blob);
    p.innerHTML = type.startsWith('image/') ? `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" style="max-width:100%;max-height:340px;border-radius:12px"></a>` : `<iframe src="${u}" style="width:100%;height:340px;border:0;border-radius:12px"></iframe><a href="${u}" target="_blank" rel="noopener" class="btn sm" style="margin-top:8px">${icon('eye')} Open PDF</a>`;
  };
  showPrev();
  $('#xe-file', m).onclick = async () => {
    const f = await pickFile('image/*,application/pdf'); if (!f) return;
    if (f.type === 'application/pdf') { if (f.size > 10e6) { toast('PDF is over 10 MB'); return; } newFile = { blob: f, type: f.type, name: f.name }; }
    else if (f.type.startsWith('image/')) { const d = await shrinkImage(f, 1800, 0.82); newFile = { blob: dataURLtoBlob(d), type: 'image/jpeg', name: f.name.replace(/\.\w+$/, '') + '.jpg' }; }
    else { toast('Please choose an image or PDF'); return; }
    dropFile = false; showPrev();
  };
  $('#xe-rm', m).onclick = () => { newFile = null; dropFile = true; showPrev(); };
  $('#xe-ok', m).onclick = async () => {
    const amount = r2(num($('#xe-amt', m).value)); const sup = $('#xe-sup', m).value.trim();
    if (!sup || !amount) { toast('Enter supplier and amount'); return; }
    Object.assign(o, { date: $('#xe-date', m).value || today(), supplier: sup, category: $('#xe-cat', m).value.trim() || 'Other', amount, gst: r2(num($('#xe-gst', m).value)), gstIncl: $('#xe-auto', m).checked, notes: $('#xe-notes', m).value.trim() });
    if ((dropFile || newFile) && o.fileId) { await fileDel(o.fileId); o.fileId = ''; }
    if (newFile) { o.fileId = uid(); await filePut({ id: o.fileId, blob: newFile.blob, type: newFile.type, name: newFile.name }); }
    if (!x) o.createdAt = new Date().toISOString();
    await save('expenses', o); closeModal(); toast('Expense saved'); render();
  };
  if (x) $('#xe-del', m).onclick = async () => { if (await confirmBox(`Delete expense from ${esc(x.supplier)} (${money(x.amount)})?`)) { if (x.fileId) await fileDel(x.fileId); await remove('expenses', x.id); render(); } };
}

/* ======================= OUTBOX ======================= */
V.outbox = async (view, _, q) => {
  const tab = q.get('t') || 'todo';
  const act = outboxActive().filter(e => !isReceipt(e)), rcs = outboxReceipts(), done = S.outbox.filter(e => e.status === 'sent' || e.status === 'skipped').sort((a, b) => (b.sentAt || b.skippedAt || '').localeCompare(a.sentAt || a.skippedAt || ''));
  const due = act.filter(e => (e.scheduledDate || '') <= today()), later = act.filter(e => (e.scheduledDate || '') > today());
  view.innerHTML = `${pageH('Email outbox', 'Scheduled emails. This site can\'t send email by itself, so each one opens ready to send in your email app.')}
  <div class="tabs"><button data-t="todo" class="${tab === 'todo' ? 'on' : ''}">To send (${act.length})</button><button data-t="sent" class="${tab === 'sent' ? 'on' : ''}">Sent &amp; skipped (${done.length})</button><button data-t="tpl" class="${tab === 'tpl' ? 'on' : ''}">Templates</button></div>
  <div id="ob-body"></div>`;
  $$('.tabs button', view).forEach(b => b.onclick = () => go('outbox?t=' + b.dataset.t));
  const body = $('#ob-body');
  const why = e => e.status === 'sent' ? 'sent ' + fmtD((e.sentAt || '').slice(0, 10)) : (e.skipReason === 'paid' ? 'not needed, paid ' : e.skipReason === 'old-receipt' ? 'receipt not sent, tidied ' : 'skipped ') + fmtD((e.skippedAt || '').slice(0, 10));
  if (tab === 'todo') body.innerHTML = `<div class="card" id="ob-due"><h2 style="margin-bottom:12px">Due now <span class="badge">${due.length}</span></h2>${due.map(e => outboxRow(e)).join('') || '<div class="empty">Nothing due. 🎉</div>'}</div>
    ${rcs.length ? `<div class="card" id="ob-rc" style="margin-top:18px"><h2 style="margin-bottom:4px">Receipts</h2><div class="small muted" style="margin-bottom:12px">Optional thank-you emails for payments you've recorded. Nothing is owing.</div>${rcs.map(e => outboxRow(e, true)).join('')}</div>` : ''}
    <div class="card" style="margin-top:18px"><h2 style="margin-bottom:12px">Scheduled</h2>${later.map(e => outboxRow(e, true)).join('') || '<div class="empty">Nothing scheduled.</div>'}</div>
    <div class="note" style="margin-top:18px">Deposit and balance emails clear themselves once that money has been recorded, and the balance email always asks for what's still unpaid. When you record a payment you're asked whether to send a receipt. Tap <b>Skip</b> on anything you don't want to send.</div>`;
  else if (tab === 'sent') body.innerHTML = `<div class="card"><div class="list">${done.map(e => { const inv = byId('invoices', e.invoiceId); return `<div class="li" data-act="send-email" data-id="${e.id}"><span class="ic ${e.status === 'sent' ? 'ok' : ''}">${icon(e.status === 'sent' ? 'check' : 'x')}</span><div class="grow"><div class="t">${esc(EMAIL_LABEL[e.type] || 'Email')}${inv ? ' · ' + esc(inv.number) : ''}</div><div class="s">${esc(custName(byId('customers', e.customerId || inv?.customerId)))} · ${why(e)}</div></div></div>`; }).join('') || '<div class="empty">No sent emails yet.</div>'}</div></div>`;
  else templatesEditor(body);
};
function templatesEditor(el) {
  const T = S.settings.templates;
  const ph = '{client} {client_first} {client_business} {invoice_no} {total} {subtotal} {gst} {paid} {balance} {amount} {deposit_amount} {deposit_pct} {deposit_due} {issue_date} {due_date} {payment_date} {business} {business_phone} {business_email} {abn} {bank_details} {payment_terms} {link} {contract_title} {form_title} {today}';
  el.innerHTML = `<div class="note" style="margin-bottom:16px"><b>Placeholders</b> are replaced when the email is opened: <span class="small" style="word-spacing:6px">${ph}</span></div>
  ${Object.keys(T).map(k => `<div class="card" style="margin-bottom:16px"><h3 style="margin-bottom:10px">${esc(EMAIL_LABEL[k] || k)}</h3><div class="stack"><label class="f">Subject<input type="text" data-t="${k}" data-f="subject" value="${esc(T[k].subject)}"></label><label class="f">Body<textarea data-t="${k}" data-f="body" style="min-height:200px">${esc(T[k].body)}</textarea></label></div></div>`).join('')}
  <div class="row"><button class="btn pri" id="tp-save">${icon('check')} Save templates</button><button class="btn ghost" id="tp-reset">Reset to defaults</button></div>`;
  $('#tp-save', el).onclick = async () => { $$('[data-t]', el).forEach(i => T[i.dataset.t][i.dataset.f] = i.value); await saveSettings(); toast('Templates saved'); };
  $('#tp-reset', el).onclick = async () => { if (await confirmBox('Reset all email templates to the defaults?', 'Reset')) { S.settings.templates = defaultSettings().templates; await saveSettings(); render(); } };
}
