/* Invoicing: optional cloud sync (Supabase). OFF until the owner signs in and taps "Move my data to the cloud".
 * IndexedDB stays the working copy; this module pushes local changes and pulls other devices' changes.
 *  - per-device state lives in the existing `settings` store, row id 'sync' (never uploaded, no DB version bump)
 *  - every record keeps its id; `_rev` = last server revision this device has seen; deletes become tombstones
 *  - push: RPC push_changes (server does last-write-wins on updatedAt, keeps losers in record_history)
 *  - pull: records with rev > lastRev, 500 at a time
 *  - receipts: private Storage bucket `receipts`, path <business_id>/<file_id>, downloaded on first view */
'use strict';
const SYNC_COLS = ['customers', 'services', 'invoices', 'payments', 'expenses', 'outbox', 'contractTemplates', 'contracts', 'forms', 'responses'];
const cloudEnabled = () => typeof SUPABASE_URL === 'string' && !!SUPABASE_URL && typeof SUPABASE_KEY === 'string' && !!SUPABASE_KEY;
const SY = { st: null, running: null, again: false, deb: null, status: 'idle', pendingRender: false, warned: {} };
function defaultSync() { return { id: 'sync', mode: 'local', businessId: '', userId: '', email: '', deviceId: 'd' + uid() + uid(), lastRev: 0, queue: {}, blobs: {}, lastSyncAt: '', lastError: '', settingsBase: null, migratedAt: '' }; }
async function loadSync() { SY.st = Object.assign(defaultSync(), (await DB.get('settings', 'sync')) || {}); return SY.st; }
const saveSync = () => DB.put('settings', SY.st);
const syncOn = () => !!(SY.st && SY.st.mode === 'cloud');
const qKey = (col, id) => col + ':' + id;
const qSplit = k => { const i = k.indexOf(':'); return [k.slice(0, i), k.slice(i + 1)]; };
const pendingCount = () => SY.st ? Object.keys(SY.st.queue).length + Object.keys(SY.st.blobs).length : 0;
async function syncMark(col, id, blob = false) {
  if (!syncOn()) return;
  if (col !== 'settings' && col !== 'files' && !SYNC_COLS.includes(col)) return;
  SY.st.queue[qKey(col, id)] = 1; if (blob) SY.st.blobs[id] = 1;
  await saveSync(); syncSoon();
}
function syncSoon(ms = 2000) { if (!syncOn()) return; clearTimeout(SY.deb); SY.deb = setTimeout(() => syncNow('change').catch(() => { }), ms); }

/* ---------- Supabase client (loaded only when cloud features are used) ---------- */
let SB = null, SBP = null;
function loadSupabase() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve();
  if (!SBP) SBP = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'js/vendor/supabase.js'; s.onload = () => ok(); s.onerror = () => { SBP = null; s.remove(); no(new Error('Couldn\'t load the cloud library. Are you offline?')); }; document.head.appendChild(s); });
  return SBP;
}
async function sbc() {
  await loadSupabase();
  if (!SB) SB = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'invoicing-cloud-auth' } });
  return SB;
}
async function cloudSession() { const sb = await sbc(); const { data } = await sb.auth.getSession(); return data && data.session; }
const sbErr = (e, what) => { const m = (e && (e.message || e.msg || e.error_description)) || String(e); return new Error((what ? what + ': ' : '') + (/fetch|network|load failed/i.test(m) ? 'no connection' : m)); };

/* ---------- sign in (email 6-digit code) ---------- */
async function cloudSendCode(email) {
  const sb = await sbc(); const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
  if (error) { if (error.status === 429 || /rate|security purposes|too many/i.test(error.message)) throw new Error('Too many sign-in emails were sent recently. The free email sender only allows a few per hour, so please wait a while and try again.'); if (/not authori[sz]ed/i.test(error.message)) throw new Error('This email address can\'t get sign-in emails yet. The free email sender only sends to people added to the Supabase team (or set up a custom email sender). Ask Josh.'); throw sbErr(error, 'Couldn\'t send the code'); }
}
/* The email holds either a 6-digit code (custom email template) or, with Supabase's free default email, only a sign-in link.
 * Accept both: a typed code, or the link pasted in (its token is verified here, so it works inside the home-screen app too). */
