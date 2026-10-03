/* Invoicing: automatic Google Drive backup (GIS token model, drive.file scope), backup reminders,
 * and "emails due" system notifications. Device-only state lives in the existing `settings` store
 * under id 'device' (no new stores, no DB version bump). Access tokens are kept in memory only. */
'use strict';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FOLDER = 'Invoicing App Backups';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3';
const BACKUP_RE = /^invoicing-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;
const DAY = 86400000;

/* ---------- device state (settings store, id 'device'; not part of the exported backup) ---------- */
let DEV = null;
function defaultDevice() {
  return { id: 'device', drive: { connected: false, email: '', folderId: '', lastAt: '', lastName: '', lastError: '', freqDays: 3, keep: 10 }, lastLocalAt: '', notify: { lastShown: '', prompted: false }, snooze: '' };
}
async function loadDevice() {
  const d = defaultDevice(), s = (await DB.get('settings', 'device')) || {};
  DEV = Object.assign(d, s); DEV.drive = Object.assign(d.drive, s.drive || {}); DEV.notify = Object.assign(d.notify, s.notify || {});
  return DEV;
}
async function saveDevice() { DEV.id = 'device'; await DB.put('settings', DEV); }
const driveEnabled = () => typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.trim() !== '';
const hasData = () => (S.invoices.length + S.customers.length + S.expenses.length + S.payments.length) > 0;
/* most recent backup of any kind (Drive, local download, or the v1 lastBackup date) as epoch ms, 0 if never */
function lastAnyBackup() {
  const t = [DEV.drive.lastAt, DEV.lastLocalAt, S.settings.lastBackup].filter(Boolean).map(x => Date.parse(x.length === 10 ? x + 'T00:00:00' : x)).filter(n => !isNaN(n));
  return t.length ? Math.max(...t) : 0;
}
const driveDue = (now = Date.now()) => !DEV.drive.lastAt || now - Date.parse(DEV.drive.lastAt) >= (+DEV.drive.freqDays || 3) * DAY - 5 * 60000;

