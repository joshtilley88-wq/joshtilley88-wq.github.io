# InvoiceMate

A voice-first invoicing app for Australian tradies. It's a plain HTML/CSS/vanilla JS installable web app (PWA), built for Chrome on Android first. There's no build step, no backend, no API keys and no tracking.

**Status:** published at https://joshtilley88-wq.github.io/invoicemate/. The two Supabase Edge Functions (`invoicemate-send`, `invoicemate-tts`) are deployed in project `invoicing` (live since 4 Oct 2026). Publish with `./publish.sh`, which copies into the `invoicemate/` folder of the GitHub Pages repo and leaves out `tests/`, `screenshots/`, `node_modules`, `supabase/` and `publish.sh`. The server code stays private on the box.

## How it works
1. **Hands-free conversation (one tap).** Tap the mic once and just talk: *"Invoice for Dave at 12 Smith St, replaced the hot water service, three hours labour plus call-out."* When you pause, the app answers out loud and asks for anything missing, one thing at a time (*"What's Dave's email address?"*, "how much for the parts?", "how many hours?", or "just checking, is that 25,000 dollars?"). Spoken emails work (*"dave at gmail dot com"*, *"d a v e at bigpond dot com"*). It reads back a short summary and asks *"Want me to send it?"*. Say *yes / yep / send it*, or a correction (*"change labour to two hours"*, *"take off the call-out"*, *"add a call-out"*, *"the rate is 110"*, *"no GST"*, *"email is …"*, *"the name is …"*) and it reads it again. On yes it saves the invoice, sends it, and says *"Sent to Dave"* (or reads out the error and offers to try again). The screen shows the running transcript and the live draft. The mic is paused whenever the app is talking, so it never hears itself. Chrome ending recognition by itself is handled by restarting it. After a long silence it asks "Still there?" once, then stops. *Cancel* / *stop*, or a tap on the mic, ends it. Logic: `js/convo.js` (state machine). Mic, speaker and screen: `js/talk.js`.
2. **Clean screen (typing).** You see the logo, a text box and a big orange mic. Tap the mic and say the job, for example *"Invoice for Dave at 12 Smith St, replaced the hot water service, three hours labour plus call-out"*. The words fill the box as you talk, and pauses are fine. You can type instead. Tap **Make invoice** to get a draft you can edit. The app reads the draft back to you, then listens for "yes / yep / send it" (or you tap **Confirm**). It saves the invoice as **Confirmed, ready to send**, auto-adds a new customer if needed, and offers **Email it** (Allyce's mailto/Gmail/copy compose), **Share** (Android share sheet) or **View / PDF**.
3. **Full app.** Swipe left to get Allyce's whole app in InvoiceMate colours: dashboard, invoices and quotes, customers, services, expenses, email outbox, contracts, questionnaires, reports, CSV import and settings. Swipe right to go back. The dots show which screen you're on, and you can tap them (or use the arrow keys on desktop). The grey ☰ on the clean screen opens the same menu.
4. **Receipt scanning.** Use **Expenses → Scan receipt**, or ☰ → Scan a receipt. The camera photo is read on the phone by Tesseract.js, with the engine and English data in `vendor/`. The app pulls out the merchant, total, date (DD/MM/YYYY) and GST (printed, or total ÷ 11), then opens a prefilled expense form for you to check. The photo and a thumbnail are saved with the expense.

## Files
| Path | What |
|---|---|
| `index.html` | Shell + CSP. The two swipe panes (`#clean`, `#full`) |
| `app.css` | Allyce's stylesheet, recoloured from pink/lavender to orange/charcoal |
| `im.css` | InvoiceMate additions: brand, pager, clean screen, mic, draft review |
| `js/parser.js` | **`parseJob(text)`**: local rule-based speech → draft invoice (number words, customer/address, labour hours × rate, parts, call-out, price list, GST). Works in the browser and in Node |
| `js/receipt.js` | `parseReceipt(ocrText)`: merchant / total / date / GST |
| `js/thinking.js` | **Provider switch** (Settings → Voice & prices → Thinking: Local / Grok / OpenAI; only Local is implemented, the other two are stubs). Price list in localStorage (`im.prices`) and its editor |
| `js/convo.js` | **Conversation state machine** (pure, Node-testable): spoken emails, yes/no, corrections, missing-detail questions, summary |
| `js/talk.js` | Conversation controller: recognition (restart, end-of-turn pause, silence), mic paused while speaking, transcript + draft UI, save + send |
| `js/engines.js` | **Conversation engine switch** (Settings → Voice & prices → Conversation engine: Live / Chained / Local) and engine B, `Chained` (calls `invoicemate-brain`, applies its ops, guards sending) |
| `js/live.js` | Engine A, `Live`: OpenAI Realtime over WebRTC (ephemeral key from `invoicemate-realtime-session`), tool calls → draft, barge-in |
| `js/voice-prompt.js` | The ONE system prompt + tool list shared by Live and Chained (copied into `supabase/functions/_shared/` on deploy) |
| `js/draft-ops.js` | The tools' effect on the draft (set_customer, add_item, update_item, remove_item, set_email), draft state for the model, grading |
| `js/voice-cost.js` | Turn latency metrics + OpenAI pricing for the cost-per-invoice numbers |
| `js/voicetest.js`, `voice-test/` | **Voice test** screen (menu → Voice test): scripted scenarios with recorded clips, runs any engine, shows the metrics table. `voice-test/results.json` = latest headless benchmark |
| `js/invoice-pdf.js`, `vendor/jspdf.umd.min.js` | **Invoice PDF** attached to every invoice email (A4, real text, ~6 KB + logo). jsPDF 4.2.1 (MIT), the same library and approach as Allyce's Invoicing app; loaded on demand, cached by the service worker |
| `js/send.js` | `Sender` (calls the `invoicemate-send` function), email-safe invoice HTML, `sendEntryNow()`, `TTS` (calls `invoicemate-tts`) + voice list |
| `supabase/functions/invoicemate-send/` | Edge Function: `{to, subject, html, text, reply_to?, attachments?}` → Resend. Test mode forces delivery to Josh |
| `supabase/functions/invoicemate-tts/` | Edge Function: `{text, voice?}` → OpenAI `gpt-4o-mini-tts` mp3 (≤ 600 chars) |
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
node parser.test.js && node receipt.test.js && node convo.test.js && node chase.test.js && node voice.test.js && node pdf.test.js && node e2e.js 8792   # e2e mocks both functions + speech
```

## Known limits
* **Talking** needs Chrome on Android (or desktop Chrome) over **HTTPS or localhost**, plus mic permission. Chrome sends the audio to Google's speech service, so it needs internet. Typing always works offline. Chrome also ends a listening session after a long silence. The app restarts it automatically and stops for good after 20 s of silence.
* **The parser is rule-based**, so it can mis-hear or misread unusual phrasing. You always review the draft before it's saved. "Two fifty" is read as $250, "ninety five fifty" as $95.50, and "eleven fifty" as $1,150.
* **OCR** works well on flat, well-lit receipts. Crumpled, faded thermal or angled photos will need corrections in the form.
* **Data is local only** (no sync between devices). Allyce's Google Drive backup and Supabase cloud sync are switched off here.
* **Sending is in TEST MODE.** There's no verified sending domain in Resend yet, so the function sends from `onboarding@resend.dev`, which Resend only delivers to the account owner. Every email is redirected to Josh's own inbox (the Resend account owner) with `[TEST to <real recipient>]` in the subject. To go live, verify a domain in Resend, then set `TEST_MODE = false` and change `FROM` in `supabase/functions/invoicemate-send/index.ts`, and redeploy (see the TODO there).
* The invoice goes in the email body as HTML **and** as an attached PDF (see Invoice PDF attachments).
* Abuse protection is light: a CORS allow-list, a shared `x-im-app` header (it's in the public JS, so it isn't a secret), a per-instance rate limit and size limits. That's fine while every email can only reach Josh. Add real auth before turning test mode off.
* If the functions aren't reachable, **Send now** is hidden and the compose sheet falls back to Email app / Gmail / Copy plus a small **I sent it myself** link. In a conversation, "yes" saves the invoice and opens the email instead. The voice falls back to the phone's speechSynthesis.

## Server functions (Supabase project `invoicing`, ref `opekqrldytqvjziowbqo`)
Keys live only as function secrets. They're never in this folder or the app. The function source (`supabase/`) is kept on the box in `/workspace/invoicemate/` and isn't published to the public repo.
```
cd /workspace/invoicemate
supabase secrets set RESEND_API_KEY="$RESEND_API_KEY" OPENAI_API_KEY="$OPENAI_API_KEY" --project-ref opekqrldytqvjziowbqo
supabase functions deploy invoicemate-send --project-ref opekqrldytqvjziowbqo --no-verify-jwt
supabase functions deploy invoicemate-tts  --project-ref opekqrldytqvjziowbqo --no-verify-jwt
```
`--no-verify-jwt` is used because the app has no Supabase sign-in. Each function checks the `x-im-app` header and the Origin (https://joshtilley88-wq.github.io or localhost) itself. GET with the header is a health check, which the app uses to decide whether to show **Send now**.

## Conversation engines (voice)
Settings → Voice & prices → **Conversation engine**. All three make the same draft and save/send it the same way; the app (not the AI) decides when it's really sent: only after a clear yes, and only when nothing is missing.

| Engine | How | Notes |
|---|---|---|
| **Live (Realtime)** | Mic → OpenAI `gpt-realtime-2.1-mini` speech-to-speech over WebRTC. `invoicemate-realtime-session` mints a 60 s client secret (key stays on the server). Semantic VAD (eagerness medium, switched to high just for "want me to send it?"), noise reduction near-field, barge-in on. The model fills the invoice through tools; the app applies them (`js/draft-ops.js`) and does the send. | Most natural, talks over you / you can interrupt. ~2–3 US cents per invoice. Needs good data. |
| **Chained (cheap)** | Phone's free Web Speech → `invoicemate-brain` (`gpt-4.1-mini`, JSON: draft ops + reply) → `invoicemate-tts` voice. The model call starts during his pause (speculative), and the first sentence of the reply is voiced first. | ~1 US cent per invoice. Best accuracy on messy speech in the tests. |
| **Local (offline)** | The rule-based parser + state machine (`js/convo.js`). | Free, quickest replies, weakest on messy speech. |

**Delay trims (Oct 2026), Chained + Local:** end-of-turn silence 2.6 s → 1.8 s for the job description and 1.5 s → 0.9 s for answers; +1.4 s automatically when the words so far look unfinished ("and", "um", "plus", "at", "dot", a trailing comma) or the job has no charge in it yet; interim-word grace 1.4 → 0.7 s; echo gap 350 → 200 ms. While he's pausing (after 0.45 s) the reply is worked out in the background and its first sentence's voice prefetched, so when the pause ends it starts almost at once (thrown away if he keeps talking). Long replies are split so the first sentence (or first clause) is voiced while the rest loads. TTS phrases are cached (40).

**Voice test** (menu → Voice test): runs scripted scenarios (simple, messy with pauses and "no wait", multi-item, spoken email, correction after read-back) through any engine with recorded clips (`voice-test/*.mp3`, made once with gpt-4o-mini-tts) and shows cost per invoice (from the APIs' usage), reply delay (end of speech → first reply audio, avg and p90) and accuracy against the expected invoice. Headless benchmark: `node tests/voice-bench.js 8792 live,chained,local s1-simple,s2-messy 1` then `node tests/voice-merge.js <live files> <chained/local files>`. In the headless browser there's no Web Speech, so `gpt-4o-mini-transcribe` stands in for Chained/Local (left out of "cost per invoice"; on the phone it's free).

Deploy the two voice functions: `bash supabase/deploy-voice.sh` (copies the shared prompt, deploys `invoicemate-realtime-session` + `invoicemate-brain`; OPENAI_API_KEY is already a function secret).

## Invoice PDF attachments
Every invoice email InvoiceMate sends attaches the invoice as a PDF named like `INV-1021.pdf`, and keeps the HTML invoice in the body: the voice "send it" (Live, Chained and Local all save + send through `Talk.deliver` → `sendEntryNow`), the outbox **Send now**, **Email it** / **Email invoice**, and payment-chasing email reminders.

* **How it's made (app):** `js/invoice-pdf.js` draws it with jsPDF (vendored, no CDN): logo (shrunk to max 360×120 px so PDFs stay small) or business name, ABN, address, contact, TAX INVOICE / INVOICE, number, issued / due (+ OVERDUE), orange-to-charcoal band, Bill to, an **Amount owing** box, line items, subtotal / GST / total, Paid + Amount owing when part-paid, a **Pay online** box (placeholder text until card payments exist; becomes a real link if `business.payLink` is set), notes / terms, bank details + reference. `draw()` is pure, so `tests/pdf.test.js` runs it in Node. View / PDF now has **Download PDF**.
* **Sizes:** ~6 KB without a logo, ~30 KB with a busy logo. Resend allows 40 MB per email (after base64); `invoicemate-send` caps attachments at 6 MB.
* **If the PDF can't be made** (very old phone, script blocked), the email still goes with the HTML invoice; the send isn't blocked.
* **Payment-chasing emails (server, cron):** the server has no browser and only minimal data, so the **app makes the PDF and uploads it** when it syncs a chase (route `pdf`), only for active chases that have an email address, and again whenever it changes (amount owing after a part payment, items, business details, logo, overdue). It's stored in the **private** Storage bucket `im-chase-pdf` (no policies; only the `invoicemate-chase` function with the service role can read it; 512 KB limit, PDF only) with the amount owing it shows. The cron attaches it to an email reminder only if that amount matches the reminder's amount (otherwise it sends without it), and the email says "Invoice INV-1021 is attached as a PDF". The file is deleted as soon as chasing stops (paid, stopped, opted out, all reminders sent). SMS reminders don't carry a PDF. Migration: `supabase/migrations/20261006_im_chase_pdf.sql` (run by `deploy-chase.sh`).
* Tests: `node tests/pdf.test.js` (renderer), `tests/e2e.js` (voice send, outbox Send now, chase upload + re-upload after a part payment; mocked functions), `node tests/pdf-live-send.js 8792` (REAL: one Send now email + one chase reminder via dry run + run, then marks it paid; sends 2 test emails to Josh).

## Automatic payment chasing

Unpaid invoices get friendly reminders by **SMS** (email as backup if there's no mobile or the SMS fails). The default is **3, 7 and 14 days** after the due date, with an optional heads-up on the due date. The 14-day reminder is firmer but still polite.

- **What the app does:** chase data is local like everything else. The app syncs only what the server needs (`js/chase.js`, see `Chase.syncNow`) when invoices, payments, customers or settings change, and when the app opens. That's the invoice no, amount owing, due date, customer first name, mobile and email, business name, schedule and wording. The device is identified by a random key (localStorage `im.chaseKey`), and the server stores only its SHA-256.
- **Turning it on or off:**
  - Overall: Settings → Payment chasing. The schedule, the due-date option and the editable templates (with previews) are all there too.
  - Per invoice: the "Chase this invoice" toggle in the invoice editor.
  - Per customer: "Chase payments automatically" in Edit customer.
  - By voice, in the hands-free conversation: "stop chasing Dave", "chase the Smith invoice", "chase invoice ten twenty one", "who owes me money?".
- **When it stops:** chasing stops when the invoice is paid in full, deleted, turned off, or when the customer opts out.
- **Reminders log:** menu → Reminders log (`#/reminders`). It shows what's being chased, the next reminder, and everything sent.
- **Public page:** `view.html?t=TOKEN` shows a summary (business, invoice no, amount, due date). "Pay online" is a **placeholder** for a later phase; Stripe isn't integrated. "Stop payment reminders" opts the customer out.
- **Spam Act:**
  - Every message names the business.
  - SMS ends "Reply STOP to opt out." (live provider) or carries an opt-out link.
  - Email has an unsubscribe link plus `List-Unsubscribe` one-click headers.
  - Opting out stops all chases for that customer (matched by customer, mobile or email).
- **Send window:** **Mon–Sat 8:00am–6:59pm Australia/Sydney**, DST-safe via Intl. Nothing goes out on Sundays or NSW public holidays (hardcoded list for 2026–27 in `js/chase-core.js`). If a reminder falls outside the window, it waits for the next one. If several steps are overdue at once, only the latest is sent, so there's never a burst.

### Server
- **Tables:** `im_chase`, `im_chase_log` and `im_chase_optout` (`supabase/migrations/20261004_im_chase.sql`). RLS is on with no policies, and anon/authenticated access is revoked, so only the edge function (service role) can touch them.
- **Function `invoicemate-chase`:**
  - App routes `sync`, `state` and `ping` need the `x-im-app` header plus `x-im-owner`, with the same CORS and rate limits as invoicemate-send.
  - Public routes `view` and `unsub` work by token.
  - `run` needs the `x-cron-secret` header. Options: `dry`, `now` (dry runs only), and `ignoreQuietHours` (honoured only while SMS and email are both in test mode).
- **Cron:** pg_cron job `invoicemate-chase-run` runs at `*/30 * * * *` (every 30 minutes) and calls `run` through pg_net. The secret lives in Vault (`im_chase_cron_secret`) and in the function secret `CHASE_CRON_SECRET`.
- **Redeploy:** run `./supabase/deploy-chase.sh`. It copies `js/chase-core.js` into `_shared/`, applies the migration, sets the secret, deploys and (re)schedules the cron job.

### SMS: test mode and going live
- `supabase/functions/_shared/sms.ts` has the provider interface `sendSms(to, body)`.
- **Test mode (default):** nothing is sent to any phone. Each reminder is logged as "test (not sent)" and Josh gets an email copy.
- **Live:** the stubbed live adapter is **Cellcast** (`https://api.cellcast.com/api/v1/gateway`, Bearer key, shared two-way number so "Reply STOP" works, `replyStopToOptOut`).
- **Going live:**
  1. Create a Cellcast account and buy credits (Josh decides).
  2. `npx supabase secrets set CELLCAST_API_KEY=... SMS_LIVE=true --project-ref opekqrldytqvjziowbqo`
  3. Redeploy.
- **Email:** for real customer email, verify a sending domain in Resend and set `EMAIL_TEST_MODE` to false in `_shared/resend.ts`.
- **Sender ID:** to use a business-name sender ID (one-way, no STOP replies), register it in the ACMA SMS Sender ID Register through the provider first. Unregistered IDs show as "Unverified" since 1 July 2026.

### Limits
- The server only knows about invoices after the app has synced (open the app once after making changes).
- Chases are tied to this browser's device key. Clearing site data creates a new key, and the old chases keep running until they're paid or stopped. Turn chasing off before wiping a device.
- The owner key and rate limits are light protection. Review them before real customers.
- The public holiday list is hardcoded (NSW 2026–27).
- STOP replies to the live number are handled by Cellcast's opt-out list. They are not fed back into the app automatically; a webhook is a later phase.

### Later (not built)
- Voice quoting.
- "Turn quote into invoice".
- Pay-now (Stripe).
