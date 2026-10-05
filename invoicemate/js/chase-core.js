/* InvoiceMate: automatic payment chasing, shared logic (no DOM, no network).
 * Used by the app (window.IMChaseCore), the Supabase function (Deno, imported for its side effect -> globalThis.IMChaseCore)
 * and the Node tests (require). Keep it dependency-free.
 *  - schedule / which reminder is due (Sydney calendar days)
 *  - quiet hours: only Mon–Sat, 8:00am–6:59pm Australia/Sydney (DST-safe via Intl). No Sundays (my call: Sunday
 *    reminders about money feel pushy; the Spam Act itself doesn't set hours, Josh asked for 8–7).
 *  - friendly-to-firmer Aussie templates, rendering, and the compliance footer (business name + opt-out always added). */
(function (root) {
  'use strict';
  const TZ = 'Australia/Sydney';
  const DEFAULT_OFFSETS = [3, 7, 14];
  const QUIET = { startHour: 8, endHour: 19, days: [1, 2, 3, 4, 5, 6] };   // 0 = Sunday
  /* NSW public holidays: no reminders on these either. Update this list each year. */
  const HOLIDAYS = ['2026-10-05', '2026-12-25', '2026-12-26', '2026-12-28', '2027-01-01', '2027-01-26', '2027-03-26', '2027-03-27', '2027-03-29', '2027-04-26',
    '2027-06-14', '2027-10-04', '2027-12-25', '2027-12-27', '2027-12-28'];

  /* ---------- Sydney time ---------- */
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function sydney(now = new Date()) {
    const p = {}; for (const x of new Intl.DateTimeFormat('en-AU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now)) p[x.type] = x.value;
    const hour = +p.hour % 24;
    return { date: `${p.year}-${p.month}-${p.day}`, hour, minute: +p.minute, weekday: WD[p.weekday] };
  }
  function canSendNow(now = new Date()) {
    const s = sydney(now);
    if (!QUIET.days.includes(s.weekday)) return { ok: false, reason: 'Sunday (no reminders on Sundays)', sydney: s };
    if (HOLIDAYS.includes(s.date)) return { ok: false, reason: 'public holiday', sydney: s };
    if (s.hour < QUIET.startHour) return { ok: false, reason: 'before 8am Sydney time', sydney: s };
    if (s.hour >= QUIET.endHour) return { ok: false, reason: 'after 7pm Sydney time', sydney: s };
    return { ok: true, reason: '', sydney: s };
  }
  const QUIET_TEXT = 'Reminders only go out Monday to Saturday, 8am to 7pm Sydney time. Not on Sundays or NSW public holidays. Anything due outside those hours waits for the next window.';

  /* ---------- dates (plain calendar dates, no time zone maths) ---------- */
  function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(iso) { const [y, m, d] = String(iso).split('-').map(Number); return `${d} ${MON[m - 1]}`; }
  function fmtMoney(cents) { const v = (Math.round(cents) / 100); return '$' + v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  /* ---------- schedule ---------- */
  function offsetsFor(cfg) {
    const o = (cfg && Array.isArray(cfg.offsets) ? cfg.offsets : DEFAULT_OFFSETS).map(Number).filter(n => Number.isFinite(n) && n > 0 && n <= 120);
    const set = [...new Set(o)].sort((a, b) => a - b);
    return (cfg && cfg.dueDay) ? [0, ...set] : set;
  }
  function schedule(dueDate, offsets) { return offsets.map(o => ({ offset: o, date: addDays(dueDate, o) })); }
  /* which reminder (if any) should go out today. Only the latest one that's due is sent; earlier missed ones are skipped,
   * so a late-created chase never sends a burst. Returns {offset, skip:[...]} or null. */
  function dueStep(chase, todayISO) {
    if (!chase || chase.status !== 'active' || !(chase.amount_cents > 0) || !chase.due_date) return null;
    const sent = chase.steps_sent || [];
    const due = (chase.schedule || []).filter(o => addDays(chase.due_date, o) <= todayISO && !sent.includes(o));
    if (!due.length) return null;
    const offset = Math.max(...due);
    return { offset, skip: due.filter(o => o !== offset) };
  }
  function nextDate(chase, todayISO) {
    if (!chase || chase.status !== 'active') return null;
    const sent = chase.steps_sent || [];
    const left = (chase.schedule || []).filter(o => !sent.includes(o)).map(o => addDays(chase.due_date, o)).sort();
    if (!left.length) return null;
    return left[0] < todayISO ? todayISO : left[0];
  }
  function allDone(chase) { const sent = chase.steps_sent || []; return (chase.schedule || []).every(o => sent.includes(o)); }

  /* ---------- templates ---------- */
  const DEFAULT_TEMPLATES = {
    due: {
      sms: "G'day {first_name}, just a heads-up that invoice {invoice_no} for {amount} is due today. View or pay: {link} Cheers, {business}",
      subject: 'Invoice {invoice_no} is due today',
      email: "G'day {first_name},\n\nJust a quick heads-up that invoice {invoice_no} for {amount} is due today.\n\nYou can view it here: {link}\n\nCheers,\n{business}",
    },
    first: {
      sms: "G'day {first_name}, just a friendly reminder that invoice {invoice_no} for {amount} was due on {due_date}. No worries if it's already on its way. View or pay: {link} Cheers, {business}",
      subject: 'Friendly reminder: invoice {invoice_no}',
      email: "G'day {first_name},\n\nJust a friendly reminder that invoice {invoice_no} for {amount} was due on {due_date}. No worries if it's already on its way.\n\nYou can view or pay it here: {link}\n\nCheers,\n{business}",
    },
    second: {
      sms: "Hi {first_name}, invoice {invoice_no} for {amount} is now {days_overdue} days overdue (due {due_date}). Could you sort it when you get a chance? View or pay: {link} Thanks, {business}",
      subject: 'Invoice {invoice_no} is now overdue',
      email: "Hi {first_name},\n\nInvoice {invoice_no} for {amount} is now {days_overdue} days overdue (it was due on {due_date}). Could you please sort it when you get a chance?\n\nView or pay: {link}\n\nThanks,\n{business}",
    },
    final: {
      sms: "Hi {first_name}, invoice {invoice_no} for {amount} is now {days_overdue} days overdue. Please arrange payment this week, or get in touch if there's a problem. View or pay: {link} Thanks, {business}",
      subject: 'Overdue: invoice {invoice_no} ({amount})',
      email: "Hi {first_name},\n\nInvoice {invoice_no} for {amount} is now {days_overdue} days overdue (due {due_date}). Please arrange payment this week. If there's a problem, just get in touch and we can work something out.\n\nView or pay: {link}\n\nThanks,\n{business}",
    },
  };
  const STEP_LABEL = { due: 'Due-date reminder', first: 'Friendly reminder', second: 'Second reminder', final: 'Final (firmer) reminder' };
  /* which template a given offset uses: 0 = due; then first / second / final in order (the last of 3+ is "final") */
  function templateKey(offset, offsets) {
    if (offset <= 0) return 'due';
    const pos = offsets.filter(o => o > 0).sort((a, b) => a - b), i = pos.indexOf(offset);
    if (i <= 0) return 'first';
    if (i === pos.length - 1 && pos.length >= 3) return 'final';
    return i === 1 ? 'second' : 'final';
  }
  /* SMS-safe text: straight quotes and dashes keep it in the GSM-7 alphabet (160 chars a part, not 70) */
  function gsmSafe(s) { return String(s).replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/\u00A0/g, ' '); }
  function smsParts(s) { const n = String(s).length; return n <= 160 ? 1 : Math.ceil(n / 153); }
  function fill(tpl, v) { return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)); }
  function vars(chase, todayISO, link) {
    return { first_name: chase.first_name || 'there', business: chase.business_name || 'us', invoice_no: chase.invoice_no, amount: fmtMoney(chase.amount_cents),
      due_date: fmtDay(chase.due_date), days_overdue: Math.max(0, daysBetween(chase.due_date, todayISO)), link: link || '' };
  }
  /* the message for one step. Business name + opt-out are always added if the template left them out (Spam Act). */
  function buildMessage(chase, offset, todayISO, links, opts = {}) {
    const offsets = chase.schedule && chase.schedule.length ? chase.schedule : DEFAULT_OFFSETS;
    const key = templateKey(offset, offsets), T = Object.assign({}, DEFAULT_TEMPLATES[key], ((chase.templates || {})[key]) || {});
    const v = vars(chase, todayISO, links.view);
    let sms = gsmSafe(fill(T.sms, v)).replace(/\s+/g, ' ').trim();
    if (!sms.includes(v.business)) sms += ` - ${v.business}`;
    if (links.view && !sms.includes(links.view)) sms += ` ${links.view}`;
    if (!/[.!?]$/.test(sms)) sms += '.';
    sms += opts.replyStop ? ' Reply STOP to opt out.' : ` Opt out: ${links.optout || links.view}`;
    const subject = fill(T.subject, v).trim();
    let text = fill(T.email, v).trim();
    if (!text.includes(v.business)) text += `\n\n${v.business}`;
    if (opts.attached) text += `\n\nInvoice ${v.invoice_no} is attached as a PDF.`;
    const footer = `This reminder was sent on behalf of ${v.business} by InvoiceMate. Don't want these reminders? Unsubscribe: ${links.optout || links.view}`;
    text += `\n\n--\n${footer}`;
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const linkify = s => esc(s).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
    const body = fill(T.email, v).trim() + (fill(T.email, v).includes(v.business) ? '' : `\n\n${v.business}`);
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#2B2F36;max-width:560px">` +
      body.split(/\n{2,}/).map(p => `<p style="margin:0 0 12px">${linkify(p).replace(/\n/g, '<br>')}</p>`).join('') +
      (opts.attached ? `<p style="margin:0 0 12px;color:#555">Invoice ${esc(v.invoice_no)} is attached as a PDF.</p>` : '') +
      (links.view ? `<p style="margin:18px 0"><a href="${esc(links.view)}" style="background:#F57C00;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:bold">View invoice ${esc(v.invoice_no)}</a></p>` : '') +
      `<p style="margin:24px 0 0;font-size:12px;color:#888">This reminder was sent on behalf of ${esc(v.business)} by InvoiceMate. Don't want these reminders? <a href="${esc(links.optout || links.view)}" style="color:#888">Unsubscribe</a>.</p></div>`;
    return { key, label: STEP_LABEL[key], sms, smsParts: smsParts(sms), subject, text, html };
  }

  /* ---------- contacts ---------- */
  function auMobile(p) {
    let d = String(p || '').replace(/[^\d+]/g, '');
    if (d.startsWith('+61')) d = '0' + d.slice(3); else if (d.startsWith('61') && d.length === 11) d = '0' + d.slice(2);
    return /^04\d{8}$/.test(d) ? '+61' + d.slice(1) : '';
  }
  const okEmail = e => /^[^\s@<>()",;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(String(e || '').trim());

  /* ---------- what the app sends to the server for one invoice ---------- */
  /* inv: {id, number, kind, sent, confirmed, dueDate, chase}, calc: {balance}, cust: {id, name, phone, email, chase, chaseOptedOut}, cfg: settings.chase */
  function desired(inv, calc, cust, cfg, business) {
    const base = { invoice_id: inv.id };
    if (!cfg || cfg.enabled === false) return { ...base, active: false, reason: 'off' };
    if (inv.kind === 'quote') return { ...base, active: false, reason: 'quote' };
    if (!(calc.balance > 0.004)) return { ...base, active: false, reason: 'paid' };
    if (!(inv.sent || inv.confirmed)) return { ...base, active: false, reason: 'draft' };
    if (inv.chase === false) return { ...base, active: false, reason: 'off-invoice' };
    if (!cust || cust.chase === false) return { ...base, active: false, reason: 'off-customer' };
    if (!inv.dueDate) return { ...base, active: false, reason: 'no-due-date' };
    const phone = auMobile(cust.phone), email = okEmail(cust.email) ? String(cust.email).trim() : '';
    if (!phone && !email) return { ...base, active: false, reason: 'no-contact' };
    return { ...base, active: true, invoice_no: inv.number, amount_cents: Math.round(calc.balance * 100), due_date: inv.dueDate, customer_key: cust.id,
      first_name: String(cust.name || cust.business || '').trim().split(/\s+/)[0] || '', phone, email, business_name: business || '',
      schedule: offsetsFor(cfg), templates: cfg.templates || {} };
  }
  const REASON = { off: 'Chasing is off in Settings', quote: 'Quote', paid: 'Paid', draft: 'Not sent or confirmed yet', 'off-invoice': 'Chasing off for this invoice',
    'off-customer': 'Chasing off for this customer', 'no-due-date': 'No due date', 'no-contact': 'No mobile or email for the customer', deleted: 'Deleted' };

  const api = { TZ, QUIET, HOLIDAYS, QUIET_TEXT, DEFAULT_OFFSETS, DEFAULT_TEMPLATES, STEP_LABEL, REASON, sydney, canSendNow, addDays, daysBetween, fmtDay, fmtMoney, offsetsFor, schedule, dueStep, nextDate, allDone,
    templateKey, gsmSafe, smsParts, fill, vars, buildMessage, auMobile, okEmail, desired };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.IMChaseCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