/* ---------- pure helpers (unit-tested) ---------- */
function backupFileName(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `invoicing-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}
/* which backup files to delete: only our own file names, keep the newest `keep` */
function pruneList(files, keep) {
  keep = Math.max(1, Math.floor(Number.isFinite(+keep) && keep !== '' && keep !== null ? +keep : 10));
  const ours = files.filter(f => BACKUP_RE.test(f.name || '') && f.appProperties?.invoicingApp === '1');
  ours.sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || '') || (b.name || '').localeCompare(a.name || ''));
  return ours.slice(keep);
}
function multipartBody(meta, json) {
  const boundary = 'inv' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  return { boundary, body, type: `multipart/related; boundary=${boundary}` };
}

/* ---------- Google auth (token model) ---------- */
class AuthError extends Error { }
/* turn GIS / OAuth error codes into something friendly */
function authMessage(code, desc = '') {
  const c = String(code || '').toLowerCase(), d = String(desc || '').toLowerCase();
  if (c === 'access_denied' || /verif|access blocked|not.*test user|testing/.test(d))
    return 'Google didn\'t allow access. While this app is in testing, only Google accounts added as test users can connect. Ask for your account to be added, then tap Connect again (and tick the Google Drive box).';
  if (c === 'popup_failed_to_open') return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.';
  if (c === 'popup_closed') return 'The Google sign-in window was closed before finishing. Tap Connect to try again.';
  if (c === 'timeout') return 'Google sign-in took too long. Please try again.';
  if (c === 'scope_missing') return 'Google Drive access wasn\'t ticked. Tap Connect again and tick the box that lets the app see its own Drive files.';
  if (c === 'invalid_client' || c === 'unauthorized_client' || c === 'idpiframe_initialization_failed' || /origin/.test(d)) return 'Google sign-in isn\'t set up for this web address yet (OAuth client settings). Please let the app owner know.';
  if (c === 'org_internal') return 'This Google app is limited to one organisation, so your account can\'t connect.';
  return 'Couldn\'t connect to Google Drive' + (code ? ` (${code})` : '') + '. Please try again.';
}
const GD = {
  token: '', exp: 0, gisP: null, needReconnect: false, busy: null,
  loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (!this.gisP) this.gisP = new Promise((ok, no) => {
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => ok(); s.onerror = () => { this.gisP = null; no(new AuthError('Couldn\'t load Google sign-in. Are you offline?')); };
      document.head.appendChild(s);
    });
    return this.gisP;
  },
  /* interactive: called from a tap (popup allowed). Otherwise prompt:'' silent attempt with a timeout. */
  async auth(interactive) {
    if (this.token && Date.now() < this.exp - 120000) return this.token;
    await this.loadGis();
    const tok = await new Promise((ok, no) => {
      let done = false; const fin = (f, v) => { if (!done) { done = true; clearTimeout(tm); f(v); } };
      const tm = setTimeout(() => fin(no, new AuthError(authMessage('timeout'))), interactive ? 180000 : 15000);
      const c = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID.trim(), scope: DRIVE_SCOPE,
        callback: r => r && r.access_token ? fin(ok, r) : fin(no, new AuthError(authMessage(r?.error, r?.error_description))),
        error_callback: e => fin(no, new AuthError(authMessage(e?.type, e?.message))),
      });
      const o = { prompt: interactive && !DEV.drive.connected ? 'consent' : '' };
      if (DEV.drive.email) o.hint = DEV.drive.email;
      c.requestAccessToken(o);
    });
    if (google.accounts.oauth2.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(tok, DRIVE_SCOPE)) throw new AuthError(authMessage('scope_missing'));
    this.token = tok.access_token; this.exp = Date.now() + (+tok.expires_in || 3600) * 1000; this.needReconnect = false;
    return this.token;
  },
};
async function gapi(url, opts = {}) {
  const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + GD.token }, opts.headers || {}) }));
  if (r.status === 401) { GD.token = ''; throw new AuthError('Google session expired'); }
  if (!r.ok && !(opts.method === 'DELETE' && r.status === 404)) { let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { } throw new Error(`Google Drive error ${r.status}${m ? ': ' + m : ''}`); }
  return r;
}

/* ---------- Drive operations ---------- */
async function driveFolder() {
  if (DEV.drive.folderId) {
    try { const f = await (await gapi(`${DRIVE_API}/files/${encodeURIComponent(DEV.drive.folderId)}?fields=id,trashed`)).json(); if (f.id && !f.trashed) return f.id; } catch (e) { if (e instanceof AuthError) throw e; }
  }
  const q = `name='${DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const l = await (await gapi(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,name,createdTime)&orderBy=createdTime`)).json();
  let id = l.files && l.files[0] && l.files[0].id;
  if (!id) id = (await (await gapi(`${DRIVE_API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder', appProperties: { invoicingApp: '1' } }) })).json()).id;
  DEV.drive.folderId = id; await saveDevice(); return id;
}
async function driveList(folderId) {
  const q = `'${folderId}' in parents and trashed=false`; let out = [], page = '';
  do {
    const l = await (await gapi(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&spaces=drive&pageSize=200&orderBy=createdTime desc&fields=nextPageToken,files(id,name,createdTime,size,appProperties)${page ? '&pageToken=' + encodeURIComponent(page) : ''}`)).json();
    out = out.concat(l.files || []); page = l.nextPageToken;
  } while (page);
  return out.filter(f => BACKUP_RE.test(f.name) && f.appProperties?.invoicingApp === '1');
}
async function aboutUser() { try { const a = await (await gapi(`${DRIVE_API}/about?fields=user(emailAddress)`)).json(); return a.user?.emailAddress || ''; } catch (e) { return ''; } }

