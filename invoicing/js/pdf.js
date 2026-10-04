/* Invoicing: PDF of the formal invoice / receipt (same layout as View / Print), drawn with the vendored jsPDF
 * so the text is real, selectable text. Loaded on demand; works offline (the library is in the SW cache). */
'use strict';
let JSPDF_P = null;
function loadJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
  if (!JSPDF_P) JSPDF_P = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'js/vendor/jspdf.umd.min.js'; s.onload = () => ok(); s.onerror = () => { JSPDF_P = null; s.remove(); no(new Error('Couldn\'t load the PDF maker')); }; document.head.appendChild(s); });
  return JSPDF_P;
}
/* built-in PDF fonts only cover Latin-1 + a few extras: map the rest so nothing comes out garbled */
const PDF_OK = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
function pdfText(s) {
  return String(s ?? '').replace(/\u2212/g, '-').replace(/[\u2010\u2011]/g, '-').replace(/\u00a0|\u202f/g, ' ').replace(/[\u2032]/g, "'").replace(/\t/g, '  ')
    .normalize('NFC').split('').map(ch => (ch.charCodeAt(0) <= 0xff || PDF_OK.has(ch)) ? ch : (ch.normalize('NFD')[0].charCodeAt(0) <= 0xff ? ch.normalize('NFD')[0] : '')).join('');
}
const pdfName = s => pdfText(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
function invoicePdfName(inv) { const b = S.settings.business; return pdfName(`${inv.kind === 'quote' ? 'Quote' : 'Invoice'} ${inv.number}${b.name ? ' - ' + b.name : ''}`) + '.pdf'; }
function receiptNo(p) { const inv = byId('invoices', p.invoiceId); const idx = S.payments.filter(x => x.invoiceId === inv.id).sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id)).findIndex(x => x.id === p.id) + 1; return `R-${inv.number}-${idx}`; }
function receiptPdfName(p) { const b = S.settings.business; return pdfName(`Receipt ${receiptNo(p)}${b.name ? ' - ' + b.name : ''}`) + '.pdf'; }

