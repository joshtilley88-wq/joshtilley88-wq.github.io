/* InvoiceMate: local rule-based "thinking" module.
 * parseJob(text, opts) turns messy Aussie tradie speech into a draft invoice.
 * No network, no AI. Works in the browser (window.IMParser) and in Node (require).
 * opts: { prices: [...price list], customers: [...{id,name,address}], gstRate: 0.1 } */
(function (root) {
  'use strict';
  const r2 = n => Math.round((+n || 0) * 100) / 100;

  /* ---------- default price list (seeded into localStorage by the app) ---------- */
  const DEFAULT_PRICES = [
    { key: 'labour', name: 'Labour', price: 95, unit: 'hour', aliases: ['labour', 'labor', 'hourly rate', 'my time'] },
    { key: 'callout', name: 'Call-out fee', price: 80, unit: 'each', aliases: ['call out', 'call-out', 'callout', 'service call', 'travel fee', 'attendance fee'] },
    { key: 'hws', name: 'Hot water service', price: 1450, unit: 'each', aliases: ['hot water service', 'hot water system', 'hot water unit', 'hot water heater', 'hws'] },
    { key: 'tapwasher', name: 'Tap washer', price: 15, unit: 'each', aliases: ['tap washer', 'tap washers', 'washer', 'washers'] },
    { key: 'smoke', name: 'Smoke alarm', price: 65, unit: 'each', aliases: ['smoke alarm', 'smoke alarms', 'smoke detector', 'smoke detectors'] },
  ];

  /* ---------- number words -> digits ---------- */
  const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const isNumWord = w => w in UNITS || w in TEENS || w in TENS || w === 'hundred' || w === 'thousand' || w === 'grand';

  /* group a run of number words into "chunks" (1-99 values or multipliers) */
  function runToNumber(words) {
    // chunks: values < 100 built from tens+units, or 'hundred'/'thousand' markers
    const chunks = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w === 'and' || w === 'a') continue;
      if (w === 'hundred' || w === 'thousand' || w === 'grand') { chunks.push(w === 'grand' ? 'thousand' : w); continue; }
      let v = w in UNITS ? UNITS[w] : w in TEENS ? TEENS[w] : TENS[w];
      if (w in TENS && i + 1 < words.length && words[i + 1] in UNITS && UNITS[words[i + 1]] > 0) { v += UNITS[words[i + 1]]; i++; }
      chunks.push(v);
    }
    const hasMult = chunks.some(c => typeof c === 'string');
    const vals = chunks.filter(c => typeof c === 'number');
    // colloquial prices: "two fifty" = 250, "four eighty five" = 485, "eleven fifty" = 1150, "ninety five fifty" = 95.50
    if (!hasMult && vals.length === 2 && vals[1] >= 10) return vals[0] < 20 ? vals[0] * 100 + vals[1] : r2(vals[0] + vals[1] / 100);
    if (!hasMult && vals.length > 1) return null; // e.g. digit strings like "one two three": leave alone
    let total = 0, cur = 0;
    for (const c of chunks) {
      if (c === 'hundred') cur = (cur || 1) * 100;
      else if (c === 'thousand') { total += (cur || 1) * 1000; cur = 0; }
      else if (cur && cur % 100 === 0 && c < 100) cur += c;      // "one hundred twenty"
      else if (cur >= 100 && cur % 100 && c < 100) return null;
      else cur = cur * (cur ? 100 : 1) + c;                         // "twelve hundred" handled via 'hundred'
    }
    return total + cur;
  }

  function wordsToNumbers(text) {
    let t = ' ' + String(text || '') + ' ';
    t = t.replace(/[\u2018\u2019]/g, "'").replace(/\b(\d+)\s*k\b/gi, (m, n) => String(+n * 1000));
    t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)\b/gi, '$1 $2');   // eighty-five
    // fractions & idioms first
    t = t.replace(/\b(a|one)\s+and\s+a\s+half\s+hours?\b/gi, '1.5 hours')
      .replace(/\ban?\s+hour\s+and\s+a\s+half\b/gi, '1.5 hours')
      .replace(/\bhalf\s+an?\s+hour\b/gi, '0.5 hours').replace(/\ba\s+half\s+hour\b/gi, '0.5 hours').replace(/\bhalf\s+hour\b/gi, '0.5 hours')
      .replace(/\b(an?|one)\s+hour\s+and\s+a\s+quarter\b/gi, '1.25 hours').replace(/\bquarter\s+of\s+an\s+hour\b/gi, '0.25 hours')
      .replace(/\ba\s+couple\s+(of\s+)?/gi, 'two ').replace(/\ba\s+few\s+/gi, 'three ').replace(/\ba\s+dozen\b/gi, 'twelve')
      .replace(/\b(\d+(?:\.\d+)?)\s+and\s+a\s+half\b/gi, (m, n) => String(+n + 0.5));
    const toks = t.split(/(\s+)/);
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const raw = toks[i]; const m = raw.match(/^([a-zA-Z-]+)([.,;:!?]*)$/);
      const w = m ? m[1].toLowerCase() : '';
      const startsRun = m && (isNumWord(w) || (w === 'a' && /^\s*(hundred|thousand|grand)\b/i.test(toks.slice(i + 1).join(''))));
      if (!startsRun) { out.push(raw); continue; }
      // collect run (words separated by whitespace; 'and' only after hundred/thousand)
      const words = [w]; let j = i, punct = m[2], lastIdx = i;
      while (!punct) {
        const sp = toks[j + 1], nx = toks[j + 2]; if (sp === undefined || nx === undefined || !/^\s+$/.test(sp)) break;
        const mm = nx.match(/^([a-zA-Z-]+)([.,;:!?]*)$/); if (!mm) break;
        const nw = mm[1].toLowerCase();
        if (nw === 'and') {
          const prev = words[words.length - 1]; const after = toks[j + 4]; const am = after && after.match(/^([a-zA-Z-]+)/);
          if (!(prev === 'hundred' || prev === 'thousand' || prev === 'grand') || !am || !isNumWord(am[1].toLowerCase()) || ['hundred', 'thousand'].includes(am[1].toLowerCase())) break;
        } else if (!isNumWord(nw)) break;
        words.push(nw); j += 2; lastIdx = j; punct = mm[2];
      }
      // "point five"
      let dec = '';
      if (!punct && toks[j + 2] && /^point$/i.test(toks[j + 2])) {
        let k = j + 4; const ds = [];
        while (toks[k] && /^[a-zA-Z]+[.,]?$/.test(toks[k]) && toks[k].replace(/[.,]$/, '').toLowerCase() in UNITS) { ds.push(UNITS[toks[k].replace(/[.,]$/, '').toLowerCase()]); lastIdx = k; if (/[.,]$/.test(toks[k])) { punct = toks[k].slice(-1); break; } k += 2; }
        if (ds.length) dec = '.' + ds.join('');
      }
      const n = runToNumber(words);
      if (n === null) { out.push(raw); continue; }
      out.push(String(n) + dec + (punct || '')); i = lastIdx;
    }
    // "2 fifty" style mixes and digit "2 50" left as-is; tidy "$ 250" -> "$250", "1,200" -> "1200"
    return out.join('').replace(/\$\s+(\d)/g, '$$$1').replace(/(\d),(\d{3})\b/g, '$1$2')
      .replace(/\b(\d+(?:\.\d+)?)\s+and\s+a\s+half\b/gi, (m, n) => String(+n + 0.5)).trim();
  }

  /* ---------- helpers ---------- */
  const STREET = '(?:street|st|road|rd|avenue|ave|av|crescent|cres|court|ct|drive|dr|place|pl|parade|pde|highway|hwy|lane|ln|way|terrace|tce|close|cl|boulevard|blvd|grove|gr|circuit|cct|square|sq|esplanade|esp)';
  const STOP_NAME = new Set(['the', 'a', 'an', 'job', 'invoice', 'labour', 'labor', 'parts', 'materials', 'call', 'callout', 'hours', 'hour', 'gst', 'today', 'yesterday', 'this', 'that', 'it', 'me', 'him', 'her', 'them', 'us', 'my', 'his', 'their', 'work', 'some', 'new', 'for', 'at', 'to', 'on', 'in', 'and', 'from', 'with']);
  const cap = s => s.replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
  const MONEY_SUFFIX = '(?:\\s*(?:dollars?|bucks|aud|quid))';

  function findMoney(s) {
    // returns [{v, i, len, explicit}] ; explicit = had $ or dollars/bucks
    const out = []; const re = new RegExp('(\\$)?(\\d+(?:\\.\\d{1,2})?)(' + MONEY_SUFFIX + ')?', 'gi'); let m;
    while ((m = re.exec(s))) {
      const after = s.slice(m.index + m[0].length);
      if (!m[1] && !m[3] && /^\s*(?:%|percent|hours?|hrs?|h\b|mins?|minutes?|x\b|times|of\s+(?:them|those)|metres?|meters?|m\b|days?|weeks?)/i.test(after)) continue;
      out.push({ v: +m[2], i: m.index, len: m[0].length, explicit: !!(m[1] || m[3]) });
    }
    return out;
  }

  function matchPrice(clause, prices) {
    let best = null;
    for (const p of prices) for (const a of [p.name, ...(p.aliases || [])]) {
      const re = new RegExp('\\b' + a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]*') + 's?\\b', 'i');
      const m = clause.match(re); if (m && (!best || m[0].length > best.m[0].length)) best = { p, m };
    }
    return best;
  }

  /* ---------- main ---------- */
  function parseJob(text, opts = {}) {
    const prices = (opts.prices && opts.prices.length ? opts.prices : DEFAULT_PRICES);
    const customers = opts.customers || [];
    const gstRate = opts.gstRate ?? 0.1;
    const original = String(text || '').trim();
    let t = wordsToNumbers(original).replace(/\s+/g, ' ');
    // mid-sentence corrections: "two hours, no wait, three hours" -> "three hours"
    t = t.replace(/\b\d+(?:\.\d+)?(\s+[a-z]+)?\s*,?\s*(?:no,?\s+wait|no,?\s+sorry|sorry|i mean|or rather|actually|nah)\s*,?\s+(\d+(?:\.\d+)?)(\s+[a-z]+)?/gi, (m, u1, n2, u2) => n2 + (u2 || u1 || ''));
    const warnings = [];
    const draft = { customer: { name: '', address: '', email: '', id: '', isNew: false }, items: [], workDone: '', notes: '', dueDays: null, gstIncluded: false, noGst: false, raw: original, normalised: t };
    const priceOf = key => prices.find(p => p.key === key) || DEFAULT_PRICES.find(p => p.key === key);

    /* GST flags */
    if (/\b(no gst|gst[ -]?free|without gst|ex(?:clude|cluding)? gst and no gst)\b/i.test(t)) draft.noGst = true;
    if (/\b(all )?(prices?|that'?s|it'?s)?\s*(inc|incl|including|includes|inclusive of)\.?\s+gst\b/i.test(t)) draft.gstIncluded = true;
    t = t.replace(/\b(?:all\s+)?(?:(?:the\s+)?prices?\s+)?(?:are\s+|is\s+)?(?:inc|incl|including|includes|inclusive of)\.?\s+gst\b|\b(plus|\+)\s+gst\b|\b(no gst|gst[ -]?free|without gst)\b|\b(inc|incl|including|includes|inclusive of)\.?\s+gst\b|\bex\.?\s+gst\b/gi, ' ');

    /* due date */
    let m = t.match(/\bdue (?:in )?(\d+) days?\b/i) || t.match(/\b(\d+) day terms\b/i); if (m) { draft.dueDays = +m[1]; t = t.replace(m[0], ' '); }
    else if ((m = t.match(/\bdue (?:in )?(?:a|one) week\b/i))) { draft.dueDays = 7; t = t.replace(m[0], ' '); }
    else if ((m = t.match(/\bdue (?:in )?(\d+) weeks?\b/i))) { draft.dueDays = 7 * +m[1]; t = t.replace(m[0], ' '); }

    /* email */
    m = t.match(/\b([\w.+-]+@[\w-]+\.[\w.]+)\b/); if (m) { draft.customer.email = m[1]; t = t.replace(m[0], ' '); }

    /* customer + address: "for Dave at 12 Smith St", "invoice Sharon Smith, 4 Beach Rd Manly", "job at 7 King St for Mrs Jones" */
    const addrRe = new RegExp('\\b(?:at|on|in|from)?\\s*((?:unit\\s+\\d+\\w?\\s*[,/]?\\s*)?\\d+\\w?(?:/\\d+)?\\s+(?:[A-Za-z\']+\\s+){1,3}' + STREET + ')\\b\\.?(?:\\s*,?\\s*(?:in\\s+)?((?!(?:and|for|replaced|fixed|installed|did|three|plus|then|labour|parts)\\b)[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?))?', 'i');
    m = t.match(addrRe);
    if (m) {
      let a = m[1].replace(/\s+/g, ' ').trim(); a = cap(a.toLowerCase()).replace(/\b(St|Rd|Ave|Dr|Ct|Pl|Pde|Hwy|Ln|Tce|Cl|Cres|Gr|Cct|Sq|Esp)\b\.?/g, '$1');
      let end = m.index + m[0].length;
      if (m[2] && /^[A-Z]/.test(m[2]) && !STOP_NAME.has(m[2].toLowerCase())) a += ', ' + m[2];
      else if (m[2]) end = m.index + m[0].indexOf(m[1]) + m[1].length;
      draft.customer.address = a; t = t.slice(0, m.index) + ' ' + t.slice(end);
    }
    const nameRe = /\b(?:for|invoice|bill|charge|customer(?: is|'s)?|client(?: is)?|job for)\s+((?:mr|mrs|ms|miss|dr)\.?\s+)?([A-Za-z'][a-z'A-Z]+)(\s+[A-Z][a-z'A-Z]+)?(?:'s(?:\s+place|\s+house|\s+joint)?)?/;
    let nm = null; const re2 = new RegExp(nameRe.source, 'gi'); let mm;
    while ((mm = re2.exec(t))) { const first = mm[2].toLowerCase(); if (STOP_NAME.has(first) || /^\d/.test(first)) { re2.lastIndex = mm.index + mm[0].split(/\s+/)[0].length; continue; } if (/^(for)$/i.test(mm[0].split(/\s/)[0]) && /^(the|a|an|parts|labour)$/i.test(first)) continue; nm = mm; break; }
    if (nm) {
      let second = nm[3] ? nm[3].trim() : '';
      if (second && (STOP_NAME.has(second.toLowerCase()) || !/^[A-Z]/.test(second))) { second = ''; nm[0] = nm[0].replace(/\s+\S+$/, ''); }
      const title = nm[1] ? cap(nm[1].replace('.', '').trim().toLowerCase()) + ' ' : '';
      draft.customer.name = (title + cap(nm[2].toLowerCase()) + (second ? ' ' + cap(second.toLowerCase()) : '')).trim();
      t = t.replace(nm[0], ' ');
    }
    if (!draft.customer.name) {   // "Mick at 18 Banksia Rd, ..." (name first, no keyword)
      const lead = original.match(/^\s*(?:(?:um+|uh+|er+|yeah|ok|right|so)[\s,]+)*([A-Z][a-z']+)(\s+[A-Z][a-z']+)?\s*,?\s+(?:at|on|from)\s+(?:unit\s+)?\d/);
      if (lead && !STOP_NAME.has(lead[1].toLowerCase()) && !/^(Invoice|Job|Bill|Charge|Customer|Client)$/.test(lead[1])) { draft.customer.name = lead[1] + (lead[2] || ''); t = t.replace(new RegExp('^\\s*(?:(?:um+|uh+|er+|yeah|ok|right|so)[\\s,]+)*' + draft.customer.name), ' '); }
    }
    if (draft.customer.name) {
      const low = draft.customer.name.toLowerCase();
      const hit = customers.find(c => (c.name || '').toLowerCase() === low) || customers.find(c => (c.name || '').toLowerCase().split(' ')[0] === low.split(' ')[0] && (!draft.customer.address || !c.address || c.address.toLowerCase().startsWith(draft.customer.address.toLowerCase().split(',')[0])));
      if (hit) { draft.customer.id = hit.id; draft.customer.name = hit.name || draft.customer.name; draft.customer.address = draft.customer.address || hit.address || ''; draft.customer.email = draft.customer.email || hit.email || ''; }
      else draft.customer.isNew = true;
    } else warnings.push('No customer name heard. Add one before confirming.');

    /* labour: hours + rate (anywhere in the sentence) */
    let hours = 0, rate = null, labourTotal = null;
    const hrRe = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/gi; let hm; const hourSpans = [];
    while ((hm = hrRe.exec(t))) { hours += +hm[1]; hourSpans.push(hm[0]); }
    const minRe = /(\d+)\s*(?:minutes?|mins?)\b/gi; while ((hm = minRe.exec(t))) { hours += +hm[1] / 60; hourSpans.push(hm[0]); }
    if (!hours && /\b(an|one) hour\b(?! rate)/i.test(t.replace(new RegExp('\\d+(?:\\.\\d+)?' + MONEY_SUFFIX + '?\\s*(?:an|a|per|/)\\s*hour', 'gi'), ''))) { hours = 1; hourSpans.push(t.match(/\b(an|one) hour\b/i)[0]); }
    const rateM = t.match(new RegExp('\\$?(\\d+(?:\\.\\d+)?)' + MONEY_SUFFIX + '?\\s*(?:an|a|per|/|p/?)\\s*(?:hour|hr|h)\\b', 'i')) || t.match(/\b(?:hourly rate|rate)\s*(?:of|is|at)?\s*\$?(\d+(?:\.\d+)?)/i);
    if (rateM) { rate = +rateM[1]; t = t.replace(rateM[0], ' '); }
    for (const s of hourSpans) t = t.replace(s, ' ');
    hours = r2(hours);
    if (hours && rate === null) {
      // "3 hours labour at 95" or "labour 285" (total)
      const lm = t.match(/\blabou?r\b[^,.;]*?\b(?:at|@)\s*\$?(\d+(?:\.\d+)?)/i) || t.match(/\b(?:at|@)\s*\$?(\d+(?:\.\d+)?)\s*(?:dollars|bucks)?\s*(?:labou?r)?\b(?!\s*(?:for|the))/i);
      if (lm && !/call|part|material/i.test(lm[0])) { rate = +lm[1]; t = t.replace(lm[0], ' labour '); }
      else { const lt = t.match(/\blabou?r\b\s*(?:was|is|of|came to|comes to|for|:)?\s*\$?(\d+(?:\.\d+)?)(?:\s*(?:dollars|bucks))?/i); if (lt) { labourTotal = +lt[1]; t = t.replace(lt[0], ' '); } }
    }
    if (hours) {
      const lp = priceOf('labour');
      if (labourTotal !== null) draft.items.push({ desc: `Labour (${hours} hour${hours === 1 ? '' : 's'})`, qty: 1, unit: 'each', price: labourTotal, source: 'spoken' });
      else draft.items.push({ desc: 'Labour', qty: hours, unit: 'hour', price: rate !== null ? rate : num(lp && lp.price), source: rate !== null ? 'spoken' : 'price list' });
    } else if (rate !== null) warnings.push('Heard a rate of $' + rate + '/hour but no hours.');
    t = t.replace(/\blabou?r\b/gi, ' ');

    /* speech often has no punctuation: start a new clause at charge keywords and work verbs */
    t = t.replace(/\s+(?=(?:parts?|materials?|call[\s-]?outs?|callout|replaced|replace|fixed|installed|repaired|unblocked|cleared|serviced|swapped|fitted|supplied|changed|checked|put in)\b)/gi, ', ');
    /* split the rest into clauses */
    const clauses = t.split(/\s*(?:[,;!?]|\.(?!\d)|\band\b|\bplus\b|\bthen\b|\balso\b|\bwith\b|\+)\s*/i).map(s => s.trim()).filter(Boolean);
    const work = [];
    for (let c of clauses) {
      c = c.replace(/^(?:(?:um+|uh+|er+|ah+|so|ok(?:ay)?|right|yeah|mate|look|invoice|job|bill|quote|new invoice)\b\s*)+/gi, '').replace(/\b(?:um+|uh+|er+)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      if (!c) continue;
      const money = findMoney(c);
      let amt = null, qty = 1;
      const pm = matchPrice(c, prices);
      if (/\bcall[\s-]?out\b|\bcallout\b|\bservice call\b|\btravel fee\b|\battendance fee\b/i.test(c)) {
        const p = priceOf('callout'); amt = money.length ? money[money.length - 1].v : null;
        draft.items.push({ desc: p ? p.name : 'Call-out fee', qty: 1, unit: 'each', price: amt ?? num(p && p.price), source: amt !== null ? 'spoken' : 'price list' }); continue;
      }
      if (pm && pm.p.key !== 'labour') {
        // qty = a number right before the item name; price = another number (or $/bucks)
        const before = c.slice(0, pm.m.index).match(/(\d+)\s*(?:x\s*)?(?:new\s+)?$/i);
        if (before) qty = +before[1];
        const rest = money.filter(x => !(before && x.i === c.slice(0, pm.m.index).lastIndexOf(before[1])));
        const xm = c.match(/\b(\d+)\s*(?:x|times)\b/i); if (xm && !before) qty = +xm[1];
        amt = rest.filter(x => !xm || x.v !== +xm[1]).map(x => x.v).pop() ?? null;
        // spoken amount for several items is usually the line total unless "each"
        let price = amt !== null ? (qty > 1 && !/\beach\b|\bper\b|\ba piece\b/i.test(c) ? r2(amt / qty) : amt) : num(pm.p.price);
        draft.items.push({ desc: pm.p.name, qty, unit: pm.p.unit || 'each', price, source: amt !== null ? 'spoken' : 'price list' });
        if (/\b(replac|install|fit|suppl|swap|chang|put in|new)\w*/i.test(c)) work.push(c);
        continue;
      }
      if (/\b(parts?|materials?|bits and pieces|consumables|sundries|fittings)\b/i.test(c)) {
        amt = money.length ? money[money.length - 1].v : null;
        const label = (c.match(/\b(parts?|materials?|consumables|sundries|fittings)\b/i) || ['Parts'])[0];
        const what = c.replace(/\$?\d+(?:\.\d+)?(?:\s*(?:dollars?|bucks))?/gi, '').replace(/\b(?:for|was|were|is|are|came to|come to|cost|costs|of|at|the|in|about|around|roughly|total|worth|on)\b/gi, ' ').replace(/\s+/g, ' ').trim();
        const desc = what && what.toLowerCase() !== label.toLowerCase() && what.length < 40 ? cap(what) : cap(label.toLowerCase().replace(/s?$/, 's')).replace('Materialss', 'Materials');
        if (amt === null) { warnings.push(`No price heard for "${desc}".`); }
        draft.items.push({ desc: desc || 'Parts', qty: 1, unit: 'each', price: amt ?? 0, source: amt !== null ? 'spoken' : 'none' }); continue;
      }
      if (money.length) {
        const x = money[money.length - 1];
        let desc = (c.slice(0, x.i) + ' ' + c.slice(x.i + x.len)).replace(/\b(?:charge|charged|for|was|is|it'?s|came to|cost|costs|of|at|the|about|around|that|put|on|add|bill|a|an)\b/gi, ' ').replace(/\s+/g, ' ').trim();
        if (!desc || desc.length < 2) desc = 'Item';
        const qm = desc.match(/^(\d+)\s+(.*)$/); if (qm) { qty = +qm[1]; desc = qm[2]; }
        draft.items.push({ desc: cap(desc.charAt(0)) + desc.slice(1), qty, unit: 'each', price: qty > 1 && !/\beach\b/i.test(c) ? r2(x.v / qty) : x.v, source: 'spoken' }); continue;
      }
      // no money: description of the work
      if (c.split(' ').length >= 2 && !/^(?:yes|yep|no|that'?s it|that'?s all|cheers|thanks|done)$/i.test(c)) work.push(c);
    }
    if (work.length) {
      draft.workDone = work.map(w => w.replace(/\s*(?:for\s+)?\$?\d+(?:\.\d+)?\s*(?:dollars?|bucks)?\s*$/i, '').replace(/\s*\b(?:that'?s|it'?s|it was)\s*$/i, '').trim()).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('. ').replace(/\s+/g, ' ');
      const lab = draft.items.find(i => /^Labour/.test(i.desc)); if (lab) lab.details = draft.workDone;
    }

    /* GST + totals */
    for (const it of draft.items) {
      it.gst = !draft.noGst;
      if (draft.gstIncluded && it.source === 'spoken' && it.gst) it.price = r2(it.price / (1 + gstRate));
      it.qty = r2(it.qty); it.price = r2(it.price);
    }
    Object.assign(draft, totals(draft.items, gstRate));
    if (!draft.items.length) warnings.push('No charges heard. Add a line before confirming.');
    draft.warnings = warnings;
    return draft;
  }
  function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function totals(items, gstRate = 0.1) {
    let sub = 0, gst = 0;
    for (const it of items) { const net = r2(num(it.qty) * num(it.price)); sub += net; if (it.gst) gst += r2(net * gstRate); }
    sub = r2(sub); gst = r2(gst);
    return { subtotal: sub, gst, total: r2(sub + gst) };
  }

  const api = { parseJob, wordsToNumbers, totals, matchPrice, DEFAULT_PRICES };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.IMParser = api;
})(typeof self !== 'undefined' ? self : this);
