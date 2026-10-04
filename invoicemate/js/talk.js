/* InvoiceMate: hands-free voice conversation, the controller (mic, speaker, screen).
 * The logic lives in js/convo.js (IMConvo). This file:
 *  - listens with the Web Speech API (en-AU, continuous + interim) and decides when a turn is over (a short pause),
 *  - pauses recognition while the app talks (speechSynthesis en-AU) so the mic never hears the app, then resumes,
 *  - restarts recognition when Chrome on Android ends it by itself, and asks "Still there?" after a long silence,
 *  - shows a running transcript + the live draft, saves the invoice and sends it (js/send.js) when you say yes.
 * One tap on the mic starts; another tap ends the conversation. Nothing else needs touching. */
'use strict';
const Talk = {
  on: false, c: null, rec: null, gen: 0, phase: 'off', inv: null, entry: null,
  turn: { done: '', session: '' }, lastHeard: 0, recStarted: 0, quickEnds: 0, tick: null,
  JOB_PAUSE_MS: 2600, ANSWER_PAUSE_MS: 1500, INTERIM_EXTRA_MS: 1400, SILENCE_MS: 14000, JOB_SILENCE_MS: 20000, ECHO_GAP_MS: 350,

  supported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
  start(prefill = '') {
    if (!this.supported()) return false;
    Voice.stopSpeaking(); Voice.unlock();
    this.on = true; this.inv = null; this.entry = null; this.c = IMConvo.create(Object.assign(Thinking.context(), { owed: Chase.owedList(), today: today() }), { prefill });
    if (prefill) this.c.history.push({ who: 'you', text: prefill });
    this.ui(true); Sender.available();          // warm up the send check while he talks
    this.listen();
    this.tick = setInterval(() => this.onTick(), 250);
    return true;
  },
  stop(reason = 'tap') {
    if (!this.on) return;
    this.on = false; this.phase = 'off'; clearInterval(this.tick); this.stopRec(); Voice.stopSpeaking();
    if (reason === 'tap' && this.c && this.c.state !== 'done') this.c.history.push({ who: 'app', text: 'Stopped. Tap the mic to start again.' });
    if (this.c && !this.c.sent && this.c.job && !this.inv) { $('#im-text').value = this.c.job; $('#im-go').disabled = false; }   // so he can type-fix and tap Make invoice
    this.render(); this.ui(false);
  },

  /* ---------- listening ---------- */
  turnText() { return Talk.merge(this.turn.done, this.turn.session); },
  /* join two bits of heard text, dropping words the second repeats from the end of the first
   * (a restarted Android session often starts by repeating what it already gave us) */
  merge(a, b) {
    a = (a || '').trim(); b = (b || '').trim(); if (!a) return b; if (!b) return a;
    const A = a.split(/\s+/), B = b.split(/\s+/), low = w => w.toLowerCase().replace(/[^a-z0-9']/g, '');
    for (let k = Math.min(A.length, B.length); k > 0; k--) {
      let same = true; for (let i = 0; i < k; i++) if (low(A[A.length - k + i]) !== low(B[i])) { same = false; break; }
      if (same) return A.concat(B.slice(k)).join(' ');
    }
    return a + ' ' + b;
  },
  listen() {
    if (!this.on) return;
    this.phase = 'listening'; this.turn = { done: '', session: '' }; this.lastHeard = Date.now(); this.quickEnds = 0; this.interim = false;
    this.spawn(); this.render();
  },
  spawn() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const g = ++this.gen;
    const r = new SR(); this.rec = r; r.lang = 'en-AU'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    let finals = '';
    r.onresult = e => {
      if (g !== this.gen || this.phase !== 'listening') return;          // stale recogniser or the app is talking: ignore
      const fin = []; let interim = '';
      for (let i = 0; i < e.results.length; i++) {                       // Chrome on Android repeats earlier text inside later results
        const t = (e.results[i][0].transcript || '').trim(); if (!t) continue;
        if (e.results[i].isFinal) { const last = fin[fin.length - 1], tl = t.toLowerCase(); if (last && tl.startsWith(last.toLowerCase())) fin[fin.length - 1] = t; else if (!(last && last.toLowerCase().endsWith(tl))) fin.push(t); }
        else interim = t;
      }
      finals = fin.join(' '); if (interim && finals.toLowerCase().endsWith(interim.toLowerCase())) interim = '';
      this.turn.session = [finals, interim].filter(Boolean).join(' '); this.interim = !!interim;
      this.lastHeard = Date.now(); this.renderLive();
    };
    r.onerror = e => {
      if (g !== this.gen) return;
      const fatal = { 'not-allowed': 'The microphone is blocked. Allow the mic for this site in Chrome settings.', 'service-not-allowed': 'The microphone is blocked. Allow the mic for this site in Chrome settings.',
        'audio-capture': 'I can’t find a microphone.', network: 'Talking needs an internet connection.' }[e.error];
      if (fatal) { this.fatal = fatal; }
    };
    r.onend = () => {
      if (g !== this.gen) return;
      // keep what this session heard (including a last interim bit Chrome never finalised) before restarting
      this.turn.done = Talk.merge(this.turn.done, this.turn.session); this.turn.session = ''; finals = ''; this.rec = null;
      if (!this.on || this.phase !== 'listening') return;
      if (this.fatal) { const f = this.fatal; this.fatal = null; this.c.history.push({ who: 'app', text: f }); this.say(f).then(() => this.stop('error')); return; }
      // Chrome (esp. Android) ends sessions by itself after a few seconds of quiet: just start again
      if (Date.now() - this.recStarted < 1000) this.quickEnds++; else this.quickEnds = 0;
      if (this.quickEnds > 6) { const f = 'The microphone keeps stopping, so I’ll stop for now.'; this.c.history.push({ who: 'app', text: f }); this.say(f).then(() => this.stop('error')); return; }
      setTimeout(() => { if (this.on && this.phase === 'listening' && !this.rec) this.spawn(); }, this.quickEnds > 2 ? 600 : 120);
    };
    this.recStarted = Date.now();
    try { r.start(); } catch (e) { this.rec = null; setTimeout(() => { if (this.on && this.phase === 'listening' && !this.rec) this.spawn(); }, 400); }
  },
  stopRec() { this.gen++; const r = this.rec; this.rec = null; if (r) { try { r.abort(); } catch (e) { try { r.stop(); } catch (e2) { } } } },
  onTick() {
    if (!this.on || this.phase !== 'listening') return;
    const now = Date.now(), quiet = now - this.lastHeard, text = this.turnText();
    const job = this.c.state === 'job';
    if (text) {
      const pause = (job ? this.JOB_PAUSE_MS : this.ANSWER_PAUSE_MS) + (this.interim ? this.INTERIM_EXTRA_MS : 0);
      if (quiet >= pause) { this.stopRec(); this.feed({ type: 'heard', text }); }
    } else if (quiet >= (job && !this.c.history.length ? this.JOB_SILENCE_MS : this.SILENCE_MS)) { this.stopRec(); this.feed({ type: 'silence' }); }
  },

  /* ---------- talking + doing ---------- */
  async say(text) {
    this.phase = 'speaking'; this.stopRec(); this.render();       // mic off while the app talks, so it can't hear itself
    await Voice.speakLong(text, () => !this.on);
    await new Promise(r => setTimeout(r, this.ECHO_GAP_MS));
  },
  feed(ev) {
    if (!this.on) return;
    this.phase = 'thinking'; const r = IMConvo.step(this.c, ev); this.render(); return this.run(r);
  },
  async run(r) {
    if (r.say) await this.say(r.say);
    if (!this.on) return;
    if (r.action === 'send') { await this.send(); return; }
    if (r.action === 'save-only') { await this.save(); }
    if (r.action && r.action.type === 'chase') { await Chase.setChasing(r.action.ids, r.action.on); }
    if (r.end) { this.stop('end'); return; }
    if (r.listen) this.listen();
  },
  async save() {
    const d = this.c.draft;
    if (!this.inv) this.inv = await IM.saveDraft({ name: d.customer.name, address: d.customer.address || '', email: d.customer.email || '' }, d.items, d.workDone || '', d, this.c.heard.join(' / '));
    else { const cu = byId('customers', this.inv.customerId); if (cu && d.customer.email && cu.email !== d.customer.email && !cu.email) { cu.email = d.customer.email; await save('customers', cu); } }
    $('#im-text').value = ''; $('#im-go').disabled = true;
    return this.inv;
  },
  async send() {
    this.phase = 'sending'; this.render();
    let ev;
    try {
      const inv = await this.save(), d = this.c.draft;
      if (!this.entry) this.entry = S.outbox.find(x => x.invoiceId === inv.id && x.type === 'invoice' && x.status !== 'sent') || { type: 'invoice', invoiceId: inv.id, customerId: inv.customerId, status: 'queued', scheduledDate: today(), createdAt: new Date().toISOString() };
      this.entry.to = d.customer.email;
      if (!(await Sender.available(true))) ev = { type: 'sent', ok: false, unavailable: true };
      else { const res = await sendEntryNow(this.entry, composeEmail(this.entry)); this.lastSend = res; ev = { type: 'sent', ok: true, to: d.customer.email }; renderNav(); }
    } catch (e) { ev = { type: 'sent', ok: false, error: e.message || String(e) }; }
    if (!this.on) return;
    const p = this.feed(ev);
    if (ev.unavailable) { await p; openCompose(this.entry); }
    return p;
  },

  /* ---------- screen ---------- */
  ui(on) {
    const mic = $('#im-mic'); $('#clean').classList.add('convo'); $('#clean').classList.toggle('convo-live', on);
    mic.classList.toggle('live', on); mic.setAttribute('aria-pressed', on); mic.setAttribute('aria-label', on ? 'End the conversation' : 'Start talking');
    if (!on) $('#im-status').textContent = this.c && this.c.sent ? 'Sent. Tap the mic for the next job.' : 'Conversation ended. Tap the mic to start again.';
  },
  close() { $('#clean').classList.remove('convo', 'convo-live'); $('#im-log').innerHTML = ''; $('#im-draft').innerHTML = ''; },
  render() {
    if (!this.c) return;
    const st = { listening: this.c.state === 'job' ? 'Listening… tell me about the job.' : 'Listening…', speaking: 'Talking… (mic paused)', thinking: 'Thinking…', sending: 'Sending…' }[this.phase];
    if (this.on && st) $('#im-status').textContent = st;
    $('#clean').dataset.phase = this.on ? this.phase : 'off';
    const log = $('#im-log');
    log.innerHTML = this.c.history.map(h => `<div class="bub ${h.who}">${esc(h.text)}</div>`).join('') + (this.on && this.phase === 'listening' ? `<div class="bub you live" id="im-live">${esc(this.turnText()) || '<span class="dots"><i></i><i></i><i></i></span>'}</div>` : '');
    log.scrollTop = log.scrollHeight;
    this.renderDraft();
  },
  renderLive() { const el = $('#im-live'); if (el) { el.textContent = this.turnText(); $('#im-log').scrollTop = $('#im-log').scrollHeight; } else this.render(); },
  renderDraft() {
    const d = this.c && this.c.draft, el = $('#im-draft'); if (!d) { el.innerHTML = ''; return; }
    const t = IMParser.totals(d.items, 0.1);
    el.innerHTML = `<div class="dft-h"><b>${esc(d.customer.name || 'No name yet')}</b>${this.c.sent ? '<span class="pill paid">sent</span>' : this.inv ? '<span class="pill ready">saved</span>' : '<span class="pill">draft</span>'}</div>
      <div class="small muted">${esc(d.customer.address || '')}${d.customer.address ? ' · ' : ''}${d.customer.email ? esc(d.customer.email) : '<i>no email yet</i>'}</div>
      ${d.items.map(it => `<div class="dft-l"><span>${esc(it.desc)}${it.unit === 'hour' ? ` · ${num(it.qty)} h × ${money(it.price)}` : num(it.qty) !== 1 ? ` × ${num(it.qty)}` : ''}</span><span class="num">${money(r2(num(it.qty) * num(it.price)))}</span></div>`).join('') || '<div class="small muted">No charges yet</div>'}
      <div class="dft-l tot"><span>Total${t.gst ? ' inc GST' : ''}</span><span class="num">${money(t.total)}</span></div>`;
  },
};
