/* InvoiceMate: automatic payment chasing, the app side.
 * The app keeps its data local, so it tells the server (Supabase function "invoicemate-chase") only what it needs to
 * chase each unpaid invoice: invoice no, amount owing, due date, customer first name, mobile, email, business name,
 * schedule and wording. The server sends the reminders (SMS, email as backup) on schedule, Mon–Sat 8am–7pm Sydney,
 * and keeps a log the app pulls in. This device is identified by a random key (localStorage im.chaseKey); the server
 * only stores a hash of it. Nothing here is secret: no API keys. */
'use strict';
const IM_CHASE_URL = 'https://opekqrldytqvjziowbqo.supabase.co/functions/v1/invoicemate-chase';
const CC = IMChaseCore;

const Chase = {
  state: null, timer: null, busy: null, lastError: '',
  key() {
    let k = localStorage.getItem('im.chaseKey');
    if (!/^[a-f0-9]{64}$/.test(k || '')) { k = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('im.chaseKey', k); }
    return k;
  },
  cfg() {
    const c = S.settings.chase || (S.settings.chase = {});
    if (c.enabled === undefined) c.enabled = true;
    if (!Array.isArray(c.offsets) || !c.offsets.length) c.offsets = CC.DEFAULT_OFFSETS.slice();
    if (c.dueDay === undefined) c.dueDay = false;
    if (!c.templates) c.templates = {};
    return c;
  },
  templates() { const t = this.cfg().templates, out = {}; for (const k of Object.keys(CC.DEFAULT_TEMPLATES)) out[k] = Object.assign({}, CC.DEFAULT_TEMPLATES[k], t[k] || {}); return out; },
  businessName() { const b = S.settings.business || {}; return b.name || b.tradingName || 'your tradie'; },
  desiredFor(inv) {
    const cu = byId('customers', inv.customerId), cfg = this.cfg();
    return CC.desired(inv, invCalc(inv), cu, Object.assign({}, cfg, { templates: cfg.templates }), this.businessName());
  },
  loadState() { if (!this.state) { try { this.state = JSON.parse(localStorage.getItem('im.chaseState')) || null; } catch (e) { } } return this.state || { chases: [], log: [], at: 0 }; },
  saveState(s) { this.state = { chases: s.chases || [], log: s.log || [], quiet: s.quiet, testMode: s.testMode, at: Date.now() }; localStorage.setItem('im.chaseState', JSON.stringify(this.state)); },
  sentMap() { try { return JSON.parse(localStorage.getItem('im.chaseSent')) || {}; } catch (e) { return {}; } },
  async call(body) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(IM_CHASE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-im-app': IM_SEND_APP, 'x-im-owner': this.key() }, body: JSON.stringify(body), signal: ctl.signal });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'Chasing server said ' + r.status);
      this.lastError = ''; return j;
    } catch (e) { this.lastError = e.name === 'AbortError' ? 'Chasing server didn’t answer' : e.message; throw e; } finally { clearTimeout(t); }
  },
  /* send only what changed since last time (and stops for deleted invoices) */
  async syncNow(force = false) {
    if (this.busy) return this.busy;
    this.busy = (async () => {
      if (!S.settings || S.settings.demo) return;            // never chase demo data
      const map = this.sentMap(), out = [], seen = new Set();
      for (const inv of S.invoices) {
        if (inv.kind === 'quote') continue;
        const d = this.desiredFor(inv); seen.add(inv.id);
        const h = JSON.stringify(d);
        if (!d.active && !map[inv.id]) continue;             // never chased: nothing to tell the server
        if (map[inv.id] !== h || force) out.push(d);
      }
      for (const id of Object.keys(map)) if (!seen.has(id)) out.push({ invoice_id: id, active: false, reason: 'deleted' });
      if (!out.length) { if (Date.now() - this.loadState().at > 120000) await this.pull(); return; }
      const res = await this.call({ route: 'sync', chases: out.slice(0, 200) });
      for (const d of out.slice(0, 200)) { if (d.reason === 'deleted') delete map[d.invoice_id]; else map[d.invoice_id] = JSON.stringify(d); }
      localStorage.setItem('im.chaseSent', JSON.stringify(map));
      this.saveState(res); this.applyOptOuts();
    })().catch(() => { }).finally(() => { this.busy = null; });
    return this.busy;
  },
  async pull() { const res = await this.call({ route: 'state' }); this.saveState(res); this.applyOptOuts(); return res; },
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.syncNow(), 1500); },
  touched(col) { if (['invoices', 'payments', 'customers', 'settings'].includes(col)) this.schedule(); },
  /* a customer who used the opt-out link: switch chasing off for them locally too */
  async applyOptOuts() {
    const st = this.loadState();
    for (const c of st.chases.filter(x => x.status === 'opted_out')) {
      const cu = byId('customers', c.customer_key);
      if (cu && !cu.chaseOptedOut) { cu.chaseOptedOut = true; cu.chase = false; await save('customers', cu); }
    }
  },
  server(inv) { return this.loadState().chases.find(x => x.invoice_id === inv.id) || null; },
  /* {label, cls, text} for the invoice screens */
  statusFor(inv) {
    if (inv.kind === 'quote') return null;
    const d = this.desiredFor(inv), sv = this.server(inv), cu = byId('customers', inv.customerId);
    if (cu && cu.chaseOptedOut) return { label: 'opted out', cls: 'overdue', text: `${custName(cu)} opted out of reminders.` };
    if (!d.active) return d.reason === 'paid' ? null : { label: '', cls: '', text: CC.REASON[d.reason] || 'Not being chased' };
    if (sv && sv.status === 'opted_out') return { label: 'opted out', cls: 'overdue', text: 'The customer opted out of reminders.' };
    if (sv && sv.status === 'done') return { label: 'chased', cls: 'sent', text: 'All reminders have been sent.' };
    const next = sv ? sv.next_date : CC.nextDate({ status: 'active', due_date: d.due_date, schedule: d.schedule, steps_sent: [] }, today());
    const sentN = sv ? (sv.steps_sent || []).length : 0;
    return { label: 'chasing', cls: 'ready', text: `${sentN ? sentN + ' reminder' + (sentN > 1 ? 's' : '') + ' sent. ' : ''}${next ? 'Next reminder ' + (next <= today() ? 'at the next send window' : fmtD(next)) + ` by ${d.phone ? 'SMS' : 'email'}.` : ''}${sv ? '' : ' (syncing…)'}` };
  },
  pill(inv) { const s = this.statusFor(inv); return s && s.label ? `<span class="pill ${s.cls}" title="${esc(s.text)}">${esc(s.label)}</span>` : ''; },
  /* for "who owes me money?" */
  owedList() {
    return S.invoices.filter(i => i.kind !== 'quote' && (i.sent || i.confirmed)).map(i => {
      const c = invCalc(i), cu = byId('customers', i.customerId);
      return { id: i.id, number: i.number, name: custName(cu), balance: r2(c.balance), dueDate: i.dueDate, chasing: !!(this.statusFor(i) || {}).label && this.statusFor(i).label === 'chasing' };
    }).filter(x => x.balance > 0.004);
  },
  async setChasing(ids, on) {
    for (const id of ids) { const inv = byId('invoices', id); if (!inv) continue; inv.chase = on; await save('invoices', inv);
      if (on) { const cu = byId('customers', inv.customerId); if (cu && cu.chase === false && !cu.chaseOptedOut) { cu.chase = true; await save('customers', cu); } } }
    await this.syncNow(); render();
  },
};
/* hook: anything saved or removed may change what should be chased */
{ const _remove = remove; remove = async (col, id) => { await _remove(col, id); Chase.touched(col); }; }   // eslint-disable-line no-global-assign

