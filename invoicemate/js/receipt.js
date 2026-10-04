/* InvoiceMate: receipt text -> expense fields. Pure function, no network.
 * parseReceipt(ocrText) -> { merchant, total, date (YYYY-MM-DD), gst, gstSource: 'printed'|'calculated'|'none', confidence notes } */
(function (root) {
  'use strict';
  const r2 = n => Math.round((+n || 0) * 100) / 100;
  const pad = n => String(n).padStart(2, '0');
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  /* fix common OCR slips inside money-looking tokens: S->$, O->0, l/I->1, comma decimals */
  function cleanLine(l) {
    return l.replace(/[|]/g, ' ').replace(/\bS(?=\s?\d)/g, '$').replace(/(\d)\s*[,.]\s?(\d{2})\b(?!\s*[\/.-]\d)/g, '$1.$2')
      .replace(/(?<=[\d$])[Oo](?=[\d.])|(?<=\d\.)[Oo]|(?<=\d\.\d)[Oo]/g, '0').replace(/(?<=\d)[lI](?=\d)|(?<=\$)[lI]/g, '1');
  }
  function amounts(line) {
    const out = []; const re = /(-)?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)(?!\s*%)/g; let m;
    while ((m = re.exec(line))) out.push(+(m[2].replace(/,/g, '') + '.' + m[3]) * (m[1] ? -1 : 1));
    return out;
  }
  function findDate(text) {
    let m, best = null;
    const re1 = /\b(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4}|\d{2})\b/g;
    while ((m = re1.exec(text))) {
      let d = +m[1], mo = +m[2], y = +m[3]; if (y < 100) y += 2000;
      if (mo > 12 && d <= 12) [d, mo] = [mo, d];                 // tolerate US-style if unambiguous
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2099) { best = `${y}-${pad(mo)}-${pad(d)}`; break; }
    }
    if (best) return best;
    const re2 = /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-\/]+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?[\s\-\/,]+(\d{4}|\d{2})\b/i;
    if ((m = text.match(re2))) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(+m[1])}`; }
    const re3 = /\b(\d{4})-(\d{2})-(\d{2})\b/; if ((m = text.match(re3))) return `${m[1]}-${m[2]}-${m[3]}`;
    return '';
  }
  const NOT_MERCHANT = /tax\s*invoice|receipt|invoice|a\.?b\.?n|abn|acn|phone|ph[:.]|tel|fax|www\.|http|@|date|time|order|table|served|cashier|operator|eftpos|welcome|thank|docket|trans|store\s*#|^\W*$|^\d/i;
  function findMerchant(lines) {
    for (const l of lines.slice(0, 6)) {
      const letters = (l.match(/[A-Za-z]/g) || []).length;
      if (letters < 3 || NOT_MERCHANT.test(l) || amounts(l).length) continue;
      if (letters / l.replace(/\s/g, '').length < 0.6) continue;     // mostly junk characters
      let s = l.replace(/[^A-Za-z0-9&'.\- ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\bPty\b/, 'Pty').replace(/\bLtd\b/, 'Ltd');
      return s;
    }
    return '';
  }
  function parseReceipt(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => cleanLine(l.trim())).filter(Boolean);
    const out = { merchant: findMerchant(lines), date: findDate(lines.join('\n')), total: 0, gst: 0, gstSource: 'none', lines };
    /* total: prefer explicit TOTAL lines (not subtotal / gst / change / savings) */
    const totalRe = /\b(grand\s*total|total\s*(?:aud|inc|incl|amount|due|payable|paid)?|amount\s*(?:due|paid|payable)|balance\s*due|to\s*pay|eftpos|card|visa|mastercard|debit|credit|amex|paid)\b/i;
    const notTotal = /sub\s*-?\s*total|gst|tax|change|saving|discount|rounding|items?\b|qty|cash\s*out|tip/i;
    let cands = [];
    lines.forEach((l, i) => {
      if (!totalRe.test(l) || notTotal.test(l)) return;
      let a = amounts(l); if (!a.length && lines[i + 1]) a = amounts(lines[i + 1]).slice(0, 1);  // amount on next line
      if (a.length) cands.push({ v: a[a.length - 1], strong: /total|amount|balance|to\s*pay/i.test(l), i });
    });
    const strong = cands.filter(c => c.strong);
    if (strong.length) out.total = Math.max(...strong.map(c => c.v));
    else if (cands.length) out.total = Math.max(...cands.map(c => c.v));
    else { const all = lines.flatMap(amounts).filter(v => v > 0 && v < 100000); if (all.length) out.total = Math.max(...all); }
    /* GST: "GST 4.09", "Includes GST $4.09", "Total includes GST of 4.09", "TAX 10% 4.09" */
    for (const l of lines) {
      if (!/\bg\.?s\.?t\b|\btax\b(?!\s*invoice)/i.test(l) || /ex\.?\s*gst|excl/i.test(l) && !/incl/i.test(l)) continue;
      const a = amounts(l).filter(v => v > 0 && (!out.total || v < out.total / 2 + 0.01));
      if (a.length) { out.gst = a.length > 1 && out.total && a.includes(out.total) ? a.find(v => v !== out.total) : Math.min(...a); out.gstSource = 'printed'; break; }
    }
    if (out.gstSource === 'none' && out.total) { out.gst = r2(out.total / 11); out.gstSource = 'calculated'; }
    out.total = r2(out.total); out.gst = r2(out.gst);
    return out;
  }
  const api = { parseReceipt, findDate, amounts };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.IMReceipt = api;
})(typeof self !== 'undefined' ? self : this);
