/* InvoiceMate (copied from Allyce's Invoicing app, recoloured): shared helpers (no data, no network). */
'use strict';
const ACT = {};      // data-act click handlers (filled by each screen file)
let CHARTS = [];     // live Chart.js instances (destroyed on navigation)
let leaveGuard = null; // unsaved-changes check for the current screen
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round((+n || 0) * 100) / 100;
const num = v => { if (typeof v === 'number') return v; const s = String(v ?? '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'); const n = parseFloat(s); return isNaN(n) ? 0 : n; };
const moneyFmt = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const money = n => moneyFmt.format(r2(n));
const kFmt = n => { const a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1000 ? s + '$' + (a / 1000).toFixed(a % 1000 ? 1 : 0).replace(/\.0$/, '') + 'K' : s + '$' + Math.round(a); };

/* dates: stored as YYYY-MM-DD local strings */
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const parseD = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s) || new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const fmtD = s => { const d = parseD(s); return d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
const monthKey = s => s ? s.slice(0, 7) : '';
const monthLabel = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'short' }) + " '" + String(y).slice(2); };
/* accept YYYY-MM-DD, DD/MM/YYYY, D/M/YY, DD-MM-YYYY, "3 Oct 2026" */
function normDate(v) {
  v = String(v ?? '').trim(); if (!v) return '';
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return y + '-' + pad(m[2]) + '-' + pad(m[1]); }
  const d = new Date(v); return isNaN(d) ? '' : ymd(d);
}
/* Australian financial year helpers */
function fyStart(d = new Date()) { const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; return new Date(y, 6, 1); }
function rangePreset(p) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  switch (p) {
    case 'this-month': return [ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))];
    case 'last-month': return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
    case 'this-quarter': { const q = Math.floor(m / 3) * 3; return [ymd(new Date(y, q, 1)), ymd(new Date(y, q + 3, 0))]; }
    case 'last-quarter': { const q = Math.floor(m / 3) * 3 - 3; return [ymd(new Date(y, q, 1)), ymd(new Date(y, q + 3, 0))]; }
    case 'this-fy': { const s = fyStart(n); return [ymd(s), ymd(new Date(s.getFullYear() + 1, 5, 30))]; }
    case 'last-fy': { const s = fyStart(n); return [ymd(new Date(s.getFullYear() - 1, 6, 1)), ymd(new Date(s.getFullYear(), 5, 30))]; }
    case 'last-12': return [ymd(new Date(y, m - 11, 1)), ymd(new Date(y, m + 1, 0))];
    default: return null;
  }
}
const PRESETS = [['this-month', 'This month'], ['last-month', 'Last month'], ['this-quarter', 'This quarter'], ['last-quarter', 'Last quarter'], ['this-fy', 'This financial year'], ['last-fy', 'Last financial year'], ['custom', 'Custom']];
function monthsBetween(a, b) { const out = []; let d = parseD(a.slice(0, 7) + '-01'); const e = parseD(b); while (d <= e) { out.push(ymd(d).slice(0, 7)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); } return out; }

/* icons (feather-style line icons) */
const ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  card: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  clip: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 2 2V2l-2 2-3-2-3 2-3-2-3 2-3-2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* placeholders: {client} etc. Unknown placeholders stay as typed. */
const fillTpl = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/* CSV (RFC 4180-ish) */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}
const csvCell = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/* downloads / files */
function download(name, data, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const readText = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsText(f); });
const readDataURL = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
const dataURLtoBlob = u => { const [h, b] = u.split(','); const mime = (h.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream'; const bin = atob(b); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: mime }); };
function pickFile(accept) { return new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept || ''; i.onchange = () => ok(i.files[0] || null); i.click(); }); }
/* shrink an image to max px (logo / receipt photos) */
async function shrinkImage(file, max = 1600, q = 0.85, type = 'image/jpeg') {
  const url = await readDataURL(file);
  const img = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = url; });
  const s = Math.min(1, max / Math.max(img.width, img.height));
  if (s === 1 && file.size < 400000) return url;
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const x = c.getContext('2d'); if (type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
  x.drawImage(img, 0, 0, c.width, c.height); return c.toDataURL(type, q);
}

/* link payloads: JSON -> deflate (if supported) -> base64url. Prefix z. (deflated) or b. (plain) */
const b64u = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
async function pipeBytes(bytes, stream) { const s = new Blob([bytes]).stream().pipeThrough(stream); return new Uint8Array(await new Response(s).arrayBuffer()); }
async function encodePayload(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== 'undefined') { try { return 'z.' + b64u(await pipeBytes(raw, new CompressionStream('deflate-raw'))); } catch (e) { } }
  return 'b.' + b64u(raw);
}
async function decodePayload(s) {
  s = String(s || '').trim().replace(/\s+/g, '');
  const all = [...s.matchAll(/(?<![A-Za-z0-9_-])([zb])\.([A-Za-z0-9_-]{16,})/g)].sort((a, b) => b[2].length - a[2].length);
  const m = all[0]; if (!m) throw new Error('No code found');
  let bytes = unb64u(m[2]);
  if (m[1] === 'z') bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function sha256short(text) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(h)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join(''); }

/* signature strokes: [[x,y,x,y...], ...] in a 600x200 box -> draw */
function drawStrokes(canvas, strokes, color = '#2B2F36') {
  const x = canvas.getContext('2d'); const sx = canvas.width / 600, sy = canvas.height / 200;
  x.clearRect(0, 0, canvas.width, canvas.height); x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = color; x.lineWidth = 2.6 * Math.min(sx, sy) + 0.4;
  for (const s of strokes || []) { x.beginPath(); for (let i = 0; i < s.length; i += 2) { const px = s[i] * sx, py = s[i + 1] * sy; i ? x.lineTo(px, py) : x.moveTo(px, py); } if (s.length === 2) x.lineTo(s[0] * sx + 0.5, s[1] * sy + 0.5); x.stroke(); }
}
function strokesToPNG(strokes, w = 600, h = 200) { const c = document.createElement('canvas'); c.width = w; c.height = h; drawStrokes(c, strokes); return c.toDataURL('image/png'); }

/* clipboard */
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { } ta.remove(); return ok;
  }
}
