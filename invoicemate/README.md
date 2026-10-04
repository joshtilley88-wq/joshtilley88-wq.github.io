# InvoiceMate

A voice-first invoicing app for Australian tradies. It's a plain HTML/CSS/vanilla JS installable web app (PWA), built for Chrome on Android first. There's no build step, no backend, no API keys and no tracking.

**Status:** local prototype on the box only. It has not been published.

## How it works
1. **Clean screen (home).** You see the logo, a text box and a big orange mic. Tap the mic and say the job, for example *"Invoice for Dave at 12 Smith St, replaced the hot water service, three hours labour plus call-out"*. The words fill the box as you talk, and pauses are fine. You can type instead. Tap **Make invoice** to get a draft you can edit. The app reads the draft back to you, then listens for "yes / yep / send it" (or you tap **Confirm**). It saves the invoice as **Confirmed, ready to send**, auto-adds a new customer if needed, and offers **Email it** (Allyce's mailto/Gmail/copy compose), **Share** (Android share sheet) or **View / PDF**.
2. **Full app.** Swipe left to get Allyce's whole app in InvoiceMate colours: dashboard, invoices and quotes, customers, services, expenses, email outbox, contracts, questionnaires, reports, CSV import and settings. Swipe right to go back. The dots show which screen you're on, and you can tap them (or use the arrow keys on desktop). The grey ☰ on the clean screen opens the same menu.
3. **Receipt scanning.** Use **Expenses → Scan receipt**, or ☰ → Scan a receipt. The camera photo is read on the phone by Tesseract.js, with the engine and English data in `vendor/`. The app pulls out the merchant, total, date (DD/MM/YYYY) and GST (printed, or total ÷ 11), then opens a prefilled expense form for you to check. The photo and a thumbnail are saved with the expense.

## Files
| Path | What |
|---|---|
| `index.html` | Shell + CSP. The two swipe panes (`#clean`, `#full`) |
| `app.css` | Allyce's stylesheet, recoloured from pink/lavender to orange/charcoal |
| `im.css` | InvoiceMate additions: brand, pager, clean screen, mic, draft review |
| `js/parser.js` | **`parseJob(text)`**: local rule-based speech → draft invoice (number words, customer/address, labour hours × rate, parts, call-out, price list, GST). Works in the browser and in Node |
| `js/receipt.js` | `parseReceipt(ocrText)`: merchant / total / date / GST |
| `js/thinking.js` | **Provider switch** (Settings → Voice & prices → Thinking: Local / Grok / OpenAI; only Local is implemented, the other two are stubs). Price list in localStorage (`im.prices`) and its editor |
| `js/voice.js` | Web Speech API dictation (en-AU, continuous, interim, auto-restart through pauses, Android duplicate fix) + speechSynthesis read-back |
| `js/scan.js` | Camera → Tesseract.js → expense form |
| `js/clean.js` | Clean screen, swipe pager, draft review/confirm, logo markup |
| `js/local-only.js` | No-op stand-in for Allyce's Supabase `sync.js` (cloud sync is off) |
| `js/config.js` | All keys blank on purpose (no Google Drive backup, no Supabase) |
| `js/util.js, db.js, views.js, tools.js, backup.js, app.js` | Copied from Allyce's app (`box-quoter/invoicing/`) with small marked changes |
| `vendor/` | Chart.js 4.4.1, tesseract.js 7.0.0 (+ worker), tesseract.js-core 7 LSTM builds (relaxed-SIMD / SIMD / plain), `lang/eng.traineddata.gz` (4.0.0_best_int) |
| `icons/` | `mark.svg`, `logo.svg`, `mark-maskable.svg`, PNG icons 192 / 512 / maskable 512 |
| `sw.js`, `manifest.json` | Offline service worker (shell network-first, vendor cache-first) + install manifest |
| `tests/` | `parser.test.js`, `receipt.test.js`, `e2e.js` (Playwright + system Chrome), `make-icons.js`, `sample-receipt.png` |
| `screenshots/` | Phone screenshots (412×915 @2x) from `tests/e2e.js` |

## Data
Everything stays in the browser on the device. Invoices, customers, expenses and receipt photos are in **IndexedDB** (database `invoicemate`), the same local-only storage Allyce's app uses by default. It's needed because photos are too big for localStorage. The price list and voice/provider settings are in **localStorage** (`im.*`). Use Settings → Data & backup → Export backup (a JSON file) to keep it safe.

## Run / test locally
```
cd /workspace/invoicemate && python3 -m http.server 8792 --bind 127.0.0.1    # then open http://localhost:8792/
cd tests && npm install          # dev only: playwright-core, tesseract.js (source of the vendored files)
node parser.test.js && node receipt.test.js && node e2e.js 8792
```

## Known limits
* **Talking** needs Chrome on Android (or desktop Chrome) over **HTTPS or localhost**, plus mic permission. Chrome sends the audio to Google's speech service, so it needs internet. Typing always works offline. Chrome also ends a listening session after a long silence. The app restarts it automatically and stops for good after 20 s of silence.
* **The parser is rule-based**, so it can mis-hear or misread unusual phrasing. You always review the draft before it's saved. "Two fifty" is read as $250, "ninety five fifty" as $95.50, and "eleven fifty" as $1,150.
* **OCR** works well on flat, well-lit receipts. Crumpled, faded thermal or angled photos will need corrections in the form.
* **Data is local only** (no sync between devices). Allyce's Google Drive backup and Supabase cloud sync are switched off here.
* Emails aren't sent by the app. They open ready to send in your email app, the same as Allyce's.
