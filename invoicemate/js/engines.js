/* InvoiceMate: conversation engine switch + engine B ("Chained").
 *   Settings > Voice & prices > Conversation engine:
 *     live    = A: OpenAI Realtime speech-to-speech over WebRTC (js/live.js)
 *     chained = B: phone's free Web Speech -> small cheap model (invoicemate-brain) -> natural voice (invoicemate-tts)
 *     local   = C: phone's Web Speech -> rule-based parser + state machine (js/convo.js) -> natural voice. Works offline.
 * All three build the same draft (IMParser structure) and save/send it the same way (Talk.save / Talk.deliver). */
'use strict';
const IM_BRAIN_URL = 'https://opekqrldytqvjziowbqo.supabase.co/functions/v1/invoicemate-brain';
const Engines = {
  LIST: [
    ['live', 'Live (Realtime)', 'Most natural, like ChatGPT voice mode. Talks back instantly and you can interrupt it. Needs good mobile data. Costs a few cents per invoice.'],
    ['chained', 'Chained (cheap)', 'The phone listens (free), a small AI understands, then the natural voice talks. Handles messy speech well. About a cent per invoice.'],
    ['local', 'Local (offline)', 'Rule-based, on the phone. Free and private. Talking still needs internet for Chrome’s speech recognition; typing works offline.'],
  ],
  get current() { const v = IMPrefs.get('engine', 'local'); return ['live', 'chained', 'local'].includes(v) ? v : 'local'; },
  set current(v) { IMPrefs.set('engine', v); },
  label(k) { return (this.LIST.find(x => x[0] === k) || [])[1] || k; },
};

/* ---------- B: Chained brain. Same step(c, ev) -> {say, listen, action, end} contract as IMConvo.step ---------- */
const Chained = {
  model: null,        // null = server default
  fails: 0,
  async call(body) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(IM_BRAIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-im-app': IM_SEND_APP }, body: JSON.stringify(body), signal: ctl.signal });
      const j = await r.json().catch(() => null); if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'brain ' + r.status); return j;
    } finally { clearTimeout(t); }
  },
  fill(reply, st) {
    return String(reply || '').replace(/\{readback\}/g, st.readback.replace(/\s*Sending to [^.]*\.\s*$/, '').trim()).replace(/\{total\}/g, IMConvo.sayMoney(st.total_inc_gst)).replace(/\s+/g, ' ').trim();
  },
  /* what to ask when the model's reply skipped over something still missing */
  ask(st, d) {
    const m = st.missing[0] || '', nm = (d.customer.name || '').split(/\s+/)[0] || 'them';
    if (/customer/.test(m)) return 'Who’s the invoice for?';
    if (/charges/.test(m)) return `What should I charge ${nm} for?`;
    if (/^hours/.test(m)) return 'How many hours of labour?';
    if (/^price/.test(m)) return `How much for the ${m.replace(/^.*\((.*)\)$/, '$1').toLowerCase()}?`;
    if (/email/.test(m)) return `What’s ${nm}’s email address?`;
    return '';
  },
  local(c, text) { return (c.state === 'job' && !c.draft && IMConvo.command(text, c.ctx)) || IMConvo.isStop(text) || c.state === 'retry'; },
  body(c, text) { return { route: 'chat', text, history: c.history.slice(-12), draft: c.draft ? IMDraftOps.state(c.draft, c.ctx) : {}, prices: c.ctx.prices, model: this.model || undefined }; },
  /* start the model call while he's still pausing; when it answers, pre-load the first bit of the spoken reply */
  spec: null,
  waste(spec) { if (spec) spec.p.then(j => VoiceMetrics.add('chat', { usage: j.usage, model: j.model, wasted: true })).catch(() => { }); },   // a thrown-away guess still costs a little
  speculate(c, text) {
    if (this.local(c, text)) return;
    const key = JSON.stringify(this.body(c, text)); if (this.spec && this.spec.key === key) return;
    this.waste(this.spec); const p = this.call(JSON.parse(key)); p.catch(() => { }); this.spec = { key, p };
    const spec = this.spec;
    p.then(j => { if (this.spec !== spec) return; const cl = structuredClone(c); const r = this.decide(cl, text, j); if (r.say && TTS.enabled()) TTS.prefetch(Voice.firstSplit(r.say)[0]); }).catch(() => { });
  },
  async step(c, ev) {
    if (ev.type !== 'heard') return IMConvo.step(c, ev);            // silence / sent / stop: same wording as Local
    const text = String(ev.text || '').trim(); if (!text) return IMConvo.step(c, { type: 'silence' });
    if (this.local(c, text)) return IMConvo.step(c, ev);              // "who owes me money?", "cancel", retry: same as Local
    const key = JSON.stringify(this.body(c, text)), spec = this.spec && this.spec.key === key ? this.spec : null;
    if (!spec) this.waste(this.spec);
    this.spec = null;
    let j;
    try { j = await (spec ? spec.p : this.call(JSON.parse(key))); this.fails = 0; }
    catch (e) { this.fails++; c.history.push({ who: 'you', text }); return IMConvo.out(c, this.fails > 1 ? 'Still can’t reach the smart voice. Switch to Local in Settings, or try again in a minute.' : 'Sorry, I lost the connection for a sec. Say that again?'); }
    return this.decide(c, text, j, true);
  },
  /* apply the model's ops + pick what to say (also run on a copy, for the speculative voice prefetch) */
  decide(c, text, j, real) {
    if (real) VoiceMetrics.add('chat', { usage: j.usage, model: j.model, ms: j.ms });
    c.silences = 0; c.heard.push(text); c.history.push({ who: 'you', text });
    const d = c.draft || IMDraftOps.newDraft(), ctx = c.ctx;
    let send = false;
    for (const op of j.ops) { if (op.tool === 'confirm_send') { send = true; continue; } IMDraftOps.apply(d, op, ctx); }
    if (j.ops.length) c.draft = d;
    if (!c.draft) return IMConvo.out(c, this.fill(j.reply, IMDraftOps.state(d, ctx)) || 'Sorry, who’s it for and what did you do?');
    const st = IMDraftOps.state(d, ctx), blocking = st.missing.filter(m => m !== 'email');
    let say = this.fill(j.reply, st);
    if (send) {
      // the app, not the model, decides: only on a clear yes, and only when the invoice is complete
      if (IMConvo.yesNo(text) !== 'yes' && !/\b(send|go ahead)\b/i.test(text)) send = false;
      else if (blocking.length) { send = false; say = this.ask(st, d); }
      else if (!d.customer.email) { c.state = 'saving'; return IMConvo.out(c, 'There’s no email address, so I’ll save it to your invoices and you can send it later.', { action: 'save-only', end: true }); }
      else { c.state = 'sending'; return IMConvo.out(c, 'Sending it now.', { action: 'send', listen: false }); }
    }
    const asksToSend = /\bsend\b/i.test(say) && /\?/.test(say);
    if (asksToSend && st.missing.length) say = (say.split(/(?<=[.!])\s+/)[0].replace(/\bwant me to send.*$/i, '').trim() + ' ' + this.ask(st, d)).trim();
    if (!say) say = st.missing.length ? this.ask(st, d) : st.readback.replace(/\s*Sending to [^.]*\.\s*$/, '') + ' Want me to send it?';
    c.state = st.missing.length ? 'ask' : asksToSend || /send it\?/i.test(say) ? 'confirm' : 'ask';
    return IMConvo.out(c, say);
  },
};
