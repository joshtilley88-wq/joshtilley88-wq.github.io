/* InvoiceMate: Voice test screen (#/voicetest). Runs the same scripted invoice conversations through each engine and
 * measures latency (end of the user's speech -> first reply audio), cost (from the usage the APIs return) and accuracy
 * (final draft vs the expected invoice). The user's lines are pre-recorded mp3s in voice-test/ (made once with
 * OpenAI TTS), so every engine hears exactly the same thing:
 *   Live    : the clips are played into a fake microphone track (WebAudio) that goes to the Realtime model over WebRTC.
 *   Chained / Local : browsers can't feed audio into Web Speech, so each clip is transcribed once with
 *             gpt-4o-mini-transcribe (stand-in for the phone's free Web Speech) and fed to a scripted recogniser,
 *             timed like real speech (interim words while "talking", final at the end of speech).
 * Nothing is saved or sent unless "really send one" is ticked (then one test email goes to Josh, test mode). */
'use strict';
const VoiceTest = {
  BASE: 'voice-test/', data: null, clips: null, buf: {}, ac: null, running: false, stopReq: false, rec: null, log: [],
  sttKey: 'im.vt.stt', resKey: 'im.vt.results',
  async load() {
    if (!this.data) { const [a, b] = await Promise.all([fetch(this.BASE + 'scenarios.json').then(r => r.json()), fetch(this.BASE + 'clips.json').then(r => r.json())]); this.data = a; this.clips = b; }
    return this.data;
  },
  files(sc, id) { const g = !sc.clips[id]; return (g ? this.data.generic[id] : sc.clips[id]).map((seg, i) => ({ ...seg, file: `${g ? 'generic' : sc.id}-${id}-${i}.mp3` })); },
  async bytes(file) { if (!this.buf[file]) this.buf[file] = fetch(this.BASE + file).then(r => { if (!r.ok) throw new Error('missing ' + file); return r.arrayBuffer(); }); return this.buf[file]; },
  /* ---------- STT stand-in (cached on this device) ---------- */
  sttCache() { try { return JSON.parse(localStorage.getItem(this.sttKey)) || {}; } catch (e) { return {}; } },
  async transcript(file) {
    const c = this.sttCache(); if (c[file]) return c[file];
    const ab = await this.bytes(file); let s = ''; const u8 = new Uint8Array(ab); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    const j = await Chained.call({ route: 'transcribe', audio_b64: btoa(s), mime: 'audio/mpeg' });
    const e = { text: j.text, usage: j.usage, seconds: this.clips[file].dur / 1000, fresh: true };
    c[file] = { text: j.text, usage: j.usage, seconds: e.seconds }; localStorage.setItem(this.sttKey, JSON.stringify(c)); return e;
  },
  /* what the app just asked -> which scripted answer to give */
  intent(t) {
    t = String(t || '').toLowerCase();
    if (/\bsent to\b|\bcancelled\b|saved it to your invoices|i’ve saved|i've saved/.test(t)) return 'done';
    if (/send it\?|want me to send|shall i send|ready to send|okay to send|ok to send|good to send|happy (for me )?to send|send this|send that\?|should i send/.test(t)) return 'confirm';
    if (/e-?mail[^.!?]*\?/.test(t)) return 'email';
    if (/^go on\.?$/.test(t.trim())) return 'goon';
    if (/how much|what price|price for/.test(t)) return 'price';
    return 'other';
  },
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  until(fn, ms) { return new Promise(res => { const t0 = Date.now(); const k = setInterval(() => { const v = fn(); if (v || Date.now() - t0 > ms) { clearInterval(k); res(v); } }, 60); }); },
  note(s) { this.log.push(s); const el = $('#vt-log'); if (el) { el.textContent = this.log.slice(-14).join('\n'); } },

  /* ---------- feeding speech ---------- */
  async speakLive(segs, dest) {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i], ab = await this.bytes(s.file), b = await this.ac.decodeAudioData(ab.slice(0));
      const src = this.ac.createBufferSource(); src.buffer = b; src.connect(dest); const t0 = Date.now(); src.start();
      const end = this.clips[s.file].speechEnd; await this.sleep(end);
      if (i === segs.length - 1) VoiceMetrics.userEnd(Date.now(), 'runner');
      await this.sleep(Math.max(0, this.clips[s.file].dur - end) + (s.gapMs || 0));
    }
  },
  async speakSR(segs, used) {
    const finals = []; let rec0 = this.rec;
    const emit = (interim) => { const r = this.rec; if (!r || !r.active || !r.onresult) return; if (r !== rec0) { rec0 = r; finals.length = 0; } /* a new recogniser starts fresh, like Web Speech */ const res = finals.map(f => Object.assign([{ transcript: f }], { isFinal: true })); if (interim) res.push(Object.assign([{ transcript: interim }], { isFinal: false })); r.onresult({ results: res }); };
    const trs = await Promise.all(segs.map(s => this.transcript(s.file)));   // fetch the stand-in transcripts first, so the network doesn't add to his pauses
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i], tr = trs[i]; used.push(tr);
      const words = s.text.split(/\s+/), end = this.clips[s.file].speechEnd, t0 = Date.now();
      for (let k = 1; k <= words.length; k++) { await this.sleep(Math.max(0, t0 + end * k / words.length - Date.now())); emit(words.slice(0, k).join(' ')); }
      finals.push(tr.text); emit('');
      if (i === segs.length - 1) VoiceMetrics.userEnd(Date.now(), 'runner');
      await this.sleep(s.gapMs || 0);
    }
  },

  /* ---------- one scenario on one engine ---------- */
  async runOne(engine, sc, opts = {}) {
    this.trace = []; const prev = Engines.current, t0 = Date.now(), used = [], said = []; let ended = false, err = '';
    Talk.bench = { noSave: !opts.send }; Talk.lastSend = null; VoiceMetrics.external = true; Engines.current = engine;
    const answers = { email: (sc.flow.email || []).slice(), confirm: (sc.flow.confirm || []).slice() };
    const pick = (kind) => { const a = answers[kind]; if (!a || !a.length) return null; return a.length > 1 ? a.shift() : a[0]; };
    const next = (appText) => {
      const k = this.intent(appText);
      if (k === 'done') return null;
      if (k === 'email') return pick('email') || 'nothing_else';
      if (k === 'confirm') return pick('confirm');
      if (k === 'price') return 'price_unknown';
      return 'nothing_else';
    };
    let appSeen = 0; const appTexts = () => (Talk.c ? Talk.c.history.filter(h => h.who === 'app') : []);
    try {
      if (engine === 'live') {
        this.ac = this.ac || new AudioContext(); await this.ac.resume();
        const dest = this.ac.createMediaStreamDestination(); let ready = false, idle = true;
        // a faint, steady road-noise hiss under the clips (keeps the mic track 'live' like a real car, ~-50 dB)
        const nb = this.ac.createBuffer(1, this.ac.sampleRate * 2, this.ac.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        const noise = this.ac.createBufferSource(), ng = this.ac.createGain(); noise.buffer = nb; noise.loop = true; ng.gain.value = 0.003; noise.connect(ng).connect(dest); noise.start();
        Live.start('', { stream: dest.stream, mute: !!opts.mute, onReady: () => { ready = true; }, onEnd: () => { ended = true; },
          onEvent: ev => { this.trace.push([Date.now() - t0, ev.type, (ev.transcript || (ev.error && ev.error.message) || ev.name || '').slice(0, 60)]); if (ev.type === 'output_audio_buffer.started') idle = false; if (ev.type === 'output_audio_buffer.stopped' || ev.type === 'output_audio_buffer.cleared') idle = true; } });
        if (!(await this.until(() => ready || ended, 15000)) || ended) throw new Error('Live voice did not connect');
        await this.sleep(300);
        let clip = 'job', turns = 0;
        while (clip && !ended && !this.stopReq && turns++ < 10) {
          said.push(clip); this.note(`  you: ${clip}`); await this.speakLive(this.files(sc, clip), dest);
          // wait for the reply to be spoken (a tool call is followed by a second response)
          const got = await this.until(() => ended || (appTexts().length > appSeen && idle && !Live.speaking && !Live.respN && !Live.toolBusy && Date.now() - Live.lastAct > 700), 30000);
          if (ended) break; if (!got) { err = 'no reply'; break; }
          await this.sleep(400); if (!idle || Live.speaking || Live.respN || Live.toolBusy) await this.until(() => ended || (idle && !Live.speaking && !Live.respN && !Live.toolBusy), 20000);
          const list = appTexts(); appSeen = list.length; const last = list[list.length - 1].text; this.note(`  app: ${last}`);
          clip = next(last);
        }
        if (!ended && !err) await this.until(() => ended, 10000);
        if (Live.on) Live.stop('end');
        try { noise.stop(); } catch (e) { }
      } else {
        const self = this;
        Talk.SRClass = class { start() { this.active = true; self.rec = this; setTimeout(() => this.onstart && this.onstart(), 5); } stop() { this._end(); } abort() { this._end(); }
          _end() { if (!this.active) return; this.active = false; if (self.rec === this) self.rec = null; setTimeout(() => this.onend && this.onend(), 5); } };
        if (!Talk.start()) throw new Error('could not start');
        const listening = () => Talk.on && Talk.phase === 'listening' && this.rec && this.rec.active;
        let clip = 'job', turns = 0;
        while (clip && Talk.on && !this.stopReq && turns++ < 10) {
          if (!(await this.until(listening, 20000))) { err = 'not listening'; break; }
          said.push(clip); this.note(`  you: ${clip}`); await this.speakSR(this.files(sc, clip), used);
          const got = await this.until(() => !Talk.on || (appTexts().length > appSeen && listening()), 30000);
          const list = appTexts(); if (list.length > appSeen) { appSeen = list.length; this.note(`  app: ${list[list.length - 1].text}`); }
          if (!Talk.on) break; if (!got) { err = 'no reply'; break; }
          clip = next(list[list.length - 1].text);
        }
        if (Talk.on) { await this.until(() => !Talk.on, 15000); if (Talk.on) Talk.stop('tap'); }
      }
    } catch (e) { err = e.message || String(e); if (Live.on) Live.stop('error'); if (Talk.on) Talk.stop('tap'); }
    finally { Talk.SRClass = null; Engines.current = prev; VoiceMetrics.external = false; }
    const m = VoiceMetrics.end() || { turns: [], usage: {} };
    for (const u of used) if (u.fresh || opts.countCachedStt) m.usage.stt.push({ usage: u.usage, seconds: u.seconds });
    const c = Talk.c || {}, d = c.draft || IMDraftOps.newDraft(), g = IMDraftOps.grade(d, sc.expect, 0.1), cost = VoiceCost.price(m), lat = VoiceCost.stats(m.turns.map(t => t.ms));
    Talk.bench = null;
    return { engine, scenario: sc.id, title: sc.title, at: new Date().toISOString(), ms: Date.now() - t0, error: err, trace: engine === 'live' ? this.trace.filter(x => !/delta|audio_buffer.append|rate_limits/.test(x[1])) : undefined, sent: !!c.sent, realSend: !!opts.send, delivery: opts.send ? (Talk.lastSend ? { ok: true, testMode: !!Talk.lastSend.testMode, id: Talk.lastSend.id || '' } : { ok: false }) : undefined, said,
      exact: g.exact, score: Math.round(g.score * 100) / 100, failed: g.checks.filter(x => !x.ok), draft: IMDraftOps.state(d, { gstRate: 0.1 }),
      latency: { turns: m.turns.map(t => t.ms), ...lat }, cost: { usd: cost.usd, phone_usd: cost.phone_usd, parts: cost.parts }, usage: m.usage,
      transcript: (c.history || []).map(h => `${h.who}: ${h.text}`), model: engine === 'live' ? Live.model : engine === 'chained' ? 'brain (server default)' : 'local parser' };
  },
  async runAll(engines, ids, reps = 1, opts = {}) {
    await this.load(); this.running = true; this.stopReq = false; this.log = []; const out = [];
    const scs = this.data.scenarios.filter(s => ids.includes(s.id));
    try {
      for (let r = 0; r < reps; r++) for (const sc of scs) for (const e of engines) {
        if (this.stopReq) break;
        this.note(`${Engines.label(e)} · ${sc.title}${reps > 1 ? ` (run ${r + 1})` : ''}`);
        const send = !!(opts.sendOne && opts.sendOne[e] === sc.id && r === 0);
        const res = await this.runOne(e, sc, { ...opts, send }); res.run = r + 1; out.push(res);
        this.note(`  -> ${res.exact ? 'exact' : 'score ' + res.score}, avg ${res.latency.avg ?? '-'} ms, US$${res.cost.usd.toFixed(4)}${res.error ? ', ' + res.error : ''}`);
        await this.sleep(800);
      }
    } finally { this.running = false; }
    const report = this.summarise(out, opts);
    localStorage.setItem(this.resKey, JSON.stringify(report)); return report;
  },
  summarise(runs, opts = {}) {
    const by = {};
    for (const r of runs) (by[r.engine] = by[r.engine] || []).push(r);
    const engines = Object.entries(by).map(([e, rs]) => {
      const lat = VoiceCost.stats([].concat(...rs.map(r => r.latency.turns))), ok = rs.filter(r => !r.error);
      const avg = k => ok.length ? ok.reduce((a, r) => a + k(r), 0) / ok.length : null;
      return { engine: e, label: Engines.label(e), runs: rs.length, exact: rs.filter(r => r.exact).length, score: avg(r => r.score), latency: lat,
        usd: avg(r => r.cost.usd), phone_usd: avg(r => r.cost.phone_usd), spend_usd: rs.reduce((a, r) => a + r.cost.usd, 0) };
    });
    return { at: new Date().toISOString(), aud_per_usd: VoiceCost.AUD, prices_source: 'https://platform.openai.com/docs/pricing', engines, runs, ...opts.meta };
  },

  /* ---------- screen ---------- */
  table(rep) {
    if (!rep || !rep.engines) return '<div class="empty">No results yet.</div>';
    const A = rep.aud_per_usd || VoiceCost.AUD, money = u => u == null ? '-' : `US$${u.toFixed(4)} <span class="muted">(A$${(u * A).toFixed(4)})</span>`;
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Engine</th><th class="right">Cost / invoice</th><th class="right">Avg reply delay</th><th class="right">p90</th><th class="right">Accuracy</th></tr></thead><tbody>
      ${rep.engines.map(e => `<tr><td><b>${esc(e.label)}</b><div class="small muted">${e.runs} run${e.runs > 1 ? 's' : ''}</div></td><td class="right num">${money(e.phone_usd)}${e.usd !== e.phone_usd ? `<div class="small muted">test run incl. STT stand-in ${money(e.usd)}</div>` : ''}</td>
        <td class="right num">${e.latency.avg == null ? '-' : (e.latency.avg / 1000).toFixed(2) + ' s'}</td><td class="right num">${e.latency.p90 == null ? '-' : (e.latency.p90 / 1000).toFixed(2) + ' s'}</td>
        <td class="right num">${e.exact}/${e.runs} exact<div class="small muted">${e.score == null ? '' : Math.round(e.score * 100) + '% of checks'}</div></td></tr>`).join('')}</tbody></table></div>
      <details style="margin-top:12px"><summary class="small">Each run</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Scenario</th><th>Engine</th><th>Result</th><th class="right">Delay</th><th class="right">US$</th></tr></thead><tbody>
      ${rep.runs.map(r => `<tr><td>${esc(r.title)}</td><td>${esc(Engines.label(r.engine))}</td><td>${r.exact ? '<span class="pill paid">exact</span>' : `<span class="pill overdue">${Math.round(r.score * 100)}%</span>`}${r.error ? ' ' + esc(r.error) : ''}${r.failed.length ? `<div class="small muted">${r.failed.map(f => esc(`${f.what}: got ${f.got}, want ${f.want}`)).join('<br>')}</div>` : ''}</td>
        <td class="right num">${r.latency.avg == null ? '-' : (r.latency.avg / 1000).toFixed(2) + ' s'}</td><td class="right num">${r.cost.phone_usd.toFixed(4)}</td></tr>`).join('')}</tbody></table></div></details>`;
  },
};

V.voicetest = async view => {
  let last = null; try { last = JSON.parse(localStorage.getItem(VoiceTest.resKey)); } catch (e) { }
  let bench = null; try { bench = await fetch(VoiceTest.BASE + 'results.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null); } catch (e) { }
  const data = await VoiceTest.load().catch(() => null);
  view.innerHTML = `${pageH('Voice test', 'Same scripted invoice conversations through each engine: reply delay, cost and accuracy.', `<a class="btn" href="#/settings?tab=voice">${icon('sliders')} Engine</a>`)}
    <div class="card" style="margin-bottom:18px"><h2 style="margin-bottom:10px">Run the scenarios</h2>
      <div class="row" style="flex-wrap:wrap;gap:14px">${Engines.LIST.map(([k, l]) => `<label class="chk"><input type="checkbox" class="vt-e" value="${k}" checked> ${esc(l)}</label>`).join('')}</div>
      <div class="list" style="margin:10px 0">${(data ? data.scenarios : []).map(s => `<label class="chk"><input type="checkbox" class="vt-s" value="${s.id}" checked> ${esc(s.title)}</label>`).join('')}</div>
      <div class="small muted">Nothing is saved or sent. Live and Chained use OpenAI (about US$0.02–0.10 for all five on Live, well under a cent each on Chained). Your phone plays the scripted lines into the engines, so you can listen along.</div>
      <div class="row" style="margin-top:12px"><button class="btn pri" id="vt-run">${icon('mic')} Run</button><button class="btn ghost" id="vt-stop">Stop</button><button class="btn ghost" id="vt-dl">Download JSON</button></div>
      <pre id="vt-log" class="small" style="white-space:pre-wrap;margin-top:12px;max-height:260px;overflow:auto"></pre></div>
    <div class="card" style="margin-bottom:18px"><h2 style="margin-bottom:10px">Results on this phone</h2><div id="vt-res">${VoiceTest.table(last)}</div></div>
    ${bench ? `<div class="card"><h2 style="margin-bottom:6px">Benchmark (headless, ${esc(new Date(bench.at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))})</h2>
      <p class="small muted" style="margin-top:0">${esc(bench.note || '')}</p>${VoiceTest.table(bench)}</div>` : ''}`;
  $('#vt-run').onclick = async () => {
    if (VoiceTest.running) return; Voice.unlock();
    const es = $$('.vt-e', view).filter(x => x.checked).map(x => x.value), ss = $$('.vt-s', view).filter(x => x.checked).map(x => x.value);
    if (!es.length || !ss.length) return toast('Pick at least one engine and scenario');
    $('#vt-run').disabled = true;
    try { const rep = await VoiceTest.runAll(es, ss, 1); $('#vt-res').innerHTML = VoiceTest.table(rep); } catch (e) { toast('Voice test: ' + e.message); }
    finally { $('#vt-run').disabled = false; }
  };
  $('#vt-stop').onclick = () => { VoiceTest.stopReq = true; if (Live.on) Live.stop('tap'); if (Talk.on) Talk.stop('tap'); };
  $('#vt-dl').onclick = () => { const r = localStorage.getItem(VoiceTest.resKey) || JSON.stringify(bench || {}); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r], { type: 'application/json' })); a.download = 'invoicemate-voice-test.json'; a.click(); };
};
