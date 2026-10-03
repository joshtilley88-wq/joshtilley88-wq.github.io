/* Impeller Quoter UI. Plain JS, no build step. */
(function () {
  'use strict';
  const D = window.IQDefaults, E = window.IQEngine, AI = window.IQAI;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => n === null || n === undefined || !isFinite(n) ? 'To confirm' : '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f = E.fmt, num = E.num;
  const uid = p => p + '_' + Math.random().toString(36).slice(2, 8);
  const clone = o => JSON.parse(JSON.stringify(o));
  const STATUS_LABEL = { confirmed: 'Confirmed', provisional: 'Provisional', to_confirm: 'To confirm' };
  const badge = s => `<span class="badge b-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
  const KEY_QUOTE = 'iq.quote.v1', KEY_SET = 'iq.settings.v1', KEY_API = 'iq.openai_key';

  // ---------------- state ----------------
  function blankQuote() {
    return { version: 1, meta: { drawingNo: '', rev: '', title: '', customer: '', rotation: '', drawingQty: null, drawingMass: null, weldStd: '', balance: '', coating: '', scope: '', quoteRef: '', notes: '' },
      params: clone(D.PARAMS), components: [], welds: [], extraLines: [], aiLog: [], chat: [], usage: [], reviewed: true, questions: [], created: new Date().toISOString() };
  }
  function loadQuote() {
    try { const q = JSON.parse(localStorage.getItem(KEY_QUOTE)); if (q && q.params) return mergeParams(q); } catch (_) { }
    return null;
  }
  function mergeParams(q) { // add any new default params missing from an older saved quote
    const have = new Set(q.params.map(p => p.id));
    D.PARAMS.forEach(p => { if (!have.has(p.id)) q.params.push(clone(p)); });
    ['components', 'welds', 'extraLines', 'aiLog', 'chat', 'usage', 'questions'].forEach(k => { if (!Array.isArray(q[k])) q[k] = []; });
    q.meta = Object.assign(blankQuote().meta, q.meta || {});
    return q;
  }
  const defaultSettings = { model: 'gpt-5.6-sol', detail: 'high', maxPx: 2048, inPerM: 4.0, outPerM: 20.0, fx: 1.52 };
  let S = Object.assign({}, defaultSettings, (() => { try { return JSON.parse(localStorage.getItem(KEY_SET)) || {}; } catch (_) { return {}; } })());
  let Q = loadQuote() || blankQuote();
  let R = null; // compute result
  let pages = []; // {canvas, rot}
  let view = 'drawing';
  let ui = { openGroups: {}, onlyOpen: false, showLines: true, busy: '', msg: '', err: '' };

  function save() { try { localStorage.setItem(KEY_QUOTE, JSON.stringify(Q)); } catch (e) { console.warn('save failed', e); } }
  function saveSettings() { localStorage.setItem(KEY_SET, JSON.stringify(S)); }
  const apiKey = () => localStorage.getItem(KEY_API) || '';
  const param = id => Q.params.find(p => p.id === id);

  function recompute() { R = E.compute(Q); renderHeader(); }

  // ---------------- header ----------------
  function renderHeader() {
    $('#hdrTotal').innerHTML = `ex GST<b>${R.price !== null ? money(R.price).replace(/\.\d\d$/, '') : '-'}</b>`;
    $('#hdrRef').textContent = Q.meta.drawingNo ? `${Q.meta.drawingNo} Rev ${Q.meta.rev || '?'} · ${R.Q}-off` : 'Fabricated centrifugal impellers · AUD';
  }

  // ---------------- views ----------------
  function setView(v) {
    view = v; $$('.view').forEach(s => s.classList.toggle('on', s.id === 'view-' + v));
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    render(); window.scrollTo(0, 0);
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  }
  function render() {
    const ae = document.activeElement, key = ae && ae.dataset ? ae.dataset.k : null;
    const fn = { drawing: vDrawing, check: vCheck, cost: vCost, params: vParams, ai: vAI, report: vReport }[view];
    $('#view-' + view).innerHTML = fn();
    if (view === 'ai') { const c = $('#chatLog'); if (c) c.scrollTop = c.scrollHeight; }
    if (key) { const el = $(`[data-k="${CSS.escape(key)}"]`); if (el) el.focus(); }
  }
  const notice = () => (ui.busy ? `<div class="warnbox"><span class="busy"></span>${esc(ui.busy)}</div>` : '') + (ui.err ? `<div class="err">${esc(ui.err)}</div>` : '') + (ui.msg ? `<div class="okmsg">${esc(ui.msg)}</div>` : '');

  // ---- Drawing
  function vDrawing() {
    const m = Q.meta, hasKey = !!apiKey();
    const mf = (k, label, type) => `<div><label>${label}</label><input data-k="meta.${k}" ${type === 'n' ? 'inputmode="decimal"' : ''} value="${esc(m[k] ?? '')}"></div>`;
    return `${notice()}
    <div class="card"><h2>1. Drawing</h2>
      <div class="drop" id="drop" tabindex="0" role="button">📎 <b>Drop a drawing here</b> or tap to choose<br><span class="muted">PDF or image (PNG, JPG). PDFs are rendered in your browser.</span></div>
      <input type="file" id="file" accept="application/pdf,image/*" hidden>
      <div class="pages" id="pages">${pages.map((p, i) => `<figure><img alt="page ${i + 1}" src="${p.thumb}"><figcaption>Page ${i + 1} <button class="btn sm sec" data-act="rot" data-i="${i}">⟳ 90°</button> <button class="btn sm warn" data-act="delpage" data-i="${i}">✕</button></figcaption></figure>`).join('')}</div>
      <div style="margin-top:10px">
        <button class="btn" data-act="extract" ${pages.length ? '' : 'disabled'}>✨ Extract with AI</button>
        <button class="btn sec" data-act="example">Load example: MVW-360-27</button>
        <button class="btn sec" data-act="blank">New blank quote</button>
      </div>
      <p class="muted">${hasKey ? `AI model: <b>${esc(S.model)}</b>. Pages are sent only to OpenAI with your key.` : 'No OpenAI key set: manual mode. Add components on the Check tab, or add a key in Settings (⚙) to extract drawings automatically.'}
      Rotate pages so text reads upright before extracting.</p>
    </div>
    <div class="card"><h2>2. Title block and scope</h2>
      <div class="grid2">${mf('drawingNo', 'Drawing number')}${mf('rev', 'Revision')}${mf('customer', 'Customer')}${mf('rotation', 'Rotation (CW/ACW)')}${mf('drawingQty', 'Qty on drawing', 'n')}${mf('drawingMass', 'Drawing mass (kg)', 'n')}${mf('weldStd', 'Welding standard')}${mf('balance', 'Balance grade')}${mf('coating', 'Coating')}${mf('quoteRef', 'Quote ref')}</div>
      <label>Title</label><input data-k="meta.title" value="${esc(m.title)}">
      <label>Scope of supply</label><textarea data-k="meta.scope">${esc(m.scope)}</textarea>
      <label>Notes</label><textarea data-k="meta.notes">${esc(m.notes)}</textarea>
      <label>Batch quantity (spreads one-off costs)</label><input data-k="param.batch_qty.value" inputmode="numeric" value="${esc(param('batch_qty').value)}">
    </div>
    ${summaryCard()}`;
  }
  function summaryCard() {
    return `<div class="card"><div class="muted">Quote price (AUD, ex GST) for ${R.Q}-off</div>
      <div class="total">${money(R.price)}</div>
      <div class="muted">Inc GST ${money(R.priceInc)} · per unit ${money(R.unitPrice)} ex GST · ${R.unpriced.length} item(s) to confirm, not priced</div>
      ${massBox()}${R.warnings.filter(w => !/mass/i.test(w)).map(w => `<div class="warnbox">${esc(w)}</div>`).join('')}
      <button class="btn sm sec" data-go="cost">See breakdown</button> <button class="btn sm sec" data-go="report">Report</button></div>`;
  }
  function massBox() {
    if (!R.drawingMass) return `<div class="muted">Calculated mass ${f(R.calcMass, 1)} kg (enter drawing mass to check).</div>`;
    const bad = Math.abs(R.massDiffPct) > 15;
    return `<div class="${bad ? 'err' : 'okmsg'}">Mass check: calculated <b>${f(R.calcMass, 1)} kg</b> vs drawing <b>${f(R.drawingMass, 1)} kg</b> (${R.massDiffPct >= 0 ? '+' : ''}${f(R.massDiffPct, 1)}%)${bad ? '. More than 15% out: check thicknesses, dimensions and quantities.' : '. Within 15%.'}</div>`;
  }

  // ---- Check extracted data
  function confCls(c, k) { const v = c.conf && c.conf[k]; return v && v !== 'high' && v !== 'confirmed' ? 'conf-' + v : ''; }
  function confTag(c, k) { const v = c.conf && c.conf[k]; return v === 'to_confirm' || v === 'low' ? ' <span class="badge b-tc">to confirm</span>' : v === 'medium' ? ' <span class="badge b-medium">check</span>' : ''; }
  function vCheck() {
    const rows = R.comps.map(({ c, g }) => `<tr><td>${esc(c.name)}</td><td class="r">${esc(c.qty)}</td><td>${esc(c.grade)}</td><td class="r">${c.thk ?? (c.shape === 'bar' ? 'bar' : '<b style="color:#b00020">?</b>')}</td><td class="r">${g.netKg !== null ? f(g.netKg * c.qty, 2) : '?'}</td><td>${badge(rowStatus(c, g))}</td></tr>`).join('');
    return `${notice()}
    ${Q.reviewed ? '' : `<div class="warnbox"><b>Check the extracted data.</b> AI readings can be wrong. Fields flagged <span class="badge b-tc">to confirm</span> or <span class="badge b-medium">check</span> need your eye. Then tap “Confirm data”.</div>`}
    <div class="card"><h2>Check extracted data</h2>
      <table><tr><th>Part</th><th class="r">Qty</th><th>Grade</th><th class="r">t mm</th><th class="r">Net kg</th><th>Status</th></tr>${rows || '<tr><td colspan=6 class="muted">No components yet. Load the example, extract a drawing, or add one below.</td></tr>'}
      <tr class="sub"><td colspan=4>Total incl. weld metal ${f(R.depositKg, 2)} kg</td><td class="r">${f(R.calcMass, 1)}</td><td></td></tr></table>
      ${massBox()}
      ${(Q.questions || []).length ? `<h3>Questions from the AI read</h3><ul class="muted">${Q.questions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <button class="btn" data-act="confirm">✔ Confirm data${Q.reviewed ? ' (confirmed)' : ''}</button>
    </div>
    <div class="card"><h2>Components</h2>${R.comps.map(compCard).join('')}
      <button class="btn sec" data-act="addcomp">+ Add component</button></div>
    <div class="card"><h2>Weld schedule</h2>
      <p class="muted">Length = length each × count × sides. Fillet: area a²/2 × length × density = deposit kg; ÷ deposition rate = arc h; ÷ operator factor = weld hours. Full-penetration welds use hr/m.</p>
      ${R.weldRows.map(weldCard).join('')}
      <button class="btn sec" data-act="addweld">+ Add weld</button></div>`;
  }
  function rowStatus(c, g) { return (g.missing.length || Object.values(c.conf || {}).includes('to_confirm')) ? 'to_confirm' : (c.status || 'provisional'); }
  function statusSel(k, v) { return `<select data-k="${k}">${Object.keys(STATUS_LABEL).map(s => `<option value="${s}" ${v === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>`; }
  function compCard({ c, g }) {
    const i = Q.components.indexOf(c), k = 'comp.' + i + '.';
    const sh = D.SHAPES[c.shape] || D.SHAPES.custom;
    const dims = sh.dims.map(([dk, lab]) => `<div><label>${esc(lab)}${confTag(c, dk)}</label><input class="${confCls(c, dk)}" inputmode="decimal" data-k="${k}dims.${dk}" value="${esc(c.dims[dk] ?? '')}"></div>`).join('');
    let calc = `Net ${g.netKg !== null ? f(g.netKg, 3) + ' kg each, ' + f(g.netKg * c.qty, 2) + ' kg total' : '<b>mass ? (missing ' + esc(g.missing.join(', ')) + ')</b>'}`;
    if (g.area !== null) calc += ` · area ${f(g.area / 1e6, 4)} m² each`;
    if (g.cut) calc += ` · cut ${f(g.cut / 1000, 2)} m, ${g.pierces} pierce(s) each`;
    if (g.grossKg !== null) calc += ` · gross ${f(g.grossKg * c.qty, 2)} kg`;
    if (g.dev && c.shape === 'cone') calc += `<br><b>Cone development</b>: Δr ${f(g.dev.dr, 1)}, H ${f(g.dev.H, 1)}, α ${f(g.dev.alpha, 2)}° from radial, s ${f(g.dev.s, 1)}, R<sub>out</sub> ${f(g.dev.Rout, 1)}, R<sub>in</sub> ${f(g.dev.Rin, 1)}, θ ${f(g.dev.theta, 1)}° (missing wedge ${f(g.dev.missingWedge, 1)}°). Check θ·R<sub>out</sub> = 2πR<sub>o</sub> ✓`;
    if (g.dev && c.shape === 'cylinder') calc += `<br><b>Eye development</b>: Dn = ID + t = ${f(g.dev.Dn, 1)} mm, L = πDn = ${f(g.dev.L, 1)} mm × W ${f(g.dev.W, 0)} mm`;
    if (g.blank) calc += `<br>Bar blank Ø${f(g.blank.OD, 0)} × ${f(g.blank.L, 0)} mm`;
    return `<div class="ccard"><div class="hd"><input data-k="${k}name" value="${esc(c.name)}"> ${badge(rowStatus(c, g))}<button class="btn sm warn" data-act="delcomp" data-i="${i}" aria-label="Delete">✕</button></div>
      <div class="grid3">
        <div><label>Qty${confTag(c, 'qty')}</label><input class="${confCls(c, 'qty')}" inputmode="numeric" data-k="${k}qty" value="${esc(c.qty ?? '')}"></div>
        <div><label>Grade${confTag(c, 'grade')}</label><input class="${confCls(c, 'grade')}" data-k="${k}grade" value="${esc(c.grade ?? '')}" list="grades"></div>
        <div><label>Thk mm${confTag(c, 'thk')}</label><input class="${confCls(c, 'thk')}" inputmode="decimal" data-k="${k}thk" value="${esc(c.thk ?? '')}"></div>
      </div>
      <label>Shape</label><select data-k="${k}shape">${Object.entries(D.SHAPES).map(([s, o]) => `<option value="${s}" ${s === c.shape ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      <div class="grid3">${dims}</div>
      <div class="grid3">
        <div><label>Yield %</label><input inputmode="decimal" data-k="${k}yieldPct" placeholder="${esc(param('plate_yield_pct').value)}" value="${esc(c.yieldPct ?? '')}"></div>
        <div><label>Extra holes</label><input inputmode="numeric" data-k="${k}holes" value="${esc(c.holes ?? 0)}"></div>
        <div><label>Hole cut mm</label><input inputmode="decimal" data-k="${k}holeCut" value="${esc(c.holeCut ?? 0)}"></div>
      </div>
      <div class="grid2"><div><label>Status</label>${statusSel(k + 'status', c.status)}</div>
        <div><label>Welded into assembly</label><select data-k="${k}welded"><option value="1" ${c.welded ? 'selected' : ''}>Yes</option><option value="0" ${c.welded ? '' : 'selected'}>No (loose)</option></select></div></div>
      <label>Note</label><input data-k="${k}note" value="${esc(c.note || '')}">
      <div class="calc">${calc}</div></div>`;
  }
  function weldCard(r) {
    const w = r.w, i = Q.welds.indexOf(w), k = 'weld.' + i + '.';
    const fil = w.type === 'fillet';
    return `<div class="ccard"><div class="hd"><input data-k="${k}desc" value="${esc(w.desc)}"> ${badge(r.hrs === null ? 'to_confirm' : w.status)}<button class="btn sm warn" data-act="delweld" data-i="${i}" aria-label="Delete">✕</button></div>
      <div class="grid3"><div><label>Type</label><select data-k="${k}type"><option value="fillet" ${fil ? 'selected' : ''}>Fillet</option><option value="fullpen" ${fil ? '' : 'selected'}>Full pen / butt</option></select></div>
        <div><label>${fil ? 'Leg a mm' : 'Plate t mm'}</label><input inputmode="decimal" data-k="${k}${fil ? 'leg' : 'thk'}" value="${esc((fil ? w.leg : w.thk) ?? '')}"></div>
        <div><label>Status</label>${statusSel(k + 'status', w.status)}</div></div>
      <div class="grid3"><div><label>Length each mm</label><input inputmode="decimal" data-k="${k}lenEach" value="${esc(w.lenEach ?? '')}"></div>
        <div><label>Count</label><input inputmode="numeric" data-k="${k}count" value="${esc(w.count ?? '')}"></div>
        <div><label>Sides</label><input inputmode="numeric" data-k="${k}sides" value="${esc(w.sides ?? '')}"></div></div>
      <label>Note</label><input data-k="${k}note" value="${esc(w.note || '')}">
      <div class="calc">Total ${r.L !== null ? f(r.L / 1000, 2) + ' m' : '<b>length to confirm</b>'}${r.kg !== null ? ` · deposit ${f(r.kg, 3)} kg` : ''}${r.arc ? ` · arc ${f(r.arc, 2)} h` : ''} · weld time ${r.hrs !== null ? f(r.hrs, 2) + ' h' : '<b>to confirm</b>'}</div></div>`;
  }

  // ---- Cost
  function vCost() {
    const ops = Object.keys(R.byOp);
    const byop = ops.map(o => `<tr><td>${esc(o)}</td><td class="r">${money(R.byOp[o])}</td><td class="r">${f(R.byOp[o] / R.direct * 100, 0)}%</td></tr>`).join('');
    const lines = R.lines.map(l => `<tr><td>${esc(l.op)}<br><span class="muted">${esc(l.desc)}</span></td><td class="r">${l.basis === 'batch' ? 'batch' : 'per unit'}</td><td class="r">${l.amount === null ? '<span class="badge b-to_confirm">To confirm</span>' : money(l.amount)}<br>${badge(l.status)}${l.extraId ? ` <button class="btn sm warn" data-act="delline" data-id="${esc(l.extraId)}">✕</button>` : ''}</td></tr>`).join('');
    return `${notice()}${summaryCard()}
    <div class="card"><h2>Cost by operation (batch of ${R.Q})</h2>
      <table><tr><th>Operation</th><th class="r">AUD</th><th class="r">Share</th></tr>${byop}
      <tr class="sub"><td>Direct cost</td><td class="r">${money(R.direct)}</td><td></td></tr>
      <tr><td>Overhead ${esc(param('overhead_pct').value)}%</td><td class="r">${money(R.overhead)}</td><td></td></tr>
      <tr><td>Contingency ${esc(param('contingency_pct').value)}%</td><td class="r">${money(R.contingency)}</td><td></td></tr>
      <tr class="sub"><td>Total cost</td><td class="r">${money(R.cost)}</td><td></td></tr>
      <tr><td>${R.method === 'margin' ? 'Margin ' + esc(param('margin_pct').value) + '% (P = C ÷ (1 − g))' : 'Markup ' + esc(param('markup_pct').value) + '% (P = C × (1 + m))'}</td><td class="r">${money(R.profit)}</td><td></td></tr>
      <tr class="grand"><td>Price ex GST</td><td class="r">${money(R.price)}</td><td></td></tr>
      <tr><td>GST ${esc(param('gst_pct').value)}%</td><td class="r">${money(R.gst)}</td><td></td></tr>
      <tr class="grand"><td>Price inc GST</td><td class="r">${money(R.priceInc)}</td><td></td></tr></table>
      <p class="muted">Batch cost = one-off ${money(R.batchSum)} + ${R.Q} × unit ${money(R.unitSum)}. ${R.unpriced.length ? `<b>${R.unpriced.length} item(s) are To confirm and NOT included:</b> ${esc(R.unpriced.map(l => l.desc).join('; '))}.` : ''}</p>
      <div class="grid2"><div><label>Pricing method</label><select data-k="param.pricing_method.value"><option value="markup" ${R.method === 'markup' ? 'selected' : ''}>Markup on cost</option><option value="margin" ${R.method === 'margin' ? 'selected' : ''}>Gross margin</option></select></div>
      <div><label>${R.method === 'margin' ? 'Margin %' : 'Markup %'}</label><input inputmode="decimal" data-k="param.${R.method}_pct.value" value="${esc(param(R.method + '_pct').value)}"></div></div>
    </div>
    <div class="card"><h2>Itemised lines</h2><table><tr><th>Item</th><th class="r">Basis</th><th class="r">AUD</th></tr>${lines}</table></div>
    <div class="card"><h2>Add a cost line</h2>
      <label>Description</label><input id="nl_name" placeholder="e.g. Dye penetrant inspection">
      <div class="grid2"><div><label>Category</label><select id="nl_cat">${AI.OPS.map(o => `<option>${esc(o)}</option>`).join('')}</select></div>
      <div><label>Basis</label><select id="nl_basis"><option value="unit">Per unit</option><option value="batch">Per batch (one-off)</option></select></div></div>
      <div class="grid3"><div><label>Qty</label><input id="nl_qty" inputmode="decimal" value="1"></div><div><label>Unit</label><input id="nl_unit" value="ea"></div><div><label>Rate $</label><input id="nl_rate" inputmode="decimal"></div></div>
      <label>Note</label><input id="nl_note">
      <button class="btn" data-act="addline">+ Add line</button></div>`;
  }

  // ---- Params
  function vParams() {
    const groups = Object.keys(D.GROUPS);
    const counts = s => Q.params.filter(p => p.status === s).length;
    const body = groups.map(g => {
      const ps = Q.params.filter(p => p.group === g && (!ui.onlyOpen || p.status !== 'confirmed'));
      if (!ps.length) return '';
      const tc = ps.filter(p => p.status === 'to_confirm').length;
      return `<details data-group="${g}" ${ui.openGroups[g] ? 'open' : ''}><summary><span>${esc(D.GROUPS[g])} <span class="muted">(${ps.length})</span></span>${tc ? `<span class="badge b-to_confirm">${tc} to confirm</span>` : ''}</summary>
        ${ps.map(p => `<div class="prow"><div class="top"><span>${esc(p.label)}</span>${badge(p.value === null || p.value === '' ? 'to_confirm' : p.status)}</div>
          <div class="vals">${p.id === 'pricing_method' ? `<select data-k="param.${p.id}.value"><option ${p.value === 'markup' ? 'selected' : ''}>markup</option><option ${p.value === 'margin' ? 'selected' : ''}>margin</option></select>` :
          `<input inputmode="decimal" data-k="param.${p.id}.value" placeholder="To confirm" value="${esc(p.value ?? '')}">`}<span class="unit">${esc(p.unit)}</span>${statusSel('param.' + p.id + '.status', p.status)}</div>
          <input class="note" data-k="param.${p.id}.note" value="${esc(p.note)}" placeholder="Note"><div class="muted">id: ${esc(p.id)}</div></div>`).join('')}</details>`;
    }).join('');
    return `${notice()}<div class="card"><h2>All parameters</h2>
      <p class="muted"><b>All rates are EXAMPLE PLACEHOLDERS</b> (AUD). Replace them with your own rates, supplier quotes and shop history. Leave a value blank to mark it To confirm: it is then not priced, never treated as zero.<br>
      ${badge('confirmed')} ${counts('confirmed')} · ${badge('provisional')} ${counts('provisional')} · ${badge('to_confirm')} ${counts('to_confirm')}</p>
      <button class="btn sec sm" data-act="expandall">Show all parameters</button> <button class="btn sec sm" data-act="collapseall">Collapse all</button>
      <button class="btn sec sm" data-act="onlyopen">${ui.onlyOpen ? 'Show all' : 'Only unconfirmed'}</button> <button class="btn warn sm" data-act="resetparams">Reset to defaults</button>
      ${body}</div>`;
  }

  // ---- AI assistant
  function vAI() {
    const hasKey = !!apiKey();
    const sr = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    const chat = Q.chat.map(m => `<div class="msg ${m.role === 'user' ? 'u' : m.role === 'sys' ? 's' : 'a'}">${esc(m.content)}</div>`).join('');
    const log = Q.aiLog.slice().reverse().map(e => `<div class="log ${e.undone ? 'undone' : ''}"><div class="flex"><b class="sp">${esc(e.instruction)}</b>${e.undone ? '<span class="muted">undone</span>' : `<button class="btn sm sec" data-act="undo" data-id="${e.id}">Undo</button>`}</div>
      <div class="muted">${new Date(e.ts).toLocaleString('en-AU')}</div>${e.actions.map(a => `<div>• ${esc(a.summary)}</div>`).join('')}</div>`).join('');
    const usd = usageTotal();
    return `${notice()}<div class="card"><h2>AI assistant</h2>
      ${hasKey ? '' : '<div class="warnbox">Add your OpenAI API key in Settings (⚙) to use the assistant. Everything it can do you can also do by hand on the Params and Cost tabs.</div>'}
      <div class="chat" id="chatLog">${chat || '<div class="muted">Try: “add $400 for pickling”, “change welding rate to $100/hr”, “add a 2-hour dye penetrant inspection at $120/hr”, “what’s driving the cost?”</div>'}</div>
      <div class="chips">${['What’s driving the cost?', 'Change welding rate to $100/hr', 'Add a 2-hour dye penetrant inspection at $120/hr', 'Add $400 for pickling'].map(t => `<button data-chip="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="chatbar"><textarea id="chatIn" placeholder="Tell the assistant what to change…" ${hasKey ? '' : 'disabled'}></textarea>
      ${sr ? `<button class="btn mic" id="mic" data-act="mic" ${hasKey ? '' : 'disabled'} aria-label="Voice input">🎤</button>` : ''}
      <button class="btn" data-act="send" ${hasKey && !ui.busy ? '' : 'disabled'}>Send</button></div>
      ${Q.chat.length ? '<button class="btn sm sec" data-act="clearchat">Clear chat</button>' : ''}</div>
    <div class="card"><h2>AI changes</h2>${log || '<p class="muted">No AI changes yet.</p>'}</div>
    <div class="card"><h2>AI usage this quote</h2>${usageTable()}<p class="muted">Estimated from the token counts OpenAI returns × the prices in Settings (US$${S.inPerM}/M input, US$${S.outPerM}/M output, 1 USD = ${S.fx} AUD). Check current OpenAI pricing for your model.</p></div>`;
  }
  function usageTotal() { return Q.usage.reduce((a, u) => a + u.costUSD, 0); }
  function usageTable() {
    if (!Q.usage.length) return '<p class="muted">No AI calls yet: $0.00.</p>';
    const tin = Q.usage.reduce((a, u) => a + u.prompt, 0), tout = Q.usage.reduce((a, u) => a + u.completion, 0), usd = usageTotal();
    return `<table><tr><th>Call</th><th class="r">In tok</th><th class="r">Out tok</th><th class="r">US$</th></tr>${Q.usage.map(u => `<tr><td>${esc(u.kind)} <span class="muted">${esc(u.model)}</span></td><td class="r">${u.prompt}</td><td class="r">${u.completion}</td><td class="r">${u.costUSD.toFixed(4)}</td></tr>`).join('')}
      <tr class="sub"><td>Total (≈ A${money(usd * S.fx)})</td><td class="r">${tin}</td><td class="r">${tout}</td><td class="r">${usd.toFixed(4)}</td></tr></table>`;
  }
  function recordUsage(kind, u) {
    const costUSD = u.prompt / 1e6 * (+S.inPerM || 0) + u.completion / 1e6 * (+S.outPerM || 0);
    Q.usage.push({ ts: Date.now(), kind, model: u.model || S.model, prompt: u.prompt, completion: u.completion, costUSD });
  }

  // ---- Report
  function dimsText(c) { return Object.entries(c.dims || {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k} ${v}`).join(', '); }
  function vReport() {
    const m = Q.meta, today = new Date().toLocaleDateString('en-AU');
    const bom = R.comps.map(({ c, g }) => `<tr><td>${esc(c.name)}</td><td class="r">${esc(c.qty)}</td><td>${esc(c.grade)}</td><td class="r">${c.thk ?? (c.shape === 'bar' ? 'bar' : '?')}</td><td>${esc(dimsText(c))}</td><td class="r">${g.netKg !== null ? f(g.netKg * c.qty, 2) : '?'}</td><td>${badge(rowStatus(c, g))}</td></tr>`).join('');
    const ops = [...new Set(R.lines.map(l => l.op))];
    const build = ops.map(o => {
      const ls = R.lines.filter(l => l.op === o);
      return ls.map(l => `<tr><td>${esc(l.desc)}</td><td class="r">${l.qty !== null && l.qty !== undefined && l.unit !== '$' ? f(l.qty, 2) + ' ' + esc(l.unit) : ''}</td><td class="r">${l.rate !== null && l.rate !== undefined && l.unit !== '$' ? money(l.rate) : ''}</td><td class="r">${l.basis === 'batch' ? 'batch' : '× ' + R.Q}</td><td class="r">${l.amount === null ? '<b>To confirm</b>' : money(l.basis === 'unit' ? l.amount * R.Q : l.amount)}</td><td>${badge(l.status)}</td></tr>`).join('') +
        `<tr class="sub"><td colspan=4>${esc(o)} subtotal</td><td class="r">${money(R.byOp[o] || 0)}</td><td></td></tr>`;
    }).join('');
    const reg = R.register.map(r => `<tr><td>${esc(r.kind)}</td><td>${esc(r.item)}</td><td>${esc(r.value)}</td><td>${badge(r.status)}</td><td class="muted">${esc(r.note)}</td></tr>`).join('');
    const excl = D.EXCLUSIONS.concat(R.unpriced.map(l => `${l.desc}: To confirm, not included in price.`));
    const log = Q.aiLog.map(e => `<tr><td>${new Date(e.ts).toLocaleString('en-AU')}</td><td>${esc(e.instruction)}</td><td>${e.actions.map(a => esc(a.summary)).join('<br>')}${e.undone ? ' <b>(undone)</b>' : ''}</td></tr>`).join('');
    return `<div class="noprint card flex"><button class="btn" data-act="print">🖨 Print / Save as PDF</button><button class="btn sec" data-act="export">⬇ Export JSON</button><button class="btn sec" data-act="import">⬆ Import JSON</button></div>
    <div class="report">
      <div class="flex"><div class="sp"><h1>Impeller quotation estimate</h1><div class="muted">Prepared by Josh Tilley, engineering estimating · ${esc(today)}${m.quoteRef ? ' · Ref ' + esc(m.quoteRef) : ''}</div></div></div>
      ${Q.reviewed ? '' : '<div class="draft">DRAFT: extracted drawing data not yet confirmed</div>'}
      ${R.unpriced.length ? `<div class="draft" style="border-color:#b26a00;color:#7a4a00">Price excludes ${R.unpriced.length} item(s) marked To confirm</div>` : ''}
      <h2>Drawing and scope</h2><table class="kv">
        <tr><td>Drawing</td><td>${esc(m.drawingNo)} Rev ${esc(m.rev)}</td></tr><tr><td>Title</td><td>${esc(m.title)}</td></tr>
        <tr><td>Customer</td><td>${esc(m.customer)}</td></tr><tr><td>Rotation</td><td>${esc(m.rotation)}</td></tr>
        <tr><td>Quantity quoted</td><td>${R.Q}-off (drawing: ${esc(m.drawingQty ?? '?')})</td></tr>
        <tr><td>Welding</td><td>${esc(m.weldStd)}</td></tr><tr><td>Balancing</td><td>${esc(m.balance || 'Not specified')}</td></tr><tr><td>Coating</td><td>${esc(m.coating || 'Not specified')}</td></tr>
        <tr><td>Scope</td><td>${esc(m.scope)}</td></tr>${m.notes ? `<tr><td>Notes</td><td>${esc(m.notes)}</td></tr>` : ''}</table>
      <h2>Bill of materials</h2><table><tr><th>Part</th><th class="r">Qty</th><th>Grade</th><th class="r">t</th><th>Dims (mm)</th><th class="r">Net kg</th><th>Status</th></tr>${bom}
        <tr class="sub"><td colspan=5>Weld metal (theoretical)</td><td class="r">${f(R.depositKg, 2)}</td><td></td></tr>
        <tr class="sub"><td colspan=5>Calculated mass per impeller</td><td class="r">${f(R.calcMass, 1)}</td><td></td></tr></table>
      ${massBox()}
      <h2>Cost build-up by operation (AUD, batch of ${R.Q})</h2>
      <table><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Basis</th><th class="r">Amount</th><th>Status</th></tr>${build}
        <tr class="sub"><td colspan=4>Direct cost (one-off ${money(R.batchSum)} + ${R.Q} × ${money(R.unitSum)})</td><td class="r">${money(R.direct)}</td><td></td></tr>
        <tr><td colspan=4>Overhead ${esc(param('overhead_pct').value)}%</td><td class="r">${money(R.overhead)}</td><td></td></tr>
        <tr><td colspan=4>Contingency ${esc(param('contingency_pct').value)}%</td><td class="r">${money(R.contingency)}</td><td></td></tr>
        <tr class="sub"><td colspan=4>Total cost</td><td class="r">${money(R.cost)}</td><td></td></tr>
        <tr><td colspan=4>${R.method === 'margin' ? `Gross margin ${esc(param('margin_pct').value)}% (price = cost ÷ (1 − margin))` : `Markup ${esc(param('markup_pct').value)}% (price = cost × (1 + markup))`}</td><td class="r">${money(R.profit)}</td><td></td></tr>
        <tr class="grand"><td colspan=4>Price ex GST</td><td class="r">${money(R.price)}</td><td></td></tr>
        <tr><td colspan=4>GST ${esc(param('gst_pct').value)}%</td><td class="r">${money(R.gst)}</td><td></td></tr>
        <tr class="grand"><td colspan=4>Price inc GST</td><td class="r">${money(R.priceInc)}</td><td></td></tr>
        <tr><td colspan=4>Unit price ex GST</td><td class="r">${money(R.unitPrice)}</td><td></td></tr></table>
      <h2>Assumption register (${R.register.length} items)</h2>
      <p class="muted">Every provisional or to-confirm input. All rates are example placeholders until replaced with confirmed rates.</p>
      <table><tr><th>Type</th><th>Item</th><th>Value</th><th>Status</th><th>Note</th></tr>${reg}</table>
      <h2>Exclusions</h2><ul>${excl.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <h2>AI change log</h2>${log ? `<table><tr><th>When</th><th>Instruction</th><th>Changes</th></tr>${log}</table>` : '<p class="muted">No AI changes.</p>'}
      <p class="muted">AI usage for this quote: ${Q.usage.length} call(s), ≈ US$${usageTotal().toFixed(4)} (A${money(usageTotal() * S.fx)}).</p>
      <p class="muted">Validity, lead time and payment terms: to confirm. This estimate is not a design approval; geometry derivations assume ideal shapes per the method document.</p>
    </div>`;
  }

  // ---------------- settings ----------------
  function openSettings() {
    const k = apiKey();
    $('#settingsSheet').innerHTML = `<h2 style="margin-top:0;color:#1f3a5f">Settings</h2>
      <label>OpenAI API key (stored only in this browser's localStorage, sent only to api.openai.com)</label>
      <input id="s_key" type="password" autocomplete="off" placeholder="sk-..." value="${esc(k)}">
      <div class="grid2"><div><label>Model</label><input id="s_model" value="${esc(S.model)}" list="models"></div>
      <div><label>Image detail</label><select id="s_detail">${['high', 'auto', 'original', 'low'].map(d => `<option ${S.detail === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div><label>Max image size (px, long side)</label><input id="s_px" inputmode="numeric" value="${esc(S.maxPx)}"></div>
      <div><label>USD → AUD</label><input id="s_fx" inputmode="decimal" value="${esc(S.fx)}"></div>
      <div><label>Input price US$/1M tokens</label><input id="s_in" inputmode="decimal" value="${esc(S.inPerM)}"></div>
      <div><label>Output price US$/1M tokens</label><input id="s_out" inputmode="decimal" value="${esc(S.outPerM)}"></div></div>
      <datalist id="models"><option>gpt-5.6-sol</option><option>gpt-6-astra</option><option>gpt-5.5</option><option>gpt-5.4-mini</option><option>gpt-4.1</option><option>gpt-4o</option></datalist>
      <p class="muted">Token prices are placeholders: check openai.com/api/pricing for your model. Use “original” detail only on models that support it.</p>
      <button class="btn" id="s_save">Save</button><button class="btn warn" id="s_forget">Forget key</button><button class="btn sec" id="s_close">Close</button>`;
    $('#settings').classList.add('on');
    $('#s_save').onclick = () => {
      const key = $('#s_key').value.trim();
      if (key) localStorage.setItem(KEY_API, key); else localStorage.removeItem(KEY_API);
      S.model = $('#s_model').value.trim() || defaultSettings.model; S.detail = $('#s_detail').value;
      S.maxPx = Math.max(512, Math.min(6000, +$('#s_px').value || 2048)); S.fx = +$('#s_fx').value || 1; S.inPerM = +$('#s_in').value || 0; S.outPerM = +$('#s_out').value || 0;
      saveSettings(); $('#settings').classList.remove('on'); render();
    };
    $('#s_forget').onclick = () => { localStorage.removeItem(KEY_API); $('#s_key').value = ''; render(); };
    $('#s_close').onclick = () => $('#settings').classList.remove('on');
  }

  // ---------------- edits ----------------
  function setPath(key, raw) {
    const parts = key.split('.');
    const numeric = new Set(['qty', 'thk', 'yieldPct', 'holes', 'holeCut', 'leg', 'lenEach', 'count', 'sides', 'drawingQty', 'drawingMass']);
    if (parts[0] === 'meta') { Q.meta[parts[1]] = numeric.has(parts[1]) ? num(raw) : raw; return; }
    if (parts[0] === 'param') {
      const p = param(parts[1]); if (!p) return;
      if (parts[2] === 'value') p.value = (p.id === 'pricing_method') ? raw : (raw.trim() === '' ? null : num(raw.replace(/[$,%\s]/g, '')));
      else p[parts[2]] = raw;
      if (parts[2] === 'value' && p.value === null) p.status = 'to_confirm';
      return;
    }
    const arr = parts[0] === 'comp' ? Q.components : Q.welds;
    const o = arr[+parts[1]]; if (!o) return;
    if (parts[2] === 'dims') { o.dims[parts[3]] = num(raw); if (o.conf) o.conf[parts[3]] = 'confirmed'; return; }
    const fk = parts[2];
    if (fk === 'welded') o.welded = raw === '1';
    else if (numeric.has(fk) || (fk === 'thk')) o[fk] = num(raw);
    else o[fk] = raw;
    if (o.conf && fk in o.conf) o.conf[fk] = 'confirmed';
    if (fk === 'shape') { o.dims = {}; D.SHAPES[raw].dims.forEach(([d]) => { o.dims[d] = null; }); }
  }
  function commit(rerender) { save(); recompute(); if (rerender !== false) render(); }

  // ---------------- AI tool application (with undo info) ----------------
  function applyTool(name, a, log) {
    if (name === 'set_parameter') {
      const p = param(a.id); if (!p) return { ok: false, error: 'Unknown parameter id ' + a.id + '. Valid ids are in context.params.' };
      const before = { value: p.value, status: p.status, note: p.note };
      let v = a.value;
      if (p.id === 'pricing_method') { if (!['markup', 'margin'].includes(v)) return { ok: false, error: 'pricing_method must be markup or margin' }; }
      else if (v !== null) { v = num(String(v).replace(/[$,%\s]/g, '')); if (v === null) return { ok: false, error: 'value must be a number or null' }; }
      p.value = v; if (a.status) p.status = a.status; else if (v === null) p.status = 'to_confirm'; else if (p.status === 'to_confirm') p.status = 'provisional';
      if (a.note) p.note = a.note;
      log.push({ type: 'param', id: p.id, before, summary: `${p.label}: ${before.value ?? 'To confirm'} → ${v ?? 'To confirm'} ${p.unit}` });
      recompute(); return { ok: true, new_price_ex_gst: R.price };
    }
    if (name === 'add_cost_line') {
      const qn = num(a.qty), rt = num(a.rate);
      if (qn === null || rt === null) return { ok: false, error: 'qty and rate must be numbers' };
      const line = { id: uid('line'), name: String(a.name || 'Extra item'), category: AI.OPS.includes(a.category) ? a.category : 'Other', qty: qn, unit: String(a.unit || 'ea'), rate: rt, basis: a.basis === 'batch' ? 'batch' : 'unit', labour: !!a.labour, note: a.note || '', status: a.status || 'provisional', source: 'ai' };
      Q.extraLines.push(line);
      log.push({ type: 'addline', id: line.id, summary: `Added ${line.name}: ${line.qty} ${line.unit} × $${line.rate} (${line.basis === 'batch' ? 'per batch' : 'per unit'}, ${line.category})` });
      recompute(); return { ok: true, id: line.id, new_price_ex_gst: R.price };
    }
    if (name === 'remove_cost_line') {
      const i = Q.extraLines.findIndex(l => l.id === a.id); if (i < 0) return { ok: false, error: 'No extra line with id ' + a.id };
      const [line] = Q.extraLines.splice(i, 1);
      log.push({ type: 'delline', line, index: i, summary: `Removed ${line.name}` });
      recompute(); return { ok: true, new_price_ex_gst: R.price };
    }
    if (name === 'update_component' || name === 'update_weld') {
      const isC = name === 'update_component', arr = isC ? Q.components : Q.welds, id = isC ? a.component_id : a.weld_id;
      const i = arr.findIndex(o => o.id === id); if (i < 0) return { ok: false, error: 'Unknown id ' + id };
      const field = String(a.field || '');
      const okF = isC ? /^(qty|grade|thk|yieldPct|holes|holeCut|welded|status|note|name|dims\.\w+)$/ : /^(type|leg|thk|lenEach|count|sides|status|note|desc)$/;
      if (!okF.test(field)) return { ok: false, error: 'Field not allowed: ' + field };
      const o = arr[i], before = field.startsWith('dims.') ? o.dims[field.slice(5)] : o[field];
      setPath(`${isC ? 'comp' : 'weld'}.${i}.${field}`, field === 'welded' ? (a.value ? '1' : '0') : (a.value === null ? '' : String(a.value)));
      const after = field.startsWith('dims.') ? o.dims[field.slice(5)] : o[field];
      log.push({ type: isC ? 'comp' : 'weld', id, field, before, summary: `${isC ? o.name : o.desc} ${field}: ${before ?? '?'} → ${after ?? '?'}` });
      recompute(); return { ok: true, new_price_ex_gst: R.price };
    }
    return { ok: false, error: 'Unknown tool ' + name };
  }
  function undo(entry) {
    entry.actions.slice().reverse().forEach(a => {
      if (a.type === 'param') { const p = param(a.id); if (p) Object.assign(p, a.before); }
      else if (a.type === 'addline') { Q.extraLines = Q.extraLines.filter(l => l.id !== a.id); }
      else if (a.type === 'delline') { Q.extraLines.splice(Math.min(a.index, Q.extraLines.length), 0, a.line); }
      else if (a.type === 'comp' || a.type === 'weld') {
        const o = (a.type === 'comp' ? Q.components : Q.welds).find(x => x.id === a.id);
        if (o) { if (a.field.startsWith('dims.')) o.dims[a.field.slice(5)] = a.before; else o[a.field] = a.before; }
      }
    });
    entry.undone = true; commit();
  }
  function chatContext() {
    return {
      meta: Q.meta, batch_qty: R.Q,
      params: Q.params.map(p => ({ id: p.id, label: p.label, value: p.value, unit: p.unit, status: p.status })),
      components: Q.components.map(c => ({ id: c.id, name: c.name, qty: c.qty, grade: c.grade, thk: c.thk, shape: c.shape, dims: c.dims, yieldPct: c.yieldPct, welded: c.welded })),
      welds: Q.welds.map(w => ({ id: w.id, desc: w.desc, type: w.type, leg: w.leg, thk: w.thk, lenEach: w.lenEach, count: w.count, sides: w.sides })),
      extraLines: Q.extraLines,
      cost: { by_operation: R.byOp, direct: R.direct, overhead: R.overhead, contingency: R.contingency, total_cost: R.cost, method: R.method, price_ex_gst: R.price, price_inc_gst: R.priceInc,
        calc_mass_kg: +R.calcMass.toFixed(2), drawing_mass_kg: R.drawingMass,
        largest_lines: R.lines.filter(l => l.amount !== null).map(l => ({ op: l.op, desc: l.desc, batch_amount: +(l.basis === 'unit' ? l.amount * R.Q : l.amount).toFixed(2) })).sort((a, b) => b.batch_amount - a.batch_amount).slice(0, 15),
        to_confirm_unpriced: R.unpriced.map(l => l.desc) }
    };
  }
  async function sendChat(text) {
    text = (text || '').trim(); if (!text || ui.busy) return;
    Q.chat.push({ role: 'user', content: text }); ui.err = ''; ui.busy = 'Thinking…'; render();
    const actions = [];
    try {
      const hist = Q.chat.filter(m => m.role === 'user' || m.role === 'assistant').slice(-8).map(m => ({ role: m.role, content: m.content }));
      const out = await AI.chat(hist, chatContext(), { key: apiKey(), model: S.model }, (n, a) => applyTool(n, a, actions));
      recordUsage('assistant', out.usage);
      Q.chat.push({ role: 'assistant', content: out.reply });
      if (actions.length) Q.aiLog.push({ id: uid('log'), ts: Date.now(), instruction: text, actions, reply: out.reply, undone: false });
    } catch (e) {
      ui.err = e.message || String(e);
      if (actions.length) Q.aiLog.push({ id: uid('log'), ts: Date.now(), instruction: text + ' (partial, error)', actions, undone: false });
      Q.chat.push({ role: 'sys', content: 'Error: ' + (e.message || e) });
    }
    ui.busy = ''; commit();
  }

  // ---------------- drawing input ----------------
  let pdfjsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; res(window.pdfjsLib); };
      s.onerror = () => { pdfjsPromise = null; rej(new Error('Could not load the PDF viewer (pdf.js) from the CDN. Check your connection, or upload a PNG/JPG instead.')); };
      document.head.appendChild(s);
    });
    return pdfjsPromise;
  }
  function addCanvas(src) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0);
    pages.push({ canvas: c, rot: 0, thumb: thumbOf(c) });
  }
  function thumbOf(c) { const t = document.createElement('canvas'), k = 300 / Math.max(c.width, c.height); t.width = c.width * k; t.height = c.height * k; t.getContext('2d').drawImage(c, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', 0.7); }
  async function handleFile(file) {
    if (!file) return;
    ui.err = ''; ui.msg = ''; ui.busy = 'Reading ' + file.name + '…'; render();
    try {
      pages = [];
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const lib = await loadPdfJs();
        const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        const n = Math.min(pdf.numPages, 4);
        for (let i = 1; i <= n; i++) {
          const pg = await pdf.getPage(i), vp1 = pg.getViewport({ scale: 1 });
          const scale = (+S.maxPx || 2048) / Math.max(vp1.width, vp1.height);
          const vp = pg.getViewport({ scale });
          const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          await pg.render({ canvasContext: ctx, viewport: vp }).promise;
          pages.push({ canvas: c, rot: 0, thumb: thumbOf(c) });
        }
        ui.msg = `Rendered ${n} page(s)${pdf.numPages > n ? ' (first 4 only)' : ''}.`;
      } else if (/^image\//.test(file.type)) {
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image.')); i.src = URL.createObjectURL(file); });
        const k = Math.min(1, (+S.maxPx || 2048) / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); pages.push({ canvas: c, rot: 0, thumb: thumbOf(c) });
        ui.msg = 'Image loaded.';
      } else throw new Error('Please choose a PDF or an image file.');
    } catch (e) { ui.err = e.message || String(e); }
    ui.busy = ''; render();
  }
  function rotatePage(i) {
    const p = pages[i], s = p.canvas, c = document.createElement('canvas');
    c.width = s.height; c.height = s.width; const x = c.getContext('2d');
    x.translate(c.width / 2, c.height / 2); x.rotate(Math.PI / 2); x.drawImage(s, -s.width / 2, -s.height / 2);
    p.canvas = c; p.thumb = thumbOf(c); render();
  }
  async function runExtract() {
    if (!apiKey()) { ui.err = 'Add your OpenAI API key in Settings (⚙) first, or fill the data in by hand on the Check tab.'; render(); return; }
    ui.err = ''; ui.msg = '';
    const t0 = Date.now(); let got = 0, lock = null;
    const tick = () => { const sec = Math.round((Date.now() - t0) / 1000); ui.busy = `Reading drawing with ${S.model}… ${sec}s${got ? ' · receiving data' : ''}. Keep the app open and the screen on.`; render(); };
    tick(); const timer = setInterval(tick, 1000);
    try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (_) {}
    try {
      const imgs = pages.map(p => p.canvas.toDataURL('image/jpeg', 0.85));
      const { data, usage } = await AI.extract(imgs, { key: apiKey(), model: S.model, detail: S.detail }, n => { got = n; }).finally(() => { clearInterval(timer); try { lock && lock.release(); } catch (_) {} });
      recordUsage('extraction', usage);
      applyExtraction(data);
      ui.msg = `Extracted ${Q.components.length} component(s) and ${Q.welds.length} weld(s). Check every flagged field.`;
      ui.busy = ''; commit(false); setView('check'); return;
    } catch (e) { ui.err = e.message || String(e); }
    ui.busy = ''; commit();
  }
  function applyExtraction(d) {
    const tb = d.title_block || {}, val = k => (tb[k] && tb[k].value !== undefined) ? tb[k].value : null;
    Object.assign(Q.meta, { drawingNo: val('drawing_number') || '', rev: val('revision') || '', title: val('title') || '', customer: val('customer') || '', rotation: val('rotation') || '',
      drawingQty: num(String(val('quantity') || '').replace(/[^\d.]/g, '')), drawingMass: num(String(val('mass_kg') || '').replace(/[^\d.]/g, '')),
      weldStd: val('weld_standard') || '', balance: val('balance_grade') || 'Not specified (to confirm)', coating: val('coating') || 'Not specified (to confirm)',
      notes: (d.general_notes || []).join(' · ') });
    if (Q.meta.drawingQty) { const p = param('batch_qty'); p.value = Q.meta.drawingQty; p.status = 'confirmed'; p.note = 'From drawing title block (AI read, check).'; }
    Q.questions = d.questions || [];
    const confMap = x => x === 'high' ? 'high' : x === 'medium' ? 'medium' : 'low';
    Q.components = (d.components || []).map(c => {
      const shape = D.SHAPES[c.shape] ? c.shape : 'custom';
      const dims = {};
      const map = { disc: { OD: c.od_mm, ID: c.id_mm }, cone: { Do: c.od_mm, Di: c.id_mm, H: c.height_mm, alpha: c.angle_deg }, cylinder: { ID: c.id_mm, W: c.width_mm },
        rect: { L: c.length_mm, W: c.width_mm }, trapezoid: { L: c.length_mm, W1: c.width_mm, W2: c.width2_mm }, bar: { OD: c.od_mm, L: c.length_mm, ID: c.id_mm, SD: c.step_od_mm, SL: c.step_length_mm }, custom: { A: null, M: null, C: null } }[shape];
      Object.keys(map).forEach(k => { dims[k] = num(map[k]); });
      const conf = {}; const base = confMap(c.confidence);
      ['qty', 'grade', 'thk'].concat(Object.keys(dims)).forEach(k => { conf[k] = base; });
      Object.keys(dims).forEach(k => { if (dims[k] === null && !(shape === 'cone' && (k === 'alpha' || k === 'H') && (dims.H !== null || dims.alpha !== null)) && !(shape === 'bar' && (k === 'SD' || k === 'SL' || k === 'ID')) && !(shape === 'disc' && k === 'ID')) conf[k] = 'to_confirm'; });
      if (c.thickness_mm === null && shape !== 'bar') conf.thk = 'to_confirm';
      if (!c.material_grade) conf.grade = 'to_confirm';
      (c.uncertain_fields || []).forEach(u => {
        const k = { thickness_mm: 'thk', material_grade: 'grade', qty: 'qty', od_mm: shape === 'cone' ? 'Do' : 'OD', id_mm: shape === 'cone' ? 'Di' : 'ID', length_mm: 'L', width_mm: shape === 'trapezoid' ? 'W1' : 'W', width2_mm: 'W2', height_mm: 'H', angle_deg: 'alpha' }[u] || u;
        conf[k] = 'to_confirm';
      });
      return { id: uid('c'), name: c.name || 'Part', qty: num(c.qty) ?? 1, grade: c.material_grade || '', thk: num(c.thickness_mm), shape, dims, yieldPct: null,
        holes: num(c.hole_count) || 0, holeCut: 0, welded: c.welded_into_assembly !== false, status: c.confidence === 'high' ? 'provisional' : 'to_confirm', note: c.notes || '', conf };
    });
    Q.welds = (d.welds || []).map(w => ({ id: uid('w'), desc: w.location || 'Weld', type: w.type === 'fillet' ? 'fillet' : 'fullpen', leg: num(w.leg_mm), thk: num(w.throat_or_thickness_mm),
      lenEach: num(w.length_each_mm), count: num(w.count), sides: num(w.sides) ?? 1, status: (num(w.length_each_mm) === null || num(w.count) === null) ? 'to_confirm' : 'provisional', note: w.notes || '' }));
    Q.reviewed = false;
  }

  // ---------------- export / import ----------------
  function exportJSON() {
    const data = Object.assign({ app: 'impeller-quoter', exported: new Date().toISOString() }, Q); // no API key in here
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (Q.meta.drawingNo || 'impeller-quote').replace(/[^\w.-]+/g, '_') + '-quote.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function importJSON(file) {
    try {
      const d = JSON.parse(await file.text());
      if (!d || !Array.isArray(d.params) || !Array.isArray(d.components)) throw new Error('That file is not an Impeller Quoter quote.');
      delete d.app; delete d.exported; Q = mergeParams(d); ui.msg = 'Quote imported.'; ui.err = '';
    } catch (e) { ui.err = 'Import failed: ' + (e.message || e); }
    commit();
  }

  // ---------------- events ----------------
  document.addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.k;
    if (k) { setPath(k, e.target.value); save(); recompute(); setTimeout(render, 0); return; }
    if (e.target.id === 'file') handleFile(e.target.files[0]);
    if (e.target.id === 'importFile') { importJSON(e.target.files[0]); e.target.value = ''; }
  });
  document.addEventListener('toggle', e => { if (e.target.tagName === 'DETAILS' && e.target.dataset.group) ui.openGroups[e.target.dataset.group] = e.target.open; }, true);
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-go],[data-view],[data-chip],#drop,#btnSettings'); if (!t) return;
    if (t.id === 'btnSettings') return openSettings();
    if (t.id === 'drop') return $('#file').click();
    if (t.dataset.view) return setView(t.dataset.view);
    if (t.dataset.go) return setView(t.dataset.go);
    if (t.dataset.chip) { const i = $('#chatIn'); if (i && !i.disabled) { i.value = t.dataset.chip; i.focus(); } return; }
    const act = t.dataset.act, i = +t.dataset.i;
    ui.msg = ''; if (act !== 'send') ui.err = '';
    switch (act) {
      case 'example': { const ex = D.example(); Q = Object.assign(blankQuote(), ex); Q.reviewed = true; ui.msg = 'Loaded example MVW-360-27 Rev 0 (read from the drawing; example rates).'; commit(); break; }
      case 'blank': if (confirm('Start a new blank quote? The current quote will be replaced (export it first if needed).')) { Q = blankQuote(); pages = []; commit(); } break;
      case 'extract': runExtract(); break;
      case 'rot': rotatePage(i); break;
      case 'delpage': pages.splice(i, 1); render(); break;
      case 'confirm': Q.reviewed = true; Q.components.forEach(c => Object.keys(c.conf || {}).forEach(k => { if (c.conf[k] === 'high' || c.conf[k] === 'medium') c.conf[k] = 'confirmed'; })); ui.msg = 'Data confirmed. Fields still marked To confirm stay in the assumption register.'; commit(); break;
      case 'addcomp': Q.components.push({ id: uid('c'), name: 'New part', qty: 1, grade: '304', thk: null, shape: 'disc', dims: { OD: null, ID: null }, yieldPct: null, holes: 0, holeCut: 0, welded: true, status: 'provisional', note: '', conf: {} }); commit(); break;
      case 'delcomp': if (confirm('Delete ' + Q.components[i].name + '?')) { Q.components.splice(i, 1); commit(); } break;
      case 'addweld': Q.welds.push({ id: uid('w'), desc: 'New weld', type: 'fillet', leg: null, thk: null, lenEach: null, count: 1, sides: 1, status: 'provisional', note: '' }); commit(); break;
      case 'delweld': Q.welds.splice(i, 1); commit(); break;
      case 'addline': {
        const name = $('#nl_name').value.trim(), qn = num($('#nl_qty').value), rt = num($('#nl_rate').value.replace(/[$,]/g, ''));
        if (!name || qn === null || rt === null) { ui.err = 'Enter a description, qty and rate for the new line.'; render(); break; }
        Q.extraLines.push({ id: uid('line'), name, category: $('#nl_cat').value, qty: qn, unit: $('#nl_unit').value || 'ea', rate: rt, basis: $('#nl_basis').value, note: $('#nl_note').value, status: 'provisional', source: 'manual' });
        ui.msg = 'Line added.'; commit(); break;
      }
      case 'delline': Q.extraLines = Q.extraLines.filter(l => l.id !== t.dataset.id); commit(); break;
      case 'expandall': Object.keys(D.GROUPS).forEach(g => ui.openGroups[g] = true); render(); break;
      case 'collapseall': ui.openGroups = {}; render(); break;
      case 'onlyopen': ui.onlyOpen = !ui.onlyOpen; render(); break;
      case 'resetparams': if (confirm('Reset all parameters to the example defaults?')) { Q.params = clone(D.PARAMS); commit(); } break;
      case 'send': { const inp = $('#chatIn'); sendChat(inp && inp.value); break; }
      case 'clearchat': Q.chat = []; commit(); break;
      case 'undo': { const en = Q.aiLog.find(x => x.id === t.dataset.id); if (en && !en.undone) undo(en); break; }
      case 'mic': startMic(t); break;
      case 'print': window.print(); break;
      case 'export': exportJSON(); break;
      case 'import': $('#importFile').click(); break;
    }
  });
  document.addEventListener('keydown', e => {
    if (e.target.id === 'chatIn' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(e.target.value); }
    if (e.target.id === 'drop' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('#file').click(); }
  });
  ['dragover', 'dragenter'].forEach(ev => document.addEventListener(ev, e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } }));
  document.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
  document.addEventListener('drop', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.remove('over'); handleFile(e.dataTransfer.files[0]); } });
  $('#settings').addEventListener('click', e => { if (e.target.id === 'settings') e.target.classList.remove('on'); });

  let rec = null;
  function startMic(btn) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'en-AU'; rec.interimResults = true;
    btn.classList.add('rec');
    rec.onresult = ev => { const tx = Array.from(ev.results).map(r => r[0].transcript).join(''); const i = $('#chatIn'); if (i) i.value = tx; };
    rec.onerror = ev => { ui.err = 'Voice input error: ' + ev.error + (ev.error === 'not-allowed' ? ' (allow the microphone for this site)' : ''); };
    rec.onend = () => { rec = null; const b = $('#mic'); if (b) b.classList.remove('rec'); if (ui.err) render(); };
    rec.start();
  }

  // datalist for grades
  document.body.insertAdjacentHTML('beforeend', '<datalist id="grades"><option>304</option><option>316</option><option>SAF 2205</option><option>Mild steel 250</option></datalist>');

  // ---------------- boot ----------------
  const qs = new URLSearchParams(location.search);
  if (qs.get('example') === '1' || (!localStorage.getItem(KEY_QUOTE) && !Q.components.length)) { Q = Object.assign(blankQuote(), D.example()); save(); }
  if (qs.get('expand') === '1') Object.keys(D.GROUPS).forEach(g => ui.openGroups[g] = true);
  recompute();
  const start = (location.hash || '').slice(1);
  setView(['drawing', 'check', 'cost', 'params', 'ai', 'report'].includes(start) ? start : 'drawing');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
  window.IQApp = { get quote() { return Q; }, get result() { return R; }, applyTool, applyExtraction: d => { applyExtraction(d); commit(); }, setView, sendChat, handleFile };
})();