/* ---------- invoice editor card ---------- */
function chaseCard(inv) {
  if (inv.kind === 'quote') return '';
  const s = Chase.statusFor(inv), cfg = Chase.cfg(), cu = byId('customers', inv.customerId);
  return `<div class="card"><div class="card-h"><span class="ic warn">${icon('clock')}</span><div><h2>Payment chasing ${s && s.label ? `<span class="pill ${s.cls}">${esc(s.label)}</span>` : ''}</h2>
    <div class="small muted">Friendly reminders ${CC.offsetsFor(cfg).map(o => o ? o + 'd' : 'due day').join(', ')} after the due date, by SMS (email if there’s no mobile). Stops when it’s paid.</div></div></div>
    <label class="chk"><input type="checkbox" id="ie-chase" ${inv.chase !== false ? 'checked' : ''} ${cfg.enabled === false ? 'disabled' : ''}> Chase this invoice automatically</label>
    <div class="small" style="margin-top:8px">${s ? esc(s.text) : 'Paid. No reminders.'}${cu && cu.chase === false && !cu.chaseOptedOut ? ' Chasing is off for this customer.' : ''}${cfg.enabled === false ? ' Chasing is off in Settings.' : ''}</div>
    <div class="row" style="margin-top:8px"><a class="btn sm ghost" href="#/reminders">Reminders log</a><a class="btn sm ghost" href="#/settings?tab=chase">Schedule &amp; wording</a></div></div>`;
}

