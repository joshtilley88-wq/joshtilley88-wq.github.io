/* InvoiceMate: real email sending through the Supabase Edge Function "invoicemate-send" (which calls Resend).
 * No secrets here: the Resend key lives only on the server as a function secret.
 * IM_SEND_APP is a public "this came from the app" header value (light abuse protection, not a secret).
 * While the server is in test mode (no verified domain yet) every email is delivered to Josh, with the
 * intended recipient in the subject. If the function isn't reachable, the app falls back to mailto/Gmail. */
'use strict';
const IM_SEND_URL = 'https://opekqrldytqvjziowbqo.supabase.co/functions/v1/invoicemate-send';
const IM_SEND_APP = 'invoicemate-pwa-2026';

const Sender = {
  _probe: null, _at: 0, ready: false, testMode: false,
  /* resolves true when the function answers. Cached for 10 minutes (a failed check is retried after 30 s). */
  available(force = false) {
    const age = Date.now() - this._at;
    if (!force && this._probe && (this.ready ? age < 600000 : age < 30000)) return this._probe;
    this._at = Date.now();
    this._probe = (async () => {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
        const r = await fetch(IM_SEND_URL, { method: 'GET', headers: { 'x-im-app': IM_SEND_APP }, signal: ctl.signal, cache: 'no-store' }); clearTimeout(t);
        const j = r.ok ? await r.json() : null; this.ready = !!(j && j.ok && j.service === 'invoicemate-send'); this.testMode = !!(j && j.testMode);
      } catch (e) { this.ready = false; }
      return this.ready;
    })();
    return this._probe;
  },
  /* {to, subject, html, text, reply_to?, attachments?} -> {ok, id, deliveredTo, intendedTo, testMode}; throws Error(plain-English message) */
  async send(msg) {
    let r;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
      r = await fetch(IM_SEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-im-app': IM_SEND_APP }, body: JSON.stringify(msg), signal: ctl.signal }); clearTimeout(t);
    } catch (e) { throw new Error(navigator.onLine === false ? 'The phone is offline' : 'Couldn’t reach the email server'); }
    let j = null; try { j = await r.json(); } catch (e) { }
    if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || `The email server said ${r.status}`);
    this.ready = true; return j;
  },
};

/* plain text -> simple HTML paragraphs */
function textToHtml(t) { return String(t || '').split(/\n{2,}/).map(p => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, '<br>')}</p>`).join(''); }

/* email-safe invoice (inline styles, tables; no app CSS) */
function invoiceEmailHtml(inv) {
  const c = invCalc(inv), cu = byId('customers', inv.customerId) || {}, b = S.settings.business || {};
  const gstOn = b.gstRegistered !== false && c.gst > 0, td = 'padding:8px 6px;border-bottom:1px solid #eee;font-size:14px', r = 'text-align:right;';
  const rows = inv.items.map(it => { const l = lineCalc(it); return `<tr><td style="${td}">${esc(it.desc)}${it.details ? `<div style="color:#777;font-size:12px">${esc(it.details)}</div>` : ''}</td><td style="${td}${r}">${num(it.qty)}</td><td style="${td}${r}">${money(it.price)}</td><td style="${td}${r}">${money(l.net)}</td></tr>`; }).join('');
  const bank = bankDetails();
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#2B2F36;max-width:620px">
  <table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:14px"><tr>
    <td style="vertical-align:top;font-size:13px;line-height:1.5"><b style="font-size:16px">${esc(b.name || b.tradingName || 'InvoiceMate')}</b>${b.abn ? '<br>ABN ' + esc(b.abn) : ''}${b.phone ? '<br>' + esc(b.phone) : ''}${b.email ? '<br>' + esc(b.email) : ''}</td>
    <td style="vertical-align:top;text-align:right"><div style="font-size:20px;font-weight:bold;color:#F57C00">${gstOn ? 'TAX INVOICE' : 'INVOICE'}</div><div style="font-size:13px;line-height:1.6"><b>${esc(inv.number)}</b><br>Issued ${fmtD(inv.issueDate)}<br>Due ${fmtD(inv.dueDate)}</div></td></tr></table>
  <div style="font-size:13px;line-height:1.5;margin-bottom:12px"><span style="font-size:11px;color:#888;text-transform:uppercase">Bill to</span><br><b>${esc(cu.business || cu.name || '')}</b>${cu.address ? '<br>' + esc(cu.address) : ''}</div>
  <table width="100%" style="border-collapse:collapse"><thead><tr style="background:#FFF3E0"><th style="${td}text-align:left">Description</th><th style="${td}${r}">Qty</th><th style="${td}${r}">Price</th><th style="${td}${r}">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <table role="presentation" style="border-collapse:collapse;margin:10px 0 0 auto;font-size:14px"><tr><td style="padding:3px 10px">Subtotal${gstOn ? ' (ex GST)' : ''}</td><td style="padding:3px 6px;${r}">${money(c.sub)}</td></tr>
    ${gstOn ? `<tr><td style="padding:3px 10px">GST 10%</td><td style="padding:3px 6px;${r}">${money(c.gst)}</td></tr>` : ''}
    <tr><td style="padding:6px 10px;font-weight:bold;font-size:16px">Total${gstOn ? ' (inc GST)' : ''}</td><td style="padding:6px;${r}font-weight:bold;font-size:16px">${money(c.total)}</td></tr>
    ${c.paid ? `<tr><td style="padding:3px 10px;font-weight:bold;color:#B25600">Balance due</td><td style="padding:3px 6px;${r}font-weight:bold;color:#B25600">${money(c.balance)}</td></tr>` : ''}</table>
  ${inv.notes ? `<div style="margin-top:16px;font-size:13px;white-space:pre-wrap;color:#555">${esc(inv.notes)}</div>` : ''}
  ${bank ? `<div style="margin-top:12px;font-size:13px;white-space:pre-wrap">${esc(bank)}\nReference: ${esc(inv.number)}</div>` : ''}</div>`;
}

