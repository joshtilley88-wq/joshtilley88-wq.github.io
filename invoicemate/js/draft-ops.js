/* InvoiceMate: the invoice draft as tool operations. Both cloud voice engines (Live/Realtime and Chained) change the
 * draft ONLY through these ops: set_customer, add_item, update_item, remove_item, set_email (confirm_send is handled by
 * the controller, which does the real saving/sending). The draft is the same structure the local parser makes
 * (IMParser.parseJob), so saving, totals and the read-back are shared with the local engine.
 * Browser: window.IMDraftOps. Node: require. */
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const P = node ? require('./parser.js') : root.IMParser;
  const C = node ? require('./convo.js') : root.IMConvo;
  const r2 = n => Math.round((+n || 0) * 100) / 100;
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const cap = s => String(s || '').trim().replace(/\s+/g, ' ').replace(/^./, c => c.toUpperCase());

  function newDraft() { return { customer: { name: '', address: '', email: '', id: '', isNew: false }, items: [], workDone: '', notes: '', dueDays: null, gstIncluded: false, noGst: false, warnings: [] }; }
  const pricesOf = ctx => (ctx && ctx.prices && ctx.prices.length ? ctx.prices : P.DEFAULT_PRICES);
  const isLabour = (desc, unit) => unit === 'hour' || /^(labou?r|time|hours?|my time)\b/i.test(String(desc || '').trim());

  function lineRef(d, ref, ctx) {
    const s = String(ref ?? '').trim(); if (!s) return -1;
    if (/^\d+$/.test(s)) { const i = +s - 1; return i >= 0 && i < d.items.length ? i : -1; }
    const i = C.findItem(d.items, s, pricesOf(ctx)); if (i >= 0) return i;
    const w = s.toLowerCase().replace(/s$/, ''); return d.items.findIndex(it => it.desc.toLowerCase().includes(w));
  }
  function cleanEmail(e) {
    let s = String(e || '').trim().toLowerCase().replace(/^mailto:/, '').replace(/[\s,]+/g, '');
    if (!s.includes('@') && / at /.test(String(e))) s = C.spokenEmail(e) || s;
    if (/^[^@]+@[a-z0-9-]+$/.test(s)) s = C.spokenEmail(s.replace('@', ' at ')) || s;
    return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s) ? s : '';
  }

  /* apply one op -> { ok, note } (note is a short machine note for the model / logs) */
  function apply(d, op, ctx) {
    const a = (op && op.args) || {}, gstRate = ctx && ctx.gstRate !== undefined ? ctx.gstRate : 0.1;
    switch (op && op.tool) {
      case 'set_customer': {
        const name = cap(String(a.name || '').replace(/[.,!?]+$/, '')).replace(/\b[a-z]/g, c => c.toUpperCase()); if (!name) return { ok: false, note: 'name missing' };
        d.customer.name = name; if (a.address) d.customer.address = cap(a.address).replace(/\b[a-z]/g, c => c.toUpperCase());
        const hit = ((ctx && ctx.customers) || []).find(x => String(x.name || '').toLowerCase() === name.toLowerCase());
        if (hit) { d.customer.id = hit.id; d.customer.email = d.customer.email || hit.email || ''; d.customer.address = d.customer.address || hit.address || ''; }
        return { ok: true, note: hit ? 'existing customer' + (hit.email ? ' (email on file)' : '') : 'new customer' };
      }
      case 'add_item': {
        let desc = cap(a.description || 'Item'); const unitIn = a.unit === 'hour' || isLabour(desc, a.unit) ? 'hour' : 'each';
        let qty = a.quantity === undefined || a.quantity === null || a.quantity === '' ? (unitIn === 'hour' ? 0 : 1) : num(a.quantity);
        let price = a.unit_price === undefined || a.unit_price === null || a.unit_price === '' ? null : num(a.unit_price), source = price === null ? 'price list' : 'spoken';
        let unit = unitIn;
        if (unit === 'hour') desc = 'Labour';
        const pm = P.matchPrice(desc.toLowerCase(), pricesOf(ctx));
        if (pm && unit !== 'hour') { desc = pm.p.name; unit = pm.p.unit === 'hour' ? 'hour' : 'each'; }
        if (price === null) { const lp = unit === 'hour' ? pricesOf(ctx).find(p => p.key === 'labour' || p.unit === 'hour') : pm && pm.p; price = lp ? num(lp.price) : 0; if (!lp) source = 'none'; }
        if (a.price_includes_gst && !d.noGst) price = r2(price / (1 + gstRate));
        const same = d.items.findIndex(it => it.desc === desc && it.unit === unit && r2(it.price) === r2(price));
        if (same >= 0 && unit !== 'hour') { d.items[same].qty = r2(d.items[same].qty + qty); return { ok: true, note: `added to line ${same + 1}` }; }
        if (same >= 0 && unit === 'hour') { d.items[same].qty = qty || d.items[same].qty; return { ok: true, note: `labour set to ${d.items[same].qty} h` }; }
        d.items.push({ desc, qty: r2(qty), unit, price: r2(price), source, gst: !d.noGst });
        return { ok: true, note: `line ${d.items.length}` };
      }
      case 'update_item': {
        const i = lineRef(d, a.item, ctx); if (i < 0) return { ok: false, note: `no line matches "${a.item}"` };
        const it = d.items[i];
        if (a.quantity !== undefined && a.quantity !== null && a.quantity !== '') it.qty = r2(num(a.quantity));
        if (a.unit_price !== undefined && a.unit_price !== null && a.unit_price !== '') { it.price = r2(num(a.unit_price)); it.source = 'spoken'; }
        if (a.description) it.desc = cap(a.description);
        return { ok: true, note: `line ${i + 1} updated` };
      }
      case 'remove_item': {
        const i = lineRef(d, a.item, ctx); if (i < 0) return { ok: false, note: `no line matches "${a.item}"` };
        d.items.splice(i, 1); return { ok: true, note: 'removed' };
      }
      case 'set_email': {
        const e = cleanEmail(a.email); if (!e) return { ok: false, note: `"${a.email}" is not a valid email, ask again` };
        d.customer.email = e; return { ok: true, note: e };
      }
      default: return { ok: false, note: 'unknown tool ' + (op && op.tool) };
    }
  }

  function missing(d) {
    const m = [];
    if (!d.customer.name) m.push('customer name');
    if (!d.items.length) m.push('charges');
    d.items.forEach((it, i) => { if (it.unit === 'hour' && !num(it.qty)) m.push(`hours for line ${i + 1} (${it.desc})`); else if (!num(it.price)) m.push(`price for line ${i + 1} (${it.desc})`); });
    if (!d.customer.email) m.push('email');
    return m;
  }
  /* what the model sees after every op (and what the app shows) */
  function state(d, ctx) {
    const gstRate = ctx && ctx.gstRate !== undefined ? ctx.gstRate : 0.1, t = P.totals(d.items, gstRate);
    return {
      customer: { name: d.customer.name, address: d.customer.address || '', email: d.customer.email || '' },
      lines: d.items.map((it, i) => ({ n: i + 1, description: it.desc, quantity: it.qty, unit: it.unit, unit_price: it.price, line_total: r2(it.qty * it.price) })),
      subtotal: t.subtotal, gst: t.gst, total_inc_gst: t.total, missing: missing(d), readback: C.summary(d, gstRate),
    };
  }
  /* compare a finished draft with a scenario's expected invoice -> { score, checks:[{what, ok, got, want}] } */
  function grade(d, want, gstRate = 0.1) {
    const checks = [], add = (what, ok, got, w) => checks.push({ what, ok: !!ok, got, want: w });
    add('customer', new RegExp('^' + want.customer + '\\b', 'i').test(d.customer.name || ''), d.customer.name, want.customer);
    if (want.email !== undefined) add('email', (d.customer.email || '') === want.email, d.customer.email, want.email);
    const used = new Set();
    for (const w of want.items) {
      const i = d.items.findIndex((it, k) => !used.has(k) && new RegExp(w.match, 'i').test(it.desc));
      const it = i >= 0 ? d.items[i] : null; if (i >= 0) used.add(i);
      add(`item ${w.match}`, it && r2(it.qty) === r2(w.qty) && r2(it.price) === r2(w.price), it ? `${it.desc} ${it.qty} x ${it.price}` : 'missing', `${w.qty} x ${w.price}`);
    }
    add('no extra items', d.items.length === want.items.length, d.items.length, want.items.length);
    const tot = P.totals(d.items, gstRate).total; add('total', r2(tot) === r2(want.total), tot, want.total);
    return { score: checks.filter(c => c.ok).length / checks.length, exact: checks.every(c => c.ok), checks };
  }

  const api = { newDraft, apply, state, missing, grade, cleanEmail };
  if (node) module.exports = api; else root.IMDraftOps = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
