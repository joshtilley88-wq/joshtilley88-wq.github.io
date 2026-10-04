/* InvoiceMate: hands-free voice conversation, the "brain" (pure logic, no DOM, no audio).
 * A small state machine: the screen/audio controller (js/talk.js) feeds it what was heard and it answers with
 * what to say next and what to do. Works in the browser (window.IMConvo) and in Node (require) for tests.
 *
 *   job ──heard──▶ ask(name | items | price | hours | amount | email) ──▶ … ──▶ confirm ──yes──▶ sending ──ok──▶ done
 *                                                                              ▲   │ correction → re-read           │ fail
 *                                                                              └───┘                         retry ◀┘
 *   any listening state: "cancel"/"stop" (short) → ended ; long silence → "Still there?" then ended.
 *
 * step(c, ev) mutates the conversation c and returns { say, listen, action, end }:
 *   say    : text to speak (and show) or ''          listen : open the mic after speaking
 *   action : 'send' | 'save-only' | null             end    : conversation over (voice mode off)
 * Events: {type:'heard', text}  {type:'silence'}  {type:'sent', ok, error, to}  {type:'stop'}  */
(function (root) {
  'use strict';
  const P = typeof module === 'object' && module.exports ? require('./parser.js') : root.IMParser;
  const r2 = n => Math.round((+n || 0) * 100) / 100;
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

  /* ---------- talking helpers ---------- */
  function sayNum(n) { return String(+n).replace(/\.5$/, ' and a half').replace(/^0 and a half/, 'half'); }
  function sayMoney(n) { n = r2(n); const d = Math.floor(n), c = Math.round((n - d) * 100); return `${d.toLocaleString('en-AU')} dollar${d === 1 ? '' : 's'}${c ? ' ' + c : ''}`; }
  function sayEmail(e) { return String(e || '').replace(/@/g, ' at ').replace(/\./g, ' dot ').replace(/_/g, ' underscore ').replace(/-/g, ' dash ').replace(/\s+/g, ' ').trim(); }
  function sayAddr(a) { return String(a || '').replace(/\bSt\b/g, 'Street').replace(/\bRd\b/g, 'Road').replace(/\bAve\b/g, 'Avenue').replace(/\bCres\b/g, 'Crescent').replace(/\bCt\b/g, 'Court').replace(/\bDr\b/g, 'Drive').replace(/\bPde\b/g, 'Parade'); }
  const first = name => String(name || '').trim().split(/\s+/)[0] || 'them';
  const plural = s => /s$/i.test(s) ? s : s + 's';
  const lc = s => String(s || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");

  /* ---------- spoken email: "dave at gmail dot com" -> dave@gmail.com ---------- */
  const DIGIT = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
  const BARE = { gmail: 'gmail.com', hotmail: 'hotmail.com', outlook: 'outlook.com', yahoo: 'yahoo.com', icloud: 'icloud.com', bigpond: 'bigpond.com', live: 'live.com', me: 'me.com', optusnet: 'optusnet.com.au', iinet: 'iinet.net.au', tpg: 'tpg.com.au' };
  const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
  function spokenEmail(text) {
    let t = ' ' + lc(text) + ' ';
    t = t.replace(/[,!?]/g, ' ').replace(/\.(\s|$)/g, ' ');
    t = t.replace(/\b(?:um+|uh+|er+|yeah|yep|ok(?:ay)?|right|so|mate|sure)\b/g, ' ')
      .replace(/\b(?:(?:it'?s|its|it is|that'?s|that is)\s+)?(?:(?:his|her|their|my|the|dave'?s|[a-z]+'s)\s+)?(?:e-?mail|email address|address)\s*(?:is|it'?s|=)?\b/g, ' ')
      .replace(/\b(?:it'?s|its|it is|that'?s)\b/g, ' ')
      .replace(/\b(?:all one word|all lower ?case|lower ?case|no spaces|one word)\b/g, ' ')
      .replace(/\b(?:at sign|at symbol|at the rate|@)\b|@/g, ' @ ')
      .replace(/\b(?:dot|period|point|full stop)\b/g, ' . ').replace(/\bunderscore\b/g, ' _ ').replace(/\b(?:dash|hyphen|minus)\b/g, ' - ')
      .replace(/\b(?:plus sign)\b/g, ' + ').replace(/\b(?:dot com dot au)\b/g, ' .com.au ');
    t = t.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (m, w) => DIGIT[w]);
    if (!t.includes('@')) { const i = t.lastIndexOf(' at '); if (i < 0) return ''; t = t.slice(0, i) + ' @ ' + t.slice(i + 4); }
    let e = t.replace(/\s+/g, '');
    e = e.replace(/@+/g, '@').replace(/\.{2,}/g, '.').replace(/^[._-]+|[._-]+$/g, '');
    const parts = e.split('@'); if (parts.length !== 2) return '';
    let [user, dom] = parts; dom = dom.replace(/^\.+/, '');
    if (!dom.includes('.') && BARE[dom]) dom = BARE[dom];
    if (/^gmail\.(?!com$)/.test(dom)) dom = 'gmail.com';
    e = user + '@' + dom;
    return EMAIL_RE.test(e) ? e : '';
  }
  /* an email said inside the job description: "... his email is dave at gmail dot com ..." */
  function extractSpokenEmail(text) {
    const s = String(text || '');
    const m = s.match(/([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/) ||
      s.match(/((?:\b[a-z0-9]\s+){2,}[a-z0-9]\s+(?:at|at sign)\s+[a-z0-9]+(?:\s+(?:dot|point)\s+[a-z]{2,})+)/i) ||          // spelled: d a v e at gmail dot com
      s.match(/(\b[a-z0-9]+(?:\s+(?:dot|underscore|dash)\s+[a-z0-9]+)*\s+(?:at|at sign)\s+[a-z0-9]+(?:\s+(?:dot|point)\s+[a-z]{2,})+)/i);
    if (!m) return null;
    let raw = m[1]; const lead = raw.match(/^(?:(?:and|his|her|their|the|email|e-mail|address|is|it's)\s+)+/i); if (lead) raw = raw.slice(lead[0].length);
    const e = spokenEmail(raw); return e ? { email: e, span: m[0] } : null;
  }

  /* ---------- intents ---------- */
  const words = s => lc(s).replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
  function isStop(text) { const w = words(text); return w.length <= 5 && /\b(cancel|stop|stop listening|forget it|never ?mind|quit|abort|scrap it|scrap that|bin it)\b/.test(lc(text)) && !/\b(valve|tap|cock|leak)\b/.test(lc(text)); }
  function yesNo(text) {
    const t = ' ' + lc(text).replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ') + ' ';
    if (/ yeah nah /.test(t)) return 'no';
    if (/ nah yeah /.test(t)) return 'yes';
    if (/ (don't|do not|dont) (send|do it)| not yet | no | nope | nah | wait | hang on | hold on | stop | negative | wrong | incorrect /.test(t)) return 'no';
    if (/ (yes|yep|yeah|yeh|yup|ya|aye|sure|send it|send|go ahead|do it|righto|right oh|sweet|too easy|perfect|spot on|correct|that's right|thats right|sounds good|ok|okay|all good|good to go|go for it|absolutely|definitely|please do|fire away|lovely|beauty|bewdy|done) /.test(t)) return 'yes';
    return null;
  }
  const SKIP_RE = /\b(skip|don'?t (?:have|know)|no email|leave it|not sure|dunno|no idea|later|none)\b/;

  /* ---------- corrections ---------- */
  const FILLER = /\b(the|a|an|my|that|this|line|item|charge|fee|cost|price|for|of|on|bit|thing)\b/g;
  const compact = s => lc(s).replace(FILLER, ' ').replace(/[^a-z0-9]/g, '').replace(/s$/, '');
  function findItem(items, target, prices) {
    const tc = compact(target); if (!tc) return -1;
    let i = items.findIndex(it => { const dc = compact(it.desc); return dc && (dc.includes(tc) || tc.includes(dc)); });
    if (i >= 0) return i;
    for (const p of prices || []) {   // "the callout" -> price-list name "Call-out fee"
      if ([p.name, ...(p.aliases || [])].some(a => { const ac = compact(a); return ac && (ac === tc || tc.includes(ac) || ac.includes(tc)); })) {
        i = items.findIndex(it => compact(it.desc).includes(compact(p.name)) || compact(p.name).includes(compact(it.desc))); if (i >= 0) return i;
      }
    }
    if (/^(labou?r|time|hours?)$/.test(tc)) return items.findIndex(it => it.unit === 'hour' || /^labou?r/i.test(it.desc));
    if (/^(part|material)$/.test(tc)) return items.findIndex(it => /part|material/i.test(it.desc));
    return -1;
  }
  /* value phrase -> what to set on the item */
  function setValue(it, val) {
    const v = P.wordsToNumbers(val);
    const hrs = v.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i), rate = v.match(/\$?(\d+(?:\.\d+)?)\s*(?:dollars?|bucks)?\s*(?:an|a|per|\/)\s*hour/i);
    const each = v.match(/\$?(\d+(?:\.\d+)?)\s*(?:dollars?|bucks)?\s*each\b/i), cnt = v.match(/^\s*(\d+)\s*(?:x\b|of them\b|[a-z]{3,})/i);
    const n = v.match(/\$?(\d+(?:\.\d+)?)/);
    if (rate) { it.price = +rate[1]; it.unit = 'hour'; return `${it.desc} rate ${sayMoney(it.price)} an hour`; }
    if (hrs) { if (it.unit !== 'hour' && /^labou?r/i.test(it.desc)) { it.desc = 'Labour'; it.unit = 'hour'; } if (it.unit === 'hour') { it.qty = +hrs[1]; return `${it.desc} ${sayNum(it.qty)} hour${it.qty === 1 ? '' : 's'}`; } }
    if (each) { it.price = +each[1]; return `${it.desc} ${sayMoney(it.price)} each`; }
    if (!n) return '';
    const x = +n[1], dollars = /\$|dollars?|bucks/i.test(v);
    if (cnt && !dollars && it.unit !== 'hour') { it.qty = x; return `${sayNum(x)} ${it.desc}`; }
    if (it.unit === 'hour' && !dollars && x <= 12) { it.qty = x; return `${it.desc} ${sayNum(x)} hour${x === 1 ? '' : 's'}`; }
    if (it.unit === 'hour') { it.price = x; return `${it.desc} ${sayMoney(x)} an hour`; }
    it.price = it.qty > 1 && !/each/i.test(v) ? r2(x / it.qty) : x; it.source = 'spoken';
    return `${it.desc} ${sayMoney(r2(it.price * it.qty))}`;
  }
  /* returns a short spoken description of the change, or '' if nothing was understood */
  function applyCorrection(d, text, ctx) {
    const prices = (ctx && ctx.prices) || P.DEFAULT_PRICES; const items = d.items;
    const t0 = lc(text).replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
    let t = lc(text).replace(/^(?:(?:yeah|yep|nah|no|ok(?:ay)?|um+|uh+|actually|mate|sorry|oh|and|but|can you|could you|please|just)[\s,]+)+/g, '').replace(/[?!]/g, ' ').replace(/\.(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    t = t.replace(/\s+(?:please|thanks|cheers|mate)$/g, '');
    let m;
    if ((m = t.match(/\b(?:e-?mail|email address)\b.*?\b(?:is|to|should be|it's)\s+(.+)$/)) || (m = t.match(/^(?:send it to|it goes to)\s+(.+@.+|.+ at .+)$/))) {
      const e = spokenEmail(m[1]); if (e) { d.customer.email = e; return `email ${sayEmail(e)}`; }
    }
    if ((m = t.match(/\b(?:name is|name's|name should be|change the name to|it's for|invoice is for|customer is|customer's name is|should be for)\s+([a-z' ]{2,40})$/))) {
      d.customer.name = m[1].trim().replace(/\b[a-z]/g, c => c.toUpperCase()); d.customer.id = ''; return `customer ${d.customer.name}`;
    }
    if ((m = t.match(/\b(?:address is|address should be|change the address to|it's at|job was at)\s+(.+)$/))) { d.customer.address = m[1].replace(/\b[a-z]/g, c => c.toUpperCase()); return `address ${sayAddr(d.customer.address)}`; }
    if (/^no\s+(?!gst\b)\S/.test(t0) && !/^no\s+(?:worries|thanks|that'?s)/.test(t0)) t = t0;   // "no call-out" = take it off
    if (/\b(no gst|without gst|take off (?:the )?gst|remove (?:the )?gst|gst free)\b/.test(t0)) { items.forEach(it => it.gst = false); d.noGst = true; return 'no GST'; }
    if (/\b(add (?:the )?gst|with gst|plus gst|put (?:the )?gst (?:back )?on)\b/.test(t)) { items.forEach(it => it.gst = true); d.noGst = false; return 'GST added'; }
    if ((m = t.match(/^(?:take off|take out|remove|drop|delete|get rid of|scrap|lose|cut|knock off|no)\s+(?:the\s+)?(.+?)(?:\s+(?:off|fee|charge|line))?$/)) || (m = t.match(/^take\s+(?:the\s+)?(.+?)\s+off$/))) {
      const i = findItem(items, m[1], prices); if (i >= 0) { const [it] = items.splice(i, 1); return `took off the ${lc(it.desc)}`; }
      return '';
    }
    if ((m = t.match(/^(?:change|make|set|update|put|switch|correct|fix)\s+(?:the\s+)?(.+?)\s+(?:to|at|as|should be)\s+(.+)$/)) || (m = t.match(/^(?:the\s+)?(.+?)\s+(?:should be|should have been|was actually|was|is|were|are|to)\s+(.+)$/))) {
      const i = findItem(items, m[1], prices);
      if (i >= 0) { const s = setValue(items[i], m[2]); if (s) return s; }
      if (/^(?:the\s+)?(?:rate|hourly rate|labour rate)$/.test(m[1])) { const li = items.findIndex(it => it.unit === 'hour'); const v = P.wordsToNumbers(m[2]).match(/(\d+(?:\.\d+)?)/); if (li >= 0 && v) { items[li].price = +v[1]; return `labour ${sayMoney(+v[1])} an hour`; } }
    }
    if ((m = t.match(/^(?:add|plus|and also|also add|also|put on|chuck on|throw in|add on)\s+(.+)$/))) {
      const nd = P.parseJob('job ' + m[1].replace(/\b(?:another|an extra)\b/g, 'one'), ctx || {});
      const add = nd.items.filter(Boolean); if (!add.length) return '';
      for (const it of add) { it.gst = !d.noGst; items.push(it); }
      return 'added ' + add.map(it => it.qty !== 1 && it.unit !== 'hour' ? `${sayNum(it.qty)} ${plural(lc(it.desc))}` : lc(it.desc)).join(' and ');
    }
    if ((m = t.match(/^(?:it was|that was|make it|it's|labour was|labour is)?\s*(\S+(?:\s+\S+)?)\s+hours?(?: of labou?r)?$/))) {
      const li = items.findIndex(it => it.unit === 'hour'); const v = P.wordsToNumbers(m[1] + ' hours').match(/(\d+(?:\.\d+)?)\s*hours/); if (li >= 0 && v) { items[li].qty = +v[1]; return `labour ${sayNum(+v[1])} hours`; }
    }
    return '';
  }

  /* ---------- summary ---------- */
  function totalsOf(d, gstRate) { return P.totals(d.items, gstRate ?? 0.1); }
  function summary(d, gstRate) {
    const t = totalsOf(d, gstRate);
    const lines = d.items.map(it => it.unit === 'hour' ? `${it.desc}, ${sayNum(it.qty)} ${+it.qty === 1 ? 'hour' : 'hours'} at ${sayMoney(it.price)} an hour` : `${+it.qty !== 1 ? sayNum(it.qty) + ' ' + plural(it.desc) : it.desc}, ${sayMoney(r2(it.qty * it.price))}`);
    return `Invoice for ${d.customer.name || 'no name yet'}${d.customer.address ? ', ' + sayAddr(d.customer.address) : ''}. ${lines.join('. ')}. Total ${sayMoney(t.total)}${t.gst ? ' including GST' : ''}.` +
      (d.customer.email ? ` Sending to ${sayEmail(d.customer.email)}.` : '');
  }

  /* ---------- the machine ---------- */
  const SILENCE_LIMIT = 2;
  function create(ctx, opts = {}) {
    return { state: 'job', ctx: ctx || {}, job: (opts.prefill || '').trim(), draft: null, asking: null, tries: 0, silences: 0, emailSkipped: false, checked: {}, sent: false, history: [], heard: [] };
  }
  const out = (c, say, o = {}) => { const r = { say: say || '', listen: o.listen !== false && !o.end, action: o.action || null, end: !!o.end }; if (say) c.history.push({ who: 'app', text: say }); if (r.end) c.state = c.sent ? 'done' : 'ended'; return r; };

  function parseInto(c, text) {
    let job = text; const se = extractSpokenEmail(job); let email = '';
    if (se) { email = se.email; job = job.replace(se.span, ' '); }
    job = job.replace(/\b(?:that'?s (?:it|all)|done|make the invoice|make it|go)\s*[.!]?\s*$/i, '').trim();
    const d = P.parseJob(job, c.ctx);
    if (email) d.customer.email = email;
    d.items.forEach(it => { it.qty = num(it.qty); it.price = num(it.price); });
    return d;
  }

  /* what's missing, one thing at a time; null = ready to read back */
  function nextQuestion(c) {
    const d = c.draft, nm = first(d.customer.name);
    if (!d.customer.name) return { field: 'name', say: 'Who’s the invoice for?' };
    if (!d.items.length) return { field: 'items', say: `What should I charge ${nm} for?` };
    const np = d.items.findIndex(it => it.source === 'none' || (!num(it.price) && it.unit !== 'hour'));
    if (np >= 0) return { field: 'price', idx: np, say: `How much for the ${lc(d.items[np].desc)}?` };
    const lab = d.items.findIndex(it => it.unit === 'hour' && !num(it.qty));
    if (lab >= 0) return { field: 'hours', idx: lab, say: 'How many hours of labour?' };
    if ((d.warnings || []).some(w => /rate of \$\d+.*no hours/i.test(w)) && !d.items.some(it => it.unit === 'hour') && !c.checked.hours) {
      const rate = +(d.warnings.find(w => /rate of \$(\d+)/.test(w)).match(/rate of \$(\d+(?:\.\d+)?)/)[1]);
      return { field: 'hours', idx: -1, rate, say: `You said ${sayMoney(rate)} an hour. How many hours?` };
    }
    const big = d.items.findIndex((it, i) => !c.checked['amt' + i] && r2(it.qty * it.price) >= 10000);
    if (big >= 0) return { field: 'amount', idx: big, say: `Just checking, the ${lc(d.items[big].desc)} is ${sayMoney(r2(d.items[big].qty * d.items[big].price))}. Is that right?` };
    if (!d.customer.email && !c.emailSkipped) return { field: 'email', say: `What’s ${nm}’s email address?` };
    return null;
  }
  function advance(c, prefix = '') {
    const q = nextQuestion(c);
    if (q) { c.state = 'ask'; c.asking = q; c.tries = 0; return out(c, (prefix ? prefix + ' ' : '') + q.say); }
    c.state = 'confirm'; c.asking = null; c.tries = 0;
    return out(c, (prefix ? prefix + ' ' : '') + summary(c.draft, c.ctx.gstRate) + ' Want me to send it?');
  }

  function onAnswer(c, text) {
    const q = c.asking, d = c.draft, t = lc(text);
    const retry = msg => { c.tries++; if (c.tries >= 3 && q.field !== 'name') { if (q.field === 'email') c.emailSkipped = true; if (q.field === 'amount') c.checked['amt' + q.idx] = true; if (q.field === 'hours') c.checked.hours = true; return advance(c, 'No worries, let’s keep going.'); } return out(c, msg); };
    // a correction instead of an answer ("actually take off the call-out")
    if (q.field !== 'name' && q.field !== 'email' && /^(?:actually\s+)?(?:take off|remove|change|add|make)\b/.test(t)) { const ch = applyCorrection(d, text, c.ctx); if (ch) return advance(c, `Okay, ${ch}.`); }
    if (q.field === 'name') {
      const n = text.replace(/^(?:(?:it'?s|its|it is|that'?s|for|the customer is|customer is|name is|um+|uh+|yeah|oh)[\s,]+)+/i, '').replace(/[.!?,]/g, '').trim();
      if (!n || n.split(/\s+/).length > 4) return retry('Sorry, who’s it for? Just say their name.');
      d.customer.name = n.replace(/\b[a-z]/g, ch => ch.toUpperCase());
      const hit = (c.ctx.customers || []).find(x => lc(x.name) === lc(d.customer.name));
      if (hit) { d.customer.id = hit.id; d.customer.email = d.customer.email || hit.email || ''; d.customer.address = d.customer.address || hit.address || ''; }
      return advance(c, `Got it, ${d.customer.name}.`);
    }
    if (q.field === 'items') {
      const nd = parseInto(c, 'job ' + text); if (!nd.items.length) return retry('Sorry, what did you do and what should I charge? For example, two hours labour and a call-out.');
      nd.items.forEach(it => { it.gst = !d.noGst; d.items.push(it); }); if (!d.workDone && nd.workDone) d.workDone = nd.workDone;
      return advance(c, 'Got it.');
    }
    if (q.field === 'price') {
      const m = P.wordsToNumbers(text).match(/\$?(\d+(?:\.\d+)?)/); if (!m) return retry(`Sorry, how much for the ${lc(d.items[q.idx].desc)}? Just say the amount.`);
      const it = d.items[q.idx]; it.price = it.qty > 1 && !/each/i.test(text) ? r2(+m[1] / it.qty) : +m[1]; it.source = 'spoken';
      if (d.gstIncluded && it.gst) it.price = r2(it.price / 1.1);
      return advance(c, `Okay, ${sayMoney(r2(it.price * it.qty))}.`);
    }
    if (q.field === 'hours') {
      const m = P.wordsToNumbers(text).replace(/\b(an|one) hour\b/i, '1 hour').match(/(\d+(?:\.\d+)?)/); if (!m) return retry('Sorry, how many hours? Just say the number.');
      if (q.idx >= 0) d.items[q.idx].qty = +m[1]; else d.items.unshift({ desc: 'Labour', qty: +m[1], unit: 'hour', price: q.rate, source: 'spoken', gst: !d.noGst });
      c.checked.hours = true; return advance(c, `Okay, ${sayNum(+m[1])} hour${+m[1] === 1 ? '' : 's'}.`);
    }
    if (q.field === 'amount') {
      const yn = yesNo(text); const m = P.wordsToNumbers(text).match(/\$?(\d+(?:\.\d+)?)/);
      if (m && yn !== 'yes') { const it = d.items[q.idx]; it.price = it.qty > 1 ? r2(+m[1] / it.qty) : +m[1]; c.checked['amt' + q.idx] = true; return advance(c, `Okay, ${sayMoney(r2(it.price * it.qty))}.`); }
      if (yn === 'yes') { c.checked['amt' + q.idx] = true; return advance(c, 'Righto.'); }
      if (yn === 'no') { c.asking = { field: 'price', idx: q.idx, say: '' }; c.tries = 0; return out(c, `No worries. How much for the ${lc(d.items[q.idx].desc)}?`); }
      return retry('Sorry, is that amount right? Say yes, or tell me the right amount.');
    }
    if (q.field === 'email') {
      if (SKIP_RE.test(t)) { c.emailSkipped = true; return advance(c, 'No worries, I’ll leave the email off.'); }
      const e = spokenEmail(text);
      if (!e) return retry(c.tries ? 'Sorry, still didn’t get it. Try spelling the first part, then say at, then the rest. Like d a v e at gmail dot com.' : 'Sorry, I didn’t catch that email. Say it like dave at gmail dot com.');
      d.customer.email = e; return advance(c, `Got it, ${sayEmail(e)}.`);
    }
    return advance(c);
  }

  function step(c, ev) {
    if (ev.type === 'stop') return out(c, '', { end: true });
    if (ev.type === 'silence') {
      if (c.state === 'sending') return out(c, '', { listen: false });
      c.silences++;
      if (c.silences >= SILENCE_LIMIT) return out(c, c.draft ? 'I’ll stop listening for now. Your draft is still on the screen. Tap the mic when you’re ready.' : 'I’ll stop listening for now. Tap the mic when you’re ready.', { end: true });
      const again = c.state === 'job' ? 'Still there? Tell me about the job, or say cancel.' : c.state === 'confirm' ? 'Still there? Want me to send it? Say yes, or tell me what to change.' : c.state === 'retry' ? 'Still there? Want me to try sending again?' : 'Still there? ' + ((c.asking && c.asking.say) || '');
      return out(c, again);
    }
    if (ev.type === 'sent') {
      const nm = first(c.draft && c.draft.customer.name);
      if (ev.unavailable) return out(c, 'Sending from the app isn’t switched on yet, so I’ve saved the invoice and opened the email, ready to send from your email app.', { end: true });
      if (ev.ok) { c.sent = true; return out(c, `Sent to ${nm}.`, { end: true }); }
      c.state = 'retry';
      return out(c, `Sorry, it didn’t send. ${String(ev.error || 'Something went wrong').replace(/\.$/, '')}. The invoice is saved. Want me to try again?`);
    }
    if (ev.type !== 'heard') return out(c, '');
    const text = String(ev.text || '').trim();
    if (!text) return step(c, { type: 'silence' });
    c.silences = 0; c.heard.push(text); c.history.push({ who: 'you', text });
    if (isStop(text) && c.state !== 'sending') return out(c, c.draft ? 'Okay, I’ve stopped. Nothing was sent.' : 'Okay, cancelled.', { end: true });

    if (c.state === 'job') {
      c.job = [c.job, text].filter(Boolean).join(' ');
      const d = parseInto(c, c.job);
      if (!d.items.length && !d.customer.name) { c.tries++; c.job = ''; return out(c, c.tries > 1 ? 'Sorry, still didn’t get that. Say who it’s for and what you did, like invoice for Dave, two hours labour plus call-out.' : 'Sorry, I didn’t get the job. Who’s it for and what did you do?'); }
      c.draft = d; c.tries = 0; return advance(c);
    }
    if (c.state === 'ask') return onAnswer(c, text);
    if (c.state === 'confirm') {
      const ch = applyCorrection(c.draft, text, c.ctx);
      if (ch) { const q = nextQuestion(c); const chl = ch.charAt(0).toLowerCase() + ch.slice(1); if (q && q.field !== 'email') return advance(c, `Okay, ${chl}.`); return advance(c, `Okay, ${chl}. Here it is again.`); }
      const yn = yesNo(text);
      if (yn === 'yes') {
        if (!c.draft.customer.email) { c.state = 'saving'; return out(c, 'There’s no email address, so I’ll save it to your invoices and you can send it later.', { action: 'save-only', end: true }); }
        c.state = 'sending'; return out(c, 'Sending it now.', { action: 'send', listen: false });
      }
      if (yn === 'no') return out(c, 'No worries. What do you want to change? For example, change labour to two hours, or take off the call-out.');
      c.tries++;
      return out(c, c.tries > 2 ? 'Say yes to send it, tell me what to change, or say cancel.' : 'Sorry, I didn’t catch that. Say yes to send it, or tell me what to change.');
    }
    if (c.state === 'retry') {
      const yn = yesNo(text);
      if (yn === 'yes') { c.state = 'sending'; return out(c, 'Trying again.', { action: 'send', listen: false }); }
      if (yn === 'no') return out(c, 'Okay. It’s saved in your invoices, and you can send it from the email outbox later.', { end: true });
      return out(c, 'Want me to try sending it again? Say yes or no.');
    }
    return out(c, '');
  }

  const api = { create, step, spokenEmail, extractSpokenEmail, applyCorrection, yesNo, isStop, summary, sayEmail, sayMoney, sayNum, nextQuestion };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.IMConvo = api;
})(typeof self !== 'undefined' ? self : this);
