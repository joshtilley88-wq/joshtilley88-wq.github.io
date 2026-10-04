/* InvoiceMate: talking (Web Speech API). Dictation that tolerates thinking pauses + read-back (speechSynthesis). */
'use strict';
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const Voice = {
  supported: !!SR,
  SILENCE_MS: 20000,        // keep listening through pauses; stop after 20 s with nothing heard
  rec: null, want: false, base: '', done: '', session: '', lastHeard: 0, onText: null, onState: null,

  start(baseText, onText, onState) {
    if (!SR) { onState && onState('unsupported'); return false; }
    this.stopSpeaking();
    this.want = true; this.fatal = null; this.base = (baseText || '').trim(); this.done = ''; this.session = ''; this.lastHeard = Date.now();
    this.onText = onText; this.onState = onState; this._spawn(); return true;
  },
  stop() { this.want = false; if (this.rec) try { this.rec.stop(); } catch (e) { } },
  text() { return [this.base, this.done, this.session].map(s => s.trim()).filter(Boolean).join(' '); },
  _spawn() {
    const r = new SR(); this.rec = r;
    r.lang = 'en-AU'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    let finals = '';
    r.onstart = () => this.onState && this.onState('listening');
    r.onresult = e => {
      // Rebuild from all results each time. Chrome on Android repeats earlier text inside later results, so drop repeats.
      const fin = []; let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim(); if (!t) continue;
        if (e.results[i].isFinal) {
          const last = fin[fin.length - 1], tl = t.toLowerCase();
          if (last && tl.startsWith(last.toLowerCase())) fin[fin.length - 1] = t; else if (!(last && last.toLowerCase().endsWith(tl))) fin.push(t);
        } else interim = t;
      }
      finals = fin.join(' ');
      if (interim && finals.toLowerCase().endsWith(interim.toLowerCase())) interim = '';
      this.session = [finals, interim].filter(Boolean).join(' ');
      this.lastHeard = Date.now(); this.onText && this.onText(this.text());
    };
    r.onerror = e => {
      const fatal = { 'not-allowed': 'denied', 'service-not-allowed': 'denied', network: 'network', 'audio-capture': 'nomic' }[e.error];
      if (fatal) { this.want = false; this.fatal = fatal; }
      // 'no-speech' / 'aborted': just let onend restart while the user is still thinking
    };
    r.onend = () => {
      this.done = [this.done, finals].filter(Boolean).join(' '); this.session = ''; this.rec = null;
      if (this.want && Date.now() - this.lastHeard < this.SILENCE_MS) { setTimeout(() => this.want && this._spawn(), 120); this.onState && this.onState('pause'); }
      else { this.want = false; this.onText && this.onText(this.text()); this.onState && this.onState(this.fatal || 'stopped'); }
    };
    try { r.start(); } catch (e) { this.want = false; this.onState && this.onState('stopped'); }
  },

  /* one short listen for yes / no after the read-back */
  listenOnce(ms = 7000) {
    return new Promise(res => {
      if (!SR) return res('');
      const r = new SR(); r.lang = 'en-AU'; r.continuous = false; r.interimResults = false; r.maxAlternatives = 3;
      let out = ''; const t = setTimeout(() => { try { r.stop(); } catch (e) { } }, ms);
      r.onresult = e => { out = [...e.results[0]].map(a => a.transcript).join(' | '); };
      r.onend = () => { clearTimeout(t); res(out); }; r.onerror = () => { };
      this._once = r; try { r.start(); } catch (e) { clearTimeout(t); res(''); }
    });
  },
  cancelListen() { if (this._once) try { this._once.abort(); } catch (e) { } },

  voice() {
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    const norm = v => (v.lang || '').replace('_', '-').toLowerCase();
    return vs.find(v => norm(v) === 'en-au') || vs.find(v => norm(v) === 'en-gb') || vs.find(v => norm(v).startsWith('en')) || null;
  },
  speak(text) {
    return new Promise(res => {
      if (!window.speechSynthesis) return res();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); u.lang = 'en-AU'; const v = this.voice(); if (v) u.voice = v; u.rate = 1.03;
      const t = setTimeout(res, Math.max(8000, text.length * 120));
      u.onend = u.onerror = () => { clearTimeout(t); res(); };
      speechSynthesis.speak(u);
    });
  },
  stopSpeaking() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (this.audio) { try { this.audio.pause(); } catch (e) { } if (this._audioDone) this._audioDone(); }
  },
  /* call from the mic tap (a user gesture) so later audio/speech is allowed to play without another tap */
  unlock() {
    try { if (!this.audio) { this.audio = new Audio(); this.audio.preload = 'auto'; } } catch (e) { }
    try { if (window.speechSynthesis && !this._unlocked) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); this._unlocked = true; } } catch (e) { }
  },
  /* split long text into sentence chunks (Chrome cuts off long utterances; the TTS server takes <= 600 chars) */
  chunks(text, max = 220) {
    const parts = String(text || '').match(/[^.!?]+[.!?]*\s*/g) || [String(text || '')]; const out = []; let cur = '';
    for (const p of parts) { if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = ''; } cur += p; }
    if (cur.trim()) out.push(cur.trim()); return out;
  },
  playBlob(blob) {
    return new Promise(res => {
      const a = this.audio || (this.audio = new Audio()); const url = URL.createObjectURL(blob); let done = false;
      const fin = ok => { if (done) return; done = true; this._audioDone = null; clearTimeout(t); a.onended = a.onerror = null; URL.revokeObjectURL(url); res(ok); };
      const t = setTimeout(() => fin(true), 60000); this._audioDone = () => fin(true);
      a.onended = () => fin(true); a.onerror = () => fin(false);
      a.src = url; const p = a.play(); if (p && p.catch) p.catch(() => fin(false));
    });
  },
  /* speak everything: natural voice from the server (TTS) when it works, else the phone's speechSynthesis.
   * cancelled() is checked between chunks. Resolves when finished (the caller keeps the mic off until then). */
  async speakLong(text, cancelled = () => false) {
    const useTTS = typeof TTS !== 'undefined' && TTS.enabled();
    if (useTTS) {
      const parts = this.chunks(text, 560); let next = TTS.fetch(parts[0]).catch(() => null); let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const blob = await next; if (cancelled()) return;
        next = i + 1 < parts.length ? TTS.fetch(parts[i + 1]).catch(() => null) : null;   // fetch the next bit while this one plays
        if (!blob || !(await this.playBlob(blob))) { ok = false; text = parts.slice(i).join(' '); break; }
        if (cancelled()) return;
      }
      if (ok) return;
    }
    for (const part of this.chunks(text)) { if (cancelled()) return; await this.speak(part); }
  },
};
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { };   // warms up the voice list on Chrome
