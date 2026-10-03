# Invoicing (v1)

Static, no-build invoicing web app for an Australian sole trader (AUD, GST 10%).
Live at https://joshtilley88-wq.github.io/invoicing/

* Plain HTML/CSS/vanilla JS. Chart.js 4.4.1 and the Inter font are vendored (no CDN calls).
* **All user data stays in the browser** (IndexedDB database `invoicing`). Nothing in this repo contains real customer or financial data.
  Settings → Data has Load demo data (fake), Export backup / Import backup (JSON, includes receipt files) and Clear all data.
* No AI, no backend, no tracking. CSP allows only `'self'`.

## Files
| File | What |
|---|---|
| `index.html` | Shell + CSP |
| `app.css` | Styles (white base, pink `#E85D9A` / lavender `#9B7BD4`, gradients) |
| `js/util.js` | Helpers: money/dates (AU FY), CSV, link encoding (deflate + base64url), signatures, icons |
| `js/db.js` | IndexedDB storage, invoice maths, statuses, email templates/outbox logic, backup |
| `js/views.js` | Dashboard, invoices + editor, payments/receipts, documents, customers, services, expenses, outbox |
| `js/tools.js` | Reports (P&L, cash flow), contracts + signing page, questionnaires, CSV import, settings, demo data |
| `js/app.js` | Router, nav, modals, email compose (mailto/Gmail/copy), printing, boot |
| `sw.js` | Offline app shell (network-first). **Bump `C` on every deploy.** |

## Client links (no server)
* `#sign=<code>`: contract text and details are deflated + base64url-encoded into the URL hash (hash never reaches the server).
  The client signs on a canvas; the signature is stored as vector strokes. The signed code (contract id, SHA-256 fingerprint of the text, name, date, strokes)
  goes back by email (mailto) or as a downloaded HTML file; the owner pastes/uploads it on the contract page, which checks the fingerprint.
* `#q=<code>`: questionnaire; answers come back the same way (readable text + answer code) and are imported into the customer record.

## Limits (v1)
* Emails are never sent automatically: a static site can't send mail or run timers. The outbox shows what is due; each email opens prefilled (mailto / Gmail) and is marked sent by hand.
* The e-signature is a simple click-to-sign record, not a certified e-signature service (no identity check, no audit trail held by a third party).
* Data lives on one device/browser. Use Export backup to move or keep it safe.

## Deploy
Edit in `invoicing/`, bump `C` in `invoicing/sw.js`, commit, push to `main`. GitHub Pages updates in about a minute.