/* build the real email for an outbox entry (with the invoice inline for invoice emails) */
function emailForSend(entry, v) {
  const inv = entry.invoiceId && byId('invoices', entry.invoiceId);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#2B2F36;line-height:1.5">${textToHtml(v.body)}</div>` +
    (inv && ['invoice', 'balance', 'deposit'].includes(entry.type) ? `<hr style="border:0;border-top:1px solid #eee;margin:18px 0">${invoiceEmailHtml(inv)}` : '');
  const b = S.settings.business || {};
  return { to: v.to, subject: v.subject, text: v.body, html, ...(b.email ? { reply_to: b.email } : {}) };
}

/* mark an outbox entry (and its invoice/contract) as sent */
async function markEntrySent(entry, v) {
  const m0 = composeEmail(entry);
  if (v) { if (v.subject !== m0.subject || v.body !== m0.body) { entry.subject = v.subject; entry.body = v.body; } entry.to = v.to; }
  entry.status = 'sent'; entry.sentAt = new Date().toISOString(); if (!entry.scheduledDate) entry.scheduledDate = today();
  await save('outbox', entry);
  const inv = entry.invoiceId && byId('invoices', entry.invoiceId);
  if (inv && !inv.sent && ['deposit', 'balance', 'invoice'].includes(entry.type)) { inv.sent = true; inv.sentAt = today(); await save('invoices', inv); }
  if (entry.type === 'contract') { const k = byId('contracts', entry.contractId); if (k && k.status === 'draft') { k.status = 'sent'; k.sentAt = today(); await save('contracts', k); } }
}

/* send an outbox entry for real. Returns the server reply; throws on failure. */
async function sendEntryNow(entry, v) {
  v = v || composeEmail(entry);
  if (!v.to) throw new Error('There’s no email address to send to');
  const res = await Sender.send(emailForSend(entry, v));
  entry.via = 'resend'; entry.resendId = res.id; if (res.testMode) entry.testDeliveredTo = res.deliveredTo;
  await markEntrySent(entry, v);
  return res;
}

/* ---------- natural voice (OpenAI TTS via the "invoicemate-tts" function). Falls back to speechSynthesis. ---------- */
const IM_TTS_URL = 'https://opekqrldytqvjziowbqo.supabase.co/functions/v1/invoicemate-tts';
const IM_TTS_VOICES = [['device', 'Phone’s built-in voice (works offline)'], ['nova', 'Nova (warm, default)'], ['alloy', 'Alloy (neutral)'], ['shimmer', 'Shimmer (bright)'], ['coral', 'Coral (friendly)'], ['sage', 'Sage (calm)'], ['ash', 'Ash (male, relaxed)'], ['echo', 'Echo (male)'], ['onyx', 'Onyx (male, deep)'], ['fable', 'Fable (storyteller)']];
const TTS = {
  down: 0,            // time of the last failure: skip the server for 60 s after one, go straight to the phone's voice
  get voice() { return IMPrefs.get('ttsvoice', 'nova'); },
  set voice(v) { IMPrefs.set('ttsvoice', v); },
  enabled() { return this.voice !== 'device' && navigator.onLine !== false && Date.now() - this.down > 60000; },
  /* text (<= 600 chars) -> Blob (audio/mpeg) or throws */
  cache: new Map(),   // recent phrases ("Still there?", "Sent to Dave.") play instantly the second time
  fetch(text) {
    const k = this.voice + '|' + text; if (this.cache.has(k)) { const p = this.cache.get(k); this.cache.delete(k); this.cache.set(k, p); return p; }
    const p = this._fetch(text); this.cache.set(k, p); p.catch(() => this.cache.delete(k));
    while (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value);
    return p;
  },
  prefetch(text) { if (this.enabled() && text) this.fetch(text).catch(() => { }); },
  async _fetch(text) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(IM_TTS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-im-app': IM_SEND_APP }, body: JSON.stringify({ text: text.slice(0, 600), voice: this.voice }), signal: ctl.signal });
      if (!r.ok || !/audio/.test(r.headers.get('content-type') || '')) throw new Error('tts ' + r.status);
      const b = await r.blob(); b.ttsChars = text.length; return b;
    } catch (e) { this.down = Date.now(); throw e; } finally { clearTimeout(t); }
  },
};
