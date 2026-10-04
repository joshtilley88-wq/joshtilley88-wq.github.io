/* InvoiceMate: clean voice screen, swipe pager, draft-invoice review + confirm. Loaded before app.js. */
'use strict';
const IM_MARK_SVG = `<svg class="im-mark" viewBox="0 0 100 100" aria-hidden="true"><rect x="2" y="2" width="96" height="96" rx="22" fill="#3A3D42"/><path d="M23 76V27l27 30 27-30v20" fill="none" stroke="#FF7A00" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/><path d="M49 66l11 11 22-25" fill="none" stroke="#3A3D42" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/><path d="M49 66l11 11 22-25" fill="none" stroke="#FF7A00" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const IM_LOGO_HTML = `<span class="im-logo">${IM_MARK_SVG}<span class="im-word"><span class="w1">Invoice</span><span class="w2">Mate</span></span></span>`;

/* ---------------- swipe pager ---------------- */
const Pager = {
  page: 0, dragging: false,
  panes() { return [$('#clean'), $('#full')]; },
  apply(dx = 0) {
    const w = window.innerWidth, [c, f] = this.panes();
    c.style.transform = `translate3d(${-this.page * w + dx}px,0,0)`; f.style.transform = `translate3d(${(1 - this.page) * w + dx}px,0,0)`;
  },
  set(p, animate = true) {
    const [c, f] = this.panes(); this.page = p;
    for (const el of [c, f]) el.classList.toggle('anim', animate);
    this.apply(0);
    c.inert = p !== 0; f.inert = p !== 1; c.setAttribute('aria-hidden', p !== 0); f.setAttribute('aria-hidden', p !== 1);
    $$('#im-dots button').forEach(b => b.classList.toggle('on', +b.dataset.p === p));
    $('#im-dots').classList.toggle('on-full', p === 1);
    if (p === 1 && Voice.want) Voice.stop();
  },
  /* don't steal swipes from things that scroll sideways or need drags */
  blocked(t) {
    if (!t || !t.closest) return true;
    if ($('#modal-root .modal-bg')) return true;
    if (t.closest('input[type=range], .sigpad, canvas, select')) return true;
    for (let el = t; el && el.id !== 'clean' && el.id !== 'full'; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2) return true;
    }
    return false;
  },
  init() {
    const root = $('#pager'); let x0 = 0, y0 = 0, t0 = 0, lock = null, dx = 0, active = false;
    root.addEventListener('touchstart', e => {
      if (e.touches.length !== 1 || this.blocked(e.target)) { active = false; return; }
      active = true; lock = null; dx = 0; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
    }, { passive: true });
    root.addEventListener('touchmove', e => {
      if (!active) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (!lock) { if (Math.abs(mx) < 10 && Math.abs(my) < 10) return; lock = Math.abs(mx) > Math.abs(my) * 1.2 ? 'h' : 'v'; if (lock === 'h') this.panes().forEach(p => p.classList.remove('anim')); }
      if (lock !== 'h') return;
      e.preventDefault();
      dx = mx; if ((this.page === 0 && dx > 0) || (this.page === 1 && dx < 0)) dx *= 0.25;   // rubber-band at the ends
      this.apply(dx);
    }, { passive: false });
    const end = () => {
      if (!active || lock !== 'h') { active = false; return; }
      active = false; const w = window.innerWidth, v = dx / Math.max(1, Date.now() - t0);
      if (this.page === 0 && (dx < -w * 0.25 || v < -0.45)) this.set(1);
      else if (this.page === 1 && (dx > w * 0.25 || v > 0.45)) this.set(0);
      else this.set(this.page);
    };
    root.addEventListener('touchend', end); root.addEventListener('touchcancel', end);
    $$('#im-dots button').forEach(b => b.onclick = () => this.set(+b.dataset.p));
    document.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, select, [contenteditable]') || $('#modal-root .modal-bg')) return;
      if (e.key === 'ArrowLeft' && this.page === 1) this.set(0); else if (e.key === 'ArrowRight' && this.page === 0) this.set(1);
    });
    window.addEventListener('resize', () => this.set(this.page, false));
    // a menu link to the screen you're already on doesn't fire hashchange, so slide across here too
    document.addEventListener('click', e => { const a = e.target.closest('a[href^="#/"]'); if (a) setTimeout(() => this.set(1), 0); });
    this.set(0, false);
  },
};
ACT['go-voice'] = () => { closeModal(); Pager.set(0); setTimeout(() => $('#im-text').focus(), 350); };

/* ---------------- clean screen ---------------- */
const IM = {
  init() {
    document.body.classList.add('im-pager');
    $('#im-logo').innerHTML = IM_LOGO_HTML;
    Pager.init();
    const ta = $('#im-text'), mic = $('#im-mic'), go = $('#im-go'), st = $('#im-status');
    const upd = () => { go.disabled = !ta.value.trim(); };
    ta.addEventListener('input', () => { if (Voice.want) Voice.stop(); upd(); });
    ta.addEventListener('focus', () => { if (!Talk.on && $('#clean').classList.contains('convo')) Talk.close(); });
    upd();
    const MSG = { listening: 'Listening… take your time, pauses are fine. Tap the mic when you’re done.', pause: 'Still listening…', stopped: '', denied: 'Microphone blocked. Allow the mic for this site in Chrome settings, or just type.',
      network: 'Talking needs an internet connection (Chrome does the speech-to-text). You can still type.', nomic: 'No microphone found. You can type instead.', unsupported: 'Talking isn’t supported in this browser. Use Chrome on Android, or type.' };
    const setState = s => {
      const on = s === 'listening' || s === 'pause'; mic.classList.toggle('live', on); mic.setAttribute('aria-pressed', on); mic.setAttribute('aria-label', on ? 'Stop talking' : 'Start talking');
      st.textContent = MSG[s] ?? ''; if (s === 'stopped') { st.textContent = ta.value.trim() ? 'Got it. Check the words, then tap Make invoice.' : 'Didn’t catch anything. Tap the mic and try again.'; }
    };
    // one tap starts a hands-free conversation (js/talk.js); another tap ends it
    mic.onclick = () => {
      if (Voice.want) { Voice.stop(); return; }
      if (Talk.on) { Talk.stop('tap'); return; }
      const pre = ta.value.trim(); ta.value = ''; upd();
      if (!Talk.start(pre)) { ta.value = pre; upd(); setState('unsupported'); }
    };
    $('#im-type').onclick = () => { if (Talk.on) Talk.stop('tap'); Talk.close(); st.textContent = 'Type the job, then tap Make invoice.'; setTimeout(() => ta.focus(), 50); };
    go.onclick = () => { if (Voice.want) Voice.stop(); this.submit(ta.value); };
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go.click(); });
    st.textContent = Voice.supported ? 'Tap the mic once and just talk. I’ll ask for anything missing, then send it.' : MSG.unsupported;
  },
  async submit(text) {
    text = (text || '').trim(); if (!text) return;
    const d = await Thinking.parse(text);
    this.review(d, text);
  },

  /* ---------- draft review ---------- */
  review(d, transcript) {
    const gstRate = Thinking.context().gstRate;
    d.items.forEach(it => { it.qty = num(it.qty); it.price = num(it.price); });
    const prices = IMPrices.load();
    const m = openModal({ title: 'Check your invoice', wide: true, body: `<div class="stack" id="dr">
      <div class="small muted heard">Heard: “${esc(transcript)}”</div>
      ${d.warnings.length ? `<div class="note pink">${d.warnings.map(esc).join('<br>')}</div>` : ''}
      <div class="card flat"><div class="grid g2">
        <label class="f">Customer<input type="text" id="dr-name" list="dr-custs" value="${esc(d.customer.name)}" placeholder="Name"></label>
        <label class="f">Address<input type="text" id="dr-addr" value="${esc(d.customer.address)}" placeholder="Job address"></label>
        <label class="f">Email (for sending)<input type="email" id="dr-email" value="${esc(d.customer.email)}" placeholder="optional"></label>
        <div class="f" style="justify-content:flex-end"><span id="dr-cbadge" class="small"></span></div></div>
        <datalist id="dr-custs">${S.customers.map(c => `<option value="${esc(c.name || c.business)}">`).join('')}</datalist></div>
      <div class="card flat"><div class="card-h"><h3>Charges</h3><div class="spacer"></div>
        <select id="dr-add" style="max-width:200px"><option value="">+ Add from price list…</option>${prices.map(p => `<option value="${esc(p.key)}">${esc(p.name)} · ${money(p.price)}</option>`).join('')}<option value="__custom">Custom line</option></select></div>
        <div id="dr-items"></div>
        <label class="chk" style="margin-top:10px"><input type="checkbox" id="dr-gst" ${!d.noGst && gstRate ? 'checked' : ''}> Add 10% GST</label>
        <div class="totals" style="margin-top:8px"><div class="tr"><span class="muted">Subtotal</span><span class="num" id="dr-sub"></span></div><div class="tr"><span class="muted">GST</span><span class="num" id="dr-gstv"></span></div><div class="tr big"><span>Total</span><span class="num" id="dr-tot"></span></div></div></div>
      <label class="f">Work done (shows on the invoice)<textarea id="dr-work" rows="2" style="min-height:60px">${esc(d.workDone)}</textarea></label>
      <div class="note" id="dr-say">${Voice.supported && IMPrefs.get('voiceconfirm', true) ? 'After I read it out, say <b>“yes”</b>, <b>“yep”</b> or <b>“send it”</b> to confirm, or just tap Confirm.' : 'Tap Confirm to save it to your invoices.'}</div>
    </div>`,
      foot: `<button class="btn ghost" id="dr-read">${icon('volume')} Read out</button><div class="spacer"></div><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn pri" id="dr-ok">${icon('check')} Confirm</button>`,
      onClose: () => { Voice.stopSpeaking(); Voice.cancelListen(); } });
    const items = d.items;
    const drawItems = () => {
      $('#dr-items', m).innerHTML = items.map((it, k) => `<div class="dr-item" data-k="${k}">
        <input type="text" data-f="desc" value="${esc(it.desc)}" aria-label="Description">
        <input type="number" step="any" data-f="qty" value="${it.qty}" aria-label="Quantity"><span class="x">×</span>
        <input type="number" step="0.01" data-f="price" value="${it.price}" aria-label="Price ex GST">
        <span class="num amt" data-amt></span><button class="btn ghost icon" data-del="${k}" aria-label="Remove">${icon('trash')}</button>
        ${it.source === 'price list' ? '<span class="tiny muted src">price from your price list</span>' : it.source === 'none' ? '<span class="tiny src" style="color:var(--bad)">no price heard</span>' : ''}</div>`).join('') || '<div class="empty" style="padding:10px">No charges yet. Add one.</div>';
      recalc();
    };
    const recalc = () => {
      const gst = $('#dr-gst', m).checked; items.forEach(it => it.gst = gst);
      $$('.dr-item', m).forEach(r => { const it = items[+r.dataset.k]; $('[data-amt]', r).textContent = money(r2(num(it.qty) * num(it.price))); });
      const t = IMParser.totals(items, 0.1); $('#dr-sub', m).textContent = money(t.subtotal); $('#dr-gstv', m).textContent = money(t.gst); $('#dr-tot', m).textContent = money(t.total);
    };
    const custBadge = () => {
      const n = $('#dr-name', m).value.trim().toLowerCase(); const hit = n && S.customers.find(c => (c.name || c.business || '').toLowerCase() === n);
      $('#dr-cbadge', m).innerHTML = !n ? '<span style="color:var(--bad)">Add a customer name</span>' : hit ? `${icon('check')} Existing customer` : `${icon('plus')} New customer, will be added`;
    };
    $('#dr-items', m).addEventListener('input', e => { const r = e.target.closest('.dr-item'); const f = e.target.dataset.f; if (!r || !f) return; items[+r.dataset.k][f] = f === 'desc' ? e.target.value : num(e.target.value); items[+r.dataset.k].source = 'edited'; recalc(); stopVoice(); });
    $('#dr-items', m).addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b) { items.splice(+b.dataset.del, 1); drawItems(); } });
    $('#dr-gst', m).onchange = recalc;
    $('#dr-name', m).oninput = () => { custBadge(); stopVoice(); };
    $('#dr-add', m).onchange = e => { const v = e.target.value; e.target.value = ''; if (!v) return; const p = prices.find(x => x.key === v);
      items.push(p ? { desc: p.name, qty: 1, unit: p.unit, price: num(p.price), source: 'price list' } : { desc: '', qty: 1, unit: 'each', price: 0, source: 'edited' }); drawItems(); };
    drawItems(); custBadge();

    let listening = false;
    const stopVoice = () => { Voice.stopSpeaking(); if (listening) Voice.cancelListen(); };
    const sayIt = async () => {
      const name = $('#dr-name', m).value.trim(), addr = $('#dr-addr', m).value.trim(), t = IMParser.totals(items, 0.1);
      const lines = items.map(it => it.unit === 'hour' ? `${it.desc}, ${sayNum(it.qty)} ${it.qty === 1 ? 'hour' : 'hours'} at ${sayMoney(it.price)} an hour` : `${it.qty !== 1 ? sayNum(it.qty) + ' ' : ''}${it.desc}, ${sayMoney(r2(it.qty * it.price))}`);
      const txt = `Invoice for ${name || 'no name yet'}${addr ? ', at ' + addr.replace(/\bSt\b/g, 'Street').replace(/\bRd\b/g, 'Road').replace(/\bAve\b/g, 'Avenue') : ''}. ${lines.join('. ')}. Total ${sayMoney(t.total)}${t.gst ? ' including GST' : ''}.${IMPrefs.get('voiceconfirm', true) && Voice.supported ? ' Say yes to confirm.' : ''}`;
      const say = $('#dr-say', m); if (say) say.innerHTML = `${icon('volume')} Reading it out…`;
      await Voice.speakLong(txt, () => !document.body.contains(m));
      if (!document.body.contains(m)) return;
      if (IMPrefs.get('voiceconfirm', true) && Voice.supported) {
        say.innerHTML = `${icon('mic')} Listening for “yes”, “yep” or “send it”…`; listening = true;
        const heard = (await Voice.listenOnce(7000)).toLowerCase(); listening = false;
        if (!document.body.contains(m)) return;
        if (/\b(yes|yep|yeah|yup|send it|send|confirm|correct|go ahead|do it|righto|sweet|too easy|perfect|spot on)\b/.test(heard)) { say.innerHTML = `${icon('check')} Heard “${esc(heard.split(' | ')[0])}”.`; confirm(/\bsend\b/.test(heard)); }
        else if (/\b(no|nope|nah|cancel|wait|change|hang on)\b/.test(heard)) say.innerHTML = 'No worries. Make your changes, then tap <b>Confirm</b>.';
        else say.innerHTML = 'Tap <b>Confirm</b> when it looks right (or tap Read out to hear it again).';
      } else if (say) say.innerHTML = 'Tap <b>Confirm</b> when it looks right.';
    };
    $('#dr-read', m).onclick = () => { stopVoice(); sayIt(); };
    let saving = false;
    const confirm = async (sendNow = false) => {
      if (saving) return;
      const name = $('#dr-name', m).value.trim();
      if (!name) { toast('Add a customer name first'); $('#dr-name', m).focus(); return; }
      if (!items.length) { toast('Add at least one charge'); return; }
      saving = true; stopVoice();
      const inv = await this.saveDraft({ name, address: $('#dr-addr', m).value.trim(), email: $('#dr-email', m).value.trim() }, items, $('#dr-work', m).value.trim(), d, transcript);
      m._onClose = null; closeModal(); $('#im-text').value = ''; $('#im-go').disabled = true; $('#im-status').textContent = 'Saved ' + inv.number + '. Tap the mic for the next job.';
      this.done(inv, sendNow);
    };
    $('#dr-ok', m).onclick = () => confirm(false);
    if (IMPrefs.get('readback', true) && window.speechSynthesis) sayIt();
  },

  async saveDraft(c, items, work, d, transcript) {
    let cu = S.customers.find(x => (x.name || x.business || '').toLowerCase() === c.name.toLowerCase());
    if (!cu) cu = await save('customers', { name: c.name, address: c.address, email: c.email, notes: 'Added by voice', createdAt: new Date().toISOString() });
    else { let ch = false; if (c.address && !cu.address) { cu.address = c.address; ch = true; } if (c.email && !cu.email) { cu.email = c.email; ch = true; } if (ch) await save('customers', cu); }
    const inv = newInvoice('invoice', cu.id); const n = inv._n; delete inv._n;
    if (d.dueDays) { inv.dueDate = addDays(inv.issueDate, d.dueDays); inv.balanceEmailDate = inv.dueDate; }
    inv.items = items.map(it => ({ desc: it.desc || 'Item', details: '', qty: num(it.qty), price: num(it.price), discountPct: 0, gst: !!it.gst }));
    inv.notes = [c.address ? 'Job address: ' + c.address : '', work ? 'Work done: ' + work : ''].filter(Boolean).join('\n');
    inv.emailDeposit = false; inv.emailBalance = true;       // tradie default: no deposit email, one reminder on the due date
    inv.confirmed = true; inv.confirmedAt = new Date().toISOString(); inv.voice = { transcript, provider: d.provider || 'local' };
    await save('invoices', inv);
    const mm = inv.number.match(/(\d+)\s*$/); await bumpNumber('invoice', mm ? +mm[1] : n);
    await syncInvoiceEmails(inv); renderNav();
    if (route().parts[0] === 'dashboard' || route().parts[0] === 'invoices') render();
    return inv;
  },

  done(inv, sendNow) {
    const c = invCalc(inv), cu = byId('customers', inv.customerId);
    const entry = () => ({ type: 'invoice', invoiceId: inv.id, customerId: inv.customerId, status: 'queued', scheduledDate: today(), createdAt: new Date().toISOString() });
    if (sendNow) { openCompose(entry()); return; }
    const m = openModal({ title: 'Invoice saved', body: `<div style="text-align:center;padding:6px 0"><span class="ic ok" style="width:64px;height:64px;margin:0 auto">${icon('check')}</span>
      <div style="font-size:28px;font-weight:750;margin-top:10px" class="num">${money(c.total)}</div><div class="muted">${esc(inv.number)} · ${esc(custName(cu))}</div>
      <p><span class="pill ready">Confirmed, ready to send</span></p></div>`,
      foot: `<button class="btn ghost" data-act="close-modal">Done</button>${navigator.share ? `<button class="btn" id="dn-share">${icon('send')} Share</button>` : ''}<a class="btn" href="#/doc/invoice/${inv.id}">${icon('printer')} View / PDF</a><button class="btn pri" id="dn-mail">${icon('mail')} Email it</button>` });
    $('#dn-mail', m).onclick = () => openCompose(entry());
    const sh = $('#dn-share', m); if (sh) sh.onclick = async () => { const e = composeEmail(entry()); try { await navigator.share({ title: e.subject, text: e.body }); } catch (err) { } };
  },
};
function sayNum(n) { return String(+n).replace(/\.5$/, ' and a half').replace(/^0 and a half/, 'half'); }
function sayMoney(n) { n = r2(n); const d = Math.floor(n), c = Math.round((n - d) * 100); return `${d.toLocaleString('en-AU')} dollar${d === 1 ? '' : 's'}${c ? ' ' + c : ''}`; }
