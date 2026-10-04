# Invoicing (v2)

Static, no-build invoicing web app for an Australian sole trader (AUD, GST 10%).
Live at https://joshtilley88-wq.github.io/invoicing/

* Plain HTML/CSS/vanilla JS. Chart.js 4.4.1, jsPDF 4.2.1 (MIT, loaded only when a PDF is made) and the Inter font are vendored (no CDN calls).
* **By default all user data stays in the browser** (IndexedDB database `invoicing`). Cloud sync (below) is opt-in. Nothing in this repo contains real customer or financial data.
  Settings → Data has Load demo data (fake), Export backup / Import backup (JSON, includes receipt files) and Clear all data.
* No AI, no backend, no tracking. CSP allows `'self'` plus, only for the optional Google Drive backup, `accounts.google.com/gsi/*` (sign-in) and `www.googleapis.com` (Drive API), and for optional Outlook drafts `login.microsoftonline.com` / `login.live.com` (sign-in), `graph.microsoft.com` and `outlook.office.com` / `outlook.office365.com` / `outlook.live.com` (large-attachment uploads). Nothing is loaded from Google until you tap **Connect Google Drive** / a backup runs.

## Files
| File | What |
|---|---|
| `index.html` | Shell + CSP |
| `app.css` | Styles (white base, pink `#E85D9A` / lavender `#9B7BD4`, gradients) |
| `js/config.js` | `GOOGLE_CLIENT_ID` (public OAuth Web client ID). Empty = Drive backup hidden ("Drive backup not set up yet"). `OUTLOOK_CLIENT_ID` (Azure app client ID). Empty = Outlook hidden ("Outlook not set up yet") |
| `js/sync.js` | Opt-in cloud sync (Supabase): email-code sign-in, Move my data to the cloud, offline queue, push/pull, receipts in Storage, Settings → Cloud sync tab |
| `js/vendor/supabase.js` | supabase-js 2.117.2 (UMD), loaded only when cloud sync is used |
| `supabase/migrations/` | Database schema, RLS, RPCs, Storage bucket (apply with `supabase db push` / `db query --linked`) |
| `js/pdf.js` | Email PDF: draws the formal invoice / receipt as an A4 PDF with real (selectable) text using `js/vendor/jspdf.umd.min.js` |
| `js/outlook.js` | Outlook drafts: Connect Outlook (MSAL.js redirect sign-in, personal Microsoft accounts) and Email PDF → Graph draft with To, message and PDF attached |
| `js/vendor/msal-browser.min.js` | @azure/msal-browser 5.24.0 (MIT, UMD), loaded only when Outlook is used |
| `auth.html`, `js/auth-bridge.js`, `js/vendor/msal-redirect-bridge.min.js` | Microsoft sign-in return page (MSAL v5 redirect bridge). This is the registered redirect URI |
| `js/backup.js` | Google Drive backup (GIS token model, `drive.file`), backup reminder banners, "emails due" notifications |
| `js/util.js` | Helpers: money/dates (AU FY), CSV, link encoding (deflate + base64url), signatures, icons |
| `js/db.js` | IndexedDB storage, invoice maths, statuses, email templates/outbox logic, backup |
| `js/views.js` | Dashboard, invoices + editor, payments/receipts, documents, customers, services, expenses, outbox |
| `js/tools.js` | Reports (P&L, cash flow), contracts + signing page, questionnaires, CSV import, settings, demo data |
| `js/app.js` | Router, nav, modals, email compose (mailto/Gmail/copy), printing, boot |
| `sw.js` | Offline app shell (network-first) + notification tap → email outbox. **Bump `C` on every deploy.** |

## Client links (no server)
* `#sign=<code>`: contract text and details are deflated + base64url-encoded into the URL hash (hash never reaches the server).
  The client signs on a canvas; the signature is stored as vector strokes. The signed code (contract id, SHA-256 fingerprint of the text, name, date, strokes)
  goes back by email (mailto) or as a downloaded HTML file; the owner pastes/uploads it on the contract page, which checks the fingerprint.
* `#q=<code>`: questionnaire; answers come back the same way (readable text + answer code) and are imported into the customer record.