/* ---- small drawing kit (points, A4) ---- */
const PDF_C = { ink: [34, 34, 34], grey: [119, 119, 119], grey2: [136, 136, 136], body: [85, 85, 85], line: [238, 238, 238], pinkT: [249, 213, 229], pinkD: [208, 69, 133], pink: [232, 93, 154], mid: [184, 108, 192], lav: [155, 123, 212] };
function pdfKit(doc) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48;
  const k = { doc, W, H, M, R: W - M, y: M };
  k.font = (size, style = 'normal', col = PDF_C.ink) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...col); };
  k.text = (s, x, y, o = {}) => doc.text(pdfText(s), x, y, o);
  k.wrap = (s, w) => doc.splitTextToSize(pdfText(s), w);
  k.lh = size => size * 1.45;
  k.hr = (y, col = PDF_C.line, w = 0.75, x1 = M, x2 = W - M) => { doc.setDrawColor(...col); doc.setLineWidth(w); doc.line(x1, y, x2, y); };
  k.band = y => {   // the pink → lavender gradient strip
    const n = 90, w = (k.R - M) / n, stops = [[0, PDF_C.pink], [0.55, PDF_C.mid], [1, PDF_C.lav]];
    const col = t => { let i = t <= stops[1][0] ? 0 : 1; const [t0, c0] = stops[i], [t1, c1] = stops[i + 1]; const f = (t - t0) / (t1 - t0); return c0.map((v, j) => Math.round(v + (c1[j] - v) * f)); };
    for (let i = 0; i < n; i++) { doc.setFillColor(...col(i / (n - 1))); doc.rect(M + i * w, y, w + 0.6, 4.5, 'F'); }
  };
  k.need = (h, onNew) => { if (k.y + h > H - M - 14) { doc.addPage(); k.y = M; onNew && onNew(); } };
  return k;
}
function pdfImgType(dataURL) { const m = /^data:image\/(png|jpe?g|webp)/i.exec(dataURL || ''); return m ? (m[1].toLowerCase().startsWith('jp') ? 'JPEG' : m[1].toUpperCase()) : null; }
function pdfHead(k, title, rightLines) {
  const { doc, M, R } = k, st = S.settings, b = st.business; let yl = M;
  const typ = st.logo && pdfImgType(st.logo);
  if (typ) {
    try { const pr = doc.getImageProperties(st.logo); const s = Math.min(180 / pr.width, 60 / pr.height, 1); doc.addImage(st.logo, typ, M, yl, pr.width * s, pr.height * s); yl += pr.height * s + 10; }
    catch (e) { k.font(17, 'bold'); k.text(b.name || 'Your business name', M, yl + 14); yl += 24; }
  } else { k.font(17, 'bold'); k.text(b.name || 'Your business name', M, yl + 14); yl += 26; }
  const lines = []; if (typ && b.name) lines.push(['bold', b.name]); if (b.abn) lines.push(['normal', 'ABN ' + b.abn]);
  for (const a of String(b.address || '').split('\n').filter(x => x.trim())) lines.push(['normal', a]);
  const ce = [b.email, b.phone].filter(Boolean).join(' · '); if (ce) lines.push(['normal', ce]);
  for (const [sty, t] of lines) { k.font(9.5, sty); for (const l of k.wrap(t, 270)) { yl += k.lh(9.5); k.text(l, M, yl - 3); } }
  let yr = M + 22; k.font(22, 'bold', PDF_C.pinkD); doc.setCharSpace(0.4); k.text(title, R, yr, { align: 'right' }); doc.setCharSpace(0);
  yr += 8; rightLines.forEach(([sty, t]) => { k.font(9.5, sty); yr += k.lh(9.5) + 1; k.text(t, R, yr, { align: 'right' }); });
  k.y = Math.max(yl, yr) + 16; k.band(k.y); k.y += 4.5 + 16;
}
function pdfParty(k, label, cu) {
  if (!cu) return; const { M } = k;
  k.font(7.5, 'normal', PDF_C.grey2); k.doc.setCharSpace(0.6); k.text(label.toUpperCase(), M, k.y + 7); k.doc.setCharSpace(0); k.y += 7 + 4;
  const rows = [['bold', cu.business || cu.name]]; if (cu.business && cu.name) rows.push(['normal', cu.name]);
  for (const a of String(cu.address || '').split('\n').filter(x => x.trim())) rows.push(['normal', a]);
  if (cu.email) rows.push(['normal', cu.email]); if (cu.abn) rows.push(['normal', 'ABN ' + cu.abn]);
  for (const [sty, t] of rows) { k.font(9.5, sty); for (const l of k.wrap(t, 300)) { k.y += k.lh(9.5); k.text(l, M, k.y - 3); } }
  k.y += 8;
}
function pdfTotals(k, rows) {   // rows: [label, value, style] style: '', 'b', 'due', 'muted'
  const { doc, R } = k, x = R - 220; k.y += 10;
  for (const [l, v, s] of rows) {
    const big = s === 'b' || s === 'due', h = big ? 22 : 17;
    k.need(h + 6);
    if (big) { k.hr(k.y + 2, PDF_C.pinkT, 1.5, x, R); k.y += 6; }
    const col = s === 'due' ? PDF_C.pinkD : s === 'muted' ? [102, 102, 102] : PDF_C.ink;
    k.font(big ? 12.5 : 9.5, big ? 'bold' : 'normal', col); k.y += h - 4; k.text(l, x, k.y); k.text(v, R, k.y, { align: 'right' }); k.y += 4;
  }
}
function pdfFoot(k, blocks) {   // blocks: [{t, bold1, size, col}]
  if (!blocks.length) return; const { M, R } = k;
  k.y += 24; k.need(30); k.hr(k.y); k.y += 6;
  for (const bl of blocks) {
    const sz = bl.size || 9.5; const lines = String(bl.t).split('\n');
    lines.forEach((ln, i) => { k.font(sz, bl.bold1 && i === 0 ? 'bold' : 'normal', bl.col || PDF_C.body); for (const w of k.wrap(ln || ' ', R - M)) { k.need(k.lh(sz)); k.y += k.lh(sz); k.text(w, M, k.y - 3); } });
    k.y += 8;
  }
}
function pdfPageNumbers(k) { const n = k.doc.getNumberOfPages(); if (n < 2) return; for (let i = 1; i <= n; i++) { k.doc.setPage(i); k.font(8, 'normal', PDF_C.grey2); k.text(`Page ${i} of ${n}`, k.R, k.H - 26, { align: 'right' }); } }

