/* InvoiceMate: the "thinking" provider switch + saved price list (localStorage).
 * ==========================================================================
 *  PROVIDER SWITCH  ->  Settings > Voice & prices > "Thinking"
 *  Local (default) is the only one implemented: rule-based parseJob() in js/parser.js, runs on the phone.
 *  Grok and OpenAI are STUBS so swapping later is a settings change plus filling in parse() below.
 *  (No API keys, no network calls are made by this file.)
 * ========================================================================== */
'use strict';
const IMPrices = {
  KEY: 'im.prices',
  load() {
    try { const a = JSON.parse(localStorage.getItem(this.KEY)); if (Array.isArray(a) && a.length) return a; } catch (e) { }
    const d = JSON.parse(JSON.stringify(IMParser.DEFAULT_PRICES)); this.save(d); return d;
  },
  save(a) { localStorage.setItem(this.KEY, JSON.stringify(a)); },
  reset() { localStorage.removeItem(this.KEY); return this.load(); },
};
const IMPrefs = {
  get(k, d) { const v = localStorage.getItem('im.' + k); return v === null ? d : v === 'true' ? true : v === 'false' ? false : v; },
  set(k, v) { localStorage.setItem('im.' + k, String(v)); },
};

const Thinking = {
  providers: {
    local: { label: 'Local (default)', note: 'Rule-based, runs on this phone. Works offline, free, private.', ready: true,
      async parse(text, ctx) { return IMParser.parseJob(text, ctx); } },
    grok: { label: 'Grok', note: 'Stub: not connected. Would send the words to xAI Grok to understand. Needs an API key and a small server; not set up.', ready: false,
      async parse(/* text, ctx */) { throw new Error('Grok is not connected yet'); } },          // TODO: implement when approved
    openai: { label: 'OpenAI', note: 'Stub: not connected. Would send the words to OpenAI. Needs an API key and a small server; not set up.', ready: false,
      async parse(/* text, ctx */) { throw new Error('OpenAI is not connected yet'); } },        // TODO: implement when approved
  },
  get provider() { return IMPrefs.get('thinking', 'local'); },
  set provider(v) { IMPrefs.set('thinking', v); },
  context() { return { prices: IMPrices.load(), customers: S.customers, gstRate: S.settings.business.gstRegistered !== false ? 0.1 : 0 }; },
  async parse(text) {
    const name = this.provider, p = this.providers[name] || this.providers.local, ctx = this.context();
    try { const d = await p.parse(text, ctx); d.provider = name; return d; }
    catch (e) { const d = await this.providers.local.parse(text, ctx); d.warnings.unshift(`${p.label}: ${e.message}. Used Local instead.`); d.provider = 'local'; return d; }
  },
};

