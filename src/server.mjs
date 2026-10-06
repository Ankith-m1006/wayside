// Wayside server: serves the app and asks Gemma to identify finds and set walk quests.
// Location stays on the phone; only the region name (for example "Karnataka, India") and
// the month are sent with a photo, because they help with identification.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { askGemma, backendInfo, parseJson } from "./gemma.mjs";

try { process.loadEnvFile(".env"); } catch {}

const PORT = Number(process.env.PORT || 4300);
const PUBLIC = path.resolve("public");
const MAX_BODY = 4_000_000; // a resized photo is ~150–400 KB as base64
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };

const IDENTIFY = ({ region, month, note }) => `You are a careful field naturalist helping someone on a walk in ${region || "India"} in ${month}.
Identify the main living thing (or natural object) in the photo.${note ? ` The walker adds: "${note}".` : ""}

Reply with JSON only, in exactly this shape:
{
  "subject": "plant | flower | tree | crop | bird | insect | spider | reptile | mammal | fungus | other | none",
  "common_name": "English name, or null",
  "scientific_name": "Latin name, or null",
  "local_name": "the name in the main local language of the region, in its own script (Kannada script for Karnataka), or null if you are not sure",
  "local_language": "e.g. Kannada",
  "local_name_confidence": 0.0 to 1.0 (how sure you are that local people in this region really use this name; names often differ between languages and villages),
  "confidence": 0.0 to 1.0,
  "alternatives": ["up to 2 other likely names if confidence is below 0.8"],
  "look_closer": ["two things the walker can check with their own eyes, nose or ears right now to confirm the identification"],
  "did_you_know": "one surprising, true sentence about it, ideally local (uses, folklore, season)",
  "safety": { "level": "safe | caution | danger", "note": "short: is it safe to touch, smell or eat; for anything unknown say do not eat" },
  "next_quest": "one related thing to look for nearby on this walk"
}
Rules: never guess a local name you are not sure of; use null. Do not give a name from a different Indian language (for example a Marathi or Hindi name for a Kannada request). If the photo shows no clear subject, use "none" and say what to try. Be honest about uncertainty. Never say any wild plant or mushroom is safe to eat.`;

const QUEST = ({ region, month, done }) => `You plan short nature walks for someone in ${region || "India"} in ${month}.
Suggest 3 things to find outside today that are common there in this season, each realistic to spot within a 30-minute walk${done?.length ? `, different from: ${done.join(", ")}` : ""}.
Reply with JSON only: {"title": "a 3-6 word name for today's walk", "quests": [{"find": "what to find, specific (e.g. a flowering lantana bush)", "category": "plant | flower | tree | crop | bird | insect | other", "hint": "where to look and when, one sentence"}]}`;

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
    if (req.method === "GET" && req.url === "/api/health") return json(res, 200, { ok: true, ...backendInfo() });
    if (req.method === "GET") return await serveStatic(req, res);
    json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    console.error("[wayside]", e.message);
    if (!res.headersSent) json(res, e.status ?? 502, { error: e.status ? e.message : "Gemma could not answer just now. Your find is saved; try again in a moment." });
  }
}).listen(PORT, () => console.log(`Wayside on http://localhost:${PORT} (${JSON.stringify(backendInfo())})`));
