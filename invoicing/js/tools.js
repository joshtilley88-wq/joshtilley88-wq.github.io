/* Invoicing: reports, cash flow, contracts + e-sign links, questionnaires, CSV import, settings, demo data. */
'use strict';
const PINK = '#E85D9A', LAV = '#9B7BD4', LAV_T = '#EDE4FA', PLUM = '#4A2545', GRID = '#F1EEF5', AXIS = '#9A93A8';
const CAT_COLORS = ['#E85D9A', '#9B7BD4', '#F4A6C8', '#C7B3EC', '#B86CC0', '#F7C6DA', '#7E5CC0', '#F08DB7', '#DCCDF5', '#D04585', '#A98BDB', '#FBD9E8', '#6D4AA8'];

/* ======================= REPORT DATA ======================= */
function plData(from, to) {
  const pays = S.payments.filter(p => p.date >= from && p.date <= to);
  const inc = { gross: 0, gst: 0, net: 0, n: pays.length };
  for (const p of pays) { const s = paymentSplit(p); inc.gross += s.gross; inc.gst += s.gst; inc.net += s.net; }
  const cats = {}; const ex = { gross: 0, gst: 0, net: 0 };
  for (const e of S.expenses.filter(e => e.date >= from && e.date <= to)) {
    const s = expenseSplit(e); const k = e.category || 'Other'; cats[k] = cats[k] || { gross: 0, gst: 0, net: 0, n: 0 };
    cats[k].gross += s.gross; cats[k].gst += s.gst; cats[k].net += s.net; cats[k].n++; ex.gross += s.gross; ex.gst += s.gst; ex.net += s.net;
  }
  const catList = Object.entries(cats).map(([k, v]) => ({ name: k, ...v })).sort((a, b) => b.net - a.net);
  return { from, to, inc, ex, cats: catList, net: r2(inc.net - ex.net), gstNet: r2(inc.gst - ex.gst) };
}
function cashflowData(from, to) {
  const months = monthsBetween(from, to);
  const inflow = months.map(k => r2(S.payments.filter(p => monthKey(p.date) === k && p.date >= from && p.date <= to).reduce((a, p) => a + num(p.amount), 0)));
  const outflow = months.map(k => r2(S.expenses.filter(e => monthKey(e.date) === k && e.date >= from && e.date <= to).reduce((a, e) => a + num(e.amount), 0)));
  return { months, inflow, outflow, net: months.map((_, i) => r2(inflow[i] - outflow[i])) };
}
function niceMax(v) { if (v <= 0) return 1000; const half = v / 2; const p = Math.pow(10, Math.floor(Math.log10(half))); const step = [1, 2, 2.5, 5, 10].map(x => x * p).find(x => x >= half); return step * 2; }
function hatchPattern() {
  const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d');
  x.fillStyle = LAV_T; x.fillRect(0, 0, 8, 8); x.strokeStyle = '#CDBBEE'; x.lineWidth = 1.2;
  x.beginPath(); x.moveTo(0, 8); x.lineTo(8, 0); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
  return x.createPattern(c, 'repeat');
}