function parseSignInLink(t) {
  try { const u = new URL(String(t).trim()); const th = u.searchParams.get('token') || u.searchParams.get('token_hash'); if (!th) return null; let type = u.searchParams.get('type') || 'magiclink'; if (!['magiclink', 'signup', 'email', 'invite'].includes(type)) type = 'magiclink'; return { token_hash: th, type }; } catch (e) { return null; }
}
async function cloudVerifyCode(email, code) {
  const sb = await sbc(), raw = String(code || '').trim(), link = parseSignInLink(raw);
  if (!link && !/^\d{6,10}$/.test(raw.replace(/\s/g, ''))) throw new Error('Type the code from the email, or paste the whole sign-in link.');
  const { data, error } = link ? await sb.auth.verifyOtp(link) : await sb.auth.verifyOtp({ email, token: raw.replace(/\s/g, ''), type: 'email' });
  if (error) throw new Error(/expired|invalid/i.test(error.message) ? (link ? 'That sign-in link has expired or was already used. Send a new one.' : 'That code is wrong or has expired. Check the latest email, or send a new code.') : sbErr(error).message);
  return finishSignIn(sb, data.user);
}
async function finishSignIn(sb, user) {
  if (syncOn() && SY.st.userId && SY.st.userId !== user.id) { await sb.auth.signOut({ scope: 'local' }); throw new Error(`This device syncs with ${SY.st.email}. Please sign in with that email.`); }
  SY.st.email = user.email; SY.st.userId = user.id; await saveSync(); if (syncOn()) syncSoon(200); return user;
}
/* Tapping the sign-in link in the email opens the app with #access_token=... (or #error=...). */
const isAuthHash = h => /(^#|&)(access_token|error_description)=/.test(h || '');
async function cloudAuthFromHash(h) {
  const p = new URLSearchParams(String(h).replace(/^#/, ''));
  if (p.get('error_description')) throw new Error(/expired|invalid/i.test(p.get('error_description')) ? 'That sign-in link has expired or was already used. Send a new one.' : p.get('error_description'));
  const sb = await sbc(); const { data, error } = await sb.auth.setSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token') });
  if (error) throw sbErr(error, 'Couldn\'t sign in');
  return finishSignIn(sb, data.user);
}
async function cloudSignOut() {
  try { const sb = await sbc(); await sb.auth.signOut({ scope: 'local' }); } catch (e) { }
  Object.assign(SY.st, { mode: 'local', queue: {}, blobs: {}, lastRev: 0, lastError: '', email: '', userId: '' }); await saveSync(); setSyncStatus('idle');
}

/* ---------- record helpers ---------- */
function cleanData(col, rec) {
  const d = Object.assign({}, rec); delete d._rev; delete d.deleted;
  if (col === 'files') { delete d.blob; return { id: d.id, name: d.name || '', type: d.type || '', size: d.size || 0, updatedAt: d.updatedAt || '' }; }
  return d;
}
async function localGet(col, id) {
  if (col === 'settings') return S.settings;
  if (col === 'files') return DB.get('files', id);
  return (S[col] || []).find(x => x.id === id) || await DB.get(col, id);
}
async function setLocalRev(col, id, rev) {
  const r = await localGet(col, id); if (!r) return;
  r._rev = rev; await DB.put(col === 'settings' ? 'settings' : col, col === 'settings' ? Object.assign(r, { id: 'main' }) : r);
}
function settingsPaths(base, cur) {
  if (!base) return null; const out = []; const skip = ['updatedAt', '_rev', 'id'];
  for (const k of new Set([...Object.keys(base), ...Object.keys(cur)])) {
    if (skip.includes(k)) continue;
    if ((k === 'business' || k === 'templates') && base[k] && cur[k] && typeof base[k] === 'object') {
      for (const s of new Set([...Object.keys(base[k]), ...Object.keys(cur[k])])) if (JSON.stringify(base[k][s]) !== JSON.stringify(cur[k][s])) out.push([k, s]);
    } else if (JSON.stringify(base[k]) !== JSON.stringify(cur[k])) out.push([k]);
  }
  return out;
}
/* write a server row into IndexedDB + the in-memory mirror */
async function applyRow(col, id, row) {
  const data = Object.assign({}, row.data, { id, _rev: row.rev }); if (row.deleted) data.deleted = true; else delete data.deleted;
  if (col === 'settings') {
    const st = Object.assign(defaultSettings(), data, { id: 'main' }); st.templates = Object.assign(defaultSettings().templates, data.templates || {}); st.business = Object.assign(defaultSettings().business, data.business || {});
    S.settings = st; await DB.put('settings', st); SY.st.settingsBase = JSON.parse(JSON.stringify(cleanData('settings', row.data))); return;
  }
  if (col === 'files') {
    const loc = await DB.get('files', id);
    if (loc && loc.blob && !row.deleted && (loc.size || loc.blob.size) === (data.size || 0)) data.blob = loc.blob;
    await DB.put('files', data); return;
  }
  await DB.put(col, data);
  const a = S[col]; const i = a.findIndex(x => x.id === id);
  if (row.deleted) { if (i >= 0) a.splice(i, 1); } else if (i >= 0) a[i] = data; else a.push(data);
}
const LABEL1 = { invoices: 'invoice', customers: 'customer', payments: 'payment', expenses: 'expense', outbox: 'email', services: 'service', contracts: 'contract', settings: 'settings', forms: 'questionnaire', responses: 'answer', contractTemplates: 'template', files: 'receipt' };
function noteConflict(col) { SY.conflicts = (SY.conflicts || 0) + 1; SY.conflictMsg = `A${col === 'invoices' || col === 'expenses' || col === 'outbox' || col === 'answer' ? 'n' : ''} ${LABEL1[col] || 'record'} was also changed on another device. Kept the newer version.`; }

/* ---------- one sync cycle: receipts up, changes up, changes down ---------- */
async function syncNow(reason = '') {
  if (!syncOn() || !cloudEnabled()) return 'off';
  if (SY.running) { SY.again = true; return SY.running; }
  if (navigator.onLine === false) { setSyncStatus('offline'); return 'offline'; }
  SY.running = (async () => {
    let changed = false;
    try {
      setSyncStatus('syncing');
      const sb = await sbc(); const sess = await cloudSession();
      if (!sess) { SY.st.lastError = 'signed-out'; await saveSync(); setSyncStatus('signed-out'); return 'signed-out'; }
      await uploadBlobs(sb);
      changed = (await pushChanges(sb)) || changed;
      changed = (await pullChanges(sb)) || changed;
      SY.st.lastSyncAt = new Date().toISOString(); SY.st.lastError = ''; await saveSync(); setSyncStatus('ok');
      return 'ok';
    } catch (e) {
      SY.st.lastError = (e && e.message) || String(e); await saveSync(); setSyncStatus(/no connection/.test(SY.st.lastError) ? 'offline' : 'error'); return 'error';
    } finally {
      SY.running = null;
      if (changed) refreshAfterSync();
      if (SY.conflicts) { toast(SY.conflictMsg); SY.conflicts = 0; }
      if (SY.again) { SY.again = false; syncSoon(300); }
    }
  })();
  return SY.running;
}
async function uploadBlobs(sb) {
  for (const id of Object.keys(SY.st.blobs)) {
    const r = await DB.get('files', id); const path = `${SY.st.businessId}/${id}`;
    if (!r || r.deleted) { await sb.storage.from('receipts').remove([path]); }
    else if (r.blob) {
      const { error } = await sb.storage.from('receipts').upload(path, await r.blob.arrayBuffer(), { contentType: r.type || 'application/octet-stream', upsert: true });
      if (error) throw sbErr(error, 'Receipt upload failed');
    }
    delete SY.st.blobs[id]; await saveSync();
  }
}
async function buildChange(key) {
  const [col, id] = qSplit(key); const rec = await localGet(col, id); if (!rec) return null;
  const data = cleanData(col, rec);
  const ch = { collection: col, id, data, deleted: !!rec.deleted, updated_at: rec.updatedAt || new Date().toISOString(), base_rev: rec._rev == null ? null : rec._rev };
  if (col === 'settings') { const f = settingsPaths(SY.st.settingsBase, data); if (f) ch.fields = f; }
  return ch;
}
async function pushBatch(sb, changes, biz = SY.st.businessId) {
  const { data, error } = await sb.rpc('push_changes', { p_business: biz, p_device: SY.st.deviceId, p_changes: changes });
  if (error) throw sbErr(error, 'Upload failed');
  return data;
}
async function pushChanges(sb) {
  let changed = false;
  for (let round = 0; round < 50; round++) {
    const keys = Object.keys(SY.st.queue).slice(0, 200); if (!keys.length) break;
    const changes = [], sent = {};
    for (const k of keys) { const ch = await buildChange(k); if (ch) { changes.push(ch); sent[k] = ch; } else delete SY.st.queue[k]; }
    if (!changes.length) { await saveSync(); continue; }
    const out = await pushBatch(sb, changes);
    for (const r of out.results) {
      const k = qKey(r.collection, r.id), ch = sent[k], cur = await localGet(r.collection, r.id);
      const same = cur && (cur.updatedAt || '') === (ch.data.updatedAt || ch.updated_at) && !!cur.deleted === ch.deleted;
      if (r.status === 'ok') { await setLocalRev(r.collection, r.id, r.rev); if (same) { delete SY.st.queue[k]; if (r.collection === 'settings') SY.st.settingsBase = JSON.parse(JSON.stringify(ch.data)); } }
      else if (same) { await applyRow(r.collection, r.id, r.row); delete SY.st.queue[k]; changed = true; if (r.status === 'stale') noteConflict(r.collection); }
      else await setLocalRev(r.collection, r.id, r.row.rev);   // edited again meanwhile: next push is based on the server copy
    }
    for (const w of out.warnings || []) if (w.type === 'duplicate-number' && !SY.warned[w.number]) { SY.warned[w.number] = 1; setTimeout(() => toast(`Two invoices are numbered ${w.number}. Renumber the one that hasn't been sent.`), 2800); }
    await saveSync();
  }
  return changed;
}
async function pullChanges(sb) {
  let changed = false;
  for (let page = 0; page < 400; page++) {
    const { data, error } = await sb.from('records').select('collection,id,data,deleted,updated_at,rev').eq('business_id', SY.st.businessId).gt('rev', SY.st.lastRev).order('rev').limit(500);
    if (error) throw sbErr(error, 'Download failed');
    if (!data.length) break;
    for (const row of data) {
      const k = qKey(row.collection, row.id), loc = await localGet(row.collection, row.id);
      if (loc && loc._rev === row.rev) continue;   // our own write coming back
      if (SY.st.queue[k] && loc) {
        const lt = Date.parse(loc.updatedAt || 0), rt = Date.parse((row.data && row.data.updatedAt) || row.updated_at);
        if (lt >= rt) { await setLocalRev(row.collection, row.id, row.rev); continue; }   // ours is newer: it will win on push
        delete SY.st.queue[k]; noteConflict(row.collection);
      }
      await applyRow(row.collection, row.id, row); changed = true;
    }
    SY.st.lastRev = data[data.length - 1].rev; await saveSync();
    if (data.length < 500) break;
  }
  return changed;
}
async function cloudFetchBlob(r) {
  const sb = await sbc(); const { data, error } = await sb.storage.from('receipts').download(`${SY.st.businessId}/${r.id}`);
  if (error || !data) throw sbErr(error || 'not found', 'Receipt download failed');
  const blob = new Blob([await data.arrayBuffer()], { type: r.type || data.type });
  const cur = await DB.get('files', r.id); if (cur && !cur.deleted) { cur.blob = blob; await DB.put('files', cur); }
  return Object.assign({}, r, { blob });
}
async function downloadAllReceipts(onProgress) {
  const fs = (await DB.all('files')).filter(f => !f.deleted && !f.blob); let n = 0, fail = 0;
  for (const f of fs) { try { await cloudFetchBlob(f); } catch (e) { fail++; } onProgress && onProgress(++n, fs.length); }
  return { total: fs.length, fail };
}
function refreshAfterSync() {
  if ($('#modal-root .modal-bg') || leaveGuard) { SY.pendingRender = true; renderNav(); return; }
  SY.pendingRender = false; render();
}

/* ---------- status ---------- */
function syncStatusText() {
  if (!syncOn()) return '';
  const n = pendingCount(), t = SY.st.lastSyncAt ? new Date(SY.st.lastSyncAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : '';
  if (SY.status === 'offline' || navigator.onLine === false) return `Offline${n ? ` · ${n} change${n === 1 ? '' : 's'} waiting` : ''}`;
  if (SY.status === 'signed-out') return 'Signed out · sign in to keep syncing';
  if (SY.status === 'error') return `Sync problem · ${SY.st.lastError}`;
  if (SY.status === 'syncing') return 'Syncing…';
  if (n) return `${n} change${n === 1 ? '' : 's'} waiting`;
  return t ? `Synced ${t}` : 'Cloud sync on';
}
function setSyncStatus(s) {
  SY.status = s;
  document.querySelectorAll('.sync-pill').forEach(el => { el.textContent = '☁ ' + syncStatusText(); el.dataset.state = s; });
}

/* ---------- checks used by the migration ---------- */
const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
function dataChecksum(D) {
  const cents = x => Math.round(num(x) * 100); let invNet = 0, invGst = 0;
  for (const i of D.invoices || []) for (const it of i.items || []) { const c = lineCalc(it); invNet += cents(c.net); invGst += cents(c.gst); }
  return {
    counts: Object.fromEntries(SYNC_COLS.map(c => [c, (D[c] || []).length])), files: (D.files || []).length,
    invoiceNet: invNet, invoiceGst: invGst, payments: (D.payments || []).reduce((a, p) => a + cents(p.amount), 0),
    expenses: (D.expenses || []).reduce((a, x) => a + cents(x.amount), 0), expenseGst: (D.expenses || []).reduce((a, x) => a + cents(x.gst), 0),
  };
}
async function localDataset() {
  const D = {}; for (const c of SYNC_COLS) D[c] = (await DB.all(c)).filter(r => !r.deleted);
  D.files = (await DB.all('files')).filter(f => !f.deleted); D.settings = S.settings; return D;
}
async function cloudDataset(sb, biz) {
  const D = { rows: {} }; for (const c of [...SYNC_COLS, 'files']) D[c] = [];
  let since = 0;
  for (let page = 0; page < 400; page++) {
    const { data, error } = await sb.from('records').select('collection,id,data,deleted,updated_at,rev').eq('business_id', biz).gt('rev', since).order('rev').limit(500);
    if (error) throw sbErr(error, 'Checking the cloud copy failed'); if (!data.length) break;
    for (const r of data) { D.rows[qKey(r.collection, r.id)] = r; } since = data[data.length - 1].rev; if (data.length < 500) break;
  }
  for (const r of Object.values(D.rows)) { if (r.deleted) continue; if (r.collection === 'settings') D.settings = r.data; else if (D[r.collection]) D[r.collection].push(r.data); }
  return D;
}
async function cloudFileList(sb, biz) {
  const out = {}; for (let off = 0; off < 100000; off += 1000) {
    const { data, error } = await sb.storage.from('receipts').list(biz, { limit: 1000, offset: off });
    if (error) throw sbErr(error, 'Checking receipts failed'); for (const f of data) out[f.name] = (f.metadata && f.metadata.size) || 0; if (data.length < 1000) break;
  }
  return out;
}

/* ---------- business + migration ("Move my data to the cloud") ---------- */
async function ensureBusiness(sb) {
  const { data, error } = await sb.from('businesses').select('id,name,created_at').order('created_at');
  if (error) throw sbErr(error, 'Couldn\'t read your cloud account');
  if (data.length) return data[0].id;
  const r = await sb.rpc('create_business', { p_name: S.settings.business.name || 'My business' });
  if (r.error) throw sbErr(r.error, 'Couldn\'t set up your cloud account'); return r.data;
}
async function cloudState() {
  const sb = await sbc(); const sess = await cloudSession(); if (!sess) throw new Error('Please sign in first.');
  const biz = await ensureBusiness(sb);
  const { count, error } = await sb.from('records').select('id', { count: 'exact', head: true }).eq('business_id', biz).eq('deleted', false);
  if (error) throw sbErr(error, 'Couldn\'t read your cloud account');
  const L = await localDataset(); const localN = SYNC_COLS.reduce((a, c) => a + L[c].length, 0) + L.files.length;
  return { sb, sess, biz, cloudN: count || 0, localN, L };
}
/* opts.merge: user agreed to merge with existing cloud data. opts.skipDrive: continue without Drive backup.
 * progress(text, pct). Returns { ok, summary, problems[] } and only switches this device to sync mode when ok. */
async function moveToCloud(opts = {}, progress = () => { }) {
  const { sb, sess, biz, cloudN, localN, L } = await cloudState();
  if (cloudN > 0 && localN > 0 && !opts.merge) return { needMerge: true, cloudN, localN };
  if (localN > 0) {
    progress('Saving a backup of this device first…', 2);
    await localBackup();
    if (driveEnabled() && DEV.drive.connected && !opts.skipDrive) { try { await driveBackupNow({ interactive: true }); } catch (e) { return { driveFailed: e.message }; } }
  }
  // 1. receipts
  const files = L.files.filter(f => f.blob);
  let done = 0;
  for (const f of files) {
    const { error } = await sb.storage.from('receipts').upload(`${biz}/${f.id}`, await f.blob.arrayBuffer(), { contentType: f.type || 'application/octet-stream', upsert: true });
    if (error) throw sbErr(error, `Receipt upload failed (${f.name || f.id})`);
    progress(`Uploading receipts… ${++done} of ${files.length}`, 5 + Math.round(done / Math.max(1, files.length) * 40));
  }
  // 2. records (same ids)
  const all = [];
  for (const c of SYNC_COLS) for (const r of L[c]) all.push({ collection: c, id: r.id, data: cleanData(c, r), deleted: false, updated_at: r.updatedAt || r.createdAt || new Date().toISOString(), base_rev: r._rev == null ? null : r._rev });
  for (const f of L.files) all.push({ collection: 'files', id: f.id, data: cleanData('files', Object.assign({}, f, { size: f.size || (f.blob ? f.blob.size : 0), updatedAt: f.updatedAt || new Date().toISOString() })), deleted: false, updated_at: f.updatedAt || new Date().toISOString(), base_rev: f._rev == null ? null : f._rev });
  if (localN > 0 || S.settings.business.name) all.push({ collection: 'settings', id: 'main', data: cleanData('settings', Object.assign({}, S.settings, { updatedAt: S.settings.updatedAt || (cloudN ? '2000-01-01T00:00:00.000Z' : new Date().toISOString()) })), deleted: false, updated_at: S.settings.updatedAt || (cloudN ? '2000-01-01T00:00:00.000Z' : new Date().toISOString()), base_rev: S.settings._rev == null ? null : S.settings._rev });
  const results = {};
  for (let i = 0; i < all.length; i += 200) {
    const out = await pushBatch(sb, all.slice(i, i + 200), biz);
    for (const r of out.results) results[qKey(r.collection, r.id)] = r;
    progress(`Uploading records… ${Math.min(all.length, i + 200)} of ${all.length}`, 45 + Math.round(Math.min(all.length, i + 200) / Math.max(1, all.length) * 40));
  }
  // 3. verify against what is now in the cloud
  progress('Checking the cloud copy…', 90);
  const C = await cloudDataset(sb, biz), cf = await cloudFileList(sb, biz), problems = [];
  for (const ch of all) {
    const row = C.rows[qKey(ch.collection, ch.id)];
    if (!row || row.deleted) { problems.push(`${ch.collection} ${ch.id} is missing in the cloud`); continue; }
    const res = results[qKey(ch.collection, ch.id)];
    if (res && res.status === 'ok' && ch.collection !== 'settings' && canon(row.data) !== canon(ch.data)) problems.push(`${ch.collection} ${ch.id} differs in the cloud`);
  }
  for (const f of files) if (!(f.id in cf)) problems.push(`receipt ${f.name || f.id} is missing in the cloud`); else if (cf[f.id] && cf[f.id] !== f.blob.size) problems.push(`receipt ${f.name || f.id} has the wrong size in the cloud`);
  const lc = dataChecksum(L), cc = dataChecksum(C);
  if (cloudN === 0) for (const k of Object.keys(lc)) if (JSON.stringify(lc[k]) !== JSON.stringify(cc[k])) problems.push(`${k} doesn't match (this device ${JSON.stringify(lc[k])}, cloud ${JSON.stringify(cc[k])})`);
  if (problems.length) return { ok: false, problems, local: lc, cloud: cc };
  // 4. switch on sync: remember revs so our own rows aren't re-downloaded
  for (const [k, r] of Object.entries(results)) if (r.status === 'ok') { const [c, id] = qSplit(k); await setLocalRev(c, id, r.rev); }
  Object.assign(SY.st, { mode: 'cloud', businessId: biz, userId: sess.user.id, email: sess.user.email, lastRev: 0, queue: {}, blobs: {}, lastError: '', migratedAt: new Date().toISOString(), settingsBase: JSON.parse(JSON.stringify(cleanData('settings', S.settings))) });
  await saveSync();
  progress('Syncing…', 96); await syncNow('migrated');
  progress('Done', 100);
  return { ok: true, local: lc, cloud: dataChecksum(C), files: files.length, records: all.length, merged: cloudN > 0 };
}

/* ---------- Settings → Cloud sync tab ---------- */
const signInFormHTML = () => `<label class="f">Email<input type="email" id="cl-email" autocomplete="email" placeholder="you@example.com" value="${esc(SY.st.email || '')}"></label>
      <div class="row" style="margin-top:10px"><button class="btn pri" id="cl-send">${icon('mail')} Email me a sign-in code</button></div>
      <div id="cl-code-wrap" hidden style="margin-top:14px"><label class="f">Code from the email, or paste the sign-in link<input type="text" id="cl-code" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" placeholder="123456 or https://…"></label>
      <div class="row" style="margin-top:10px"><button class="btn pri" id="cl-verify">${icon('check')} Sign in</button></div></div>
      <p class="tiny muted" style="margin-top:12px">The email can take a minute; check spam. If it has a <b>sign-in link</b> instead of a code, tap the link on this device, or (for the home-screen app) press and hold it, copy it and paste it above. Only a couple of emails can be sent per hour for now.</p>`;
async function cloudTab(body) {
  if (!cloudEnabled()) { body.innerHTML = '<div class="card"><p class="muted">Cloud sync isn\'t set up yet.</p></div>'; return; }
  let sess = null; try { sess = await cloudSession(); } catch (e) { }
  const intro = `<p class="small muted">Keep your data in your own private cloud account (stored in Sydney) and use the app on more than one device. It's off until you choose <b>Move my data to the cloud</b>. Until then, everything stays only on this device, just like now.</p>`;
  if (syncOn()) {
    const nf = (await DB.all('files')).filter(f => !f.deleted), miss = nf.filter(f => !f.blob).length;
    body.innerHTML = `<div class="grid g2" style="align-items:start"><div class="card" id="cl-card"><h2>Cloud sync is on</h2>
      <p class="small">Signed in as <b>${esc(SY.st.email || sess?.user?.email || '')}</b><br><span class="sync-pill" data-state="${SY.status}">☁ ${esc(syncStatusText())}</span></p>
      ${SY.st.lastError && SY.st.lastError !== 'signed-out' ? `<div class="note pink" style="margin-bottom:12px">${icon('alert')} ${esc(SY.st.lastError)}</div>` : ''}
      ${!sess ? `<div class="note pink" style="margin-bottom:12px">${icon('alert')} You're signed out on this device, so changes are waiting here. Sign in again to carry on syncing.</div>${signInFormHTML()}` : ''}
      <div class="row" style="margin-top:10px">${sess ? `<button class="btn pri" id="cl-sync">${icon('upload')} Sync now</button>` : ''}<button class="btn ghost" id="cl-out">Stop syncing on this device</button></div>
      <p class="tiny muted" style="margin-top:10px">Changes sync when you open the app, when you come back to it, when you go back online and every couple of minutes. If the same record is edited on two devices, the newer edit wins and the other is kept in the cloud history.</p></div>
      <div class="card"><h2>Receipts</h2><p class="small">${nf.length} receipt file${nf.length === 1 ? '' : 's'}${miss ? `, ${miss} not downloaded to this device yet (they download when opened)` : ', all on this device'}.</p>
      ${miss ? `<button class="btn" id="cl-dlall">${icon('download')} Download all receipts</button>` : ''}</div></div>`;
  } else if (sess) {
    body.innerHTML = `<div class="card" id="cl-card" style="max-width:720px"><h2>Cloud sync</h2>${intro}
      <p class="small">Signed in as <b>${esc(sess.user.email)}</b>.</p>
      <div class="note" style="margin-bottom:12px">When you tap <b>Move my data to the cloud</b>: a backup of this device is downloaded first (and saved to Google Drive if it's connected). Then everything is uploaded with the same IDs, and the app checks that the counts, receipts and money totals in the cloud match this device to the cent. It only switches to sync after that check passes. Nothing on this device is deleted.</div>
      <div class="row"><button class="btn pri" id="cl-move">${icon('upload')} Move my data to the cloud</button><button class="btn ghost" id="cl-out">Sign out</button></div>
      <div id="cl-prog" class="small" style="margin-top:12px"></div></div>`;
  } else {
    body.innerHTML = `<div class="card" id="cl-card" style="max-width:620px"><h2>Cloud sync</h2>${intro}
      ${signInFormHTML()}<p class="tiny muted">Signing in doesn't move or change anything.</p></div>`;
  }
  bindCloudTab(body);
}
function bindCloudTab(body) {
  const q = s => $(s, body);
  if (q('#cl-send')) q('#cl-send').onclick = async e => {
    const email = q('#cl-email').value.trim(); if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Enter your email address'); return; }
    const b = e.currentTarget; b.disabled = true; try { await cloudSendCode(email); SY.st.email = email; await saveSync(); q('#cl-code-wrap').hidden = false; q('#cl-code').focus(); toast('Email sent. Check your inbox'); } catch (err) { toast(err.message); } finally { b.disabled = false; }
  };
  if (q('#cl-verify')) q('#cl-verify').onclick = async e => {
    const b = e.currentTarget; b.disabled = true; try { await cloudVerifyCode(q('#cl-email').value.trim(), q('#cl-code').value); toast('Signed in'); render(); } catch (err) { toast(err.message); b.disabled = false; }
  };
  if (q('#cl-sync')) q('#cl-sync').onclick = async e => { const b = e.currentTarget; b.disabled = true; const r = await syncNow('button'); toast(r === 'ok' ? 'Synced' : 'Sync problem: ' + (SY.st.lastError || r)); render(); };
  if (q('#cl-dlall')) q('#cl-dlall').onclick = async e => { const b = e.currentTarget; b.disabled = true; const r = await downloadAllReceipts((n, t) => b.textContent = `Downloading ${n} of ${t}…`); toast(r.fail ? `${r.fail} receipt(s) couldn't be downloaded` : 'All receipts downloaded'); render(); };
  if (q('#cl-out')) q('#cl-out').onclick = async () => {
    const n = pendingCount();
    if (!await confirmBox(syncOn() ? `Stop syncing on this device and sign out? Your data stays on this device.${n ? ` <b>${n} change${n === 1 ? '' : 's'} haven't been uploaded yet</b> and won't be until you turn sync on again.` : ''}` : 'Sign out?', 'Sign out', !!n)) return;
    await cloudSignOut(); toast('Signed out'); render();
  };
  if (q('#cl-move')) q('#cl-move').onclick = async e => {
    const b = e.currentTarget, prog = q('#cl-prog'); b.disabled = true;
    const p = (t, pct) => { prog.innerHTML = `<div class="dr-prog"><div style="width:${pct}%"></div></div><div style="margin-top:6px">${esc(t)}</div>`; };
    try {
      let r = await moveToCloud({}, p);
      if (r.needMerge) {
        if (!await confirmBox(`Your cloud account already has data (${r.cloudN} records) and this device has its own data (${r.localN} records).<br><br><b>Merge them?</b> Both are kept. Where the same record was changed in both places, the newer version wins. Nothing is deleted, and a backup of this device is saved first.`, 'Merge', false)) { prog.innerHTML = 'Cancelled. Nothing was changed.'; b.disabled = false; return; }
        r = await moveToCloud({ merge: true }, p);
      }
      if (r.driveFailed) {
        if (!await confirmBox(`The Google Drive backup didn't work (${esc(r.driveFailed)}). A backup file was downloaded to this device. Continue without the Drive copy?`, 'Continue', false)) { prog.innerHTML = 'Stopped. Nothing was changed.'; b.disabled = false; return; }
        r = await moveToCloud({ merge: true, skipDrive: true }, p);
      }
      if (!r.ok) { prog.innerHTML = `<div class="note pink">${icon('alert')} The cloud copy didn't match, so sync was <b>not</b> switched on and nothing on this device changed. You can try again.<br><span class="tiny">${r.problems.slice(0, 5).map(esc).join('<br>')}</span></div>`; b.disabled = false; return; }
      const c = r.local; await render();
      openModal({ title: 'Your data is in the cloud', body: `<p>Everything checked out${r.merged ? ' and was merged with your cloud data' : ''}:</p><ul class="small">
        <li>${c.counts.invoices} invoices, ${c.counts.customers} customers, ${c.counts.payments} payments, ${c.counts.expenses} expenses, ${c.files} receipt files</li>
        <li>Invoice totals ${money((c.invoiceNet + c.invoiceGst) / 100)}, payments ${money(c.payments / 100)}, expenses ${money(c.expenses / 100)}: ${r.merged ? 'all uploaded' : 'match to the cent'}</li></ul>
        <p class="small muted">Sign in with the same email on your other devices and choose Move my data to the cloud there too. Their data is merged in.</p>` , foot: '<button class="btn pri" data-act="close-modal">Great</button>' });
    } catch (err) { prog.innerHTML = `<div class="note pink">${icon('alert')} ${esc(err.message)}. Nothing on this device was changed; sync is still off.</div>`; b.disabled = false; }
  };
}

/* ---------- start-up ---------- */
function startSync() {
  if (!syncOn() || !cloudEnabled()) return;
  syncNow('open');
  window.addEventListener('online', () => syncNow('online'));
  window.addEventListener('offline', () => setSyncStatus('offline'));
  setInterval(() => { if (document.visibilityState === 'visible') syncNow('timer'); }, 120000);
}
