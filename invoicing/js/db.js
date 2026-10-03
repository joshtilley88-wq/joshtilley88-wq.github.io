/* Invoicing: storage (IndexedDB only, on this device) + business logic. */
'use strict';
const COLS = ['settings', 'customers', 'services', 'invoices', 'payments', 'expenses', 'outbox', 'contractTemplates', 'contracts', 'forms', 'responses', 'files'];
const DB = {
  db: null,
  open() {
    return new Promise((ok, no) => {
      const r = indexedDB.open('invoicing', 1);
      r.onupgradeneeded = () => { for (const c of COLS) if (!r.result.objectStoreNames.contains(c)) r.result.createObjectStore(c, { keyPath: 'id' }); };
      r.onsuccess = () => { DB.db = r.result; ok(); }; r.onerror = () => no(r.error);
    });
  },
  tx(col, mode, fn) { return new Promise((ok, no) => { const t = DB.db.transaction(col, mode); const st = t.objectStore(col); const res = fn(st); t.oncomplete = () => ok(res && res.result); t.onerror = () => no(t.error); }); },
  all(col) { return DB.tx(col, 'readonly', s => s.getAll()); },
  get(col, id) { return DB.tx(col, 'readonly', s => s.get(id)); },
  put(col, o) { return DB.tx(col, 'readwrite', s => s.put(o)); },
  del(col, id) { return DB.tx(col, 'readwrite', s => s.delete(id)); },
  clear(col) { return DB.tx(col, 'readwrite', s => s.clear()); },
};

/* in-memory mirror of everything except file blobs */
const S = {};
const DATA_COLS = COLS.filter(c => c !== 'files' && c !== 'settings');
async function loadAll() {
  for (const c of DATA_COLS) S[c] = await DB.all(c);
  S.settings = Object.assign(defaultSettings(), await DB.get('settings', 'main') || {});
  S.settings.templates = Object.assign(defaultSettings().templates, S.settings.templates || {});
  S.settings.business = Object.assign(defaultSettings().business, S.settings.business || {});
}
async function save(col, o) { o.updatedAt = new Date().toISOString(); if (!o.id) o.id = uid(); await DB.put(col, o); const a = S[col]; const i = a.findIndex(x => x.id === o.id); i >= 0 ? a[i] = o : a.push(o); return o; }
async function remove(col, id) { await DB.del(col, id); S[col] = S[col].filter(x => x.id !== id); }
async function saveSettings() { S.settings.id = 'main'; await DB.put('settings', S.settings); }
const byId = (col, id) => S[col].find(x => x.id === id);

function defaultSettings() {
  return {
    id: 'main',
    business: { name: '', abn: '', address: '', email: '', phone: '', website: '', bankName: '', bsb: '', account: '', accountName: '', paymentTerms: 'Payment due within 14 days. Please use the invoice number as the payment reference.', termsDays: 14, gstRegistered: true },
    logo: '',
    invPrefix: 'INV-', invNext: 1001, quotePrefix: 'Q-', quoteNext: 1,
    depositPct: 50, balanceDaysAfterIssue: 14,
    expenseCategories: ['Materials', 'Equipment', 'Software & subscriptions', 'Vehicle & travel', 'Fuel', 'Phone & internet', 'Insurance', 'Advertising', 'Office supplies', 'Rent', 'Professional fees', 'Bank fees', 'Other'],
    templates: {
      deposit: { subject: 'Deposit invoice {invoice_no} from {business}', body: 'Hi {client_first},\n\nThanks for choosing {business}. Please find invoice {invoice_no} for {total}.\n\nTo get started we ask for a deposit of {deposit_amount} ({deposit_pct}), due by {deposit_due}.\n\n{bank_details}\n\nPlease use {invoice_no} as your payment reference.\n\nKind regards,\n{business}\n{business_phone}' },
      balance: { subject: 'Balance due: invoice {invoice_no} from {business}', body: 'Hi {client_first},\n\nThis is a friendly reminder that the remaining balance of {balance} for invoice {invoice_no} is due on {due_date}.\n\nInvoice total: {total}\nPaid so far: {paid}\nBalance: {balance}\n\n{bank_details}\n\nPlease use {invoice_no} as your payment reference.\n\nThank you,\n{business}' },
      receipt: { subject: 'Receipt for payment on {invoice_no} – {business}', body: 'Hi {client_first},\n\nThank you! We have received your payment of {amount} on {payment_date} for invoice {invoice_no}.\n\nInvoice total: {total}\nPaid to date: {paid}\nBalance remaining: {balance}\n\nKind regards,\n{business}' },
      invoice: { subject: 'Invoice {invoice_no} from {business}', body: 'Hi {client_first},\n\nPlease find invoice {invoice_no} for {total}, due {due_date}.\n\n{bank_details}\n\nKind regards,\n{business}' },
      contract: { subject: 'Agreement to sign: {contract_title}', body: 'Hi {client_first},\n\nPlease review and sign our agreement "{contract_title}" using this secure link:\n\n{link}\n\nAfter signing, tap "Email signed copy back" (or download the signed copy and reply with it attached).\n\nKind regards,\n{business}' },
      questionnaire: { subject: '{form_title} – {business}', body: 'Hi {client_first},\n\nCould you please fill in this short questionnaire so we can prepare your job:\n\n{link}\n\nWhen you finish, tap "Email my answers" to send them back.\n\nThank you,\n{business}' },
    },
  };
}

