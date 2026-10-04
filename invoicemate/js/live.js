/* InvoiceMate engine A ("Live"): OpenAI Realtime speech-to-speech over WebRTC.
 *  1. asks invoicemate-realtime-session for a 60-second client secret (the API key stays on the server; the shared
 *     prompt + tools are baked into the session there),
 *  2. sends the mic straight to the model over WebRTC and plays its voice (semantic VAD decides when he's finished;
 *     talking over it interrupts it: barge-in),
 *  3. the model changes the invoice only through tool calls, which the app applies to its draft (js/draft-ops.js) and
 *     answers with the updated draft + totals. confirm_send is checked by the app and does the real save + send.
 * Uses Talk's screen (transcript bubbles + live draft) so it looks the same as the other engines. */
'use strict';
const IM_RT_URL = 'https://opekqrldytqvjziowbqo.supabase.co/functions/v1/invoicemate-realtime-session';
const Live = {
  on: false, respN: 0, toolBusy: false, pc: null, dc: null, stream: null, ownStream: false, el: null, c: null, model: '', calls: [], ending: false, speaking: false,
  IDLE_MS: 45000, MAX_MS: 6 * 60000,
  supported() { return typeof RTCPeerConnection !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
  /* opts.stream: a MediaStream to use instead of the mic (Voice test) */
  start(prefill = '', opts = {}) {
    if (this.on) return true;
    Voice.stopSpeaking(); Voice.unlock();
    this.on = true; this.ending = false; this.pendingTx = null; this.calls = []; this.respN = 0; this.toolBusy = false; this.opts = opts; this.lastAct = Date.now(); this.t0 = Date.now();
    Talk.on = true; Talk.inv = null; Talk.entry = null; Talk.brain = null; Talk.phase = 'connecting';
    this.c = Talk.c = IMConvo.create(Talk.ctx());
    this.c.draft = IMDraftOps.newDraft(); this.c.engine = 'live';
    VoiceMetrics.begin('live');
    Talk.ui(true); Talk.render(); $('#im-status').textContent = 'Connecting…';
    Sender.available();
    this.connect(opts).catch(e => this.fail(e));
    this.tick = setInterval(() => { if (!this.on) return; const now = Date.now();
      if (now - this.lastAct > this.IDLE_MS || now - this.t0 > this.MAX_MS) { this.c.history.push({ who: 'app', text: 'I’ll stop for now. Your draft is still on the screen.' }); this.stop('idle'); } }, 1000);
    return true;
  },
  async connect(opts) {
    const r = await fetch(IM_RT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-im-app': IM_SEND_APP }, body: JSON.stringify({ prices: Talk.bench ? IMParser.DEFAULT_PRICES : IMPrices.load(), voice: opts.voice, eagerness: opts.eagerness || IMPrefs.get('rteager', 'medium') }) });
    const s = await r.json().catch(() => null); if (!r.ok || !s || !s.ok) throw new Error((s && s.error) || 'Live voice isn’t available (' + r.status + ')');
    if (!this.on) return;
    this.model = s.model; this.eager = this.vad = s.eagerness || 'medium';
    const pc = this.pc = new RTCPeerConnection();
    this.el = this.el || Object.assign(document.createElement('audio'), { autoplay: true }); this.el.muted = !!opts.mute;
    pc.ontrack = e => { this.el.srcObject = e.streams[0]; this.el.play().catch(() => { }); };
    if (opts.stream) { this.stream = opts.stream; this.ownStream = false; }
    else { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); this.ownStream = true; }
    if (!this.on) return this.cleanup();
    for (const t of this.stream.getAudioTracks()) pc.addTrack(t, this.stream);
    const dc = this.dc = pc.createDataChannel('oai-events');
    dc.onmessage = e => { try { this.onEvent(JSON.parse(e.data)); } catch (err) { console.warn('live event', err); } };
    dc.onopen = () => { Talk.phase = 'listening'; Talk.render(); $('#im-status').textContent = 'Listening… tell me about the job.'; if (opts.onReady) opts.onReady(); };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const a = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', body: offer.sdp, headers: { Authorization: 'Bearer ' + s.value, 'Content-Type': 'application/sdp' } });
    if (!a.ok) throw new Error('Live voice connection failed (' + a.status + ')');
    await pc.setRemoteDescription({ type: 'answer', sdp: await a.text() });
    pc.onconnectionstatechange = () => { if (this.on && ['failed', 'disconnected'].includes(pc.connectionState)) this.fail(new Error('The connection dropped')); };
  },
  send(ev) { if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(ev)); },
  onEvent(ev) {
    const c = this.c; if (!c) return;
    if (this.opts.onEvent) this.opts.onEvent(ev);
    switch (ev.type) {
      case 'input_audio_buffer.speech_started': this.lastAct = Date.now(); Talk.phase = 'listening'; Talk.render(); break;
      case 'input_audio_buffer.committed': this.pendingTx = ev.item_id || true; break;
      case 'input_audio_buffer.speech_stopped': this.lastAct = Date.now(); VoiceMetrics.userEnd(Date.now()); Talk.phase = 'thinking'; Talk.render(); break;
      case 'conversation.item.input_audio_transcription.completed':
        if (!ev.item_id || ev.item_id === this.pendingTx || this.pendingTx === true) this.pendingTx = null;
        if (ev.transcript && ev.transcript.trim()) { c.history.push({ who: 'you', text: ev.transcript.trim() }); c.heard.push(ev.transcript.trim()); Talk.render(); }
        if (ev.usage) VoiceMetrics.add('rtstt', { usage: ev.usage }); break;
      case 'output_audio_buffer.started': this.speaking = true; VoiceMetrics.audioStart(Date.now()); Talk.phase = 'speaking'; Talk.render(); $('#im-status').textContent = 'Talking… (just talk over me to interrupt)'; break;
      case 'output_audio_buffer.stopped': case 'output_audio_buffer.cleared':
        this.speaking = false; this.lastAct = Date.now();
        if (this.ending) { setTimeout(() => this.stop('end'), 300); break; }
        Talk.phase = 'listening'; Talk.render(); $('#im-status').textContent = 'Listening…'; break;
      case 'response.output_audio_transcript.done': if (ev.transcript) { c.history.push({ who: 'app', text: ev.transcript.trim() }); Talk.render(); this.tune(ev.transcript); } break;
      case 'response.function_call_arguments.done': this.calls.push(ev); break;
      case 'response.created': this.respN++; break;
      case 'response.done': {
        this.respN = Math.max(0, this.respN - 1); this.lastAct = Date.now();
        const resp = ev.response || {}; if (resp.usage) VoiceMetrics.add('realtime', { usage: resp.usage, model: this.model });
        const calls = this.calls.splice(0); if (!calls.length) break;
        this.toolBusy = true; this.runTools(calls).finally(() => { this.toolBusy = false; }).catch(e => console.warn('live tools', e)); break;
      }
      case 'error': console.warn('Live:', ev.error && ev.error.message); break;
    }
  },
  /* a yes/no question gets a quicker end-of-turn ("yep" doesn't need 4 s of patience); everything else stays patient */
  tune(said) {
    const want = /\b(send it|want me to send|good to send|shall I send)\b[^?]*\?\s*$/i.test(said) ? 'high' : this.eager;
    if (want === this.vad) return; this.vad = want;
    this.send({ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: { type: 'semantic_vad', eagerness: want, create_response: true, interrupt_response: true } } } } });
  },
  async runTools(calls) {
    const c = this.c, ctx = c.ctx; let speakAfter = true;
    for (const fc of calls) {
      let args = {}; try { args = JSON.parse(fc.arguments || '{}'); } catch (e) { }
      let out;
      if (fc.name === 'confirm_send') {
        const st = IMDraftOps.state(c.draft, ctx), blocking = st.missing.filter(m => m !== 'email');
        // the app decides, not the model: wait for what he actually just said, and only send on a clear yes
        for (let i = 0; i < 40 && this.pendingTx; i++) await new Promise(r => setTimeout(r, 50));
        const lastYou = c.history.slice().reverse().find(h => h.who === 'you'), heard = lastYou ? lastYou.text : '';
        const yes = IMConvo.yesNo(heard) === 'yes' || (/\b(send|go ahead)\b/i.test(heard) && IMConvo.yesNo(heard) !== 'no');
        if (!yes) out = { ok: false, error: 'Not sent: they have not said yes to sending yet. Read the total back and ask: want me to send it?', draft: st };
        else if (blocking.length) out = { ok: false, error: 'Not ready: missing ' + blocking.join(', ') + '. Ask for it.', draft: st };
        else if (!c.draft.customer.email) { await Talk.save(); out = { ok: true, sent: false, saved: true, note: 'No email, so it was saved to the invoices to send later. Tell them that in one short sentence.' }; this.ending = true; }
        else {
          Talk.phase = 'sending'; Talk.render();
          const r = await Talk.deliver();
          if (r.ok) { c.sent = true; out = { ok: true, sent: true, to: r.to }; this.ending = true; }
          else if (r.unavailable) { out = { ok: false, error: 'Sending from the app is not switched on, so the invoice was saved and the email opened for the tradie to send.' }; this.ending = true; setTimeout(() => openCompose(Talk.entry), 1500); }
          else out = { ok: false, error: String(r.error || 'it did not send').slice(0, 120) + '. The invoice is saved.' };
        }
      } else {
        const res = IMDraftOps.apply(c.draft, { tool: fc.name, args }, ctx);
        out = { ...res, draft: IMDraftOps.state(c.draft, ctx) };
      }
      this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: fc.call_id, output: JSON.stringify(out) } });
    }
    Talk.render();
    if (speakAfter) this.send({ type: 'response.create' });
    if (this.ending) setTimeout(() => { if (this.on && !this.speaking) this.stop('end'); }, 9000);   // in case it says nothing
  },
  fail(e) {
    if (!this.on) return;
    const msg = (e && e.message) || 'Live voice stopped';
    this.c.history.push({ who: 'app', text: msg + '. You can switch to Chained or Local in Settings.' }); console.warn('Live:', msg);
    this.stop('error');
  },
  cleanup() {
    clearInterval(this.tick);
    try { if (this.dc) this.dc.close(); } catch (e) { } try { if (this.pc) this.pc.close(); } catch (e) { }
    if (this.ownStream && this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.el) this.el.srcObject = null;
    this.pc = this.dc = null; this.stream = null;
  },
  stop(reason = 'tap') {
    if (!this.on) return;
    this.on = false; this.cleanup();
    Talk.on = false; Talk.phase = 'off';
    if (reason === 'tap' && !this.c.sent) this.c.history.push({ who: 'app', text: 'Stopped. Tap the mic to start again.' });
    this.c.state = this.c.sent ? 'done' : 'ended';
    Talk.render(); Talk.ui(false);
    if (this.opts && this.opts.onEnd) this.opts.onEnd(reason);
  },
};
