// InvoiceMate: send one email through Resend. Supabase Edge Function "invoicemate-send".
//
// Deploy (from /workspace/invoicemate):
//   supabase secrets set RESEND_API_KEY="$RESEND_API_KEY" --project-ref opekqrldytqvjziowbqo
//   supabase functions deploy invoicemate-send --project-ref opekqrldytqvjziowbqo --no-verify-jwt
//
// POST JSON { to, subject, html?, text?, reply_to?, attachments?: [{ filename, content (base64) }] }
//   headers: Content-Type: application/json, x-im-app: <APP_HEADER below, same value as js/send.js>
//   -> 200 { ok: true, id, deliveredTo, intendedTo, testMode }   | 4xx/5xx { ok: false, error }
// GET (same header) -> 200 { ok: true, service: "invoicemate-send", testMode }   (the app uses this to show "Send now")
//
// The Resend key only ever lives here as a function secret. It is never sent to, or stored in, the app.

const RESEND_URL = "https://api.resend.com/emails";
const FROM = "InvoiceMate <onboarding@resend.dev>";

// TODO(domain): Resend only delivers mail sent from onboarding@resend.dev to the Resend account owner.
// Until a sending domain is verified in Resend, EVERY email is redirected to Josh, with the intended
// recipient shown in the subject ("[TEST to dave@x.com] ...") and in a banner at the top of the email.
// When a domain is verified: set TEST_MODE = false, change FROM to e.g. "Josh Tilley <invoices@yourdomain.com.au>",
// and consider a stronger abuse check (e.g. Supabase auth) because the function could then email anyone.
const TEST_MODE = true;
const TEST_INBOX = "joshtilley88@gmail.com";

// Light abuse protection. This value is in the public app code, so it only stops casual/bot traffic.
// It's acceptable for now because in TEST_MODE every email can only ever reach Josh.
const APP_HEADER = "invoicemate-pwa-2026";

const ALLOWED_ORIGINS = ["https://joshtilley88-wq.github.io"];
const isAllowedOrigin = (o: string) =>
  ALLOWED_ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

// Rate limit (per running instance, in memory; instances are short-lived so this is deliberately light).
const PER_IP_MAX = 10, PER_IP_WINDOW_MS = 10 * 60 * 1000;   // 10 emails / 10 min / IP
const GLOBAL_MAX = 60, GLOBAL_WINDOW_MS = 60 * 60 * 1000;   // 60 emails / hour overall
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const a = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (a.length >= max) { hits.set(key, a); return true; }
  a.push(now); hits.set(key, a); return false;
}

const MAX_HTML = 300_000, MAX_TEXT = 100_000, MAX_ATTACH_BYTES = 6_000_000;
const EMAIL_RE = /^[^\s@<>()",;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function cors(origin: string): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-im-app, apikey, authorization, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (isAllowedOrigin(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: isAllowedOrigin(origin) ? 204 : 403, headers: cors(origin) });
  // Browsers always send Origin on cross-site fetches. Anything else (curl, bots) must still pass the header check.
  if (origin && !isAllowedOrigin(origin)) return json(403, { ok: false, error: "Origin not allowed" });
  if (req.headers.get("x-im-app") !== APP_HEADER) return json(401, { ok: false, error: "Not allowed" });

  if (req.method === "GET") return json(200, { ok: true, service: "invoicemate-send", testMode: TEST_MODE });
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json(500, { ok: false, error: "Email sending isn't set up on the server (missing RESEND_API_KEY)" });

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (limited("ip:" + ip, PER_IP_MAX, PER_IP_WINDOW_MS) || limited("all", GLOBAL_MAX, GLOBAL_WINDOW_MS))
    return json(429, { ok: false, error: "Too many emails in a short time. Try again in a few minutes" });

  let b: any;
  try { b = await req.json(); } catch { return json(400, { ok: false, error: "Body must be JSON" }); }
  const to = String(b?.to || "").trim();
  const subject = String(b?.subject || "").trim().slice(0, 300);
  const html = typeof b?.html === "string" ? b.html : "";
  const text = typeof b?.text === "string" ? b.text : "";
  const replyTo = typeof b?.reply_to === "string" && EMAIL_RE.test(b.reply_to.trim()) ? b.reply_to.trim() : "";
  if (!EMAIL_RE.test(to)) return json(400, { ok: false, error: "That email address doesn't look right" });
  if (!subject) return json(400, { ok: false, error: "The email needs a subject" });
  if (!html && !text) return json(400, { ok: false, error: "The email is empty" });
  if (html.length > MAX_HTML || text.length > MAX_TEXT) return json(413, { ok: false, error: "The email is too big" });

  let attachments: { filename: string; content: string }[] | undefined;
  if (Array.isArray(b?.attachments) && b.attachments.length) {
    let bytes = 0;
    attachments = b.attachments.slice(0, 5).map((a: any) => {
      const content = String(a?.content || ""); bytes += content.length * 0.75;
      return { filename: String(a?.filename || "attachment").replace(/[^\w.\- ]/g, "_").slice(0, 100), content };
    });
    if (bytes > MAX_ATTACH_BYTES) return json(413, { ok: false, error: "Attachments are too big" });
  }

  const deliverTo = TEST_MODE ? TEST_INBOX : to;
  const subj = TEST_MODE ? `[TEST to ${to}] ${subject}` : subject;
  const banner = `This is a test send from InvoiceMate. It would have gone to ${to}.`;
  const payload: Record<string, unknown> = {
    from: FROM,
    to: [deliverTo],
    subject: subj,
    ...(html ? { html: TEST_MODE ? `<div style="background:#FFF3E0;border:1px solid #F57C00;border-radius:8px;padding:10px 14px;margin:0 0 16px;font:14px Arial,sans-serif;color:#7A3E00">${esc(banner)}</div>${html}` : html } : {}),
    ...(text ? { text: TEST_MODE ? `${banner}\n\n${text}` : text } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(attachments ? { attachments } : {}),
  };

  try {
    const r = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (out && (out.message || out.error)) || `Resend said ${r.status}`;
      return json(502, { ok: false, error: `The email service refused it: ${String(msg).slice(0, 200)}` });
    }
    return json(200, { ok: true, id: out.id, deliveredTo: deliverTo, intendedTo: to, testMode: TEST_MODE });
  } catch (_e) {
    return json(502, { ok: false, error: "Couldn't reach the email service. Try again in a minute" });
  }
});