## Google Drive backup
* Settings → Data → **Google Drive backup**: Connect, Back up now, Restore from Drive, frequency (every day / every 3 days (default) / weekly) and keep last N (default 10).
* Uses Google Identity Services token model with scope `https://www.googleapis.com/auth/drive.file`, so the app can only see the files it creates. Backups are the same JSON as Export backup (with receipt files), uploaded with a resumable upload (Drive API v3, 4 MiB chunks, so large backups with receipt photos are fine; a dropped chunk or 5xx is retried once by asking Drive how much it has and resuming) to the folder **Invoicing App Backups** as `invoicing-backup-YYYY-MM-DD-HHMM.json`. After each upload, the oldest backups beyond N are deleted, but only files in that folder that the app made (it tags them with `appProperties.invoicingApp=1`).
* Automatic: when the app opens or comes back to the front, if Drive is connected and the last Drive backup is older than the chosen frequency, it backs up silently. Tokens last about an hour and are kept only in memory. The app tries a silent re-auth (`prompt: ''`). If that fails, it shows a pink **Tap to reconnect Drive for backups** banner, never a surprise popup. Auto-backup is skipped when demo data is loaded or the app is empty, so real backups are never pushed out by demo or empty ones.
* If there's been no backup at all (Drive or downloaded) for 7+ days, a gentle banner offers **Back up now** (downloads a file if Drive isn't connected).
* Restore from Drive lists the backups, asks you to confirm, downloads a local backup of the current data first, then replaces the data.
* Drive connection and notification state are per device: they're stored in the existing `settings` store under id `device` (no DB version change) and aren't part of a backup. Import/restore/demo/clear keep them.
* OAuth client (Google Cloud Console): type **Web application**, Authorised JavaScript origin `https://joshtilley88-wq.github.io` (add `http://localhost:<port>` only for local testing), no redirect URIs. Consent screen External. While it's in **Testing**, only listed test users can connect (anyone else gets "access denied", and the card explains this). `drive.file` is a non-sensitive scope, so publishing the app usually doesn't need Google's scope verification.

## Cloud sync (opt-in, Supabase Free)
* Project `invoicing` (ref `opekqrldytqvjziowbqo`, Sydney). `js/config.js` has the URL and the **publishable** key (public by design; all access is enforced by RLS). The service-role key and DB password are never in this repo.
* **Off until you turn it on.** Settings → **Cloud sync** → enter email → open the email and tap the sign-in link (or paste it, or type the code if the email has one) → **Move my data to the cloud**. Before anything is uploaded the app downloads a local backup (and a Drive backup if Drive is connected). It uploads every record with the same IDs plus receipt files, then checks row counts, receipt file sizes and a cents checksum of all invoices/payments/expenses against the server. Only if all match does the device switch to sync mode. If the cloud already has different data it asks before merging (merge = union, nothing is deleted). On other devices: sign in with the same email and choose the same button; it merges.
* Sync: every change is queued locally (works offline) and sent on open, focus, coming back online, 2 s after an edit and every 2 minutes. Pull is incremental by server revision. Last write wins per record by `updatedAt`; the losing version is kept server-side in `record_history`, and a toast says when another device's newer edit won. Settings merge field by field; invoice/quote counters take the higher value; a sent email stays sent. Deletes are tombstones (`deleted=true`), so they sync too. Duplicate invoice numbers from two offline devices are flagged.
* Receipts go to the private Storage bucket `receipts` under `<business_id>/...`. Other devices download them when opened (or Settings → Cloud sync → Download all receipts for offline use). Images are already compressed in the app (1800 px, JPEG 0.82).
* Stays local: the `device` row (Drive connection, reminders) and the `sync` row (sync state, queue). Load demo / Clear all are disabled while syncing; Import backup merges instead of replacing. **Stop syncing** signs out and keeps the local data.
* Security: RLS on every table, keyed by business membership (`members`), so it's multi-business ready. Clients can only `select`; all writes go through `push_changes()` / `create_business()` (security definer, membership checked). anon can only call `heartbeat()`.
* **Sign-in email (free plan limits):** the app asks Supabase for an email sign-in. Projects created on the Free plan after 3 June 2026 can't edit email templates while using Supabase's built-in sender, so the email has a **sign-in link** rather than a 6-digit code. The app handles both: tap the link on the same device (it opens the app signed in), or copy the link and paste it into the code box (needed for the iPhone home-screen app, since links open in Safari). Typing a 6-digit code works once a custom email sender is set up and the Magic Link template contains `{{ .Token }}` (OTP length is already 6). The built-in sender also only sends **2 emails per hour** and **only to members of the Supabase organisation** (Arden Images), so the person signing in must be invited to the org, or set up free custom SMTP (e.g. Brevo/Resend free tier) in Auth → SMTP, which lifts both limits.
* Auth settings (set with `supabase config push`): site URL and redirect allow-list `https://joshtilley88-wq.github.io/invoicing/`, email OTP length 6.
* **Keep-alive:** Free projects pause after 7 idle days. `.github/workflows/supabase-keepalive.yml` (repo root) calls `heartbeat()` with the anon key daily. GitHub disables scheduled workflows after 60 days without repo commits; re-enable it in the Actions tab if that happens.
* Tests (box, `/workspace/tools`): `rls-test.js` (two users can't see each other's rows/files), `cloud-flows.js` (migration counts/cents, two-device offline edits and conflicts, tombstones, merge prompt), plus `flows.js`, `backup-flows.js`, `migrate.js`.