/* ---------- invoice maths ---------- */
function lineCalc(it) {
  const gross = r2(num(it.qty) * num(it.price));
  const disc = r2(gross * Math.min(100, Math.max(0, num(it.discountPct))) / 100);
  const net = r2(gross - disc);
  const gst = it.gst ? r2(net * 0.1) : 0;
  return { gross, disc, net, gst };
}
function invCalc(inv) {
  let sub = 0, disc = 0, gst = 0, gross = 0;
  for (const it of inv.items || []) { const c = lineCalc(it); gross += c.gross; disc += c.disc; sub += c.net; gst += c.gst; }
  sub = r2(sub); gst = r2(gst); const total = r2(sub + gst);
  const paid = r2(S.payments.filter(p => p.invoiceId === inv.id).reduce((a, p) => a + num(p.amount), 0));
  const balance = r2(total - paid);
  return { gross: r2(gross), disc: r2(disc), sub, gst, total, paid, balance };
}
function invStatus(inv, c = invCalc(inv)) {
  if (inv.kind === 'quote') return inv.accepted ? 'accepted' : inv.sent ? 'sent' : 'draft';
  if (c.total > 0 && c.balance <= 0.004) return 'paid';
  if (inv.sent && inv.dueDate && inv.dueDate < today()) return 'overdue';
  if (c.paid > 0) return 'part-paid';
  return inv.sent ? 'sent' : 'draft';
}
function depositAmount(inv, c = invCalc(inv)) {
  const d = inv.deposit || { type: 'pct', value: S.settings.depositPct };
  return d.type === 'amt' ? r2(Math.min(num(d.value), c.total)) : r2(c.total * num(d.value) / 100);
}
function nextNumber(kind) {
  const st = S.settings; const pre = kind === 'quote' ? st.quotePrefix : st.invPrefix; let n = +(kind === 'quote' ? st.quoteNext : st.invNext) || 1;
  const used = new Set(S.invoices.map(i => i.number));
  while (used.has(pre + n)) n++;
  return { number: pre + n, n };
}
async function bumpNumber(kind, n) { if (kind === 'quote') S.settings.quoteNext = Math.max(+S.settings.quoteNext || 1, n + 1); else S.settings.invNext = Math.max(+S.settings.invNext || 1, n + 1); await saveSettings(); }
const custName = c => c ? (c.business && c.name ? `${c.name} (${c.business})` : c.business || c.name || 'Unnamed') : 'No customer';

/* gst portion of a payment = amount * invoice gst / invoice total */
function paymentSplit(p) {
  const inv = byId('invoices', p.invoiceId); const amt = num(p.amount);
  if (!inv) return { gross: amt, gst: 0, net: amt };
  const c = invCalc(inv); const gst = c.total ? r2(amt * c.gst / c.total) : 0;
  return { gross: amt, gst, net: r2(amt - gst) };
}
function expenseSplit(e) { const gross = num(e.amount); const gst = r2(num(e.gst)); return { gross, gst, net: r2(gross - gst) }; }

