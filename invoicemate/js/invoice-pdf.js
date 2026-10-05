/* InvoiceMate: the invoice as a real PDF (A4, selectable text), attached automatically to every invoice email.
 * Same approach as Allyce's Invoicing app (js/pdf.js there): draw it with the vendored jsPDF (vendor/jspdf.umd.min.js,
 * v4.2.1, MIT), built-in Helvetica (no embedded font, so a PDF is ~5-15 KB plus the logo, which is shrunk first).
 * Layout follows the View / PDF screen: logo or business name, ABN, address, contact, TAX INVOICE + number + dates,
 * orange-to-charcoal band, Bill to, line items, subtotal / GST / total, paid + AMOUNT OWING, pay-online box
 * (placeholder until card payments exist), notes, bank details + reference.
 *
 * Two layers:
 *   draw(jsPDF, model) -> jsPDF doc     PURE: no app globals, so Node tests can run it (tests/pdf.test.js)
 *   InvoicePDF.make(inv) (browser)      builds the model from the app's data, loads jsPDF on demand, returns
 *                                       { filename: 'INV-1021.pdf', blob, base64, bytes }  */
(function (root) {
  'use strict';
  const C = { ink: [43, 47, 54], body: [85, 90, 99], grey: [118, 124, 134], line: [236, 237, 239], orange: [245, 124, 0], orangeD: [217, 106, 0], orangeT: [255, 227, 199], orangeTT: [255, 245, 235], mid: [255, 143, 46], char: [91, 100, 114] };
  /* the built-in PDF fonts only cover Latin-1 (+ a few): map the rest so nothing comes out garbled */
  const OK = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
  function clean(s) {
    return String(s ?? '').replace(/\u2212/g, '-').replace(/[\u2010\u2011]/g, '-').replace(/\u00a0|\u202f/g, ' ').replace(/\t/g, '  ').normalize('NFC').split('')
      .map(ch => (ch.charCodeAt(0) <= 0xff || OK.has(ch)) ? ch : (ch.normalize('NFD')[0].charCodeAt(0) <= 0xff ? ch.normalize('NFD')[0] : '')).join('');
  }
  const fileName = number => clean(String(number || 'invoice')).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') + '.pdf';

  function kit(doc) {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 46;
    const k = { doc, W, H, M, R: W - M, y: M };
    k.font = (size, style = 'normal', col = C.ink) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...col); };
    k.text = (s, x, y, o = {}) => doc.text(clean(s), x, y, o);
    k.wrap = (s, w) => doc.splitTextToSize(clean(s), w);
    k.lh = size => size * 1.42;
    k.hr = (y, col = C.line, w = 0.75, x1 = M, x2 = W - M) => { doc.setDrawColor(...col); doc.setLineWidth(w); doc.line(x1, y, x2, y); };
    k.band = y => {   // orange -> light orange -> charcoal, like the app's --grad
      const n = 80, w = (k.R - M) / n, stops = [[0, C.orange], [0.55, C.mid], [1, C.char]];
      const col = t => { const i = t <= stops[1][0] ? 0 : 1, [t0, c0] = stops[i], [t1, c1] = stops[i + 1], f = (t - t0) / (t1 - t0); return c0.map((v, j) => Math.round(v + (c1[j] - v) * f)); };
      for (let i = 0; i < n; i++) { doc.setFillColor(...col(i / (n - 1))); doc.rect(M + i * w, y, w + 0.6, 4.5, 'F'); }
    };
    k.need = (h, onNew) => { if (k.y + h > H - M - 16) { doc.addPage(); k.y = M; onNew && onNew(); } };
    return k;
  }
  const imgType = d => { const m = /^data:image\/(png|jpe?g)/i.exec(d || ''); return m ? (m[1].toLowerCase().startsWith('jp') ? 'JPEG' : 'PNG') : null; };

  /* model: { number, title, issued, due, overdue?, business:{name, abn, address, email, phone}, logo?, customer:{name, business, address, email, abn},
   *   items:[{desc, details, qty, price, gst, amount}], totals:{sub, gst, total, paid?, owing}, gstOn, notes, bank, payLink?, payments? }  (money already formatted) */
  function draw(jsPDF, m) {
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true }), k = kit(doc), { M, R } = k, b = m.business || {};
    doc.setProperties({ title: `${m.title === 'QUOTE' ? 'Quote' : 'Invoice'} ${clean(m.number)}`, subject: `${m.title} ${clean(m.number)}`, author: clean(b.name || ''), creator: 'InvoiceMate' });
    // ---- header: left = logo / business, right = title + number + dates
    let yl = M; const typ = imgType(m.logo);
    if (typ) {
      try { const pr = doc.getImageProperties(m.logo), s = Math.min(170 / pr.width, 56 / pr.height, 1); doc.addImage(m.logo, typ, M, yl, pr.width * s, pr.height * s, undefined, 'FAST'); yl += pr.height * s + 10; }
      catch (e) { k.font(17, 'bold'); k.text(b.name || 'Your business name', M, yl + 14); yl += 24; }
    } else { k.font(17, 'bold'); k.text(b.name || 'Your business name', M, yl + 14); yl += 26; }
    const lines = []; if (typ && b.name) lines.push(['bold', b.name]); if (b.abn) lines.push(['normal', 'ABN ' + b.abn]);
    for (const a of String(b.address || '').split('\n').filter(x => x.trim())) lines.push(['normal', a]);
    const ce = [b.email, b.phone].filter(Boolean).join('  ·  '); if (ce) lines.push(['normal', ce]);
    for (const [sty, t] of lines) { k.font(9.5, sty, sty === 'bold' ? C.ink : C.body); for (const l of k.wrap(t, 270)) { yl += k.lh(9.5); k.text(l, M, yl - 3); } }
    let yr = M + 22; k.font(22, 'bold', C.orangeD); doc.setCharSpace(0.4); k.text(m.title, R, yr, { align: 'right' }); doc.setCharSpace(0);
    yr += 8;
    for (const [sty, t, col] of [['bold', m.number], ['normal', 'Issued: ' + m.issued], ['normal', 'Due: ' + m.due], ...(m.overdue ? [['bold', 'OVERDUE', C.orangeD]] : [])]) { k.font(9.5, sty, col || C.ink); yr += k.lh(9.5) + 1; k.text(t, R, yr, { align: 'right' }); }
    k.y = Math.max(yl, yr) + 16; k.band(k.y); k.y += 4.5 + 16;
    // ---- bill to (left) + amount owing box (right)
    const cu = m.customer || {}, y0 = k.y;
    if (cu.name || cu.business) {
      k.font(7.5, 'normal', C.grey); doc.setCharSpace(0.6); k.text('BILL TO', M, k.y + 7); doc.setCharSpace(0); k.y += 11;
      const rows = [['bold', cu.business || cu.name]]; if (cu.business && cu.name) rows.push(['normal', cu.name]);
      for (const a of String(cu.address || '').split('\n').filter(x => x.trim())) rows.push(['normal', a]);
      if (cu.email) rows.push(['normal', cu.email]); if (cu.abn) rows.push(['normal', 'ABN ' + cu.abn]);
      for (const [sty, t] of rows) { k.font(9.5, sty); for (const l of k.wrap(t, 280)) { k.y += k.lh(9.5); k.text(l, M, k.y - 3); } }
    }
    if (m.title !== 'QUOTE') {
      const bw = 170, bh = 50, bx = R - bw; doc.setFillColor(...C.orangeTT); doc.setDrawColor(...C.orangeT); doc.setLineWidth(1); doc.roundedRect(bx, y0, bw, bh, 6, 6, 'FD');
      k.font(7.5, 'bold', C.orangeD); doc.setCharSpace(0.6); k.text('AMOUNT OWING', bx + 12, y0 + 16); doc.setCharSpace(0);
      k.font(17, 'bold', C.ink); k.text(m.totals.owing, bx + 12, y0 + 38);
      k.y = Math.max(k.y, y0 + bh);
    }
    k.y += 12;
    // ---- items
    const cols = [['Amount', 74], ['GST', 60], ['Unit price', 74], ['Qty', 40]], xs = []; let x = R;
    for (const [, w] of cols) { xs.push(x); x -= w; } const descW = x - M - 12;
    const head = () => { k.y += 10; k.font(7.5, 'bold', C.grey); doc.setCharSpace(0.4); k.text('DESCRIPTION', M + 4, k.y); cols.forEach(([l], i) => k.text(l.toUpperCase(), xs[i] - 4, k.y, { align: 'right' })); doc.setCharSpace(0); k.y += 7; k.hr(k.y, C.orangeT, 1.5); k.y += 2; };
    head();
    for (const it of m.items || []) {
      k.font(10, 'bold'); const dl = k.wrap(it.desc || '', descW); k.font(8.5); const dd = it.details ? k.wrap(it.details, descW) : [];
      k.need(9 + dl.length * k.lh(10) + dd.length * k.lh(8.5) + 7, head);
      let yy = k.y + 9; k.font(10, 'bold'); dl.forEach(t => { yy += k.lh(10) - 2; k.text(t, M + 4, yy); yy += 2; });
      k.font(8.5, 'normal', C.grey); dd.forEach(t => { yy += k.lh(8.5); k.text(t, M + 4, yy - 1); });
      k.font(10); [it.amount, it.gst || '-', it.price, it.qty].forEach((v, i) => k.text(String(v), xs[i] - 4, k.y + 9 + k.lh(10) - 2, { align: 'right' }));
      k.y = Math.max(yy, k.y + 9 + k.lh(10)) + 7; k.hr(k.y);
    }
    // ---- totals
    const t = m.totals, rows = [[`Subtotal${m.gstOn ? ' (ex GST)' : ''}`, t.sub], ...(m.gstOn ? [['GST 10%', t.gst]] : []), [`Total${m.gstOn ? ' (inc GST)' : ''}`, t.total, 'b']];
    if (m.title !== 'QUOTE' && t.paid) rows.push(['Paid', '-' + t.paid], ['Amount owing', t.owing, 'due']);
    const tx = R - 220; k.y += 10;
    for (const [l, v, s] of rows) {
      const big = s === 'b' || s === 'due', h = big ? 22 : 17; k.need(h + 6);
      if (big) { k.hr(k.y + 2, C.orangeT, 1.5, tx, R); k.y += 6; }
      k.font(big ? 12.5 : 9.5, big ? 'bold' : 'normal', s === 'due' ? C.orangeD : C.ink); k.y += h - 4; k.text(l, tx, k.y); k.text(v, R, k.y, { align: 'right' }); k.y += 4;
    }
    // ---- pay online (placeholder until card payments are switched on)
    if (m.title !== 'QUOTE') {
      k.y += 18; k.need(46); const bh = 40; doc.setFillColor(...C.orangeTT); doc.roundedRect(M, k.y, R - M, bh, 6, 6, 'F');
      k.font(9.5, 'bold', C.orangeD); k.text('Pay online', M + 12, k.y + 16);
      k.font(9.5, 'normal', C.ink);
      if (m.payLink) { doc.setTextColor(...C.orangeD); doc.textWithLink(clean(m.payLink), M + 12, k.y + 30, { url: m.payLink }); }
      else k.text('Card payments coming soon. For now please pay by bank transfer using the details below.', M + 12, k.y + 30);
      k.y += bh;
    }
    // ---- footer: notes / terms, bank details + reference, payments
    const fb = []; if (m.notes) fb.push({ t: m.notes }); if (m.bank) fb.push({ t: m.bank + '\nReference: ' + m.number, bold1: true });
    if (m.payments) fb.push({ t: m.payments, size: 8.5, col: C.grey });
    if (fb.length) {
      k.y += 20; k.need(30); k.hr(k.y); k.y += 6;
      for (const bl of fb) { const sz = bl.size || 9.5; String(bl.t).split('\n').forEach((ln, i) => { k.font(sz, bl.bold1 && i === 0 ? 'bold' : 'normal', bl.col || C.body); for (const w of k.wrap(ln || ' ', R - M)) { k.need(k.lh(sz)); k.y += k.lh(sz); k.text(w, M, k.y - 3); } }); k.y += 8; }
    }
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) { doc.setPage(i); k.font(7.5, 'normal', C.grey); k.text(`${clean(m.number)}${n > 1 ? `  ·  Page ${i} of ${n}` : ''}`, R, k.H - 24, { align: 'right' }); }
    return doc;
  }
  const api = { draw, fileName, clean };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.IMInvoicePdf = api;

  /* ---------------- browser glue ---------------- */
  let loading = null;
  function loadJsPDF() {
    if (root.jspdf && root.jspdf.jsPDF) return Promise.resolve();
    if (!loading) loading = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'vendor/jspdf.umd.min.js'; s.onload = () => ok(); s.onerror = () => { loading = null; s.remove(); no(new Error('Couldn’t load the PDF maker')); }; document.head.appendChild(s); });
    return loading;
  }
  /* a big logo would make every PDF big: shrink it once (max 360 x 120 px), cached per logo */
  let logoCache = { src: null, out: null };
  function smallLogo(src) {
    if (!src || !/^data:image\//.test(src)) return Promise.resolve(null);
    if (logoCache.src === src) return Promise.resolve(logoCache.out);
    return new Promise(ok => {
      const img = new Image();
      img.onload = () => {
        try {
          const s = Math.min(360 / img.width, 120 / img.height, 1), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          let out = c.toDataURL('image/png'); if (out.length > 60000) { const g = c.getContext('2d'); g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); out = c.toDataURL('image/jpeg', 0.85); }
          logoCache = { src, out }; ok(out);
        } catch (e) { ok(null); }
      };
      img.onerror = () => ok(null); img.src = src;
    });
  }
  const InvoicePDF = {
    /* everything the PDF shows, from the app's data (amount owing = total minus payments recorded so far) */
    model(inv, logo) {
      const c = invCalc(inv), cu = byId('customers', inv.customerId) || {}, b = S.settings.business || {}, isQ = inv.kind === 'quote';
      const gstOn = b.gstRegistered !== false && c.gst > 0, pays = S.payments.filter(p => p.invoiceId === inv.id);
      return {
        number: inv.number, title: isQ ? 'QUOTE' : gstOn ? 'TAX INVOICE' : 'INVOICE', issued: fmtD(inv.issueDate), due: fmtD(inv.dueDate),
        overdue: !isQ && c.balance > 0.004 && inv.dueDate && inv.dueDate < today(),
        business: { name: b.name || b.tradingName || '', abn: b.abn || '', address: b.address || '', email: b.email || '', phone: b.phone || '' }, logo: logo || null,
        customer: { name: cu.name || '', business: cu.business || '', address: cu.address || '', email: cu.email || '', abn: cu.abn || '' },
        items: (inv.items || []).map(it => { const l = lineCalc(it); return { desc: it.desc || '', details: it.details || '', qty: String(+num(it.qty).toFixed(3)), price: money(it.price), gst: it.gst ? money(l.gst) : '', amount: money(l.net) }; }),
        totals: { sub: money(c.sub), gst: money(c.gst), total: money(c.total), paid: c.paid ? money(c.paid) : '', owing: money(Math.max(0, c.balance)) }, gstOn,
        notes: inv.notes || b.paymentTerms || '', bank: isQ ? '' : bankDetails(), payLink: b.payLink || '',
        payments: pays.length && !isQ ? 'Payments received: ' + pays.map(p => fmtD(p.date) + ' ' + money(p.amount)).join(', ') : '',
      };
    },
    /* what decides whether a stored PDF is still up to date (amount owing, items, business details, logo ...) */
    key(inv) {
      const m = this.model(inv, null), s = JSON.stringify([1, m, (S.settings.logo || '').length, today() > (inv.dueDate || '9')]);
      let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      return h.toString(16).padStart(8, '0') + s.length.toString(16);
    },
    async make(inv) {
      await loadJsPDF();
      const logo = await smallLogo(S.settings.logo), doc = draw(root.jspdf.jsPDF, this.model(inv, logo));
      const ab = doc.output('arraybuffer'), u8 = new Uint8Array(ab); let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return { filename: fileName(inv.number), blob: new Blob([ab], { type: 'application/pdf' }), base64: btoa(bin), bytes: u8.length };
    },
  };
  root.InvoicePDF = InvoicePDF;
})(typeof globalThis !== 'undefined' ? globalThis : this);
