# Invoicing (v2)

Static, no-build invoicing web app for an Australian sole trader (AUD, GST 10%).
Live at https://joshtilley88-wq.github.io/invoicing/

* Plain HTML/CSS/vanilla JS. Chart.js 4.4.1 and the Inter font are vendored (no CDN calls).
* **All user data stays in the browser** (IndexedDB database `invoicing`). Nothing in this repo contains real customer or financial data.
  Settings → Data has Load demo data (fake), Export backup / Import backup (JSON, includes receipt files) and Clear all data.
* No AI, no backend, no tracking. CSP allows `'self'` plus, only for the optional Google Drive backup, `accounts.google.com/gsi/*` (sign-in) and `www.googleapis.com` (Drive API). Nothing is loaded from Google until you tap **Connect Google Drive** / a backup runs.

## Files
| File | What |
|---|---|
| `index.html` | Shell + CSP |
| `app.css` | Styles (white base, pink `#E85D9A` / lavender `#9B7BD4`, gradients) |
| `js/config.js` | `GOOGLE_CLIENT_ID` (public OAuth Web client ID). Empty = Drive backup hidden ("Drive backup not set up yet") |
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
* Uses Google Identity Services token model with scope `https://www.googleapis.com/auth/drive.file`, so the app can only see the files it creates. Backups are the same JSON as Export backup (with receipt files), uploaded (multipart, Drive API v3) to the folder **Invoicing App Backups** as `invoicing-backup-YYYY-MM-DD-HHMM.json`. After each upload, the oldest backups beyond N are deleted, but only files in that folder that the app made (it tags them with `appProperties.invoicingApp=1`).
* Automatic: when the app opens or comes back to the front, if Drive is connected and the last Drive backup is older than the chosen frequency, it backs up silently. Tokens last about an hour and are kept only in memory. The app tries a silent re-auth (`prompt: ''`). If that fails, it shows a pink **Tap to reconnect Drive for backups** banner, never a surprise popup. Auto-backup is skipped when demo data is loaded or the app is empty, so real backups are never pushed out by demo or empty ones.
* If there's been no backup at all (Drive or downloaded) for 7+ days, a gentle banner offers **Back up now** (downloads a file if Drive isn't connected).
* Restore from Drive lists the backups, asks you to confirm, downloads a local backup of the current data first, then replaces the data.
* Drive connection and notification state are per device: they're stored in the existing `settings` store under id `device` (no DB version change) and aren't part of a backup. Import/restore/demo/clear keep them.
* OAuth client (Google Cloud Console): type **Web application**, Authorised JavaScript origin `https://joshtilley88-wq.github.io` (add `http://localhost:<port>` only for local testing), no redirect URIs. Consent screen External. While it's in **Testing**, only listed test users can connect (anyone else gets "access denied", and the card explains this). `drive.file` is a non-sensitive scope, so publishing the app usually doesn't need Google's scope verification.

## Email-due notifications
* When the app opens, if any queued emails are due today or overdue, it shows one system notification via the service worker ("2 invoice emails due today"), at most once a day. Tapping it opens the email outbox.
* Permission is only requested from the **Turn on email reminders** button (Settings → Data) or the one-time dashboard prompt, never on page load. On iPhone, notifications only work once the app has been added to the Home Screen (iOS 16.4+).
* **Limit:** this only happens when the app is opened. Notifications while the app is closed would need a server (Web Push) later.

## Limits
* Emails are never sent automatically: a static site can't send mail or run timers. The outbox shows what is due; each email opens prefilled (mailto / Gmail) and is marked sent by hand.
* The e-signature is a simple click-to-sign record, not a certified e-signature service (no identity check, no audit trail held by a third party).
* Data lives on one device/browser. Use Export backup or Google Drive backup to move it or keep it safe.

## Deploy
Edit in `invoicing/`, bump `C` in `invoicing/sw.js`, commit, push to `main`. GitHub Pages updates in about a minute.