/* ---------- email variables ---------- */
function bankDetails() {
  const b = S.settings.business; const l = [];
  if (b.bankName || b.bsb || b.account) { l.push('Payment details:'); if (b.accountName) l.push('Account name: ' + b.accountName); if (b.bankName) l.push('Bank: ' + b.bankName); if (b.bsb) l.push('BSB: ' + b.bsb); if (b.account) l.push('Account: ' + b.account); }
  return l.join('\n');
}
function emailVars(extra = {}) {
  const b = S.settings.business; const v = { business: b.name || 'our business', business_email: b.email || '', business_phone: b.phone || '', abn: b.abn || '', bank_details: bankDetails(), payment_terms: b.paymentTerms || '', today: fmtD(today()) };
  return Object.assign(v, extra);
}
function invoiceVars(inv, extra = {}) {
  const c = invCalc(inv); const cu = byId('customers', inv.customerId) || {};
  const dep = depositAmount(inv, c); const d = inv.deposit || { type: 'pct', value: S.settings.depositPct };
  return emailVars(Object.assign({
    client: cu.name || cu.business || 'there', client_first: (cu.name || cu.business || 'there').split(' ')[0], client_business: cu.business || '', client_email: cu.email || '',
    invoice_no: inv.number, total: money(c.total), subtotal: money(c.sub), gst: money(c.gst), paid: money(c.paid), balance: money(c.balance), amount: money(c.balance),
    issue_date: fmtD(inv.issueDate), due_date: fmtD(inv.dueDate), deposit_amount: money(dep), deposit_pct: d.type === 'amt' ? money(dep) : num(d.value) + '%', deposit_due: fmtD(inv.depositDue || inv.issueDate),
    balance_date: fmtD(inv.balanceEmailDate || inv.dueDate),
  }, extra));
}
/* build subject/body for an outbox entry from current data (unless user edited it) */
function composeEmail(e) {
  const T = S.settings.templates; let vars = emailVars(), tpl = null, to = e.to || '';
  const inv = e.invoiceId && byId('invoices', e.invoiceId); const cu = byId('customers', e.customerId || inv?.customerId);
  if (inv) vars = invoiceVars(inv);
  if (cu) { to = to || cu.email || ''; Object.assign(vars, { client: cu.name || cu.business, client_first: (cu.name || cu.business || 'there').split(' ')[0] }); }
  if (e.type === 'deposit') { tpl = T.deposit; vars.amount = vars.deposit_amount; }
  else if (e.type === 'balance') tpl = T.balance;
  else if (e.type === 'invoice') tpl = T.invoice;
  else if (e.type === 'receipt') { tpl = T.receipt; const p = byId('payments', e.paymentId); if (p) { vars.amount = money(p.amount); vars.payment_date = fmtD(p.date); } }
  else if (e.type === 'contract') { tpl = T.contract; const k = byId('contracts', e.contractId); if (k) Object.assign(vars, { contract_title: k.title, link: k.link || '(link not generated yet)' }); }
  else if (e.type === 'questionnaire') { tpl = T.questionnaire; Object.assign(vars, { form_title: e.formTitle || 'Questionnaire', link: e.link || '' }); }
  return { to, subject: e.subject ?? fillTpl(tpl?.subject, vars), body: e.body ?? fillTpl(tpl?.body, vars) };
}
const EMAIL_LABEL = { deposit: 'Deposit request', balance: 'Balance reminder', receipt: 'Payment receipt', invoice: 'Invoice', contract: 'Contract to sign', questionnaire: 'Questionnaire', custom: 'Email' };

/* keep the deposit + balance outbox entries in step with the invoice */
async function syncInvoiceEmails(inv) {
  if (inv.kind === 'quote') return;
  const want = [];
  if (inv.emailDeposit !== false) want.push(['deposit', inv.depositDue || inv.issueDate || today()]);
  if (inv.emailBalance !== false) want.push(['balance', inv.balanceEmailDate || inv.dueDate || today()]);
  for (const [type, date] of want) {
    let e = S.outbox.find(x => x.invoiceId === inv.id && x.type === type);
    if (!e) e = { type, invoiceId: inv.id, status: 'queued', createdAt: new Date().toISOString() };
    if (e.status !== 'sent') { e.scheduledDate = date; e.customerId = inv.customerId; await save('outbox', e); }
  }
  for (const e of S.outbox.filter(x => x.invoiceId === inv.id && x.status !== 'sent' && ((x.type === 'deposit' && inv.emailDeposit === false) || (x.type === 'balance' && inv.emailBalance === false)))) await remove('outbox', e.id);
}
/* an email is "done" if sent, or if it's a deposit/balance email whose money is already in */
function emailObsolete(e) {
  if (e.status === 'sent' || e.status === 'skipped') return true;
  const inv = e.invoiceId && byId('invoices', e.invoiceId); if (e.invoiceId && !inv) return true;
  if (inv && (e.type === 'deposit' || e.type === 'balance')) { const c = invCalc(inv); if (c.balance <= 0.004) return true; if (e.type === 'deposit' && c.paid >= depositAmount(inv, c) - 0.004) return true; }
  return false;
}
const outboxActive = () => S.outbox.filter(e => !emailObsolete(e)).sort((a, b) => (a.scheduledDate || '').localeCompare(b.scheduledDate || ''));
const outboxDue = () => outboxActive().filter(e => (e.scheduledDate || '') <= today());

/* ---------- backup ---------- */
async function exportBackup() {
  const out = { app: 'invoicing', version: 1, exportedAt: new Date().toISOString(), settings: S.settings };
  for (const c of DATA_COLS) out[c] = S[c];
  const files = await DB.all('files'); out.files = [];
  for (const f of files) out.files.push({ id: f.id, name: f.name, type: f.type, dataURL: await readDataURL(f.blob) });
  return out;
}
async function importBackup(o, replace = true) {
  if (!o || o.app !== 'invoicing') throw new Error('This is not an Invoicing backup file.');
  if (replace) for (const c of COLS) await DB.clear(c);
  if (o.settings) { await DB.put('settings', Object.assign(o.settings, { id: 'main' })); }
  for (const c of DATA_COLS) for (const r of o[c] || []) await DB.put(c, r);
  for (const f of o.files || []) await DB.put('files', { id: f.id, name: f.name, type: f.type, blob: dataURLtoBlob(f.dataURL) });
  await loadAll();
}
async function clearAll() { for (const c of COLS) await DB.clear(c); await loadAll(); }
