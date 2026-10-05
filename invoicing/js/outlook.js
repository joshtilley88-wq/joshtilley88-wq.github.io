/* Invoicing: "Email PDF" through Outlook (personal Microsoft account) using Microsoft Graph, all in the browser.
 * Sign-in: MSAL.js v5 (vendored at js/vendor/msal-browser.min.js, loaded on demand) with the redirect flow, which is the
 * reliable one in installed Android / iPhone apps. Microsoft sends the sign-in result to auth.html (the MSAL redirect
 * bridge), which hands it back to the app. Tokens live in MSAL's localStorage cache and renew silently.
 * Device-only state: DEV.outlook = { username, homeAccountId, lastError } in the settings 'device' row (no new stores). */
'use strict';
const OL_AUTHORITY = 'https://login.microsoftonline.com/consumers';
const OL_SCOPES = ['Mail.ReadWrite', 'Mail.Send'];    // asked for at sign-in. MSAL adds openid, profile and offline_access itself
const OL_DRAFT_SCOPES = ['Mail.ReadWrite'];           // drafts keep working for accounts connected before Mail.Send was added
const OL_SEND_SCOPES = ['Mail.ReadWrite', 'Mail.Send'];
const OL_RESUME = 'inv-outlook-resume';               // localStorage {entry, back, at}: the email to reopen after "Reconnect Outlook to allow sending"
const GRAPH = 'https://graph.microsoft.com/v1.0';
const OL_INLINE_MAX = 3 * 1024 * 1024;                // bigger attachments go through an upload session
const OL_CHUNK = 9 * 327680;                          // upload session chunks: multiple of 320 KiB, under 4 MB
const OL_PENDING = 'inv-outlook-pending';             // localStorage timestamp: set while a Microsoft sign-in redirect is under way
// (localStorage, not sessionStorage: some phone browsers don't reliably keep tab storage across the trip to Microsoft and back)
const olFlag = { set: k => { try { localStorage.setItem(k, String(Date.now())); } catch (e) { } }, fresh: k => { const t = +localStorage.getItem(k) || 0; return t && Date.now() - t < 30 * 60000; }, clear: k => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) { } } };
const outlookEnabled = () => typeof OUTLOOK_CLIENT_ID === 'string' && OUTLOOK_CLIENT_ID.trim() !== '';
const outlookOn = () => outlookEnabled() && !!(DEV && DEV.outlook && DEV.outlook.homeAccountId);
const OL = { app: null, needReconnect: false, needSend: false };
class OutlookError extends Error { constructor(msg, kind, status) { super(msg); this.kind = kind || 'graph'; this.status = status || 0; } }   // kind: offline | network | auth | consent | graph

let MSAL_P = null;
function loadMsal() {
  if (window.msal && window.msal.PublicClientApplication) return Promise.resolve();
  if (!MSAL_P) MSAL_P = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'js/vendor/msal-browser.min.js'; s.onload = () => ok(); s.onerror = () => { MSAL_P = null; s.remove(); no(new OutlookError('Couldn\'t load the Microsoft sign-in library', 'offline')); }; document.head.appendChild(s); });
  return MSAL_P;
}
const olRedirectUri = () => new URL('auth.html', location.origin + location.pathname).href;
async function olApp() {
  await loadMsal();
  if (!OL.app) {
    const a = new msal.PublicClientApplication({ auth: { clientId: OUTLOOK_CLIENT_ID.trim(), authority: OL_AUTHORITY, redirectUri: olRedirectUri(), postLogoutRedirectUri: null }, cache: { cacheLocation: 'localStorage' } });
    await a.initialize(); OL.app = a;
  }
  return OL.app;
}
function olAccount(app) {
  const id = DEV.outlook && DEV.outlook.homeAccountId; if (!id) return null;
  return (app.getAccount ? app.getAccount({ homeAccountId: id }) : null) || app.getAllAccounts().find(a => a.homeAccountId === id) || null;
}
const isInteraction = e => !!e && ((window.msal && msal.InteractionRequiredAuthError && e instanceof msal.InteractionRequiredAuthError) || /interaction_required|login_required|consent_required|no_account|no_tokens_found|invalid_grant|monitor_window_timeout|timed_out/i.test((e.errorCode || '') + ' ' + (e.message || '')));

