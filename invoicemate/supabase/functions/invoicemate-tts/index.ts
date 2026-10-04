// InvoiceMate: natural-sounding voice. Supabase Edge Function "invoicemate-tts" -> OpenAI text-to-speech.
//
// Deploy (from /workspace/invoicemate):
//   supabase secrets set OPENAI_API_KEY="$OPENAI_API_KEY" --project-ref opekqrldytqvjziowbqo
//   supabase functions deploy invoicemate-tts --project-ref opekqrldytqvjziowbqo --no-verify-jwt
//
// POST JSON { text, voice? }   headers: Content-Type: application/json, x-im-app: <APP_HEADER, same as js/send.js>
//   -> 200 audio/mpeg (mp3 bytes)   | 4xx/5xx JSON { ok: false, error }
// GET (same header) -> 200 { ok: true, service: "invoicemate-tts", voices: [...] }
// The OpenAI key only lives here as a function secret; it is never sent to the app.

const OPENAI_URL = "https://api.openai.com/v1/audio/speech";
const MODEL = "gpt-4o-mini-tts";
const VOICES = ["nova", "alloy", "shimmer", "coral", "sage", "ash", "ballad", "echo", "fable", "onyx", "verse"];
const DEFAULT_VOICE = "nova";
const INSTRUCTIONS =
  "Speak like a friendly, relaxed Australian mate helping a tradie with their paperwork. Warm, casual and upbeat, " +
  "natural pace, not robotic. Say dollar amounts and email addresses clearly.";
const MAX_TEXT = 600;

const APP_HEADER = "invoicemate-pwa-2026";   // public app header value: light abuse protection only
const ALLOWED_ORIGINS = ["https://joshtilley88-wq.github.io"];
const isAllowedOrigin = (o: string) =>
  ALLOWED_ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

// Light, per-instance rate limit (each prompt is one call, so a conversation is ~5-15 calls)
const PER_IP_MAX = 60, PER_IP_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_MAX = 600, GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const a = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (a.length >= max) { hits.set(key, a); return true; }
  a.push(now); hits.set(key, a); return false;
}

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
  if (origin && !isAllowedOrigin(origin)) return json(403, { ok: false, error: "Origin not allowed" });
  if (req.headers.get("x-im-app") !== APP_HEADER) return json(401, { ok: false, error: "Not allowed" });
  if (req.method === "GET") return json(200, { ok: true, service: "invoicemate-tts", voices: VOICES, default: DEFAULT_VOICE });
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });

  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return json(500, { ok: false, error: "Voice isn't set up on the server (missing OPENAI_API_KEY)" });

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (limited("ip:" + ip, PER_IP_MAX, PER_IP_WINDOW_MS) || limited("all", GLOBAL_MAX, GLOBAL_WINDOW_MS))
    return json(429, { ok: false, error: "Too many voice requests. Try again in a few minutes" });

  let b: any;
  try { b = await req.json(); } catch { return json(400, { ok: false, error: "Body must be JSON" }); }
  const text = String(b?.text || "").trim();
  const voice = VOICES.includes(String(b?.voice)) ? String(b.voice) : DEFAULT_VOICE;
  if (!text) return json(400, { ok: false, error: "No text" });
  if (text.length > MAX_TEXT) return json(413, { ok: false, error: `Text is longer than ${MAX_TEXT} characters` });

  try {
    const r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, voice, input: text, instructions: INSTRUCTIONS, response_format: "mp3" }),
    });
    if (!r.ok || !r.body) {
      await r.body?.cancel();   // don't pass OpenAI's error text on (it can quote part of the key)
      return json(502, { ok: false, error: `Voice service said ${r.status}` });
    }
    return new Response(r.body, { status: 200, headers: { ...cors(origin), "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (_e) {
    return json(502, { ok: false, error: "Couldn't reach the voice service" });
  }
});
