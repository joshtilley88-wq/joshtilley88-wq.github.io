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
  // PDF attachment: invoices are always sent as a PDF; deposit/balance/receipt emails can add one
  const pdf = typeof pdfForEmail === 'function' ? pdfForEmail(entry) : null, pdfOnly = !!pdf && entry.type === 'invoice';
  let share = pdf && canShareFiles();
  // with Outlook connected, the PDF button makes a ready-to-send Outlook draft (To + message + PDF) instead
  let ol = !!pdf && typeof outlookOn === 'function' && outlookOn(); const olOffer = !!pdf && !ol && typeof outlookEnabled === 'function' && outlookEnabled();
  let pdfBlob = null, pdfErr = null; const pdfP = pdf ? pdf.make().then(b => { pdfBlob = b; }, e => { pdfErr = e; console.warn('PDF failed', e); }) : null;
  const shareLbl = () => share ? (pdfOnly ? 'Share PDF' : 'Send with PDF') : (pdfOnly ? 'Download PDF &amp; open email' : 'Email with PDF');
  const pdfLbl = () => `${icon(ol ? 'link' : share ? 'send' : 'download')} ${ol ? 'Open in Outlook' : shareLbl()}`;
  const already = () => entry.status === 'sent' || entry.sendState === 'sent';
  const pdfBtn = pdf ? `<button class="btn ${pdfOnly && !ol ? 'out' : ''}" id="em-pdf">${pdfLbl()}</button>` : '';
  const sendBtn = ol ? `<button class="btn pri" id="em-send" ${already() ? 'disabled' : ''}>${icon('send')} ${already() ? 'Already sent' : 'Send now'}</button>` : '';
  const pdfNote = !pdf ? '' : ol ? `Check the email above, then tap <b>Send now</b> to send it from your Outlook (${esc(DEV.outlook.username || 'connected')}) with <b>${esc(pdf.name)}</b> attached. It's marked as sent automatically. To change it in Outlook first, tap <b>Open in Outlook</b>.`
    : share ? `Tap <b>${pdfOnly ? 'Share PDF' : 'Send with PDF'}</b> and choose Gmail (or your email app): it opens with <b>${esc(pdf.name)}</b> attached and the message filled in. Add the To address if it's empty (it's copied for you). Then come back and tap <b>Mark as sent</b>.`
    : `<b>${pdfOnly ? 'Download PDF &amp; open email' : 'Email with PDF'}</b> saves <b>${esc(pdf.name)}</b> to your downloads and opens your email app with the message filled in. Attach the PDF, send it, then come back and tap <b>Mark as sent</b>.`;
  const olTip = olOffer ? ' <span class="tiny">Tip: connect Outlook in Settings → Data to get a ready-made draft with the PDF attached.</span>' : '';
  const m = openModal({
    title: esc(EMAIL_LABEL[entry.type] || 'Email') + (inv ? ' · ' + esc(inv.number) : ''), wide: true,
    body: `<div class="stack">
      <label class="f">To<input type="email" id="em-to" value="${esc(m0.to)}" placeholder="client@example.com"></label>
      <label class="f">Subject<input type="text" id="em-sub" value="${esc(m0.subject)}"></label>
      <label class="f">Message<textarea id="em-body" style="min-height:260px">${esc(m0.body)}</textarea></label>
      ${pdf ? `<div class="small" id="em-att">${icon('file')} Attachment: <b>${esc(pdf.name)}</b> <span class="muted" id="em-att-size"></span></div>` : ''}
      <div class="note" id="em-note">${opts.resumed ? '<b>Outlook reconnected.</b> Check the email, then tap <b>Send now</b>. ' : ''}${pdfOnly || ol ? pdfNote + olTip : `Opens your email app with everything filled in.${pdf ? ' ' + pdfNote + olTip : ' Then come back and tap <b>Mark as sent</b>.'}`}</div>
      <div class="note pink" id="em-confirm" hidden></div>
    </div>`,
    foot: `${entry.id ? `<button class="btn ghost" id="em-skip">Skip / dismiss</button>` : ''}<div class="spacer"></div>
      <button class="btn" id="em-copy">${icon('copy')} Copy email</button>
      ${pdfOnly ? '' : `<a class="btn" id="em-gmail" target="_blank" rel="noopener">Open in Gmail</a>
      <a class="btn ${ol ? '' : 'out'}" id="em-open">${icon('send')} Open in email app</a>`}${pdfBtn}
      <button class="btn ${ol ? '' : 'pri'}" id="em-sent">${icon('check')} Mark as sent</button>${sendBtn}`,
  });
  const val = () => ({ to: $('#em-to', m).value.trim(), subject: $('#em-sub', m).value, body: $('#em-body', m).value });
  const upd = () => { if (pdfOnly || ol) return; const v = val(); const u = mailtoURL(v.to, v.subject, v.body); $('#em-open', m).href = u; $('#em-gmail', m).href = gmailURL(v.to, v.subject, v.body);
    $('#em-note', m).classList.toggle('pink', u.length > 1900); if (u.length > 1900) $('#em-note', m).innerHTML = 'This email is long. Some desktop email apps cut off very long mailto links, so if the text looks cut off, use <b>Copy email</b> and paste it instead. Gmail usually handles it fine.'; };
  m.addEventListener('input', upd); upd();
  $('#em-copy', m).onclick = async () => { const v = val(); toast(await copyText(`To: ${v.to}\nSubject: ${v.subject}\n\n${v.body}`) ? 'Email copied' : 'Copy failed'); };
  if (pdfP) pdfP.then(() => { const z = $('#em-att-size', m); if (z && pdfBlob) z.textContent = `(${Math.max(1, Math.round(pdfBlob.size / 1024))} KB)`; });
  let draft = entry.draftId && entry.draftLink ? { id: entry.draftId, webLink: entry.draftLink } : null, draftFor = draft ? JSON.stringify([entry.to || m0.to, m0.subject, m0.body]) : '';
  const openDraft = () => { const w = window.open(draft.webLink, '_blank'); if (w) { try { w.opener = null; } catch (x) { } } return !!w; };
  if (pdf) $('#em-pdf', m).onclick = async e => {
    const btn = e.currentTarget, v = val();
    const done = msg => { const n = $('#em-note', m); n.classList.add('pink'); n.innerHTML = msg; };
    if (draft) { if (!openDraft()) toast('Your browser blocked the new tab. Allow pop-ups for this app'); return; }
    if (!pdfBlob && !pdfErr) {   // still being made: wait, then (for sharing) ask for one more tap so the browser allows the share sheet
      const lbl = btn.innerHTML; btn.disabled = true; btn.textContent = 'Making PDF…'; await pdfP; btn.disabled = false; btn.innerHTML = lbl;
      if (pdfBlob && share && !(ol && navigator.onLine)) { toast('PDF ready. Tap again to share'); return; }
    }
    if (!pdfBlob) { toast('Couldn\'t make the PDF: ' + (pdfErr && pdfErr.message || 'unknown error')); return; }
    let why = olOffer ? 'Outlook isn\'t connected' : '';
    if (ol) {
      why = !navigator.onLine ? 'You\'re offline' : OL.needReconnect ? 'Outlook needs reconnecting (Settings → Data)' : '';
      if (!why) {
        const lbl = btn.innerHTML; btn.disabled = true; btn.textContent = 'Creating Outlook draft…'; let err = null;
        try { draft = await outlookDraft({ to: v.to, subject: v.subject, body: v.body, name: pdf.name, blob: pdfBlob }); draftFor = JSON.stringify([v.to, v.subject, v.body]); } catch (x) { err = x; console.warn('Outlook draft', x); }
        btn.disabled = false; btn.innerHTML = lbl;
        if (draft) {
          if (entry.id) { entry.draftId = draft.id; entry.draftLink = draft.webLink; await persist(null); }   // so Send now later reuses it
          const opened = openDraft();
          btn.innerHTML = `${icon('send')} Open draft in Outlook`;
          toast('Draft ready in Outlook with the PDF attached');
          done(`Draft ready in Outlook${v.to ? ` to <b>${esc(v.to)}</b>` : ''} with <b>${esc(pdf.name)}</b> attached.${opened ? '' : ' Tap <b>Open draft in Outlook</b> to open it.'} Send it there and then tap <b>Mark as sent</b>, or come back and tap <b>Send now</b>.`);
          return;
        }
        why = err && err.kind === 'auth' ? 'Outlook needs reconnecting (Settings → Data)' : 'Outlook didn\'t work: ' + (err && err.message || 'unknown error');
        ol = false; btn.innerHTML = pdfLbl(); const sb = $('#em-send', m); if (sb) sb.hidden = true;
        if (share) {   // the share sheet needs a fresh tap after waiting on the network
          toast(`${why}. Tap ${shareLbl()} to share the PDF instead`);
          done(`${esc(why)}. Tap <b>${shareLbl()}</b> to share the PDF another way, then tap <b>Mark as sent</b>.`);
          return;
        }
      }
    }
    if (share) {
      const file = new File([pdfBlob], pdf.name, { type: 'application/pdf' });
      if (v.to && navigator.clipboard) navigator.clipboard.writeText(v.to).catch(() => { });
      if (why && ol) toast(why + ', so sharing the PDF instead');
      try { await navigator.share({ files: [file], title: v.subject, text: v.body }); done(`Sent it? Tap <b>Mark as sent</b>.${v.to ? ` (The address ${esc(v.to)} was copied in case Gmail left To empty.)` : ''}`); }
      catch (err) { if (err && err.name === 'AbortError') return; download(pdf.name, pdfBlob); toast('Sharing didn\'t work here, so the PDF was downloaded instead'); }
      return;
    }
    download(pdf.name, pdfBlob);
    setTimeout(() => { const a = document.createElement('a'); a.href = mailtoURL(v.to, v.subject, v.body); a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }, 400);
    toast(why ? `${why}, so the PDF was downloaded. Attach it to the email that opens` : 'PDF downloaded. Attach it to the email that opens');
    done(`${why ? esc(why) + '. ' : ''}<b>${esc(pdf.name)}</b> is in your downloads. Attach it to the email, send it, then tap <b>Mark as sent</b>.`);
  };
  const persist = async status => {
    const v = val(); const e = entry;
    if (v.subject !== m0.subject || v.body !== m0.body) { e.subject = v.subject; e.body = v.body; }
    e.to = v.to; if (status) { e.status = status; if (status === 'sent') e.sentAt = new Date().toISOString(); }
    if (!e.scheduledDate) e.scheduledDate = today();
    await save('outbox', e);
  };
  const finishSent = async msg => {
    await persist('sent');
    if (inv && !inv.sent && ['deposit', 'balance', 'invoice'].includes(entry.type)) { inv.sent = true; inv.sentAt = today(); await save('invoices', inv); }
    if (entry.type === 'contract') { const k = byId('contracts', entry.contractId); if (k && k.status === 'draft') { k.status = 'sent'; k.sentAt = today(); await save('contracts', k); } }
    closeModal(); toast(msg || 'Marked as sent'); opts.onSent ? opts.onSent() : render();
  };
  $('#em-sent', m).onclick = () => finishSent();
  // ---- Send now: straight from her Outlook (Mail.Send), only after she taps Send now AND confirms
  let sending = false;
  const cf = $('#em-confirm', m), sendB = $('#em-send', m);
  { const f = $('.modal-f', m); cf.style.cssText = 'flex-basis:100%;margin:0 0 4px'; f.insertBefore(cf, f.firstChild); }   // in the sticky footer: always on screen
  const okAddr = to => { const a = to.split(/[,;]/).map(x => x.trim()).filter(Boolean); return a.length > 0 && a.every(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)); };
  const failNote = (msg, consent, kind) => {
    cf.hidden = false; cf.innerHTML = `${icon('alert')} Not sent: ${esc(msg)}.${kind === 'gone' || kind === 'network' ? '' : ' Nothing went to the client.'}${consent || kind === 'gone' ? '' : ' You can try again, or tap <b>Open in Outlook</b> to send it from there.'}
      ${consent ? `<div class="row" style="margin-top:10px"><button class="btn pri sm" id="em-recon">${icon('link')} Reconnect Outlook to allow sending</button></div>` : ''}`;
    const rb = $('#em-recon', m); if (rb) rb.onclick = async () => { rb.disabled = true; rb.textContent = 'Opening Microsoft sign-in…'; const v = val();
      try { await outlookReconnectForSend(Object.assign({}, entry, { to: v.to, subject: v.subject, body: v.body })); } catch (x) { rb.disabled = false; toast('Couldn\'t start Microsoft sign-in: ' + (x.message || x)); } };
    cf.scrollIntoView({ block: 'nearest' });
  };
  const doSend = async () => {
    if (sending) return;
    if (already()) { toast('Already sent'); return; }
    sending = true; const btns = [...m.querySelectorAll('.modal-f button, #em-confirm button')]; btns.forEach(b => b.disabled = true); sendB.textContent = 'Sending…';
    cf.innerHTML = `${icon('send')} Sending from your Outlook…`;
    let ok = false;
    try {
      if (!navigator.onLine) throw new OutlookError('you\'re offline', 'offline');
      if (!pdfBlob && !pdfErr) await pdfP; if (!pdfBlob) throw new OutlookError('the PDF couldn\'t be made', 'graph');
      const token = await olSendToken(); const v = val();
      let id = draft && draft.id;
      if (id && await outlookDraftState(token, id) === 'gone') {
        if (entry.sendState === 'sending') { entry.sendState = 'sent'; entry.sentVia = 'outlook'; ok = true; await finishSent('Already sent from ' + (DEV.outlook.username || 'Outlook')); return; }   // an earlier try went through after all
        // she sent (or deleted) that draft in Outlook herself: don't risk sending it twice
        draft = null; entry.draftId = ''; entry.draftLink = ''; if (entry.id) await persist(null);
        throw new OutlookError('that Outlook draft was already sent or deleted in Outlook. If you sent it there, tap Mark as sent; otherwise tap Send now again to send a fresh copy', 'gone');
      }
      if (id && draftFor !== JSON.stringify([v.to, v.subject, v.body])) await outlookPatchDraft(token, id, v);
      if (!id) { draft = await outlookDraft({ to: v.to, subject: v.subject, body: v.body, name: pdf.name, blob: pdfBlob, token }); id = draft.id; }
      draftFor = JSON.stringify([v.to, v.subject, v.body]);
      entry.draftId = id; entry.draftLink = draft.webLink; entry.sendState = 'sending'; await persist(null);   // a retry checks the draft before sending again
      try { await outlookSendMessage(token, id); }
      catch (x) { if (x.kind !== 'network') { entry.sendState = ''; await persist(null); } throw x; }   // network: unknown whether it went, keep 'sending'
      entry.sendState = 'sent'; entry.sentVia = 'outlook'; ok = true;
      await finishSent('Sent from ' + (DEV.outlook.username || 'Outlook'));
    } catch (x) {
      console.warn('Send now', x);
      const consent = x.kind === 'consent';
      failNote(consent ? 'Outlook needs your OK to send emails from the app' : x.kind === 'offline' ? 'you\'re offline' : x.kind === 'auth' ? 'Outlook needs reconnecting (Settings → Data)' : x.kind === 'network' ? 'the connection dropped before Outlook answered, so it may not have gone. Tap Send now again to check' : (x.message || 'unknown error'), consent, x.kind);
      toast(consent ? 'Reconnect Outlook to allow sending' : x.kind === 'gone' ? 'Not sent: that draft was already sent or deleted in Outlook' : 'Not sent: ' + (x.message || 'unknown error'));
      if (draft) $('#em-pdf', m).innerHTML = `${icon('link')} Open draft in Outlook`;
    } finally {
      sending = false;
      if (!ok) { btns.forEach(b => b.disabled = false); sendB.innerHTML = `${icon('send')} Send now`; }
    }
  };
  if (sendB) sendB.onclick = () => {
    if (sending) return; if (already()) { toast('Already sent'); return; }
    const v = val();
    if (!okAddr(v.to)) { toast('Add the client\'s email address in To first'); $('#em-to', m).focus(); return; }
    if (!navigator.onLine) { toast('You\'re offline. Use ' + (share ? shareLbl() : shareLbl().replace('&amp;', '&')) + ' instead, or try again when you\'re online'); ol = false; $('#em-pdf', m).innerHTML = pdfLbl(); return; }
    cf.hidden = false;
    cf.innerHTML = `<b>Send to ${esc(v.to)} now?</b><div class="small" style="margin:4px 0 10px">“${esc(v.subject)}” with <b>${esc(pdf.name)}</b> attached, from ${esc(DEV.outlook.username || 'your Outlook')}.</div>
      <div class="row"><button class="btn ghost sm" id="em-cf-no">Cancel</button><button class="btn pri sm" id="em-cf-yes">${icon('send')} Send</button></div>`;
    $('#em-cf-no', m).onclick = () => { cf.hidden = true; cf.innerHTML = ''; };
    $('#em-cf-yes', m).onclick = doSend;
    cf.scrollIntoView({ block: 'nearest' });
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
  let olMsg = ''; if (typeof outlookAfterRedirect === 'function') { olMsg = await outlookAfterRedirect(); if (olMsg) setTimeout(() => toast(olMsg), 300); }   // back from Microsoft sign-in
  try { await tidyOutbox(); } catch (e) { console.warn('tidy outbox', e); }   // paid-up deposit/balance emails + old receipts out of "Due now"
  window.addEventListener('hashchange', () => { if (/^#(sign|q)=/.test(location.hash)) { location.reload(); return; } render(); });
  // back from "Reconnect Outlook to allow sending": return to the page she was on and reopen the email (she still taps Send now herself)
  const re = typeof outlookTakeResume === 'function' ? outlookTakeResume() : null, resume = re && /^Outlook connected/.test(olMsg);
  if (resume && re._back && re._back !== location.hash) history.replaceState(null, '', location.pathname + location.search + re._back);
  if (re) delete re._back;
  await render();
  if (resume) openCompose(re, { resumed: true });   // reopen the email she was sending; she still taps Send now herself
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { });
  // background jobs: Drive auto-backup + due-email notification, on open and whenever the app comes back to the front
  const wake = () => { autoBackup().catch(() => { }); dueNotifyCheck().catch(() => { }); if (syncOn()) syncNow('focus').catch(() => { }); };
  startSync();
  wake();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
  window.addEventListener('focus', wake);
}
boot();