/* ======================= CASH FLOW CARD (Wave-style) ======================= */
const CF_RANGES = [['last-12', 'Last 12 months'], ['this-fy', 'This financial year'], ['last-fy', 'Last financial year'], ['custom', 'Custom range']];
function renderCashflowCard(el, withReportBtn) {
  let r = sessionStorage.getItem('cf-range') || 'last-12'; let [from, to] = rangePreset(r) || [sessionStorage.getItem('cf-from'), sessionStorage.getItem('cf-to')];
  if (!from || !to) { r = 'last-12'; [from, to] = rangePreset(r); }
  el.innerHTML = `<div class="card"><h2 style="font-size:22px">Cash flow</h2><div class="small muted" style="margin:2px 0 14px">Always displays cash basis (paid)</div>
    ${withReportBtn ? `<a class="btn out block" href="#/reports" style="margin-bottom:12px">View report</a>` : ''}
    <select class="cf-r">${CF_RANGES.map(([k, l]) => `<option value="${k}" ${k === r ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <div class="row cf-custom" style="margin-top:10px" ${r === 'custom' ? '' : 'hidden'}><input type="date" class="cf-from" value="${from}" style="flex:1"><input type="date" class="cf-to" value="${to}" style="flex:1"></div>
    <div class="cf-legend"><span><i class="sw in"></i>Inflow</span><span><i class="sw out"></i>Outflow</span><span><i class="sw net"></i>Net change</span></div>
    <div class="chart-scroll"><div class="chart-box"><canvas></canvas></div></div></div>`;
  let chart;
  const draw = () => {
    if (chart) { chart.destroy(); CHARTS = CHARTS.filter(c => c !== chart); }
    const d = cashflowData(from, to); const M = niceMax(Math.max(1, ...d.inflow, ...d.outflow, ...d.net.map(Math.abs)) * 1.05);
    const box = $('.chart-box', el); box.style.minWidth = Math.max(300, d.months.length * (window.innerWidth < 860 ? 58 : 46)) + 'px';
    const hatch = hatchPattern();
    chart = new Chart($('canvas', el), {
      data: {
        labels: d.months.map(k => monthLabel(k).split(' ')),
        datasets: [
          { type: 'line', label: 'Net change', data: d.net, borderColor: PLUM, borderWidth: 2, pointBackgroundColor: PINK, pointBorderColor: PLUM, pointBorderWidth: 1.5, pointRadius: 5, pointHoverRadius: 7, tension: 0, order: 0, stack: 'net' },
          { type: 'bar', label: 'Inflow', data: d.inflow, order: 1, stack: 'cash', borderRadius: { topLeft: 8, topRight: 8 }, borderSkipped: 'bottom', maxBarThickness: 30, categoryPercentage: 0.62,
            backgroundColor: ctx => { const a = ctx.chart.chartArea; if (!a || !ctx.raw) return PINK; const y = ctx.chart.scales.y; const top = y.getPixelForValue(ctx.raw), z = y.getPixelForValue(0); if (!isFinite(top) || top >= z) return PINK; const g = ctx.chart.ctx.createLinearGradient(0, top, 0, z); g.addColorStop(0, PINK); g.addColorStop(1, LAV); return g; } },
          { type: 'bar', label: 'Outflow', data: d.outflow.map(v => -v), order: 2, stack: 'cash', backgroundColor: hatch, borderColor: '#D3C3F0', borderWidth: 1, borderRadius: { bottomLeft: 8, bottomRight: 8 }, borderSkipped: 'top', maxBarThickness: 30, categoryPercentage: 0.62 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#fff', titleColor: PLUM, bodyColor: '#4A4458', borderColor: '#EEE8F4', borderWidth: 1, padding: 12, cornerRadius: 12, boxPadding: 4,
          callbacks: { title: it => it[0].label.replace(',', ' '), label: it => ` ${it.dataset.label}: ${money(it.dataset.label === 'Outflow' ? -it.raw : it.raw)}` } } },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: AXIS, font: { size: 12, family: 'Inter' } } },
          y: { stacked: true, min: -M, max: M, ticks: { stepSize: M / 2, color: AXIS, font: { size: 12, family: 'Inter' }, callback: v => kFmt(v) }, grid: { color: ctx => ctx.tick.value === 0 ? '#C9C2D4' : GRID, lineWidth: ctx => ctx.tick.value === 0 ? 1.2 : 1 }, border: { display: false } },
        },
      },
    });
    CHARTS.push(chart);
    const sc = $('.chart-scroll', el); setTimeout(() => sc.scrollLeft = sc.scrollWidth, 80);
  };
  $('.cf-r', el).onchange = e => { r = e.target.value; sessionStorage.setItem('cf-range', r); $('.cf-custom', el).hidden = r !== 'custom'; if (r !== 'custom') { [from, to] = rangePreset(r); $('.cf-from', el).value = from; $('.cf-to', el).value = to; draw(); } };
  $$('.cf-from,.cf-to', el).forEach(i => i.onchange = () => { from = $('.cf-from', el).value; to = $('.cf-to', el).value; if (from && to && from <= to) { sessionStorage.setItem('cf-from', from); sessionStorage.setItem('cf-to', to); draw(); } });
  draw();
}

/* ======================= REPORTS (P&L) ======================= */
V.reports = async (view, _, q) => {
  let preset = q.get('r') || 'this-fy'; let [from, to] = rangePreset(preset) || [q.get('from') || rangePreset('this-fy')[0], q.get('to') || today()];
  view.innerHTML = `${demoBanner()}${pageH('Reports', 'Profit and loss, GST and cash flow')}
  <div class="card" style="margin-bottom:18px"><div class="row"><div class="seg" id="rp-seg">${PRESETS.map(([k, l]) => `<button data-r="${k}" class="${k === preset ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="spacer"></div><input type="date" id="rp-from" value="${from}" style="max-width:165px"><span class="muted">to</span><input type="date" id="rp-to" value="${to}" style="max-width:165px"><button class="btn pri" id="rp-print">${icon('printer')} Print P&amp;L</button></div></div>
  <div id="rp-body"></div><div id="rp-cf" style="margin-top:18px"></div>`;
  const draw = () => {
    CHARTS.filter(c => c._pl).forEach(c => c.destroy()); CHARTS = CHARTS.filter(c => !c._pl);
    const d = plData(from, to); const margin = d.inc.net ? Math.round(d.net / d.inc.net * 100) : 0;
    $('#rp-body').innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);align-items:start" id="rp-grid">
      <div class="stack"><div class="card"><h2>Overview</h2><div class="small muted">${fmtD(from)} – ${fmtD(to)}</div>
        <div class="donut-wrap" style="margin-top:16px"><canvas id="rp-gauge"></canvas><div class="donut-c" style="top:auto;bottom:4%"><div class="l">Net profit</div><div class="v num">${money(d.net)}</div><div class="l">${d.inc.net ? margin + '% margin' : ''}</div></div></div>
        <div class="list legend-list" style="margin-top:6px">
          <div class="li"><span class="ic">${icon('trend')}</span><div class="grow"><div class="t">Income</div><div class="s">${d.inc.n} payments received</div></div><b class="num">${money(d.inc.net)}</b></div>
          <div class="li"><span class="ic lav">${icon('receipt')}</span><div class="grow"><div class="t">Expenses</div><div class="s">${d.cats.reduce((a, c) => a + c.n, 0)} receipts</div></div><b class="num">${money(d.ex.net)}</b></div>
          <div class="li"><span class="ic warn">${icon('dollar')}</span><div class="grow"><div class="t">GST to pay (est.)</div><div class="s">collected ${money(d.inc.gst)} − credits ${money(d.ex.gst)}</div></div><b class="num">${money(d.gstNet)}</b></div></div></div>
        ${d.cats.length ? `<div class="card"><h2 style="margin-bottom:10px">Expenses by category</h2><div class="donut-wrap"><canvas id="rp-cats"></canvas></div>
          <div class="list legend-list" style="margin-top:10px">${d.cats.map((c, i) => `<div class="li" style="padding:8px 4px"><span class="dot" style="background:${CAT_COLORS[i % CAT_COLORS.length]}"></span><div class="grow">${esc(c.name)}</div><span class="num small">${money(c.net)}</span></div>`).join('')}</div></div>` : ''}
      </div>
      <div class="card"><div class="card-h"><h2>Profit &amp; loss</h2><div class="spacer"></div><span class="pill sent">Cash basis</span></div>${plTable(d)}
        <div class="note" style="margin-top:14px">Cash basis: income is counted when a payment is received (not when invoiced); expenses on their receipt date. Amounts are ex GST, GST shown separately. Check with your accountant before lodging a BAS.</div></div></div>`;
    if (window.innerWidth < 1000) $('#rp-grid').style.gridTemplateColumns = '1fr';
    const gctx = $('#rp-gauge').getContext('2d'); const g = gctx.createLinearGradient(0, 0, 260, 0); g.addColorStop(0, PINK); g.addColorStop(1, LAV);
    const exp = Math.max(0, d.ex.net), prof = Math.max(0, d.inc.net - d.ex.net);
    const c1 = new Chart($('#rp-gauge'), { type: 'doughnut', data: { labels: ['Profit', 'Expenses'], datasets: [{ data: exp + prof ? [prof, exp] : [0, 1], backgroundColor: [g, LAV_T], borderWidth: 0, borderRadius: 10, spacing: 2 }] },
      options: { rotation: -90, circumference: 180, cutout: '78%', aspectRatio: 1.6, plugins: { legend: { display: false }, tooltip: { callbacks: { label: it => ' ' + it.label + ': ' + money(it.raw) } } } } });
    c1._pl = true; CHARTS.push(c1);
    if (d.cats.length) { const c2 = new Chart($('#rp-cats'), { type: 'doughnut', data: { labels: d.cats.map(c => c.name), datasets: [{ data: d.cats.map(c => r2(c.net)), backgroundColor: d.cats.map((_, i) => CAT_COLORS[i % CAT_COLORS.length]), borderWidth: 2, borderColor: '#fff', borderRadius: 6 }] },
      options: { cutout: '68%', aspectRatio: 1.4, plugins: { legend: { display: false }, tooltip: { callbacks: { label: it => ' ' + it.label + ': ' + money(it.raw) } } } } }); c2._pl = true; CHARTS.push(c2); }
  };
  $$('#rp-seg button').forEach(b => b.onclick = () => { $$('#rp-seg button').forEach(x => x.classList.toggle('on', x === b)); preset = b.dataset.r; const r = rangePreset(preset); if (r) { [from, to] = r; $('#rp-from').value = from; $('#rp-to').value = to; draw(); } });
  $$('#rp-from,#rp-to').forEach(i => i.onchange = () => { from = $('#rp-from').value; to = $('#rp-to').value; $$('#rp-seg button').forEach(x => x.classList.toggle('on', x.dataset.r === 'custom')); if (from && to) draw(); });
  $('#rp-print').onclick = () => printHTML(plDoc(plData(from, to)));
  draw(); renderCashflowCard($('#rp-cf'), false);
};
function plTable(d) {
  const row = (l, v) => `<tr><td>${l}</td><td class="right num">${money(v)}</td></tr>`;
  return `<table class="tbl"><tbody>
    <tr><td colspan="2" style="font-weight:700;color:var(--pink-d);padding-top:14px">Income</td></tr>
    ${row('Sales (payments received, ex GST)', d.inc.net)}
    <tr><td><b>Total income</b></td><td class="right num"><b>${money(d.inc.net)}</b></td></tr>
    <tr><td colspan="2" style="font-weight:700;color:#7255B5;padding-top:18px">Expenses (ex GST)</td></tr>
    ${d.cats.map(c => row(esc(c.name), c.net)).join('') || '<tr><td colspan="2" class="muted">No expenses</td></tr>'}
    <tr><td><b>Total expenses</b></td><td class="right num"><b>${money(d.ex.net)}</b></td></tr>
    <tr><td style="font-size:17px;font-weight:750;padding-top:16px">Net profit</td><td class="right num" style="font-size:17px;font-weight:750;padding-top:16px;color:${d.net < 0 ? 'var(--bad)' : 'var(--ink)'}">${money(d.net)}</td></tr>
    <tr><td colspan="2" style="font-weight:700;padding-top:18px">GST (shown separately)</td></tr>
    ${row('GST collected on payments', d.inc.gst)}${row('GST paid on expenses (credits)', d.ex.gst)}
    <tr><td><b>Net GST payable</b></td><td class="right num"><b>${money(d.gstNet)}</b></td></tr>
    ${row('<span class="muted">Total received inc GST</span>', d.inc.gross)}${row('<span class="muted">Total spent inc GST</span>', d.ex.gross)}
  </tbody></table>`;
}
function plDoc(d) {
  return `<div class="doc"><div class="d-head">${bizBlock()}<div><div class="d-title" style="font-size:24px">PROFIT &amp; LOSS</div><div style="text-align:right;font-size:13px;margin-top:8px">${fmtD(d.from)} – ${fmtD(d.to)}<br>Cash basis · AUD</div></div></div>
    <div class="d-band"></div>${plTable(d)}<div class="d-foot">Cash basis: income counted when payments were received; expenses by receipt date. Amounts ex GST; GST shown separately. Generated ${fmtD(today())}.</div></div>`;
}

/* ======================= CONTRACTS ======================= */
const linkBase = () => location.origin + location.pathname;
function contractRow(k) { const cu = byId('customers', k.customerId); return `<a class="li" href="#/contract/${k.id}" style="text-decoration:none;color:inherit"><span class="ic ${k.status === 'signed' ? 'ok' : 'lav'}">${icon('pen')}</span><div class="grow"><div class="t">${esc(k.title)}</div><div class="s">${esc(custName(cu))} · ${fmtD(k.createdAt?.slice(0, 10))}</div></div>${pill(k.status)}</a>`; }
V.contracts = async (view, _, q) => {
  const tab = q.get('t') || 'list';
  view.innerHTML = `${demoBanner()}${pageH('Contracts', 'Send agreements for your clients to sign online', `<button class="btn pri" id="k-new">${icon('plus')} New contract</button>`)}
  <div class="tabs"><button data-t="list" class="${tab === 'list' ? 'on' : ''}">Contracts (${S.contracts.length})</button><button data-t="tpl" class="${tab === 'tpl' ? 'on' : ''}">Templates (${S.contractTemplates.length})</button></div><div id="k-body"></div>`;
  $$('.tabs button', view).forEach(b => b.onclick = () => go('contracts?t=' + b.dataset.t));
  const body = $('#k-body');
  if (tab === 'list') body.innerHTML = `<div class="card"><div class="list">${[...S.contracts].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(contractRow).join('') || '<div class="empty">No contracts yet. Create a template, then a contract from it.</div>'}</div></div>
    <div class="note" style="margin-top:16px"><b>How signing works:</b> the contract text travels inside the link itself (nothing is uploaded anywhere). Your client opens the link, signs with a finger or mouse, then emails the signed copy back. Paste what they send into the contract here to mark it signed.</div>`;
  else body.innerHTML = `<div class="card"><div class="list">${S.contractTemplates.map(t => `<div class="li" data-act="edit-ktpl" data-id="${t.id}"><span class="ic lav">${icon('file')}</span><div class="grow"><div class="t">${esc(t.name)}</div><div class="s">${esc(t.body.slice(0, 90))}…</div></div>${icon('edit')}</div>`).join('') || '<div class="empty">No templates yet.</div>'}</div>
    <button class="btn" id="kt-new" style="margin-top:12px">${icon('plus')} New template</button></div>`;
  if ($('#kt-new')) $('#kt-new').onclick = () => editKTplModal(null);
  $('#k-new').onclick = () => newContractModal(q.get('customer'));
  if (q.get('new')) newContractModal(q.get('customer'));
};
const K_PH = '{client} {client_business} {client_email} {client_address} {client_abn} {business} {abn} {business_email} {business_phone} {date} {invoice_no} {total} {deposit_amount} {deposit_pct} {due_date} {payment_terms}';
ACT['edit-ktpl'] = el => editKTplModal(byId('contractTemplates', el.dataset.id));
function editKTplModal(t) {
  const m = openModal({ title: t ? 'Edit contract template' : 'New contract template', wide: true, body: `<div class="stack"><label class="f">Template name<input type="text" id="kt-name" value="${esc(t?.name || '')}"></label>
    <label class="f">Contract text<textarea id="kt-body" style="min-height:340px">${esc(t?.body || '')}</textarea></label><div class="note small">Placeholders: ${K_PH}</div></div>`,
    foot: `${t ? `<button class="btn danger" id="kt-del">${icon('trash')} Delete</button>` : ''}<div class="spacer"></div><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn pri" id="kt-ok">${icon('check')} Save</button>` });
  $('#kt-ok', m).onclick = async () => { const o = t || {}; o.name = $('#kt-name', m).value.trim() || 'Untitled'; o.body = $('#kt-body', m).value; await save('contractTemplates', o); closeModal(); render(); };
  if (t) $('#kt-del', m).onclick = async () => { if (await confirmBox(`Delete template “${esc(t.name)}”?`)) { await remove('contractTemplates', t.id); render(); } };
}
function contractVars(cu, inv) {
  const v = inv ? invoiceVars(inv) : emailVars();
  return Object.assign(v, { client: cu?.name || cu?.business || '', client_business: cu?.business ? ' of ' + cu.business : '', client_email: cu?.email || '', client_address: cu?.address || '', client_abn: cu?.abn || '', date: fmtD(today()) });
}
function newContractModal(custId) {
  if (!S.contractTemplates.length) { toast('Create a contract template first'); go('contracts?t=tpl'); return; }
  const m = openModal({ title: 'New contract', wide: true, body: `<div class="grid g3"><label class="f">Template<select id="nk-t">${S.contractTemplates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
    <label class="f">Customer<select id="nk-c">${custOptions(custId)}</select></label><label class="f">Invoice / quote (optional)<select id="nk-i"></select></label></div>
    <div class="stack" style="margin-top:16px"><label class="f">Title<input type="text" id="nk-title"></label><div id="nk-warn"></div><label class="f">Contract text (edit freely; this exact text is what gets signed)<textarea id="nk-body" style="min-height:300px"></textarea></label></div>`,
    foot: `<button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn pri" id="nk-ok">${icon('link')} Create signing link</button>` });
  const fillInv = () => { const c = $('#nk-c', m).value; const list = S.invoices.filter(i => i.customerId === c).sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''));
    $('#nk-i', m).innerHTML = '<option value="">None</option>' + list.map((i, n) => `<option value="${i.id}" ${n === 0 ? 'selected' : ''}>${i.kind === 'quote' ? 'Quote ' : ''}${esc(i.number)} · ${money(invCalc(i).total)}</option>`).join(''); };
  const fill = () => { const t = byId('contractTemplates', $('#nk-t', m).value); const cu = byId('customers', $('#nk-c', m).value); const inv = byId('invoices', $('#nk-i', m).value);
    $('#nk-title', m).value = t.name + (cu ? ' – ' + custName(cu) : ''); $('#nk-body', m).value = fillTpl(t.body, contractVars(cu, inv)); warn(); };
  const warn = () => { const left = [...new Set($('#nk-body', m).value.match(/\{\w+\}/g) || [])]; $('#nk-warn', m).innerHTML = left.length ? `<div class="note pink">Not filled in yet: <b>${esc(left.join(' '))}</b>. Pick an invoice above, or edit the text.</div>` : ''; };
  $('#nk-body', m).oninput = warn; $('#nk-t', m).onchange = fill; $('#nk-c', m).onchange = () => { fillInv(); fill(); }; $('#nk-i', m).onchange = fill; fillInv(); fill();
  $('#nk-ok', m).onclick = async () => {
    const cu = byId('customers', $('#nk-c', m).value); if (!cu) { toast('Choose a customer'); return; }
    const k = { id: uid(), customerId: cu.id, invoiceId: $('#nk-i', m).value, templateId: $('#nk-t', m).value, title: $('#nk-title', m).value.trim() || 'Agreement', text: $('#nk-body', m).value, status: 'draft', createdAt: new Date().toISOString() };
    k.hash = await sha256short(k.text); k.link = await contractLink(k);
    await save('contracts', k); closeModal(); go('contract/' + k.id);
  };
}
async function contractLink(k) {
  const b = S.settings.business, cu = byId('customers', k.customerId);
  return linkBase() + '#sign=' + await encodePayload({ t: 'c', id: k.id, ti: k.title, tx: k.text, d: k.createdAt.slice(0, 10), b: { n: b.name, e: b.email, p: b.phone, a: b.abn }, cl: cu?.name || cu?.business || '' });
}
function contractDoc(k) {
  const cu = byId('customers', k.customerId), sg = k.signed;
  return `<div class="doc"><div class="d-head">${bizBlock()}<div><div class="d-title" style="font-size:22px">AGREEMENT</div><div style="text-align:right;font-size:13px;margin-top:8px">${esc(k.title)}<br>Ref ${esc(k.id)}</div></div></div><div class="d-band"></div>
    ${custBlock(cu).replace('Bill to', 'Client')}<div class="ctext">${esc(k.text)}</div>
    <div class="d-foot">${sg ? `<div style="display:flex;gap:30px;flex-wrap:wrap;align-items:flex-end"><div><img class="sig-img" src="${strokesToPNG(sg.strokes)}" alt="signature"><div style="margin-top:6px"><b>${esc(sg.name)}</b> · signed ${fmtD(sg.date)}</div></div>
      <div class="tiny" style="color:#777">Signed electronically ${esc(new Date(sg.at).toLocaleString('en-AU'))}<br>Document fingerprint ${esc(sg.hash)} ${sg.verified ? '✓ matches the text sent' : '⚠ does NOT match the text sent'}</div></div>`
      : k.manualSigned ? `<b>Marked signed manually</b> ${fmtD(k.manualSigned)}` : '<span style="color:#999">Not signed yet.</span>'}</div></div>`;
}
V.contract = async (view, [id]) => {
  const k = byId('contracts', id); if (!k) { view.innerHTML = '<div class="card empty">Contract not found.</div>'; return; }
  const cu = byId('customers', k.customerId);
  view.innerHTML = `${pageH(esc(k.title), esc(custName(cu)) + ' · ' + pill(k.status), `<button class="btn" id="kd-print">${icon('printer')} Print / PDF</button>`, 'contracts')}
  <div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start" id="kd-grid">
    <div>${contractDoc(k)}</div>
    <div class="stack sticky">
      <div class="card"><h3>1. Send the signing link</h3><div class="code-box" style="margin:10px 0">${esc(k.link)}</div><div class="row"><button class="btn sm" id="kd-copy">${icon('copy')} Copy link</button><a class="btn sm" href="${esc(k.link)}" target="_blank" rel="noopener">${icon('eye')} Preview</a><button class="btn pri sm" id="kd-mail">${icon('send')} Email to client</button></div>
        <div class="tiny muted" style="margin-top:8px">Link length: ${k.link.length} characters.${k.link.length > 6000 ? ' This is long; some email apps may break it. Consider shortening the contract text.' : ''}</div></div>
      <div class="card"><h3>2. Import the signed copy</h3><p class="small muted">When the client emails back, paste the whole email (or just the signed code), or upload the signed-copy file they sent.</p>
        <textarea id="kd-code" placeholder="Paste here…" style="min-height:80px"></textarea><div class="row" style="margin-top:8px"><button class="btn pri sm" id="kd-imp">${icon('check')} Import signature</button><button class="btn sm" id="kd-file">${icon('upload')} Upload file</button></div>
        <details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">Signed on paper instead?</summary><div class="row" style="margin-top:8px"><button class="btn sm" id="kd-manual">Mark signed manually</button></div></details></div>
      <div class="card"><button class="btn sm danger" id="kd-del">${icon('trash')} Delete contract</button></div>
    </div></div>`;
  if (window.innerWidth < 1100) $('#kd-grid').style.gridTemplateColumns = '1fr';
  $('#kd-print').onclick = () => printHTML(contractDoc(k));
  $('#kd-copy').onclick = async () => toast(await copyText(k.link) ? 'Link copied' : 'Copy failed');
  $('#kd-mail').onclick = async () => { let e = S.outbox.find(x => x.contractId === k.id && x.status !== 'sent'); if (!e) e = await save('outbox', { type: 'contract', contractId: k.id, customerId: k.customerId, status: 'queued', scheduledDate: today() }); openCompose(e); };
  const imp = async text => {
    let p; try { p = await decodePayload(text); } catch (e) { toast('No signed code found in that text'); return; }
    if (p.t !== 'cs') { toast('That code is not a signed contract'); return; }
    if (p.id !== k.id) { const other = byId('contracts', p.id); toast(other ? 'That signature belongs to “' + other.title + '”' : 'That signature is for a different contract'); return; }
    const verified = p.h === k.hash;
    if (!verified && !await confirmBox('Warning: the signed text does not match the contract you sent (it may have been edited). Save the signature anyway (flagged as not matching)?', 'Save anyway', false)) return;
    k.signed = { name: p.n, date: p.dt, at: p.at, strokes: p.s, hash: p.h, verified }; k.status = 'signed'; await save('contracts', k); toast('Signed copy saved'); render();
  };
  $('#kd-imp').onclick = () => imp($('#kd-code').value);
  $('#kd-file').onclick = async () => { const f = await pickFile('.html,.htm,.txt,.json,text/*'); if (f) imp(await readText(f)); };
  $('#kd-manual').onclick = async () => { k.manualSigned = today(); k.status = 'signed'; await save('contracts', k); render(); };
  $('#kd-del').onclick = async () => { if (await confirmBox('Delete this contract record?')) { await remove('contracts', k.id); for (const e of S.outbox.filter(e => e.contractId === k.id)) await remove('outbox', e.id); go('contracts'); } };
};

/* ======================= QUESTIONNAIRES ======================= */
const Q_TYPES = [['text', 'Short text'], ['long', 'Long text'], ['choice', 'Multiple choice (one)'], ['multi', 'Checkboxes (many)'], ['date', 'Date']];
V.forms = async (view, _, q) => {
  view.innerHTML = `${demoBanner()}${pageH('Questionnaires', 'Send clients a form; import their answers into the customer record', `<button class="btn" data-act="import-answers">${icon('download')} Import answers</button><button class="btn pri" id="f-new">${icon('plus')} New questionnaire</button>`)}
  <div class="grid g2" style="align-items:start"><div class="card"><h2 style="margin-bottom:10px">Your questionnaires</h2><div class="list">${S.forms.map(f => `<div class="li" style="cursor:default"><span class="ic">${icon('clip')}</span><div class="grow"><div class="t">${esc(f.title)}</div><div class="s">${f.questions.length} questions</div></div><button class="btn sm" data-act="edit-form" data-id="${f.id}">${icon('edit')}</button><button class="btn pri sm" data-act="send-form" data-id="${f.id}">${icon('send')} Send</button></div>`).join('') || '<div class="empty">None yet.</div>'}</div></div>
  <div class="card"><h2 style="margin-bottom:10px">Answers received</h2><div class="list">${[...S.responses].sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || '')).map(r => `<div class="li" data-act="view-response" data-id="${r.id}"><span class="ic lav">${icon('inbox')}</span><div class="grow"><div class="t">${esc(r.title)}</div><div class="s">${esc(custName(byId('customers', r.customerId)))} · ${fmtD(r.receivedAt)}</div></div></div>`).join('') || '<div class="empty">No answers imported yet.</div>'}</div></div></div>
  <div class="note" style="margin-top:16px"><b>How it works:</b> the questions travel inside the link. Your client fills it in, then taps “Email my answers”, which sends you their answers plus an answer code. Paste that email into <b>Import answers</b> to save it on the customer.</div>`;
  $('#f-new').onclick = () => editFormModal(null);
  if (q.get('send')) sendFormModal(null, q.get('customer'));
};
ACT['edit-form'] = el => editFormModal(byId('forms', el.dataset.id));
ACT['send-form'] = el => sendFormModal(el.dataset.id);
function editFormModal(f) {
  const o = f ? structuredClone(f) : { title: '', intro: '', questions: [{ id: uid(), type: 'text', label: '', options: [], req: false }] };
  const m = openModal({ title: f ? 'Edit questionnaire' : 'New questionnaire', wide: true, body: `<div class="stack"><label class="f">Title<input type="text" id="fe-title" value="${esc(o.title)}"></label><label class="f">Intro text (optional)<textarea id="fe-intro" rows="2" style="min-height:60px">${esc(o.intro || '')}</textarea></label><div id="fe-qs"></div><button class="btn" id="fe-add">${icon('plus')} Add question</button></div>`,
    foot: `${f ? `<button class="btn danger" id="fe-del">${icon('trash')} Delete</button>` : ''}<div class="spacer"></div><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn pri" id="fe-ok">${icon('check')} Save</button>` });
  const drawQ = () => {
    $('#fe-qs', m).innerHTML = o.questions.map((qq, i) => `<div class="card flat" style="margin-bottom:10px" data-i="${i}"><div class="row nw"><b class="muted">${i + 1}.</b><input type="text" data-f="label" value="${esc(qq.label)}" placeholder="Question"><select data-f="type" style="max-width:200px">${Q_TYPES.map(([k, l]) => `<option value="${k}" ${k === qq.type ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${qq.type === 'choice' || qq.type === 'multi' ? `<textarea data-f="options" placeholder="One option per line" style="min-height:70px;margin-top:8px">${esc((qq.options || []).join('\n'))}</textarea>` : ''}
      <div class="row" style="margin-top:8px"><label class="chk small"><input type="checkbox" data-f="req" ${qq.req ? 'checked' : ''}> Required</label><div class="spacer"></div><button class="btn ghost sm" data-mv="-1">↑</button><button class="btn ghost sm" data-mv="1">↓</button><button class="btn ghost sm" data-rm="1">${icon('trash')}</button></div></div>`).join('');
  };
  drawQ();
  $('#fe-qs', m).addEventListener('input', e => { const c = e.target.closest('[data-i]'); if (!c) return; const qq = o.questions[+c.dataset.i], f2 = e.target.dataset.f; if (f2 === 'label') qq.label = e.target.value; if (f2 === 'options') qq.options = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); if (f2 === 'req') qq.req = e.target.checked; });
  $('#fe-qs', m).addEventListener('change', e => { const c = e.target.closest('[data-i]'); if (c && e.target.dataset.f === 'type') { o.questions[+c.dataset.i].type = e.target.value; drawQ(); } if (c && e.target.dataset.f === 'req') o.questions[+c.dataset.i].req = e.target.checked; });
  $('#fe-qs', m).addEventListener('click', e => { const c = e.target.closest('[data-i]'); const b = e.target.closest('button'); if (!c || !b) return; const i = +c.dataset.i;
    if (b.dataset.rm) o.questions.splice(i, 1); else if (b.dataset.mv) { const j = i + +b.dataset.mv; if (j >= 0 && j < o.questions.length) [o.questions[i], o.questions[j]] = [o.questions[j], o.questions[i]]; } drawQ(); });
  $('#fe-add', m).onclick = () => { o.questions.push({ id: uid(), type: 'text', label: '', options: [], req: false }); drawQ(); };
  $('#fe-ok', m).onclick = async () => { o.title = $('#fe-title', m).value.trim() || 'Questionnaire'; o.intro = $('#fe-intro', m).value.trim(); o.questions = o.questions.filter(x => x.label.trim()); if (!o.questions.length) { toast('Add at least one question'); return; } await save('forms', o); closeModal(); render(); };
  if (f) $('#fe-del', m).onclick = async () => { if (await confirmBox(`Delete “${esc(f.title)}”? Imported answers are kept.`)) { await remove('forms', f.id); render(); } };
}
function sendFormModal(formId, custId) {
  if (!S.forms.length) { toast('Create a questionnaire first'); return; }
  const m = openModal({ title: 'Send questionnaire', body: `<div class="stack"><label class="f">Questionnaire<select id="sf-f">${S.forms.map(f => `<option value="${f.id}" ${f.id === formId ? 'selected' : ''}>${esc(f.title)}</option>`).join('')}</select></label><label class="f">Customer<select id="sf-c">${custOptions(custId)}</select></label></div>`,
    foot: `<button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn pri" id="sf-ok">${icon('link')} Create link &amp; email</button>` });
  $('#sf-ok', m).onclick = async () => {
    const f = byId('forms', $('#sf-f', m).value), cu = byId('customers', $('#sf-c', m).value); if (!cu) { toast('Choose a customer'); return; }
    const b = S.settings.business;
    const link = linkBase() + '#q=' + await encodePayload({ t: 'q', f: f.id, ti: f.title, in: f.intro, qs: f.questions.map(x => ({ i: x.id, y: x.type, l: x.label, o: x.options, r: x.req ? 1 : 0 })), b: { n: b.name, e: b.email }, c: cu.id, cn: cu.name || cu.business });
    const e = await save('outbox', { type: 'questionnaire', customerId: cu.id, formId: f.id, formTitle: f.title, link, status: 'queued', scheduledDate: today(), createdAt: new Date().toISOString() });
    openCompose(e);
  };
}
ACT['import-answers'] = el => {
  const pre = el.dataset.customer || '';
  const m = openModal({ title: 'Import questionnaire answers', wide: true, body: `<div class="stack"><p class="small muted" style="margin:0">Paste the client's whole email (or just the answer code), or upload the answers file they sent.</p>
    <textarea id="ia-t" style="min-height:140px" placeholder="Paste here…"></textarea><div class="row"><button class="btn sm" id="ia-file">${icon('upload')} Upload file</button><button class="btn sm" id="ia-read">Read answers</button></div><div id="ia-prev"></div></div>`,
    foot: `<button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn pri" id="ia-ok" disabled>${icon('check')} Save to customer</button>` });
  let parsed = null;
  const read = async () => {
    const t = $('#ia-t', m).value; const prev = $('#ia-prev', m);
    try { const p = await decodePayload(t); if (p.t !== 'qa') throw new Error('not answers'); parsed = { title: p.ti, formId: p.f, answers: p.a, customerId: byId('customers', p.c) ? p.c : pre, at: p.at, from: p.cn }; }
    catch (e) { parsed = t.trim() ? { title: 'Questionnaire answers (pasted text)', answers: [['Answers', t.trim()]], customerId: pre, raw: true } : null; }
    if (!parsed) { prev.innerHTML = ''; $('#ia-ok', m).disabled = true; return; }
    prev.innerHTML = `${parsed.raw ? '<div class="note pink">No answer code found, so the pasted text will be saved as-is.</div>' : `<div class="note">Found answers to <b>${esc(parsed.title)}</b>${parsed.from ? ' from ' + esc(parsed.from) : ''}.</div>`}
      <label class="f" style="margin-top:12px">Customer<select id="ia-c">${custOptions(parsed.customerId)}</select></label>
      <table class="tbl" style="margin-top:10px">${parsed.answers.map(([q2, a]) => `<tr><td class="muted" style="width:40%">${esc(q2)}</td><td style="white-space:pre-wrap">${esc(a)}</td></tr>`).join('')}</table>`;
    $('#ia-ok', m).disabled = false;
  };
  $('#ia-read', m).onclick = read; $('#ia-t', m).addEventListener('input', () => { clearTimeout(m._t); m._t = setTimeout(read, 400); });
  $('#ia-file', m).onclick = async () => { const f = await pickFile('.txt,.html,.json,text/*'); if (f) { $('#ia-t', m).value = await readText(f); read(); } };
  $('#ia-ok', m).onclick = async () => {
    const c = $('#ia-c', m).value; if (!c) { toast('Choose a customer'); return; }
    await save('responses', { customerId: c, formId: parsed.formId || '', title: parsed.title, answers: parsed.answers, receivedAt: (parsed.at || new Date().toISOString()).slice(0, 10) });
    closeModal(); toast('Answers saved to ' + custName(byId('customers', c))); go('customer/' + c);
  };
};
ACT['view-response'] = el => {
  const r = byId('responses', el.dataset.id); const cu = byId('customers', r.customerId);
  const doc = `<div class="doc"><div class="d-head">${bizBlock()}<div><div class="d-title" style="font-size:20px">QUESTIONNAIRE</div><div style="text-align:right;font-size:13px;margin-top:8px">${esc(r.title)}<br>${esc(custName(cu))}<br>${fmtD(r.receivedAt)}</div></div></div><div class="d-band"></div>
    <table>${r.answers.map(([q, a]) => `<tr><td style="width:40%;color:#666">${esc(q)}</td><td style="white-space:pre-wrap">${esc(a)}</td></tr>`).join('')}</table></div>`;
  const m = openModal({ title: esc(r.title), wide: true, body: doc, foot: `<button class="btn danger" id="vr-del">${icon('trash')} Delete</button><div class="spacer"></div><button class="btn" id="vr-print">${icon('printer')} Print</button>` });
  $('#vr-print', m).onclick = () => printHTML(doc);
  $('#vr-del', m).onclick = async () => { if (await confirmBox('Delete these answers?')) { await remove('responses', r.id); render(); } };
};

/* ======================= PUBLIC PAGES (client side: #sign= / #q=) ======================= */
const PUBLIC = {
  async render(hash) {
    $('#app').hidden = true; const root = $('#public'); root.hidden = false; document.title = 'Please review';
    const code = hash.replace(/^#(sign|q)=/, '');
    let p; try { p = await decodePayload(code); } catch (e) { root.innerHTML = `<div class="wrap"><div class="card"><h2>This link looks incomplete</h2><p class="muted">Part of the link may have been cut off by the email app. Please copy the whole link into your browser, or ask the sender to resend it.</p></div></div>`; return; }
    if (hash.startsWith('#sign=') && p.t === 'c') return PUBLIC.sign(root, p);
    if (hash.startsWith('#q=') && p.t === 'q') return PUBLIC.form(root, p);
    root.innerHTML = '<div class="wrap"><div class="card"><h2>Unknown link</h2></div></div>';
  },
  head(p, kind) { return `<div class="row no-print" style="margin-bottom:18px"><span class="ic" style="width:46px;height:46px">${icon(kind === 'sign' ? 'pen' : 'clip')}</span><div><div class="small muted">${esc(p.b?.n || '')}</div><h1 style="font-size:22px">${esc(p.ti)}</h1></div></div>`; },
  sign(root, p) {
    document.title = 'Sign: ' + p.ti;
    root.innerHTML = `<div class="wrap">${PUBLIC.head(p, 'sign')}
      <div class="card no-print" id="sg-text"><p class="small muted" style="margin-top:0">${esc(p.b?.n || 'The sender')} has asked you to review and sign this agreement${p.cl ? ', ' + esc(p.cl) : ''}.</p><div style="white-space:pre-wrap;line-height:1.6;max-height:55vh;overflow:auto;border:1px solid var(--line);border-radius:14px;padding:16px">${esc(p.tx)}</div></div>
      <div class="card no-print" style="margin-top:16px" id="sg-form"><h2 style="margin-bottom:12px">Sign</h2><div class="grid g2"><label class="f">Your full name<input type="text" id="sg-name" value="${esc(p.cl || '')}" autocomplete="name"></label><label class="f">Date<input type="date" id="sg-date" value="${today()}"></label></div>
        <div class="row" style="margin:14px 0 6px"><b class="small">Draw your signature</b><div class="spacer"></div><button class="btn ghost sm" id="sg-clear">Clear</button></div><canvas class="sigpad" id="sg-pad"></canvas>
        <label class="chk" style="margin-top:14px"><input type="checkbox" id="sg-agree"> I have read and agree to this agreement, and I'm signing it electronically.</label>
        <button class="btn pri block" id="sg-go" style="margin-top:16px">${icon('pen')} Sign agreement</button></div><div id="sg-done"></div>
      <p class="tiny muted no-print" style="text-align:center;margin-top:20px">Nothing is uploaded: this page runs in your browser. After signing, send the signed copy back by email.</p></div>`;
    const pad = $('#sg-pad'); const strokes = []; let cur = null;
    const fit = () => { const r = pad.getBoundingClientRect(); if (!r.width) return; pad.width = r.width * devicePixelRatio; pad.height = r.height * devicePixelRatio; drawStrokes(pad, strokes); };
    fit(); window.addEventListener('resize', fit);
    const pt = e => { const r = pad.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * 600), Math.round((e.clientY - r.top) / r.height * 200)]; };
    pad.addEventListener('pointerdown', e => { e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (x) { } cur = pt(e); strokes.push(cur); drawStrokes(pad, strokes); });
    pad.addEventListener('pointermove', e => { if (!cur) return; const [x, y] = pt(e); const n = cur.length; if (Math.abs(cur[n - 2] - x) + Math.abs(cur[n - 1] - y) < 3) return; cur.push(x, y); drawStrokes(pad, strokes); });
    const end = () => { cur = null; }; pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
    $('#sg-clear').onclick = () => { strokes.length = 0; drawStrokes(pad, strokes); };
    $('#sg-go').onclick = async () => {
      const name = $('#sg-name').value.trim(), date = $('#sg-date').value;
      if (!name) { toast('Please type your full name'); return; } if (!strokes.length) { toast('Please draw your signature'); return; } if (!$('#sg-agree').checked) { toast('Please tick the box to agree'); return; }
      const signed = { t: 'cs', id: p.id, h: await sha256short(p.tx), n: name, dt: date, at: new Date().toISOString(), s: strokes };
      const code = await encodePayload(signed); const png = strokesToPNG(strokes);
      const docHTML = `<div class="doc" id="sg-doc"><div style="font-size:13px;color:#777">${esc(p.b?.n || '')}${p.b?.a ? ' · ABN ' + esc(p.b.a) : ''}</div><div class="d-title" style="text-align:left;font-size:24px;margin-top:6px">${esc(p.ti)}</div><div class="d-band"></div><div class="ctext">${esc(p.tx)}</div>
        <div class="d-foot"><img class="sig-img" src="${png}" alt="signature"><div style="margin-top:6px"><b>${esc(name)}</b> · signed ${fmtD(date)}</div><div class="tiny" style="color:#777;margin-top:6px">Signed electronically ${esc(new Date(signed.at).toLocaleString('en-AU'))} · document fingerprint ${signed.h} · ref ${esc(p.id)}</div>
        <div class="tiny" style="color:#999;margin-top:10px;word-break:break-all">Signed code: ${code}</div></div></div>`;
      $('#sg-form').hidden = true; $('#sg-text').hidden = true;
      const subj = `Signed: ${p.ti} – ${name}`;
      const body = `Hi${p.b?.n ? ' ' + p.b.n : ''},\n\nI have signed "${p.ti}" on ${fmtD(date)}.\n\nSigned by: ${name}\n\nSigned code (this records my signature, please keep it):\n${code}\n`;
      $('#sg-done').innerHTML = `<div class="card no-print" style="margin-bottom:16px;text-align:center"><span class="ic ok" style="width:56px;height:56px;margin:0 auto">${icon('check')}</span><h2 style="margin-top:10px">Signed, thank you!</h2><p class="muted">Now please send the signed copy back to ${esc(p.b?.n || 'the sender')}.</p>
        <div class="row" style="justify-content:center"><a class="btn pri" id="sg-mail" href="${mailtoURL(p.b?.e || '', subj, body)}">${icon('send')} Email signed copy back</a><button class="btn" id="sg-dl">${icon('download')} Download signed copy</button><button class="btn" id="sg-pr">${icon('printer')} Print / Save PDF</button><button class="btn ghost" id="sg-cp">${icon('copy')} Copy signed code</button></div>
        <p class="tiny muted">If your email app doesn't open or cuts the message off, download the signed copy and attach it to an email${p.b?.e ? ' to ' + esc(p.b.e) : ''}.</p></div>${docHTML}`;
      $('#sg-pr').onclick = () => window.print();
      $('#sg-cp').onclick = async () => toast(await copyText(code) ? 'Copied' : 'Copy failed');
      $('#sg-dl').onclick = () => download(`Signed - ${p.ti.replace(/[^\w\- ]+/g, '')}.html`, `<!doctype html><meta charset="utf-8"><title>${esc(subj)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:30px auto;padding:0 16px;color:#222}.ctext{white-space:pre-wrap;line-height:1.6}.d-band{height:5px;border-radius:5px;background:linear-gradient(90deg,#E85D9A,#9B7BD4);margin:16px 0}.sig-img{max-width:300px;border-bottom:1px solid #999;display:block}.d-title{font-weight:700;color:#D04585}.d-foot{margin-top:24px;border-top:1px solid #eee;padding-top:14px}.tiny{font-size:11px}</style>${docHTML}`, 'text/html');
      window.scrollTo(0, 0);
    };
  },
  form(root, p) {
    document.title = p.ti;
    root.innerHTML = `<div class="wrap">${PUBLIC.head(p, 'q')}<div class="card" id="qf">${p.cn ? `<p style="margin-top:0">Hi ${esc(p.cn.split(' ')[0])},</p>` : ''}${p.in ? `<p class="muted" style="white-space:pre-wrap">${esc(p.in)}</p>` : ''}
      ${p.qs.map((q, i) => `<div class="q-item" data-i="${i}"><label class="f" style="color:var(--ink);font-size:15px">${esc(q.l)}${q.r ? ' <span style="color:var(--pink)">*</span>' : ''}</label>${
        q.y === 'long' ? '<textarea style="margin-top:8px"></textarea>' : q.y === 'date' ? '<input type="date" style="margin-top:8px;max-width:220px">' :
        q.y === 'choice' || q.y === 'multi' ? `<div class="opts">${(q.o || []).map(o => `<label class="chk"><input type="${q.y === 'choice' ? 'radio' : 'checkbox'}" name="q${i}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>` : '<input type="text" style="margin-top:8px">'}</div>`).join('')}
      <button class="btn pri block" id="qf-go" style="margin-top:18px">${icon('check')} Submit answers</button></div><div id="qf-done"></div>
      <p class="tiny muted" style="text-align:center;margin-top:20px">Nothing is uploaded: your answers are sent back by email from your own email app.</p></div>`;
    $('#qf-go').onclick = async () => {
      const ans = []; let missing = null;
      p.qs.forEach((q, i) => { const el = $(`.q-item[data-i="${i}"]`); let a;
        if (q.y === 'choice' || q.y === 'multi') a = $$('input:checked', el).map(x => x.value).join(', '); else if (q.y === 'date') { const v = $('input', el).value; a = v ? fmtD(v) : ''; } else a = ($('textarea,input', el).value || '').trim();
        if (q.r && !a && !missing) missing = el; ans.push([q.l, a]); });
      if (missing) { missing.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Please answer the required questions'); return; }
      const code = await encodePayload({ t: 'qa', f: p.f, ti: p.ti, c: p.c, cn: p.cn, at: new Date().toISOString(), a: ans });
      const readable = ans.map(([q, a]) => `${q}\n${a || '-'}`).join('\n\n');
      const body = `Hi${p.b?.n ? ' ' + p.b.n : ''},\n\nHere are my answers to "${p.ti}":\n\n${readable}\n\nAnswer code (for importing):\n${code}\n`;
      $('#qf').hidden = true;
      $('#qf-done').innerHTML = `<div class="card" style="text-align:center"><span class="ic ok" style="width:56px;height:56px;margin:0 auto">${icon('check')}</span><h2 style="margin-top:10px">Thank you!</h2><p class="muted">Last step: send your answers back to ${esc(p.b?.n || 'us')}.</p>
        <div class="row" style="justify-content:center"><a class="btn pri" id="qf-mail" href="${mailtoURL(p.b?.e || '', 'Answers: ' + p.ti + (p.cn ? ' – ' + p.cn : ''), body)}">${icon('send')} Email my answers</a><button class="btn" id="qf-cp">${icon('copy')} Copy answers</button><button class="btn" id="qf-dl">${icon('download')} Download</button></div>
        <p class="tiny muted">If your email app doesn't open, copy the answers and paste them into an email${p.b?.e ? ' to ' + esc(p.b.e) : ''}.</p></div>
        <div class="card" style="margin-top:16px"><table class="tbl">${ans.map(([q, a]) => `<tr><td class="muted" style="width:40%">${esc(q)}</td><td style="white-space:pre-wrap">${esc(a)}</td></tr>`).join('')}</table></div>`;
      $('#qf-cp').onclick = async () => toast(await copyText(body) ? 'Copied' : 'Copy failed');
      $('#qf-dl').onclick = () => download(`Answers - ${p.ti.replace(/[^\w\- ]+/g, '')}.txt`, body);
      window.scrollTo(0, 0);
    };
  },
};

/* ======================= CSV IMPORT ======================= */
const IMPORT_DEF = {
  customers: { label: 'Customers', fields: [['name', 'Contact name', ['contact', 'contactname', 'fullname', 'customer', 'client']], ['business', 'Business', ['company', 'businessname', 'organisation', 'organization']], ['email', 'Email', ['emailaddress']], ['phone', 'Phone', ['mobile', 'phonenumber', 'tel']], ['address', 'Address', ['street', 'postaladdress']], ['abn', 'ABN', []], ['notes', 'Notes', ['note', 'comments']]],
    sample: [['name', 'business', 'email', 'phone', 'address', 'abn', 'notes'], ['Alex Sample', 'Sample Pty Ltd', 'alex@example.com', '0400 000 001', '1 Example St, Sampleville NSW 2000', '', 'Prefers email'], ['Jordan Example', '', 'jordan@example.com', '0400 000 002', '', '', '']] },
  invoices: { label: 'Invoices (+ payments)', fields: [['invoice_no', 'Invoice number *', ['invoice', 'invoicenumber', 'number', 'invno']], ['customer', 'Customer name *', ['client', 'customername']], ['customer_email', 'Customer email', ['email']], ['issue_date', 'Issue date *', ['date', 'invoicedate', 'issued']], ['due_date', 'Due date', ['due']], ['description', 'Line description', ['item', 'service', 'details']], ['quantity', 'Quantity', ['qty']], ['unit_price', 'Unit price ex GST', ['price', 'rate', 'unitprice']], ['total_inc_gst', 'Line total inc GST (if no unit price)', ['total', 'amount', 'totalincgst']], ['gst', 'GST? (yes/no)', ['taxable']], ['amount_paid', 'Amount paid', ['paid', 'amountpaid']], ['paid_date', 'Date paid', ['paymentdate', 'datepaid']], ['status', 'Status (draft/sent/paid)', []]],
    sample: [['invoice_no', 'customer', 'customer_email', 'issue_date', 'due_date', 'description', 'quantity', 'unit_price', 'total_inc_gst', 'gst', 'amount_paid', 'paid_date', 'status'], ['OLD-001', 'Alex Sample', 'alex@example.com', '15/03/2026', '29/03/2026', 'Consultation', '2', '120', '', 'yes', '264', '20/03/2026', 'paid'], ['OLD-002', 'Jordan Example', 'jordan@example.com', '02/04/2026', '16/04/2026', 'Design package', '1', '', '935', 'yes', '', '', 'sent'], ['OLD-002', 'Jordan Example', 'jordan@example.com', '02/04/2026', '16/04/2026', 'Site visit', '1', '180', '', 'yes', '', '', 'sent']] },
  payments: { label: 'Payments', fields: [['invoice_no', 'Invoice number *', ['invoice', 'invoicenumber', 'number', 'reference']], ['date', 'Date *', ['paymentdate', 'datepaid']], ['amount', 'Amount *', ['paid', 'amountpaid', 'total']], ['method', 'Method', ['type', 'paymentmethod']], ['note', 'Note', ['notes', 'memo']]],
    sample: [['invoice_no', 'date', 'amount', 'method', 'note'], ['OLD-002', '10/04/2026', '500', 'Bank transfer', 'Deposit']] },
  expenses: { label: 'Expenses', fields: [['date', 'Date *', ['expensedate']], ['supplier', 'Supplier *', ['vendor', 'payee', 'merchant']], ['category', 'Category', ['account', 'type']], ['amount', 'Amount inc GST *', ['total', 'amountincgst', 'cost']], ['gst', 'GST amount', ['tax', 'gstamount']], ['notes', 'Notes', ['note', 'memo', 'description']]],
    sample: [['date', 'supplier', 'category', 'amount', 'gst', 'notes'], ['05/03/2026', 'Example Hardware', 'Materials', '110.00', '10.00', ''], ['12/03/2026', 'Sample Fuel Co', 'Fuel', '88.00', '', 'GST blank: can be auto-calculated']] },
};
const normH = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
V.import = async (view, _, q) => {
  const type = IMPORT_DEF[q.get('type')] ? q.get('type') : 'customers'; let rows = null, headers = [], map = {};
  view.innerHTML = `${pageH('Import from CSV', 'Bring in customers and business history from a spreadsheet or your old system')}
    <div class="card"><h2 style="margin-bottom:12px">1. What are you importing?</h2><div class="seg" id="im-type">${Object.entries(IMPORT_DEF).map(([k, d]) => `<button data-t="${k}" class="${k === type ? 'on' : ''}">${d.label}</button>`).join('')}</div>
      <div class="row" style="margin-top:16px"><button class="btn" id="im-tpl">${icon('download')} Download template CSV</button><button class="btn pri" id="im-file">${icon('upload')} Choose CSV file</button><span class="small muted" id="im-fn"></span></div>
      <div class="note" style="margin-top:14px">Tips: export from Excel or Google Sheets as CSV. Dates can be DD/MM/YYYY or YYYY-MM-DD. Import invoices before payments. For invoices, several rows with the same number become line items on one invoice; invoice numbers already in the app are skipped.</div></div>
    <div id="im-map"></div><div id="im-res"></div>`;
  $$('#im-type button').forEach(b => b.onclick = () => go('import?type=' + b.dataset.t));
  $('#im-tpl').onclick = () => download(`template-${type}.csv`, toCSV(IMPORT_DEF[type].sample), 'text/csv');
  const loadText = text => {
    const all = parseCSV(text); if (all.length < 2) { toast('No rows found'); return; }
    headers = all[0].map(h => h.trim()); rows = all.slice(1); map = {};
    for (const [k, , al] of IMPORT_DEF[type].fields) { const i = headers.findIndex(h => [normH(k), ...al.map(normH)].includes(normH(h))); if (i >= 0 && !Object.values(map).includes(i)) map[k] = i; }
    drawMap();
  };
  V.import._load = loadText; // used by automated tests
  $('#im-file').onclick = async () => { const f = await pickFile('.csv,text/csv'); if (!f) return; $('#im-fn').textContent = f.name; loadText(await readText(f)); };
  const rec = r => { const o = {}; for (const [k] of IMPORT_DEF[type].fields) o[k] = map[k] >= 0 ? String(r[map[k]] ?? '').trim() : ''; return o; };
  const drawMap = () => {
    $('#im-res').innerHTML = '';
    $('#im-map').innerHTML = `<div class="card" style="margin-top:18px"><h2 style="margin-bottom:6px">2. Match your columns</h2><p class="small muted" style="margin-top:0">${rows.length} rows found. We've matched what we could; check each one. * = required.</p>
      ${IMPORT_DEF[type].fields.map(([k, l]) => `<div class="map-row"><b class="small">${l}</b><select data-k="${k}"><option value="-1">— skip —</option>${headers.map((h, i) => `<option value="${i}" ${map[k] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}
      ${type === 'expenses' ? `<label class="chk" style="margin-top:10px"><input type="checkbox" id="im-g11" checked> If GST is blank, assume the amount includes GST (GST = amount ÷ 11)</label>` : ''}
      <h3 style="margin:18px 0 8px">Preview (first 5 rows)</h3><div class="tbl-wrap"><table class="tbl small" id="im-prev"></table></div>
      <button class="btn pri" id="im-go" style="margin-top:16px">${icon('check')} Import ${rows.length} rows</button></div>`;
    const prev = () => { const fl = IMPORT_DEF[type].fields.filter(([k]) => map[k] >= 0); $('#im-prev').innerHTML = `<tr>${fl.map(([, l]) => `<th>${l}</th>`).join('')}</tr>` + rows.slice(0, 5).map(r => { const o = rec(r); return `<tr>${fl.map(([k]) => `<td>${esc(o[k])}</td>`).join('')}</tr>`; }).join(''); };
    $$('#im-map select').forEach(s => s.onchange = () => { map[s.dataset.k] = +s.value; prev(); }); prev();
    $('#im-go').onclick = async () => { $('#im-go').disabled = true; try { const res = await runImport(type, rows.map(rec), { g11: $('#im-g11')?.checked }); $('#im-res').innerHTML = `<div class="card" style="margin-top:18px" id="im-done"><h2>Done</h2><p>${res}</p><a class="btn" href="#/${type === 'payments' ? 'invoices' : type}">View ${type}</a></div>`; renderNav(); } catch (e) { console.error(e); toast(e.message); $('#im-go').disabled = false; } };
  };
};
async function runImport(type, recs, opt) {
  let ok = 0, skip = 0; const notes = [];
  const yes = v => /^(y|yes|true|1|gst|incl?)$/i.test(String(v).trim());
  if (type === 'customers') {
    for (const r of recs) { if (!r.name && !r.business) { skip++; continue; } await save('customers', { ...r, createdAt: new Date().toISOString(), imported: true }); ok++; }
    return `Imported ${ok} customers${skip ? `, skipped ${skip} rows with no name` : ''}.`;
  }
  if (type === 'expenses') {
    for (const r of recs) { const d = normDate(r.date), amt = r2(num(r.amount)); if (!d || !amt || !r.supplier) { skip++; continue; }
      const gst = r.gst !== '' ? r2(num(r.gst)) : (opt.g11 ? r2(amt / 11) : 0);
      await save('expenses', { date: d, supplier: r.supplier, category: r.category || 'Other', amount: amt, gst, gstIncl: gst > 0, notes: r.notes, createdAt: new Date().toISOString(), imported: true }); ok++; }
    return `Imported ${ok} expenses${skip ? `, skipped ${skip} rows missing a date, supplier or amount` : ''}.`;
  }
  if (type === 'payments') {
    for (const r of recs) { const inv = S.invoices.find(i => i.number.toLowerCase() === r.invoice_no.toLowerCase()); const d = normDate(r.date), amt = r2(num(r.amount));
      if (!inv || !d || !amt) { skip++; if (!inv && r.invoice_no) notes.push(r.invoice_no); continue; }
      await save('payments', { invoiceId: inv.id, date: d, amount: amt, method: r.method || 'Bank transfer', note: r.note, imported: true }); ok++; }
    return `Imported ${ok} payments${skip ? `, skipped ${skip} rows` : ''}${notes.length ? ` (invoice not found: ${esc([...new Set(notes)].slice(0, 8).join(', '))})` : ''}.`;
  }
  // invoices: group rows by number
  const groups = new Map(); for (const r of recs) { if (!r.invoice_no) { skip++; continue; } if (!groups.has(r.invoice_no)) groups.set(r.invoice_no, []); groups.get(r.invoice_no).push(r); }
  let pays = 0, newCust = 0;
  for (const [no, rs] of groups) {
    if (S.invoices.some(i => i.number === no)) { skip += rs.length; notes.push(no); continue; }
    const h = rs[0]; if (!h.customer && !h.customer_email) { skip += rs.length; continue; }
    const nm = (h.customer || h.customer_email).toLowerCase(), em = (h.customer_email || '').toLowerCase();
    let cu = (em && S.customers.find(c => (c.email || '').toLowerCase() === em)) || S.customers.find(c => (c.name || '').toLowerCase() === nm || (c.business || '').toLowerCase() === nm);
    if (!cu) { cu = await save('customers', { name: h.customer || h.customer_email, email: h.customer_email || '', createdAt: new Date().toISOString(), imported: true }); newCust++; }
    const issue = normDate(h.issue_date) || today();
    const items = rs.map(r => { const g = r.gst === '' ? S.settings.business.gstRegistered !== false : yes(r.gst); const qty = num(r.quantity) || 1; let price = num(r.unit_price);
      if (!r.unit_price && r.total_inc_gst) price = r2(num(r.total_inc_gst) / (g ? 1.1 : 1) / qty);
      return { desc: r.description || 'Imported item', details: '', qty, price, discountPct: 0, gst: g }; });
    const st = (h.status || '').toLowerCase();
    const inv = await save('invoices', { kind: 'invoice', number: no, customerId: cu.id, issueDate: issue, dueDate: normDate(h.due_date) || addDays(issue, 14), items, notes: '', sent: st !== 'draft', deposit: { type: 'pct', value: S.settings.depositPct }, emailDeposit: false, emailBalance: false, imported: true, createdAt: new Date().toISOString() });
    ok++;
    const pr = rs.find(r => num(r.amount_paid) > 0);
    if (pr) { await save('payments', { invoiceId: inv.id, date: normDate(pr.paid_date) || inv.dueDate, amount: r2(num(pr.amount_paid)), method: 'Bank transfer', note: 'Imported', imported: true }); pays++; }
    else if (st === 'paid') { await save('payments', { invoiceId: inv.id, date: normDate(h.paid_date) || inv.dueDate, amount: invCalc(inv).total, method: 'Bank transfer', note: 'Imported (marked paid)', imported: true }); pays++; }
  }
  return `Imported ${ok} invoices${pays ? ` with ${pays} payments` : ''}${newCust ? `, created ${newCust} new customers` : ''}${skip ? `. Skipped ${skip} rows` : ''}${notes.length ? ` (already exist: ${esc(notes.slice(0, 8).join(', '))})` : ''}. Imported invoices don't schedule any emails.`;
}

/* ======================= SETTINGS ======================= */
V.settings = async (view, _, q) => {
  const tab = q.get('tab') || 'business'; const st = S.settings, b = st.business;
  const tabs = [['business', 'Business'], ['invoices', 'Invoices & numbering'], ['emails', 'Email templates'], ['categories', 'Expense categories'], ['data', 'Data & backup']];
  view.innerHTML = `${demoBanner()}${pageH('Settings')}<div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div><div id="st-body"></div>`;
  $$('.tabs button', view).forEach(x => x.onclick = () => go('settings?tab=' + x.dataset.t));
  const body = $('#st-body');
  const field = (k, l, t = 'text', obj = 'b') => `<label class="f">${l}<input type="${t}" data-${obj}="${k}" value="${esc((obj === 'b' ? b : st)[k] ?? '')}"></label>`;
  const saveBtn = `<button class="btn pri" id="st-save" style="margin-top:18px">${icon('check')} Save</button>`;
  const bindSave = () => $('#st-save').onclick = async () => {
    $$('[data-b]', body).forEach(i => b[i.dataset.b] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? num(i.value) : i.value.trim());
    $$('[data-s]', body).forEach(i => st[i.dataset.s] = i.type === 'number' ? num(i.value) : i.value);
    await saveSettings(); toast('Settings saved'); renderNav();
  };
  if (tab === 'business') {
    body.innerHTML = `<div class="grid g2" style="align-items:start"><div class="card"><h2 style="margin-bottom:14px">Business details</h2><div class="stack">${field('name', 'Business name')}${field('abn', 'ABN')}
      <label class="f">Address<textarea data-b="address" rows="3" style="min-height:70px">${esc(b.address)}</textarea></label><div class="grid g2">${field('email', 'Email', 'email')}${field('phone', 'Phone', 'tel')}</div>${field('website', 'Website')}
      <label class="chk"><input type="checkbox" data-b="gstRegistered" ${b.gstRegistered !== false ? 'checked' : ''}> Registered for GST (show “Tax invoice” and add 10% GST by default)</label></div></div>
      <div class="stack"><div class="card"><h2 style="margin-bottom:14px">Logo</h2><div class="row">${st.logo ? `<img src="${st.logo}" class="logo-prev" alt="logo">` : '<div class="thumb" style="width:120px;height:60px">No logo</div>'}<div class="spacer"></div><button class="btn" id="st-logo">${icon('upload')} Upload logo</button>${st.logo ? `<button class="btn ghost" id="st-logo-rm">${icon('trash')}</button>` : ''}</div><p class="tiny muted">Shown on invoices, quotes, receipts, contracts and reports. A PNG with a transparent background looks best.</p></div>
      <div class="card"><h2 style="margin-bottom:14px">Bank and payment details</h2><div class="stack">${field('accountName', 'Account name')}<div class="grid g2">${field('bankName', 'Bank')}${field('bsb', 'BSB')}</div>${field('account', 'Account number')}
      <label class="f">Payment terms (shown on invoices)<textarea data-b="paymentTerms" rows="3">${esc(b.paymentTerms)}</textarea></label>${field('termsDays', 'Default days until due', 'number')}</div></div></div></div>${saveBtn}`;
    $('#st-logo').onclick = async () => { const f = await pickFile('image/*'); if (!f) return; st.logo = await shrinkImage(f, 600, 0.9, f.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'); await saveSettings(); toast('Logo saved'); render(); };
    if ($('#st-logo-rm')) $('#st-logo-rm').onclick = async () => { st.logo = ''; await saveSettings(); render(); };
    bindSave();
  } else if (tab === 'invoices') {
    body.innerHTML = `<div class="card" style="max-width:720px"><div class="grid g2">${field('invPrefix', 'Invoice prefix', 'text', 's')}${field('invNext', 'Next invoice number', 'number', 's')}${field('quotePrefix', 'Quote prefix', 'text', 's')}${field('quoteNext', 'Next quote number', 'number', 's')}
      ${field('depositPct', 'Default deposit %', 'number', 's')}${field('balanceDaysAfterIssue', 'Balance email: days after issue', 'number', 's')}</div>
      <p class="small muted">Next invoice will be <b>${esc(nextNumber('invoice').number)}</b>. Numbers already used are skipped automatically.</p>${saveBtn}</div>`;
    bindSave();
  } else if (tab === 'emails') templatesEditor(body);
  else if (tab === 'categories') {
    body.innerHTML = `<div class="card" style="max-width:620px"><label class="f">One category per line<textarea id="st-cats" style="min-height:300px">${esc(st.expenseCategories.join('\n'))}</textarea></label><button class="btn pri" id="st-cs" style="margin-top:14px">${icon('check')} Save</button></div>`;
    $('#st-cs').onclick = async () => { st.expenseCategories = $('#st-cats').value.split('\n').map(s => s.trim()).filter(Boolean); await saveSettings(); toast('Saved'); };
  } else {
    let est = ''; try { const e = await navigator.storage.estimate(); est = `Using about ${(e.usage / 1048576).toFixed(1)} MB of browser storage.`; } catch (e) { }
    let pers = false; try { pers = await navigator.storage.persisted(); } catch (e) { }
    body.innerHTML = `<div class="grid g2" style="align-items:start"><div class="card"><h2>Your data</h2><p class="small muted">Everything (customers, invoices, receipts, logo) is stored <b>only in this browser on this device</b>. Nothing is sent to a server. If you clear your browser data, or open the app in another browser or device, it starts empty, so export a backup regularly.</p>
      <p class="small">${est} ${pers ? 'Storage is marked persistent ✓' : '<button class="btn sm" id="st-pers">Ask browser to keep data permanently</button>'}${st.lastBackup ? `<br>Last backup: ${fmtD(st.lastBackup)}` : ''}</p>
      <div class="row"><button class="btn pri" id="st-exp">${icon('download')} Export backup</button><button class="btn" id="st-imp">${icon('upload')} Import backup</button></div>
      <p class="tiny muted">The backup is one JSON file, including receipt photos. Keep it somewhere private because it contains your customer and financial data.</p></div>
      <div class="card"><h2>Demo &amp; reset</h2><p class="small muted">Load fake sample data to try everything out. This replaces whatever is in the app now.</p>
      <div class="row"><button class="btn" id="st-demo">${icon('eye')} Load demo data</button><button class="btn danger" id="st-clear">${icon('trash')} Clear all data</button></div></div></div>`;
    if ($('#st-pers')) $('#st-pers').onclick = async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Storage is now persistent' : 'Browser declined (installing the app usually helps)'); render(); };
    $('#st-exp').onclick = async () => { S.settings.lastBackup = today(); await saveSettings(); download(`invoicing-backup-${today()}.json`, JSON.stringify(await exportBackup()), 'application/json'); };
    $('#st-imp').onclick = async () => { const f = await pickFile('.json,application/json'); if (!f) return; let o; try { o = JSON.parse(await readText(f)); } catch (e) { toast('Not a valid backup file'); return; }
      if (!await confirmBox(`Replace ALL current data with the backup from ${esc((o.exportedAt || '').slice(0, 10))}?`, 'Replace')) return; try { await importBackup(o); toast('Backup restored'); go('dashboard'); } catch (e) { toast(e.message); } };
    $('#st-demo').onclick = async () => { if (S.invoices.length + S.customers.length && !await confirmBox('Replace ALL current data with demo data?', 'Load demo')) return; await loadDemo(); toast('Demo data loaded'); go('dashboard'); };
    $('#st-clear').onclick = async () => { if (!await confirmBox('Delete ALL data in this browser (customers, invoices, payments, expenses, receipts, settings)? Export a backup first if you need it.', 'Delete everything')) return; await clearAll(); toast('All data cleared'); go('dashboard'); };
  }
};

/* ======================= DEMO DATA (all fake) ======================= */
async function loadDemo() {
  await clearAll();
  let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const pick = a => a[Math.floor(rnd() * a.length)];
  const st = S.settings; st.demo = true;
  Object.assign(st.business, { name: 'Petal & Pine Studio (DEMO)', abn: '00 000 000 000', address: '1 Sample Street\nExampleton NSW 2000', email: 'hello@example.com', phone: '0400 000 000', website: 'example.com', bankName: 'Demo Bank', bsb: '000-000', account: '00000000', accountName: 'Petal & Pine Studio (DEMO)' });
  st.invNext = 1001; await saveSettings();
  const sv = [['Consultation (1 hour)', 'Initial meeting to scope your project.', 120, 'hour'], ['Design package', 'Concept, two revisions and final files.', 850, ''], ['Site visit', 'Travel and on-site measure (within 30 km).', 180, ''], ['Installation – half day', 'Up to 4 hours on site, one installer.', 450, ''], ['Materials allowance', 'Supplied at cost plus handling.', 300, ''], ['Styling session', 'Two-hour styling and shopping list.', 260, '']];
  for (const [name, description, price, unit] of sv) await save('services', { name, description, price, unit, gst: true });
  const cs = [['Alex Sample', '', 'alex.sample@example.com'], ['Jordan Example', 'Example Co (DEMO)', 'jordan@example.com'], ['Sam Placeholder', '', 'sam.p@example.com'], ['Riley Demo', 'Demo Café (DEMO)', 'riley@example.com'], ['Taylor Test', 'Test Florist (DEMO)', 'taylor@example.com'], ['Casey Fictional', '', 'casey@example.com']];
  const cust = []; for (const [i, [name, business, email]] of cs.entries()) cust.push(await save('customers', { name, business, email, phone: '0400 000 ' + String(100 + i), address: (10 + i) + ' Example Road\nSampleville VIC 3000', abn: '', notes: 'Demo customer, not a real person.', createdAt: new Date().toISOString() }));
  const t = today();
  const mk = async (cu, daysAgo, items, opt = {}) => {
    const issue = addDays(t, -daysAgo); const { number, n } = nextNumber('invoice');
    const inv = { kind: 'invoice', number, customerId: cu.id, issueDate: issue, dueDate: addDays(issue, 14), items, notes: '', sent: opt.sent !== false, deposit: { type: 'pct', value: 50 }, depositDue: issue, balanceEmailDate: addDays(issue, 14), emailDeposit: true, emailBalance: true, createdAt: new Date().toISOString() };
    await save('invoices', inv); await bumpNumber('invoice', n);
    const c = invCalc(inv);
    if (opt.pay === 'full' || opt.pay === 'dep') { const p = await save('payments', { invoiceId: inv.id, date: addDays(issue, 2), amount: depositAmount(inv, c), method: 'Bank transfer' }); await save('outbox', { type: 'receipt', invoiceId: inv.id, customerId: cu.id, paymentId: p.id, status: 'sent', sentAt: p.date + 'T09:00:00', scheduledDate: p.date }); }
    if (opt.pay === 'full') await save('payments', { invoiceId: inv.id, date: addDays(issue, 12 + Math.floor(rnd() * 8)), amount: r2(c.total - depositAmount(inv, c)), method: pick(['Bank transfer', 'Card', 'PayID']) });
    await syncInvoiceEmails(inv);
    if (opt.pay) for (const e of S.outbox.filter(e => e.invoiceId === inv.id && e.type === 'deposit')) { e.status = 'sent'; e.sentAt = issue + 'T09:00:00'; await save('outbox', e); }
    return inv;
  };
  const L = (s, qty = 1, disc = 0) => { const x = S.services.find(v => v.name.startsWith(s)); return { desc: x.name, details: x.description, qty, price: x.price, discountPct: disc, gst: true, serviceId: x.id }; };
  for (let m = 11; m >= 1; m--) {
    const nInv = 1 + Math.floor(rnd() * 2.6);
    for (let k = 0; k < nInv; k++) {
      const items = [L('Design package')]; if (rnd() > .4) items.push(L('Site visit')); if (rnd() > .5) items.push(L('Installation', 1 + Math.floor(rnd() * 3))); if (rnd() > .7) items.push(L('Materials', 1, 10));
      await mk(pick(cust), m * 30 + Math.floor(rnd() * 20), items, { pay: 'full' });
    }
  }
  await mk(cust[1], 40, [L('Design package'), L('Installation', 2)], { pay: 'dep' });                  // overdue, deposit paid
  await mk(cust[3], 9, [L('Consultation', 2), L('Styling')], { pay: 'dep' });                           // part-paid, balance email soon
  await mk(cust[4], 0, [L('Design package'), L('Site visit'), L('Materials', 2)], { sent: false });    // new today: deposit email due today
  await mk(cust[5], 3, [L('Consultation')], { sent: false });                                          // draft
  const qn = nextNumber('quote'); await save('invoices', { kind: 'quote', number: qn.number, customerId: cust[2].id, issueDate: addDays(t, -2), dueDate: addDays(t, 28), items: [L('Design package'), L('Installation', 3)], notes: 'Quote valid for 30 days.', sent: true, createdAt: new Date().toISOString() }); await bumpNumber('quote', qn.n);
  const ex = [['Materials', ['Example Timber Supplies', 'Sample Hardware'], 120, 900], ['Software & subscriptions', ['Demo Design Software'], 30, 80], ['Fuel', ['Sample Fuel Co'], 60, 140], ['Phone & internet', ['Example Telco'], 89, 89], ['Advertising', ['Demo Socials Ads'], 50, 300], ['Equipment', ['Example Tools Direct'], 150, 1400], ['Insurance', ['Sample Insurance (DEMO)'], 95, 95]];
  for (let m = 12; m >= 0; m--) for (const [cat, sups, lo, hi] of ex) {
    if (cat === 'Equipment' && rnd() > .2) continue; if (cat === 'Advertising' && rnd() > .5) continue;
    const date = addDays(t, -(m * 30 + Math.floor(rnd() * 25))); if (date > t) continue;
    const amount = r2(lo + rnd() * (hi - lo)); await save('expenses', { date, supplier: pick(sups), category: cat, amount, gst: r2(amount / 11), gstIncl: true, notes: '', createdAt: new Date().toISOString() });
  }
  await save('contractTemplates', { name: 'Service agreement', body: 'SERVICE AGREEMENT\n\nThis agreement is made on {date} between {business} (ABN {abn}) ("we") and {client}{client_business} ("you").\n\n1. Services\nWe will provide the services described in quote/invoice {invoice_no}.\n\n2. Fees and payment\nThe total fee is {total} including GST. A deposit of {deposit_amount} is payable before work starts. The balance is due by {due_date}.\n\n3. Changes\nAny changes to the scope will be agreed in writing (email is fine) and may change the fee.\n\n4. Cancellation\nIf you cancel after work has started, the deposit is non-refundable to cover work already done.\n\n5. Acceptance\nBy signing below you accept these terms.\n\n(DEMO TEMPLATE: have your own terms checked before real use.)' });
  await save('forms', { title: 'New client questionnaire', intro: 'A few quick questions so we can prepare for your project.', questions: [
    { id: uid(), type: 'text', label: 'What is the project address?', options: [], req: true }, { id: uid(), type: 'choice', label: 'What type of project is it?', options: ['Residential', 'Commercial', 'Event', 'Other'], req: true },
    { id: uid(), type: 'multi', label: 'Which services are you interested in?', options: ['Design', 'Installation', 'Styling', 'Ongoing maintenance'], req: false }, { id: uid(), type: 'date', label: 'Preferred start date', options: [], req: false },
    { id: uid(), type: 'long', label: 'Anything else we should know?', options: [], req: false }] });
}