async function invoicePDF(inv) {
  await loadJsPDF();
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', compress: true }), k = pdfKit(doc);
  const c = invCalc(inv), cu = byId('customers', inv.customerId), b = S.settings.business, isQ = inv.kind === 'quote';
  const title = isQ ? 'QUOTE' : (b.gstRegistered !== false && c.gst > 0 ? 'TAX INVOICE' : 'INVOICE');
  doc.setProperties({ title: `${isQ ? 'Quote' : 'Invoice'} ${inv.number}`, subject: `${title} ${inv.number}`, author: pdfText(b.name || ''), creator: 'Invoicing' });
  pdfHead(k, title, [['bold', inv.number], ['normal', 'Issued: ' + fmtD(inv.issueDate)], ['normal', (isQ ? 'Valid until: ' : 'Due: ') + fmtD(inv.dueDate)]]);
  pdfParty(k, 'Bill to', cu);
  // ---- items table
  const { M, R } = k, hasDisc = c.disc > 0;
  const cols = [['Amount', 74], ['GST', 62], ...(hasDisc ? [['Disc', 42]] : []), ['Unit price', 74], ['Qty', 40]];   // right-aligned, from the right edge
  const xs = []; let x = R; for (const [, w] of cols) { xs.push(x); x -= w; } const descW = x - M - 12;
  const head = () => { k.y += 10; k.font(7.5, 'bold', PDF_C.grey); k.doc.setCharSpace(0.4); k.text('DESCRIPTION', M + 4, k.y); cols.forEach(([l], i) => k.text(l.toUpperCase(), xs[i] - 4, k.y, { align: 'right' })); k.doc.setCharSpace(0); k.y += 7; k.hr(k.y, PDF_C.pinkT, 1.5); k.y += 2; };
  head();
  for (const it of inv.items || []) {
    const l = lineCalc(it); k.font(10, 'bold'); const dl = k.wrap(it.desc || '', descW); k.font(8.5); const dd = it.details ? k.wrap(it.details, descW) : [];
    const h = 9 + dl.length * k.lh(10) + dd.length * k.lh(8.5) + 7;
    k.need(h, head);
    let yy = k.y + 9; k.font(10, 'bold'); dl.forEach(t => { yy += k.lh(10) - 2; k.text(t, M + 4, yy); yy += 2; });
    k.font(8.5, 'normal', [102, 102, 102]); dd.forEach(t => { yy += k.lh(8.5); k.text(t, M + 4, yy - 1); });
    const vals = [money(l.net), it.gst ? money(l.gst) : '—', ...(hasDisc ? [num(it.discountPct) ? num(it.discountPct) + '%' : ''] : []), money(it.price), String(+num(it.qty).toFixed(3))];
    k.font(10); vals.forEach((v, i) => k.text(v, xs[i] - 4, k.y + 9 + k.lh(10) - 2, { align: 'right' }));
    k.y = Math.max(yy, k.y + 9 + k.lh(10)) + 7; k.hr(k.y);
  }
  // ---- totals
  const tr = [['Subtotal (ex GST)', money(c.sub)], ['GST 10%', money(c.gst)], ['Total' + (b.gstRegistered !== false ? ' (inc GST)' : ''), money(c.total), 'b']];
  if (!isQ && c.paid) tr.push(['Paid', '-' + money(c.paid)], ['Balance due', money(c.balance), 'due']);
  if (!isQ && !c.paid && inv.emailDeposit !== false) tr.push(['Deposit required', money(depositAmount(inv, c)), 'muted']);
  pdfTotals(k, tr);
  // ---- footer: notes / terms, bank details, payments
  const fb = [], notes = inv.notes || b.paymentTerms || ''; if (notes) fb.push({ t: notes });
  if (!isQ && bankDetails()) fb.push({ t: bankDetails() + '\nReference: ' + inv.number, bold1: true });
  const pays = S.payments.filter(p => p.invoiceId === inv.id);
  if (pays.length && !isQ) fb.push({ t: 'Payments received: ' + pays.map(p => fmtD(p.date) + ' ' + money(p.amount)).join(', '), size: 8.5, col: PDF_C.grey });
  pdfFoot(k, fb); pdfPageNumbers(k);
  return doc.output('blob');
}
async function receiptPDF(p) {
  await loadJsPDF();
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', compress: true }), k = pdfKit(doc);
  const inv = byId('invoices', p.invoiceId), c = invCalc(inv), cu = byId('customers', inv.customerId), b = S.settings.business, no = receiptNo(p);
  const paidTo = r2(S.payments.filter(x => x.invoiceId === inv.id && (x.date < p.date || (x.date === p.date && x.id <= p.id))).reduce((a, x) => a + num(x.amount), 0));
  doc.setProperties({ title: 'Receipt ' + no, subject: 'Receipt ' + no, author: pdfText(b.name || ''), creator: 'Invoicing' });
  pdfHead(k, 'RECEIPT', [['bold', no], ['normal', 'Date: ' + fmtD(p.date)]]);
  pdfParty(k, 'Received from', cu);
  const { M, R } = k; k.y += 6; k.hr(k.y, PDF_C.line);
  k.font(10); const d1 = k.wrap(`Payment received (${p.method || 'payment'})${p.note ? ' – ' + p.note : ''}`, R - M - 140); let yy = k.y + 6; d1.forEach(t => { yy += k.lh(10); k.text(t, M + 4, yy - 2); });
  k.font(14, 'bold'); k.text(money(p.amount), R - 4, k.y + 6 + k.lh(10), { align: 'right' }); k.y = yy + 8; k.hr(k.y);
  k.font(10); k.y += 6 + k.lh(10); k.text(`For invoice ${inv.number} issued ${fmtD(inv.issueDate)}`, M + 4, k.y - 2); k.y += 8; k.hr(k.y);
  pdfTotals(k, [['Includes GST', money(paymentSplit(p).gst)], ['Invoice total', money(c.total)], ['Paid to date', money(paidTo)], ['Balance remaining', money(Math.max(0, c.total - paidTo)), 'b']]);
  pdfFoot(k, [{ t: 'Thank you for your payment.' }]); pdfPageNumbers(k);
  return doc.output('blob');
}
/* which PDF goes with an outbox email (null = none) */
function pdfForEmail(e) {
  const inv = e.invoiceId && byId('invoices', e.invoiceId);
  if (inv && ['invoice', 'deposit', 'balance'].includes(e.type)) return { name: invoicePdfName(inv), make: () => invoicePDF(inv), label: inv.kind === 'quote' ? 'quote' : 'invoice' };
  const p = e.type === 'receipt' && e.paymentId && byId('payments', e.paymentId);
  if (p && byId('invoices', p.invoiceId)) return { name: receiptPdfName(p), make: () => receiptPDF(p), label: 'receipt' };
  return null;
}
const canShareFiles = () => { try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [new File([new Blob(['x'], { type: 'application/pdf' })], 'x.pdf', { type: 'application/pdf' })] })); } catch (e) { return false; } };
