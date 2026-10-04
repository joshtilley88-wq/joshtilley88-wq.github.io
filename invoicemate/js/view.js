/* InvoiceMate: public "view invoice" page for payment reminders (view.html?t=<token>[&stop=1]).
 * Shows only a summary (business, invoice no, amount owing, due date). No customer contact details are ever returned.
 * Pay online is a placeholder for a later phase (Stripe etc. not integrated). "Stop reminders" opts this customer out. */
'use strict';
(function () {
  const URL_ = 'https://opekqrldytqvjziowbqo.supabase.co/functions/v1/invoicemate-chase', APP = 'invoicemate-pwa-2026';
  const el = document.getElementById('vw'), q = new URLSearchParams(location.search), t = q.get('t') || '';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = iso => { try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return iso; } };
  const call = body => fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-im-app': APP }, body: JSON.stringify(body) }).then(r => r.json().then(j => ({ ok: r.ok && j.ok, j })));
  const show = h => { el.innerHTML = `<div class="card">${h}</div><div class="foot">Sent with InvoiceMate</div>`; };
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(t)) { show('<h2>Link not valid</h2><p class="muted">This link is incomplete. Please use the full link from your message.</p>'); return; }
  call({ route: 'view', t }).then(({ ok, j }) => {
    if (!ok) { show(`<h2>Invoice not found</h2><p class="muted">${esc(j.error || 'This link isn’t valid any more.')}</p>`); return; }
    const paid = j.status === 'paid', out = j.status === 'opted_out';
    show(`<div class="small muted">${esc(j.business_name)}</div><h2 style="margin:4px 0 0">Invoice ${esc(j.invoice_no)}</h2>
      ${paid ? '<p><span class="pill paid">Paid, thank you</span></p>' : `<div class="amt num">${esc(j.amount)}</div><div class="muted">owing${j.first_name ? ' · for ' + esc(j.first_name) : ''}</div>`}
      <div style="margin-top:14px"><div class="row2"><span class="muted">Invoice</span><b>${esc(j.invoice_no)}</b></div><div class="row2"><span class="muted">Due date</span><b>${esc(fmt(j.due_date))}</b></div><div class="row2"><span class="muted">From</span><b>${esc(j.business_name)}</b></div></div>
      ${paid ? '' : `<button class="btn pri pay" disabled title="Coming soon">Pay online (coming soon)</button>
      <p class="small muted" style="margin-top:10px">Online payment isn’t set up yet. Please pay using the bank details on your invoice, with ${esc(j.invoice_no)} as the reference, or contact ${esc(j.business_name)}.</p>`}
      ${out ? '<p class="small muted" style="margin-top:18px">You’ve opted out of payment reminders.</p>' : `<div style="text-align:center"><button class="stop" id="stop">Stop payment reminders</button></div>`}`);
    const b = document.getElementById('stop');
    if (b) {
      const go = () => { b.disabled = true; b.textContent = 'Stopping…'; call({ route: 'unsub', t }).then(({ ok }) => { b.outerHTML = ok ? `<p class="small" style="margin-top:18px">Done. You won’t get any more payment reminders from ${esc(j.business_name)}.</p>` : '<p class="small">Sorry, that didn’t work. Please try again.</p>'; }); };
      b.onclick = go;
      if (q.get('stop') === '1') { b.textContent = 'Yes, stop payment reminders'; b.className = 'btn pay'; b.insertAdjacentHTML('beforebegin', '<p class="small" style="margin-top:18px">Don’t want reminders about this invoice? Tap below and they’ll stop.</p>'); }
    }
  }).catch(() => show('<h2>Couldn’t load the invoice</h2><p class="muted">Check your internet connection and try again.</p>'));
})();