## Invoice editor notes
* Items show as card rows (name, 2-line description, "qty x price", line total). Tap a row to edit qty, price, description, discount, GST or remove it. **Add items** opens a searchable service picker (tap to add, several at once) with a **Custom item** option ("Also save to my services").
* Customer fields (invoice, contract, questionnaire, import answers) are a type-to-search picker over name, business, email and phone (digits only, `+61` = `0`), showing at most 60 matches at a time so it stays fast with hundreds of customers. **Add new customer** works inline, including inside modals.
* The remaining-balance email is scheduled for the **due date** and moves with it (the queued outbox email too). Picking a different date on that invoice is an override (`balanceDateManual: true`) until **Use the due date** is tapped. Older invoices whose balance date already differed from the due date keep their date.
* New invoices default to a **fixed $100 deposit** (Settings → Invoices & numbering: fixed amount or percentage). If a deposit % other than the old built-in 50% was saved, that percentage stays the default.

## Email PDF
* Invoice screen and View / Print: **Email PDF** (replaces the old text-only "Email invoice"). It makes an A4 PDF of the same formal invoice (logo, pink/lavender band, items, totals, payment details), named `Invoice INV-1234 - Business name.pdf`.
* Phones (Web Share with files): **Share PDF** opens the share sheet with the PDF attached and the invoice email subject/message as title/text; choose Gmail. The To address is copied to the clipboard in case the app leaves it empty. Desktop (no file sharing): **Download PDF & open email** saves the PDF and opens the mailto email with To/subject/message; attach the PDF yourself.
* **Mark as sent** works as before (outbox entry sent, invoice marked sent). Deposit, balance and receipt emails keep their text-only buttons and also get **Send with PDF** / **Email with PDF** (receipt PDFs match the printable receipt).
* Works offline: the library is in the service worker cache. Built-in PDF fonts cover Western European characters; emoji and other scripts are left out of the PDF.

## Outlook drafts (optional)
* Settings → Data → **Connect Outlook** signs in to a personal Outlook / Hotmail account (authority `login.microsoftonline.com/consumers`, delegated `Mail.ReadWrite`; MSAL adds `openid profile offline_access`). Full-page redirect sign-in (works in installed Android / iPhone apps); Microsoft returns to `auth.html`, which hands the result back to the app. Tokens stay in MSAL's localStorage cache on this device; the device row (`settings`/`device`) only stores `outlook.username` / `homeAccountId`. **Disconnect** removes both.
* Connected + online: **Email PDF** (and the "with PDF" button on deposit / balance / receipt emails) becomes **Open in Outlook with PDF**: it creates a draft with `POST /me/messages` (To = the address in the To box, which comes from the customer record; subject + text body as shown; PDF as a `fileAttachment`; over 3 MB it uses an attachment upload session), then opens the draft's `webLink` so she can check it and press Send. **Mark as sent** stays manual (the app can't see whether it was sent).
* Fallbacks (toast says why): not connected, offline, Microsoft sign-in expired ("Outlook needs reconnecting"), or Graph error → the normal Share PDF / Download PDF & open email flow. PDFs are still made offline.
* Azure app registration: Personal Microsoft accounts only; platform **Single-page application**; redirect URI `https://joshtilley88-wq.github.io/invoicing/auth.html`; Microsoft Graph delegated `Mail.ReadWrite` (+ default `User.Read`); no client secret.
* SPA refresh tokens last 24 hours. After that MSAL tries a hidden renewal, which browsers that block third-party cookies (Safari, iPhone apps) usually refuse, so expect **Reconnect Outlook** (one quick redirect) after a day or so without use.

## Email-due notifications
* When the app opens, if any queued emails are due today or overdue, it shows one system notification via the service worker ("2 invoice emails due today"), at most once a day. Tapping it opens the email outbox.
* Permission is only requested from the **Turn on email reminders** button (Settings → Data) or the one-time dashboard prompt, never on page load. On iPhone, notifications only work once the app has been added to the Home Screen (iOS 16.4+).
* **Limit:** this only happens when the app is opened. Notifications while the app is closed would need a server (Web Push) later.

## Limits
* Emails are never sent automatically: a static site can't send mail or run timers. The outbox shows what is due; each email opens prefilled (mailto / Gmail) and is marked sent by hand.
* The e-signature is a simple click-to-sign record, not a certified e-signature service (no identity check, no audit trail held by a third party).
* Without cloud sync, data lives on one device/browser. Use Export backup, Google Drive backup or Cloud sync to move it or keep it safe.

## Deploy
Edit in `invoicing/`, bump `C` in `invoicing/sw.js`, commit, push to `main`. GitHub Pages updates in about a minute.
