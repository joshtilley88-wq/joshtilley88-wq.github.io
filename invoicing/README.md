# Invoicing (v2)

Static, no-build invoicing web app for an Australian sole trader (AUD, GST 10%).
Live at https://joshtilley88-wq.github.io/invoicing/

* Plain HTML/CSS/vanilla JS. Chart.js 4.4.1 and the Inter font are vendored (no CDN calls).
* **By default all user data stays in the browser** (IndexedDB database `invoicing`). Cloud sync (below) is opt-in. Nothing in this repo contains real customer or financial data.
  Settings → Data has Load demo data (fake), Export backup / Import backup (JSON, includes receipt files) and Clear all data.
* No AI, no backend, no tracking. CSP allows `'self'` plus, only for the optional Google Drive backup, `accounts.google.com/gsi/*` (sign-in) and `www.googleapis.com` (Drive API). Nothing is loaded from Google until you tap **Connect Google Drive** / a backup runs.

## Files
| File | What |
|---|---|
| `index.html` | Shell + CSP |
| `app.css` | Styles (white base, pink `#E85D9A` / lavender `#9B7BD4`, gradients) |
| `js/config.js` | `GOOGLE_CLIENT_ID` (public OAuth Web client ID). Empty = Drive backup hidden ("Drive backup not set up yet") |
| `js/sync.js` | Opt-in cloud sync (Supabase): email-code sign-in, Move my data to the cloud, offline queue, push/pull, receipts in Storage, Settings → Cloud sync tab |
| `js/vendor/supabase.js` | supabase-js 2.117.2 (UMD), loaded only when cloud sync is used |
| `supabase/migrations/` | Database schema, RLS, RPCs, Storage bucket (apply with `supabase db push` / `db query --linked`) |
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
* **Off until you turn it on.** Settings → **Cloud sync** → enter email → type the 6-digit code from the email → **Move my data to the cloud**. Before anything is uploaded the app downloads a local backup (and a Drive backup if Drive is connected). It uploads every record with the same IDs plus receipt files, then checks row counts, receipt file sizes and a cents checksum of all invoices/payments/expenses against the server. Only if all match does the device switch to sync mode. If the cloud already has different data it asks before merging (merge = union, nothing is deleted). On other devices: sign in with the same email and choose the same button; it merges.
* Sync: every change is queued locally (works offline) and sent on open, focus, coming back online, 2 s after an edit and every 2 minutes. Pull is incremental by server revision. Last write wins per record by `updatedAt`; the losing version is kept server-side in `record_history`, and a toast says when another device's newer edit won. Settings merge field by field; invoice/quote counters take the higher value; a sent email stays sent. Deletes are tombstones (`deleted=true`), so they sync too. Duplicate invoice numbers from two offline devices are flagged.
* Receipts go to the private Storage bucket `receipts` under `<business_id>/...`. Other devices download them when opened (or Settings → Cloud sync → Download all receipts for offline use). Images are already compressed in the app (1800 px, JPEG 0.82).
* Stays local: the `device` row (Drive connection, reminders) and the `sync` row (sync state, queue). Load demo / Clear all are disabled while syncing; Import backup merges instead of replacing. **Stop syncing** signs out and keeps the local data.
* Security: RLS on every table, keyed by business membership (`members`), so it's multi-business ready. Clients can only `select`; all writes go through `push_changes()` / `create_business()` (security definer, membership checked). anon can only call `heartbeat()`.
* **Email limit:** Supabase's built-in mailer only sends a few emails per hour (about 2/hour on Free) and is for low volume. Fine for one person signing in occasionally; if "too many requests" appears, wait an hour. Later: add a free custom SMTP (e.g. Resend/Brevo free tier) in Auth settings.
* **Keep-alive:** Free projects pause after 7 idle days. `.github/workflows/supabase-keepalive.yml` (repo root) calls `heartbeat()` with the anon key daily. GitHub disables scheduled workflows after 60 days without repo commits; re-enable it in the Actions tab if that happens.
* Tests (box, `/workspace/tools`): `rls-test.js` (two users can't see each other's rows/files), `cloud-flows.js` (migration counts/cents, two-device offline edits and conflicts, tombstones, merge prompt), plus `flows.js`, `backup-flows.js`, `migrate.js`.

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