/* Settings → Connect Outlook: full-page redirect to Microsoft; we come back through auth.html */
async function outlookConnect(startPage) {
  if (!navigator.onLine) throw new OutlookError('You\'re offline. Connect Outlook when you have internet.', 'offline');
  const app = await olApp();
  try { await app.handleRedirectPromise(); } catch (e) { }   // clears any half-finished sign-in
  olFlag.set(OL_PENDING);
  const hint = outlookOn() && DEV.outlook.username;   // reconnecting: usually just a quick bounce through Microsoft, no account picker
  await app.loginRedirect(Object.assign({ scopes: OL_SCOPES, redirectStartPage: startPage || location.origin + location.pathname + '#/settings?tab=data' }, hint ? { loginHint: hint } : { prompt: 'select_account' }));
}
/* boot: finish a sign-in we started. Returns a message for a toast, or '' */
async function outlookAfterRedirect() {
  if (!outlookEnabled() || !olFlag.fresh(OL_PENDING)) { if (localStorage.getItem(OL_PENDING)) olFlag.clear(OL_PENDING); return ''; }
  olFlag.clear(OL_PENDING);
  try {
    const app = await olApp(); const r = await app.handleRedirectPromise();
    if (!r || !r.account) return '';
    DEV.outlook = { username: r.account.username || r.account.name || '', homeAccountId: r.account.homeAccountId, lastError: '', connectedAt: new Date().toISOString() };
    OL.needReconnect = false; OL.needSend = false; await saveDevice(); return 'Outlook connected' + (DEV.outlook.username ? ' as ' + DEV.outlook.username : '');
  } catch (e) {
    console.warn('Outlook sign-in', e);
    const cancelled = /access_denied|user_cancelled|cancel/i.test((e.errorCode || '') + ' ' + (e.message || ''));
    DEV.outlook.lastError = cancelled ? '' : 'Couldn\'t connect Outlook: ' + (e.errorMessage || e.message || e); await saveDevice();
    return cancelled ? 'Outlook connection cancelled' : 'Couldn\'t connect Outlook (see Settings → Data)';
  }
}
async function outlookDisconnect() {
  try { const app = await olApp(); const acc = olAccount(app); if (acc && app.clearCache) await app.clearCache({ account: acc }); } catch (e) { console.warn(e); }
  try { Object.keys(localStorage).filter(k => k.startsWith('msal.') || k.includes('login.windows.net') || k.includes('login.microsoftonline.com')).forEach(k => localStorage.removeItem(k)); } catch (e) { }
  DEV.outlook = { username: '', homeAccountId: '', lastError: '' }; OL.needReconnect = false; OL.needSend = false; olFlag.clear(OL_RESUME); await saveDevice();
}
async function olToken(scopes = OL_DRAFT_SCOPES) {
  const send = scopes.includes('Mail.Send');
  if (!navigator.onLine) throw new OutlookError('you\'re offline', 'offline');
  let app; try { app = await olApp(); } catch (e) { throw new OutlookError('the Microsoft sign-in library didn\'t load', 'offline'); }
  const account = olAccount(app);
  if (!account) { OL.needReconnect = true; throw new OutlookError('Outlook needs reconnecting (Settings → Data)', 'auth'); }
  try { return (await app.acquireTokenSilent({ scopes, account })).accessToken; }
  catch (e) {
    console.warn('Outlook token', e);
    // accounts connected before sending was added haven't agreed to Mail.Send yet (consent_required / invalid_grant)
    if (isInteraction(e)) { if (send) { OL.needSend = true; throw new OutlookError('Reconnect Outlook to allow sending', 'consent'); } OL.needReconnect = true; throw new OutlookError('Outlook needs reconnecting (Settings → Data)', 'auth'); }
    throw new OutlookError('couldn\'t reach Microsoft' + (navigator.onLine ? '' : ' (offline)'), navigator.onLine ? 'graph' : 'offline');
  }
}
async function graph(token, url, opts = {}) {
  let r; try { r = await fetch(url.startsWith('https:') ? url : GRAPH + url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, opts.headers || {}) })); }
  catch (e) { throw new OutlookError('couldn\'t reach Outlook' + (navigator.onLine ? '' : ' (offline)'), navigator.onLine ? 'network' : 'offline'); }
  if (r.status === 401) { OL.needReconnect = true; throw new OutlookError('Outlook needs reconnecting (Settings → Data)', 'auth', 401); }
  if (!r.ok) { let m = ''; try { m = (await r.json()).error.message; } catch (e) { } throw new OutlookError(`Outlook said ${r.status}${m ? ': ' + m : ''}`, 'graph', r.status); }
  const t = await r.text(); return t ? JSON.parse(t) : null;   // send answers 202 with no body
}
const blobB64 = blob => new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = () => no(fr.error); fr.readAsDataURL(blob); });
const olRecipients = to => String(to || '').split(/[,;]/).map(s => s.trim()).filter(Boolean).map(address => ({ emailAddress: { address } }));
/* Creates a draft in her Outlook with To, subject, text body and the PDF attached. Returns { id, webLink }. */
async function outlookDraft({ to, subject, body, name, blob, token }) {
  token = token || await olToken();
  const small = blob.size <= OL_INLINE_MAX;
  const msg = { subject: subject || '', body: { contentType: 'Text', content: body || '' }, toRecipients: olRecipients(to) };
  if (small) msg.attachments = [{ '@odata.type': '#microsoft.graph.fileAttachment', name, contentType: 'application/pdf', contentBytes: await blobB64(blob) }];
  const d = await graph(token, '/me/messages', { method: 'POST', body: JSON.stringify(msg) });
  if (!small) {
    try {
      const s = await graph(token, `/me/messages/${encodeURIComponent(d.id)}/attachments/createUploadSession`, { method: 'POST', body: JSON.stringify({ AttachmentItem: { attachmentType: 'file', name, size: blob.size, contentType: 'application/pdf' } }) });
      for (let at = 0; at < blob.size; at += OL_CHUNK) {
        const end = Math.min(at + OL_CHUNK, blob.size);
        let r; try { r = await fetch(s.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${at}-${end - 1}/${blob.size}` }, body: blob.slice(at, end) }); }   // no auth header: the URL carries its own token
        catch (e) { throw new OutlookError('the PDF upload to Outlook was interrupted', 'graph'); }
        if (!r.ok) throw new OutlookError(`the PDF upload to Outlook failed (${r.status})`, 'graph');
      }
    } catch (e) { try { await graph(token, `/me/messages/${encodeURIComponent(d.id)}`, { method: 'DELETE' }); } catch (x) { } throw e; }   // don't leave a draft without its PDF
  }
  return { id: d.id, webLink: d.webLink || 'https://outlook.live.com/mail/0/drafts' };
}

/* ---------- Send now (Mail.Send) ---------- */
async function olSendToken() { return olToken(OL_SEND_SCOPES); }
/* is a draft we made still an unsent draft? 'draft' | 'gone' (sent, or deleted in Outlook) */
async function outlookDraftState(token, id) {
  try { const m = await graph(token, `/me/messages/${encodeURIComponent(id)}?$select=isDraft`); return m && m.isDraft ? 'draft' : 'gone'; }
  catch (e) { if (e.status === 404) return 'gone'; throw e; }
}
const outlookPatchDraft = (token, id, { to, subject, body }) => graph(token, `/me/messages/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ subject: subject || '', body: { contentType: 'Text', content: body || '' }, toRecipients: olRecipients(to) }) });
async function outlookSendMessage(token, id) {
  try { await graph(token, `/me/messages/${encodeURIComponent(id)}/send`, { method: 'POST' }); }
  catch (e) { if (e.status === 403) { OL.needSend = true; throw new OutlookError('Reconnect Outlook to allow sending', 'consent', 403); } throw e; }
}
/* "Reconnect Outlook to allow sending": remember the open email, redirect to Microsoft, reopen it afterwards (never sends by itself) */
async function outlookReconnectForSend(entry) {
  localStorage.setItem(OL_RESUME, JSON.stringify({ entry, back: location.hash, at: Date.now() }));
  try { await outlookConnect(location.href); } catch (e) { olFlag.clear(OL_RESUME); olFlag.clear(OL_PENDING); throw e; }
}
function outlookTakeResume() {
  let raw = null; try { raw = localStorage.getItem(OL_RESUME); if (!raw) return null; olFlag.clear(OL_RESUME); } catch (e) { return null; }
  try { const o = JSON.parse(raw); if (!o || !o.entry || Date.now() - o.at > 30 * 60000 || !outlookOn()) return null;
    const saved = o.entry.id && byId('outbox', o.entry.id); if (saved && saved.status === 'sent') return null;
    const e = saved ? Object.assign(saved, { to: o.entry.to, subject: o.entry.subject, body: o.entry.body }) : o.entry;
    e._back = o.back || ''; return e; } catch (e) { return null; }
}

/* ---------- Settings → Data card ---------- */
function outlookCardHTML() {
  if (!outlookEnabled()) return `<div class="card" id="ol-off"><h2>Outlook email</h2><p class="small muted">Outlook not set up yet</p></div>`;
  const o = DEV.outlook || {}, c = outlookOn();
  return `<div class="card" id="ol-card"><h2>Outlook email</h2>
    <p class="small muted">With Outlook connected, <b>Email PDF</b> can <b>Send now</b> straight from your Outlook (after you check it and confirm), or open a ready-made draft in Outlook: the client's address in To, the message filled in and the PDF attached. The app only uses your mailbox to create and send these emails.</p>
    <p class="small" id="ol-status">${c ? `<b style="color:var(--ok, #2E9E6A)">● Connected</b>${o.username ? ' as ' + esc(o.username) : ''}` : '<b>Not connected</b>'}</p>
    ${c && (OL.needReconnect || OL.needSend) ? `<div class="note pink" id="ol-recon" style="margin-bottom:12px">${icon('alert')} ${OL.needSend && !OL.needReconnect ? 'Tap <b>Reconnect Outlook</b> to allow sending emails from the app.' : 'Microsoft wants you to sign in again. Tap <b>Reconnect Outlook</b>.'}</div>` : ''}${o.lastError ? `<div class="note pink" id="ol-err" style="margin-bottom:12px">${icon('alert')} ${esc(o.lastError)}</div>` : ''}
    <div class="row">${c ? `${OL.needReconnect || OL.needSend ? `<button class="btn pri" id="ol-connect">${icon('link')} Reconnect Outlook</button>` : ''}<button class="btn ghost" id="ol-disc">Disconnect</button>` : `<button class="btn pri" id="ol-connect">${icon('link')} Connect Outlook</button>`}</div>
    <p class="tiny muted">Sign in with your Outlook / Hotmail account. This only affects this device.</p></div>`;
}
function bindOutlookCard(root) {
  const q = s => $(s, root);
  if (q('#ol-connect')) q('#ol-connect').onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Opening Microsoft sign-in…';
    try { await outlookConnect(); } catch (err) { b.disabled = false; olFlag.clear(OL_PENDING); toast(err.kind === 'offline' ? err.message : 'Couldn\'t start Microsoft sign-in: ' + (err.errorMessage || err.message)); render(); }
  };
  if (q('#ol-disc')) q('#ol-disc').onclick = async () => { if (await confirmBox('Disconnect Outlook on this device? Email PDF will go back to sharing / downloading the PDF. Drafts already in Outlook are kept.', 'Disconnect', false)) { await outlookDisconnect(); toast('Outlook disconnected'); render(); } };
}
