// Wayside server: serves the app and asks Gemma to identify finds and set walk quests.
// Location stays on the phone; only the region name (for example "Karnataka, India") and
// the month are sent with a photo, because they help with identification.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { askGemma, backendInfo, parseJson } from "./gemma.mjs";
import { IDENTIFY, QUEST } from "./prompts.mjs";

try { process.loadEnvFile(".env"); } catch {}

const PORT = Number(process.env.PORT || 4300);
const PUBLIC = path.resolve("public");
const MAX_BODY = 4_000_000; // a resized photo is ~150–400 KB as base64
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };

async function body(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > MAX_BODY) throw Object.assign(new Error("Photo too large"), { status: 413 });
  }
  return JSON.parse(data || "{}");
}

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function identify(req, res) {
  const input = await body(req);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(input.image ?? ""));
  if (!m) return json(res, 400, { error: "Send a JPEG, PNG or WebP photo." });
  const t0 = Date.now();
  const prompt = IDENTIFY({ region: String(input.region ?? "").slice(0, 80), month: String(input.month ?? "").slice(0, 20), note: String(input.note ?? "").slice(0, 200) });
  const out = await askGemma(prompt, { mime: m[1], base64: m[2] });
  const result = parseJson(out.text);
  json(res, 200, { ...result, model: out.model, ms: Date.now() - t0 });
}

async function quest(req, res) {
  const input = await body(req);
  const out = await askGemma(QUEST({ region: String(input.region ?? "").slice(0, 80), month: String(input.month ?? "").slice(0, 20), done: (input.done ?? []).slice(0, 10).map(String) }));
  json(res, 200, { ...parseJson(out.text), model: out.model });
}

// Speech fallback: the phone's own voice is used first (Android Google TTS, Apple voices,
// Windows voices). When the device has no voice for a language (Kannada on an iPhone, for
// example), the app asks for a short clip from Google Cloud Text-to-Speech instead.
const TTS_CACHE = new Map();
async function cloudToken() {
  const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error("No Google Cloud credentials here");
  return (await r.json()).access_token;
}
async function speak(req, res) {
  const input = await body(req);
  const text = String(input.text ?? "").slice(0, 400), lang = /^[a-z]{2,3}-[A-Z]{2}$/.test(input.lang) ? input.lang : "en-IN";
  if (!text) return json(res, 400, { error: "Nothing to say." });
  const key = `${lang}|${text}`;
  let audio = TTS_CACHE.get(key);
  if (!audio) {
    const r = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: { Authorization: `Bearer ${await cloudToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: { text }, voice: { languageCode: lang }, audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 } }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j.error?.message ?? "Speech failed"), { status: 502 });
    audio = Buffer.from(j.audioContent, "base64");
    if (TTS_CACHE.size > 300) TTS_CACHE.clear();
    TTS_CACHE.set(key, audio);
  }
  res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" });
  res.end(audio);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: "Forbidden" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": /\.(html|js|webmanifest)$/.test(rel) ? "no-cache" : "public, max-age=3600" });
    res.end(data);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}

createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/identify") return await identify(req, res);
    if (req.method === "POST" && req.url === "/api/quest") return await quest(req, res);
    if (req.method === "POST" && req.url === "/api/speak") return await speak(req, res);
    if (req.method === "GET" && req.url === "/api/health") return json(res, 200, { ok: true, ...backendInfo() });
    if (req.method === "GET") return await serveStatic(req, res);
    json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    console.error("[wayside]", e.message);
    if (!res.headersSent) json(res, e.status ?? 502, { error: e.status ? e.message : "Gemma could not answer just now. Your find is saved; try again in a moment." });
  }
}).listen(PORT, () => console.log(`Wayside on http://localhost:${PORT} (${JSON.stringify(backendInfo())})`));
