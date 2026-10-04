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
  stopSpeaking() { if (window.speechSynthesis) speechSynthesis.cancel(); },
};
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { };   // warms up the voice list on Chrome