/* ---------- Settings > Payment chasing ---------- */
const SAMPLE = { first_name: 'Dave', business_name: '', invoice_no: 'INV-1021', amount_cents: 199650, due_date: '', schedule: [], steps_sent: [], status: 'active' };
function chaseSettings(body) {
  const cfg = Chase.cfg(), T = Chase.templates(), st = Chase.loadState();
  const test = !st.testMode || st.testMode.sms !== false;
  body.innerHTML = `<div class="grid g2" style="align-items:start"><div class="stack">
    <div class="card"><h2 style="margin-bottom:10px">Automatic payment chasing</h2>
      ${test ? `<div class="note pink" style="margin-bottom:12px">${icon('alert')} <b>Test mode.</b> No SMS goes to any phone yet. Each reminder is written to the log as “test (not sent)” and Josh gets an email copy. Email reminders also go to Josh until a sending domain is set up.</div>` : ''}
      <div class="stack"><label class="chk"><input type="checkbox" id="ch-on" ${cfg.enabled !== false ? 'checked' : ''}> Chase unpaid invoices automatically</label>
      <label class="chk"><input type="checkbox" id="ch-due" ${cfg.dueDay ? 'checked' : ''}> Also send a heads-up on the due date</label>
      <div class="f">Reminders, days after the due date<div class="row nw">${[0, 1, 2].map(i => `<input type="number" min="1" max="120" class="ch-off" value="${cfg.offsets[i] ?? ''}" style="width:80px">`).join('')}</div></div>
      <div class="note">${icon('clock')} ${esc(CC.QUIET_TEXT)}</div>
      <div class="small muted">Every message names your business (${esc(Chase.businessName())}) and has an opt-out: “Reply STOP to opt out” on SMS, an unsubscribe link on email. Turn chasing off for a single invoice on the invoice, or for a customer on their page.</div></div></div>
    <div class="card"><h2 style="margin-bottom:10px">Preview</h2><div class="seg" id="ch-pk">${Object.keys(T).map(k => `<button data-k="${k}" class="${k === 'first' ? 'on' : ''}">${esc(CC.STEP_LABEL[k].replace(' reminder', '').replace('Due-date', 'Due day'))}</button>`).join('')}</div>
      <div class="small muted" style="margin:10px 0 4px">SMS <span id="ch-pn"></span></div><div class="sms-bub" id="ch-ps"></div>
      <div class="small muted" style="margin:12px 0 4px">Email</div><div class="card flat" style="padding:12px"><b id="ch-pj"></b><div id="ch-pe" style="white-space:pre-wrap;margin-top:6px;font-size:14px"></div></div></div>
    </div>
    <div class="card"><h2 style="margin-bottom:6px">Wording</h2><p class="small muted" style="margin-top:0">Placeholders: {first_name} {invoice_no} {amount} {due_date} {days_overdue} {link} {business}. Friendly first, a bit firmer by the last one.</p>
      ${Object.keys(T).map(k => `<details class="ch-t" data-k="${k}" ${k === 'first' ? 'open' : ''}><summary><b>${esc(CC.STEP_LABEL[k])}</b></summary><div class="stack" style="margin:10px 0 14px">
        <label class="f">SMS<textarea data-f="sms" rows="3" style="min-height:80px">${esc(T[k].sms)}</textarea></label>
        <label class="f">Email subject<input type="text" data-f="subject" value="${esc(T[k].subject)}"></label>
        <label class="f">Email<textarea data-f="email" rows="6">${esc(T[k].email)}</textarea></label></div></details>`).join('')}
      <div class="row" style="margin-top:12px"><button class="btn pri" id="ch-save">${icon('check')} Save</button><button class="btn ghost" id="ch-reset">Reset wording</button><a class="btn ghost" href="#/reminders">Reminders log</a></div></div></div>`;
  let pk = 'first';
  const read = () => { const t = {}; $$('.ch-t', body).forEach(d => { t[d.dataset.k] = {}; $$('[data-f]', d).forEach(i => t[d.dataset.k][i.dataset.f] = i.value); }); return t; };
  const preview = () => {
    const offs = CC.offsetsFor({ offsets: $$('.ch-off', body).map(i => +i.value).filter(Boolean), dueDay: $('#ch-due', body).checked });
    const off = pk === 'due' ? 0 : (offs.filter(o => o > 0).find(o => CC.templateKey(o, offs) === pk) ?? 3);
    const due = CC.addDays(today(), -off), ch = Object.assign({}, SAMPLE, { business_name: Chase.businessName(), due_date: due, schedule: offs, templates: read() });
    const m = CC.buildMessage(ch, off, today(), { view: 'https://joshtilley88-wq.github.io/invoicemate/view.html?t=Xy12Ab34Cd56Ef78Gh90Ij' }, { replyStop: true });
    $('#ch-ps', body).textContent = m.sms; $('#ch-pn', body).textContent = `· ${m.sms.length} characters, ${m.smsParts} SMS part${m.smsParts > 1 ? 's' : ''}`;
    $('#ch-pj', body).textContent = m.subject; $('#ch-pe', body).textContent = m.text;
  };
  $$('#ch-pk button', body).forEach(b => b.onclick = () => { pk = b.dataset.k; $$('#ch-pk button', body).forEach(x => x.classList.toggle('on', x === b)); preview(); });
  body.addEventListener('input', preview); body.addEventListener('change', preview); preview();
  $('#ch-save', body).onclick = async () => {
    const t = read(), keep = {};
    for (const k of Object.keys(t)) { const d = CC.DEFAULT_TEMPLATES[k], o = {}; for (const f of ['sms', 'subject', 'email']) if (t[k][f].trim() && t[k][f].trim() !== d[f]) o[f] = t[k][f].trim(); if (Object.keys(o).length) keep[k] = o; }
    Object.assign(cfg, { enabled: $('#ch-on', body).checked, dueDay: $('#ch-due', body).checked, offsets: [...new Set($$('.ch-off', body).map(i => Math.round(+i.value)).filter(n => n > 0 && n <= 120))].sort((a, b) => a - b), templates: keep });
    if (!cfg.offsets.length) cfg.offsets = CC.DEFAULT_OFFSETS.slice();
    await saveSettings(); toast('Chasing settings saved'); Chase.syncNow();
  };
  $('#ch-reset', body).onclick = async () => { if (await confirmBox('Reset the reminder wording to the defaults?', 'Reset', false)) { cfg.templates = {}; await saveSettings(); render(); } };
}