/* full backup: same JSON as Export backup. Returns { name, deleted } */
async function driveBackupNow({ interactive = false } = {}) {
  if (GD.busy) return GD.busy;
  GD.busy = (async () => {
    try {
      await GD.auth(interactive);
      const folder = await driveFolder();
      const json = JSON.stringify(await exportBackup());
      const name = backupFileName();
      const mp = multipartBody({ name, parents: [folder], mimeType: 'application/json', appProperties: { invoicingApp: '1', kind: 'backup' } }, json);
      const up = await (await gapi(`${DRIVE_UP}/files?uploadType=multipart&fields=id,name,createdTime`, { method: 'POST', headers: { 'Content-Type': mp.type }, body: mp.body })).json();
      let deleted = 0;
      try { for (const f of pruneList(await driveList(folder), DEV.drive.keep)) { await gapi(`${DRIVE_API}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE' }); deleted++; } } catch (e) { console.warn('prune failed', e); }
      Object.assign(DEV.drive, { connected: true, lastAt: new Date().toISOString(), lastName: name, lastError: '' }); await saveDevice();
      return { name, id: up.id, deleted };
    } catch (e) {
      if (e instanceof AuthError) GD.needReconnect = !!DEV.drive.connected;
      DEV.drive.lastError = e.message; await saveDevice(); throw e;
    } finally { GD.busy = null; renderBanners(); }
  })();
  return GD.busy;
}
async function driveConnect() {
  try { await GD.auth(true); } catch (e) { DEV.drive.lastError = e.message; await saveDevice(); throw e; }
  DEV.drive.connected = true; DEV.drive.lastError = ''; await saveDevice();
  const em = await aboutUser(); if (em) { DEV.drive.email = em; await saveDevice(); }
  return driveBackupNow({ interactive: true });
}
async function driveDisconnect() {
  try { if (GD.token && window.google?.accounts?.oauth2?.revoke) google.accounts.oauth2.revoke(GD.token, () => { }); } catch (e) { }
  GD.token = ''; GD.needReconnect = false;
  Object.assign(DEV.drive, { connected: false, email: '', lastError: '' }); await saveDevice(); renderBanners();
}

/* local download backup (shared by Settings → Export and the reminder banner) */
async function localBackup() {
  const json = JSON.stringify(await exportBackup());
  S.settings.lastBackup = today(); await saveSettings();
  DEV.lastLocalAt = new Date().toISOString(); await saveDevice();
  download(backupFileName(), json, 'application/json'); renderBanners();
}

/* ---------- automation ---------- */
let lastAuto = 0;
async function autoBackup(force = false) {
  if (!DEV || !driveEnabled() || !DEV.drive.connected || GD.busy) return 'skip';
  if (!force && Date.now() - lastAuto < 5 * 60000) return 'throttled';
  if (S.settings.demo || !hasData() || !driveDue() || navigator.onLine === false) return 'not-due';
  lastAuto = Date.now();
  try { await driveBackupNow({ interactive: false }); return 'done'; }
  catch (e) { console.warn('Auto backup failed:', e.message); return 'failed'; }
}
function backupBannerHTML() {
  if (!DEV || S.settings.demo) return '';
  if (driveEnabled() && DEV.drive.connected && GD.needReconnect) return `<div class="note pink bk-banner" id="bk-reconnect" role="button" tabindex="0">${icon('alert')} <b>Tap to reconnect Drive for backups</b></div>`;
  const last = lastAnyBackup();
  if (hasData() && DEV.snooze !== today() && (!last || Date.now() - last >= 7 * DAY)) {
    const msg = last ? `No backup for ${Math.floor((Date.now() - last) / DAY)} days.` : 'Your data hasn\'t been backed up yet.';
    return `<div class="note bk-banner" id="bk-stale">${icon('download')} <span class="grow">${msg} It only lives in this browser.</span><button class="btn pri sm" id="bk-now">Back up now</button><button class="btn ghost sm" id="bk-later">Later</button></div>`;
  }
  return '';
}
function renderBanners() {
  const view = document.getElementById('view'); if (!view || !DEV) return;
  const old = document.getElementById('bk-wrap'); if (old) old.remove();
  const html = backupBannerHTML(); if (!html) return;
  const w = document.createElement('div'); w.id = 'bk-wrap'; w.className = 'no-print'; w.innerHTML = html; view.prepend(w);
  const rc = $('#bk-reconnect', w);
  if (rc) { const go2 = async () => { try { const r = await driveBackupNow({ interactive: true }); toast('Backed up to Google Drive'); } catch (e) { toast(e.message); } }; rc.onclick = go2; rc.onkeydown = e => { if (e.key === 'Enter') go2(); }; }
  const now = $('#bk-now', w);
  if (now) now.onclick = async () => {
    if (driveEnabled() && DEV.drive.connected) { try { await driveBackupNow({ interactive: true }); toast('Backed up to Google Drive'); return; } catch (e) { toast('Drive backup failed, downloading a copy instead'); } }
    await localBackup(); toast('Backup downloaded');
  };
  const later = $('#bk-later', w); if (later) later.onclick = async () => { DEV.snooze = today(); await saveDevice(); renderBanners(); };
}

/* ---------- restore from Drive ---------- */
async function driveRestorePicker() {
  let files;
  try { await GD.auth(true); files = await driveList(await driveFolder()); } catch (e) { toast(e.message); return; }
  const m = openModal({
    title: 'Restore from Google Drive', wide: true,
    body: files.length ? `<p class="small muted">Pick a backup. Your current data will be downloaded as a local backup first, then replaced.</p><div class="list">${files.map(f => `<div class="li" data-fid="${esc(f.id)}" style="cursor:pointer"><span class="ic lav">${icon('file')}</span><div class="grow"><div class="t">${esc(f.name)}</div><div class="s">${new Date(f.createdTime).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}${f.size ? ' · ' + (f.size / 1048576).toFixed(2) + ' MB' : ''}</div></div><button class="btn sm">Restore</button></div>`).join('')}</div>`
      : '<div class="empty">No backups in the "Invoicing App Backups" folder yet.</div>',
  });
  $$('[data-fid]', m).forEach(el => el.onclick = async () => {
    const f = files.find(x => x.id === el.dataset.fid); closeModal();
    if (!await confirmBox(`Replace ALL current data with the Drive backup <b>${esc(f.name)}</b>?<br><br>A copy of your current data will be downloaded to this device first.`, 'Restore', true)) return;
    try {
      const o = await (await gapi(`${DRIVE_API}/files/${encodeURIComponent(f.id)}?alt=media`)).json();
      if (!o || o.app !== 'invoicing') throw new Error('That file is not an Invoicing backup.');
      await localBackup();
      await importBackup(o); toast('Restored from Google Drive'); location.hash === '#/dashboard' ? render() : go('dashboard');
    } catch (e) { toast(e.message); }
  });
}

/* ---------- Settings → Data cards ---------- */
function driveCardHTML() {
  if (!driveEnabled()) return `<div class="card" id="drive-off"><h2>Google Drive backup</h2><p class="small muted">Drive backup not set up yet</p></div>`;
  const d = DEV.drive, c = d.connected;
  const opt = (v, l) => `<option value="${v}" ${+d.freqDays === v ? 'selected' : ''}>${l}</option>`;
  return `<div class="card" id="drive-card"><h2>Google Drive backup</h2>
    <p class="small muted">Backs up automatically to a folder called <b>${DRIVE_FOLDER}</b> in your Google Drive. The app can only see files it created there.</p>
    <p class="small" id="dr-status">${c ? `<b style="color:var(--ok, #2E9E6A)">● Connected</b>${d.email ? ' as ' + esc(d.email) : ''}` : '<b>Not connected</b>'}<br>Last Drive backup: ${d.lastAt ? new Date(d.lastAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}</p>${d.lastError ? `<div class="note pink" id="dr-err" style="margin-bottom:12px">${icon('alert')} ${esc(d.lastError)}</div>` : ''}
    <div class="row">${c ? `<button class="btn pri" id="dr-now">${icon('upload')} Back up now</button><button class="btn" id="dr-restore">${icon('download')} Restore from Drive</button><button class="btn ghost" id="dr-disc">Disconnect</button>` : `<button class="btn pri" id="dr-connect">${icon('link')} Connect Google Drive</button>`}</div>
    <div class="grid g2" style="margin-top:12px"><label class="f">Back up<select id="dr-freq">${opt(1, 'Every day')}${opt(3, 'Every 3 days')}${opt(7, 'Weekly')}</select></label>
    <label class="f">Keep last<input type="number" id="dr-keep" min="1" max="100" value="${+d.keep || 10}"></label></div>
    <p class="tiny muted">Backs up when you open the app and the last backup is older than this. Older backups beyond the number kept are deleted (only this app's backup files).</p></div>`;
}
function notifyCardHTML() {
  const sup = 'Notification' in window && 'serviceWorker' in navigator;
  const p = sup ? Notification.permission : 'unsupported';
  return `<div class="card" id="nt-card"><h2>Email reminders</h2><p class="small muted">Get a notification on this device when invoice emails are due (checked when you open the app, at most once a day).</p>
    <p class="small">${p === 'granted' ? '<b>● Notifications are on</b>' : p === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser or phone settings.' : p === 'unsupported' ? 'This browser can\'t show notifications. On iPhone, add the app to your Home Screen first.' : ''}</p>
    ${p === 'default' ? `<button class="btn pri" id="nt-on">${icon('mail')} Turn on email reminders</button>` : ''}</div>`;
}
function bindDataCards(root) {
  const q = s => $(s, root);
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { toast(e instanceof AuthError ? 'Couldn\'t connect to Google Drive (see the note on the card)' : e.message); } finally { render(); } };
  if (q('#dr-connect')) q('#dr-connect').onclick = e => busy(e.currentTarget, async () => { const r = await driveConnect(); toast('Connected. Backed up to Google Drive'); });
  if (q('#dr-now')) q('#dr-now').onclick = e => busy(e.currentTarget, async () => { await driveBackupNow({ interactive: true }); toast('Backed up to Google Drive'); });
  if (q('#dr-restore')) q('#dr-restore').onclick = () => driveRestorePicker();
  if (q('#dr-disc')) q('#dr-disc').onclick = async () => { if (await confirmBox('Stop automatic Google Drive backups on this device? Backups already in Drive are kept.', 'Disconnect', false)) { await driveDisconnect(); render(); } };
  if (q('#dr-freq')) q('#dr-freq').onchange = async e => { DEV.drive.freqDays = +e.target.value; await saveDevice(); toast('Saved'); };
  if (q('#dr-keep')) q('#dr-keep').onchange = async e => { DEV.drive.keep = Math.min(100, Math.max(1, Math.floor(+e.target.value || 10))); e.target.value = DEV.drive.keep; await saveDevice(); toast('Saved'); };
  if (q('#nt-on')) q('#nt-on').onclick = async () => { await askNotify(); render(); };
}

/* ---------- due-email notifications ---------- */
function dueNotifyText(due, t = today()) {
  const n = due.length, over = due.filter(e => (e.scheduledDate || '') < t).length;
  return { title: `${n} invoice email${n === 1 ? '' : 's'} due today`, body: (over ? `${over} overdue. ` : '') + 'Tap to open your email outbox.' };
}
async function swReg() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 5000))]); } catch (e) { return null; }
}
async function dueNotifyCheck() {
  if (!DEV || !('Notification' in window) || Notification.permission !== 'granted') return 'no-permission';
  if (DEV.notify.lastShown === today()) return 'already-today';
  const due = outboxDue(); if (!due.length) return 'none-due';
  const reg = await swReg(); if (!reg || !reg.showNotification) return 'no-sw';
  const { title, body } = dueNotifyText(due);
  await reg.showNotification(title, { body, tag: 'invoicing-due', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: new URL('./#/outbox', location.href).href } });
  DEV.notify.lastShown = today(); await saveDevice(); return 'shown';
}
async function askNotify() {
  DEV.notify.prompted = true; await saveDevice();
  if (!('Notification' in window)) { toast('Notifications are not supported here'); return 'unsupported'; }
  const p = await Notification.requestPermission();
  if (p === 'granted') { toast('Email reminders are on'); await dueNotifyCheck(); } else toast('Notifications not turned on');
  return p;
}
function notifyPromptHTML() {
  if (!DEV || DEV.notify.prompted || !('Notification' in window) || !('serviceWorker' in navigator) || Notification.permission !== 'default') return '';
  return `<div class="note" id="nt-prompt" style="margin-bottom:18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">${icon('mail')} <span class="grow" style="flex:1">Want a reminder on this device when invoice emails are due?</span><button class="btn pri sm" id="nt-yes">Turn on reminders</button><button class="btn ghost sm" id="nt-no">No thanks</button></div>`;
}
function bindNotifyPrompt(root) {
  const y = $('#nt-yes', root), n = $('#nt-no', root);
  if (y) y.onclick = async () => { await askNotify(); render(); };
  if (n) n.onclick = async () => { DEV.notify.prompted = true; await saveDevice(); render(); };
}
/* tapping the notification: the service worker posts {go:'outbox'} to an open window */
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.go === 'outbox') go('outbox'); });
