/* InvoiceMate: voice engine metrics (latency per turn, API usage) + pricing.
 * Prices: USD per 1M tokens from https://platform.openai.com/docs/pricing (checked 4 Oct 2026).
 * Browser: VoiceMetrics / VoiceCost globals. Node: require (tests + benchmark report). */
(function (root) {
  'use strict';
  const RATES = {
    'gpt-realtime-2.1-mini': { audio_in: 10, audio_cached: 0.30, audio_out: 20, text_in: 0.60, text_cached: 0.06, text_out: 2.40 },
    'gpt-realtime-2.1': { audio_in: 32, audio_cached: 0.40, audio_out: 64, text_in: 4, text_cached: 0.40, text_out: 24 },
    'gpt-4.1-mini': { in: 0.40, cached: 0.10, out: 1.60 },
    'gpt-4.1-nano': { in: 0.10, cached: 0.025, out: 0.40 },
    'gpt-4o-mini': { in: 0.15, cached: 0.075, out: 0.60 },
    'gpt-4o-mini-tts': { text_in: 0.60, audio_out: 12 },
    'gpt-4o-mini-transcribe': { text_in: 1.25, audio_in: 1.25, out: 5, per_min: 0.003 },   // audio input tokens billed at the input rate
  };
  /* gpt-4o-mini-tts: the speech endpoint returns no usage with mp3, so TTS is estimated from the audio length,
   * calibrated against real API usage (stream_format=sse reports it): ~26 audio tokens per second of speech,
   * plus ~45 text tokens of voice instructions per call. */
  const TTS_AUDIO_TOK_PER_S = 26, TTS_INSTR_TOK = 45;
  const M = 1e6;

  function realtimeCost(u, model = 'gpt-realtime-2.1-mini') {
    const R = RATES[model], i = u.input_token_details || {}, o = u.output_token_details || {}, c = i.cached_tokens_details || {};
    const cachedA = c.audio_tokens || 0, cachedT = c.text_tokens || 0;
    return ((i.audio_tokens || 0) - cachedA) * R.audio_in / M + cachedA * R.audio_cached / M + ((i.text_tokens || 0) - cachedT) * R.text_in / M + cachedT * R.text_cached / M +
      (o.audio_tokens || 0) * R.audio_out / M + (o.text_tokens || 0) * R.text_out / M;
  }
  function chatCost(u, model) { const R = RATES[model] || RATES['gpt-4.1-mini']; return ((u.prompt_tokens || 0) - (u.cached_tokens || 0)) * R.in / M + (u.cached_tokens || 0) * R.cached / M + (u.completion_tokens || 0) * R.out / M; }
  function ttsCost(t) { const R = RATES['gpt-4o-mini-tts']; return (Math.ceil((t.chars || 0) / 4) + TTS_INSTR_TOK) * R.text_in / M + (t.seconds || 0) * TTS_AUDIO_TOK_PER_S * R.audio_out / M; }
  function sttCost(t) {   // gpt-4o-mini-transcribe returns token usage; fall back to the per-minute estimate
    const R = RATES['gpt-4o-mini-transcribe'], u = t.usage;
    if (u && (u.input_tokens || u.output_tokens)) return (u.input_tokens || 0) * R.audio_in / M + (u.output_tokens || 0) * R.out / M;
    return (t.seconds || 0) / 60 * R.per_min;
  }
  /* one conversation's usage -> {usd, parts, tokens} */
  function price(session) {
    const u = session.usage || {}, parts = { realtime: 0, realtime_transcription: 0, chat: 0, tts: 0, stt_standin: 0 };
    for (const r of u.realtime || []) parts.realtime += realtimeCost(r.usage, r.model);
    for (const r of u.rtstt || []) parts.realtime_transcription += sttCost({ usage: r.usage, seconds: r.seconds });
    for (const r of u.chat || []) parts.chat += chatCost(r.usage, r.model);
    for (const r of u.tts || []) parts.tts += ttsCost(r);
    for (const r of u.stt || []) parts.stt_standin += sttCost(r);
    const usd = Object.values(parts).reduce((a, b) => a + b, 0);
    return { usd, phone_usd: usd - parts.stt_standin, parts };   // phone_usd: on the phone, Web Speech (free) replaces the stand-in STT
  }
  const stats = a => { const s = a.filter(x => x >= 0).slice().sort((x, y) => x - y); if (!s.length) return { avg: null, p90: null, n: 0 };
    return { avg: Math.round(s.reduce((x, y) => x + y, 0) / s.length), p90: Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)]), n: s.length }; };

  /* the running conversation's metrics. Turn latency = end of the user's speech -> first reply audio. */
  const VoiceMetrics = {
    cur: null, external: false,     // external: the Voice test runner marks the true end of speech itself
    begin(engine, info = {}) { this.cur = { engine, info, t0: Date.now(), turns: [], usage: { realtime: [], rtstt: [], chat: [], tts: [], stt: [] }, pendingEnd: null }; return this.cur; },
    end() { const c = this.cur; this.cur = null; return c; },
    userEnd(t = Date.now(), from = 'app') { if (!this.cur || (this.external && from !== 'runner')) return; this.cur.pendingEnd = t; },
    audioStart(t = Date.now()) { const c = this.cur; if (c && c.pendingEnd != null) { c.turns.push({ at: c.pendingEnd - c.t0, ms: t - c.pendingEnd }); c.pendingEnd = null; } },
    add(kind, u) { if (this.cur) this.cur.usage[kind].push(u); },
  };
  const AUD = 1.44;   // AUD per USD, open.er-api.com, 4 Oct 2026
  const api = { AUD, RATES, TTS_AUDIO_TOK_PER_S, realtimeCost, chatCost, ttsCost, sttCost, price, stats, VoiceMetrics };
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.VoiceCost = api; root.VoiceMetrics = VoiceMetrics; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