/* ---------- Reminders log ---------- */
V.reminders = async view => {
  const draw = () => {
    const st = Chase.loadState(), active = st.chases.filter(c => c.status === 'active');
    view.innerHTML = `${pageH('Reminders log', 'Payment reminders InvoiceMate has sent for you, newest first.', `<button class="btn" id="rl-ref">${icon('refresh')} Refresh</button><a class="btn" href="#/settings?tab=chase">${icon('sliders')} Settings</a>`)}
      ${st.testMode && st.testMode.sms ? `<div class="note pink" style="margin-bottom:16px">${icon('alert')} Test mode: SMS reminders are logged as “test (not sent)” and Josh gets an email copy. Nothing goes to customers’ phones yet.</div>` : ''}
      ${Chase.lastError ? `<div class="note pink" style="margin-bottom:16px">Couldn’t reach the chasing server: ${esc(Chase.lastError)}</div>` : ''}
      <div class="card" style="margin-bottom:18px"><h2 style="margin-bottom:10px">Being chased <span class="badge">${active.length}</span></h2>
        <div class="list">${active.map(c => `<a class="li" href="#/invoice/${esc(c.invoice_id)}" style="text-decoration:none;color:inherit"><span class="ic warn">${icon('clock')}</span><div class="grow"><div class="t">${esc(c.first_name || '')} · ${esc(c.invoice_no)}</div>
          <div class="s">${CC.fmtMoney(c.amount_cents)} · due ${fmtD(c.due_date)} · ${c.next_date ? 'next ' + fmtD(c.next_date) : 'no more scheduled'}</div></div></a>`).join('') || '<div class="empty">Nothing being chased right now.</div>'}</div>
        <div class="small muted" style="margin-top:8px">${esc(CC.QUIET_TEXT)}</div></div>
      <div class="card"><h2 style="margin-bottom:10px">Sent</h2><div class="list">${st.log.map(l => `<div class="li" style="cursor:default;align-items:flex-start"><span class="ic ${/fail/.test(l.status) ? 'bad' : /opted/.test(l.status) ? 'lav' : 'ok'}">${icon(l.channel === 'email' ? 'mail' : l.channel === 'sms' ? 'send' : 'user')}</span>
        <div class="grow"><div class="t">${esc(l.first_name || '')} · ${esc(l.invoice_no || '')} · ${esc(l.step_label || l.status)}</div>
        <div class="s" style="white-space:normal">${new Date(l.at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ${esc((l.channel || '').toUpperCase())} ${esc(l.recipient || '')} · <b>${esc(l.status)}</b>${l.detail ? ' · ' + esc(l.detail) : ''}</div>
        ${l.body ? `<details><summary class="small">Message</summary><div class="small" style="white-space:pre-wrap;margin-top:6px">${esc(l.body)}</div></details>` : ''}</div></div>`).join('') || '<div class="empty">No reminders sent yet.</div>'}</div></div>`;
    $('#rl-ref').onclick = async () => { $('#rl-ref').disabled = true; try { await Chase.syncNow(true); await Chase.pull(); } catch (e) { } draw(); };
  };
  draw(); Chase.pull().then(() => { if (route().parts[0] === 'reminders') draw(); }).catch(() => draw());
};