/* Settings > Voice & prices tab */
const IMSettings = {
  render(body) {
    const prices = IMPrices.load(); const cur = Thinking.provider;
    body.innerHTML = `<div class="grid g2" style="align-items:start">
      <div class="stack">
        <div class="card"><h2 style="margin-bottom:6px">Conversation engine</h2><p class="small muted" style="margin-top:0">Who you talk to in hands-free mode. All three make the same invoice and only send when you say yes.</p>
          <div class="list">${Engines.LIST.map(([k, l, n]) => `<label class="li" style="cursor:pointer"><input type="radio" name="im-engine" value="${k}" ${k === Engines.current ? 'checked' : ''}>
            <div class="grow"><div class="t">${esc(l)}</div><div class="s" style="white-space:normal">${esc(n)}</div></div></label>`).join('')}</div>
          <div class="row" style="margin-top:10px"><a class="btn sm" href="#/voicetest">${icon('mic')} Voice test</a><span class="small muted">Compare the engines: speed, cost, accuracy.</span></div></div>
        <div class="card"><h2 style="margin-bottom:6px">Thinking</h2><p class="small muted" style="margin-top:0">What turns your words into an invoice.</p>
          <div class="list">${Object.entries(Thinking.providers).map(([k, p]) => `<label class="li" style="cursor:pointer"><input type="radio" name="im-think" value="${k}" ${k === cur ? 'checked' : ''}>
            <div class="grow"><div class="t">${esc(p.label)} ${p.ready ? '' : '<span class="pill">stub</span>'}</div><div class="s" style="white-space:normal">${esc(p.note)}</div></div></label>`).join('')}</div></div>
        <div class="card"><h2 style="margin-bottom:12px">Voice</h2><div class="stack">
          <label class="f">App’s voice<select id="im-tts">${IM_TTS_VOICES.map(([k, l]) => `<option value="${k}" ${k === TTS.voice ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <div class="row"><button class="btn sm" id="im-tts-try" type="button">${icon('volume')} Hear it</button><span class="small muted" id="im-tts-note"></span></div>
          <div class="small muted">The natural voices come from OpenAI through InvoiceMate’s server and need internet. If they can’t be reached, the phone’s built-in voice is used instead.</div>
          <label class="chk"><input type="checkbox" id="im-rb" ${IMPrefs.get('readback', true) ? 'checked' : ''}> Read the draft invoice back to me</label>
          <label class="chk"><input type="checkbox" id="im-vc" ${IMPrefs.get('voiceconfirm', true) ? 'checked' : ''}> Then listen for “yes / yep / send it” to confirm</label>
          <div class="small muted">Talking uses Chrome's built-in speech recognition (Australian English). On Android it needs Chrome, an internet connection and microphone permission.</div></div></div>
      </div>
      <div class="card"><div class="card-h"><h2>Price list</h2><div class="spacer"></div><button class="btn sm" id="pl-add">${icon('plus')} Add</button></div>
        <p class="small muted" style="margin-top:0">Used when you say an item without a price. “Also called” = other words you might say, comma separated. Prices are ex GST.</p>
        <div id="pl-rows" class="stack">${prices.map((p, i) => this.row(p, i)).join('')}</div>
        <div class="row" style="margin-top:16px"><button class="btn pri" id="pl-save">${icon('check')} Save price list</button><button class="btn ghost" id="pl-reset">Reset to defaults</button></div></div>
    </div>`;
    $$('input[name=im-engine]', body).forEach(r => r.onchange = () => { Engines.current = r.value; toast('Conversation engine: ' + Engines.label(r.value)); });
    $$('input[name=im-think]', body).forEach(r => r.onchange = () => { Thinking.provider = r.value; toast(Thinking.providers[r.value].ready ? 'Thinking: ' + Thinking.providers[r.value].label : Thinking.providers[r.value].label + ' is a stub. Local will be used until it is set up.'); });
    $('#im-tts', body).onchange = e => { TTS.voice = e.target.value; TTS.down = 0; };
    $('#im-tts-try', body).onclick = async () => { const n = $('#im-tts-note', body); Voice.unlock(); TTS.down = 0; n.textContent = 'Playing…';
      const viaServer = TTS.enabled(); await Voice.speakLong('G’day! What’s Dave’s email address?');
      n.textContent = TTS.voice === 'device' ? 'Phone voice' : viaServer && Date.now() - TTS.down > 60000 ? 'Natural voice' : 'Natural voice not reachable, used the phone voice'; };
    $('#im-rb', body).onchange = e => IMPrefs.set('readback', e.target.checked);
    $('#im-vc', body).onchange = e => IMPrefs.set('voiceconfirm', e.target.checked);
    $('#pl-add', body).onclick = () => { $('#pl-rows', body).insertAdjacentHTML('beforeend', this.row({ key: 'p' + uid(), name: '', price: '', unit: 'each', aliases: [] })); };
    $('#pl-rows', body).addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) b.closest('.pl-row').remove(); });
    $('#pl-save', body).onclick = () => {
      const a = $$('.pl-row', body).map(r => ({ key: r.dataset.key, name: $('[data-f=name]', r).value.trim(), price: r2(num($('[data-f=price]', r).value)), unit: $('[data-f=unit]', r).value.trim() || 'each',
        aliases: $('[data-f=aliases]', r).value.split(',').map(s => s.trim()).filter(Boolean) })).filter(p => p.name);
      IMPrices.save(a); toast('Price list saved');
    };
    $('#pl-reset', body).onclick = async () => { if (await confirmBox('Reset the price list to the defaults?', 'Reset', false)) { IMPrices.reset(); render(); } };
  },
  row(p) {
    return `<div class="pl-row card flat" data-key="${esc(p.key)}" style="padding:12px"><div class="grid g2">
      <label class="f">Item<input type="text" data-f="name" value="${esc(p.name)}"></label>
      <div class="row nw"><label class="f" style="flex:1">Price $<input type="number" step="0.01" data-f="price" value="${esc(p.price)}"></label><label class="f" style="width:90px">Per<input type="text" data-f="unit" value="${esc(p.unit || 'each')}"></label></div></div>
      <div class="row nw" style="margin-top:8px"><label class="f" style="flex:1">Also called<input type="text" data-f="aliases" value="${esc((p.aliases || []).join(', '))}"></label>${p.key === 'labour' || p.key === 'callout' ? '' : `<button class="btn ghost icon" data-rm title="Remove" style="margin-top:20px">${icon('trash')}</button>`}</div></div>`;
  },
};
