// Field test: runs Wayside's exact identify prompt over a folder of photos with known answers
// and scores species and local (Kannada) names. Usage:
//   GEMMA_MODEL=gemma-4-31b-it node scripts/fieldtest.mjs <photoDir> <out.json>
// Photos are public-domain/CC images from Wikimedia Commons named <key>.jpg.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

try { process.loadEnvFile(".env"); } catch {}
const { askGemma, parseJson } = await import("../src/gemma.mjs");
const { IDENTIFY } = await import("../src/prompts.mjs");

// Answer key: words that must appear in the common or scientific name, and the Kannada names
// people actually use (null where we could not confirm one).
const KEY = {
  banana: { match: ["banana", "musa"], kn: ["ಬಾಳೆ"] },
  bulbul: { match: ["bulbul", "pycnonotus"], kn: ["ಪಿಕಳಾರ"] },
  coconut: { match: ["coconut", "cocos"], kn: ["ತೆಂಗು", "ತೆಂಗಿನ"] },
  drongo: { match: ["drongo", "dicrurus"], kn: ["ಕಾಜಾಣ"] },
  frangipani: { match: ["frangipani", "plumeria", "temple tree"], kn: null },
  hibiscus: { match: ["hibiscus"], kn: ["ದಾಸವಾಳ"] },
  ixora: { match: ["ixora"], kn: ["ಕೇಪಳೆ", "ಕೇಪಳ"] },
  kingfisher: { match: ["kingfisher", "halcyon"], kn: ["ಮಿಂಚುಳ್ಳಿ"] },
  lantana: { match: ["lantana"], kn: null },
  mimosa: { match: ["mimosa", "touch-me-not", "sensitive plant"], kn: ["ಮುಟ್ಟಿದರೆ ಮುನಿ"] },
  myna: { match: ["myna", "acridotheres"], kn: ["ಗೊರವಂಕ"] },
  neem: { match: ["neem", "azadirachta"], kn: ["ಬೇವು", "ಬೇವಿನ"] },
  plaintiger: { match: ["plain tiger", "danaus chrysippus", "danaus"], kn: null },
  tulsi: { match: ["tulsi", "holy basil", "ocimum tenuiflorum", "ocimum sanctum"], kn: ["ತುಳಸಿ"] },
};

const dir = process.argv[2], out = process.argv[3] ?? "fieldtest.json";
const rows = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort()) {
  const key = path.basename(file, ".jpg"), k = KEY[key];
  if (!k) continue;
  const t0 = Date.now();
  try {
    const res = await askGemma(IDENTIFY({ region: "Karnataka, India", month: "October" }), { mime: "image/jpeg", base64: readFileSync(path.join(dir, file)).toString("base64") });
    const r = parseJson(res.text);
    const names = `${r.common_name ?? ""} ${r.scientific_name ?? ""}`.toLowerCase();
    const shown = r.local_name && (r.local_name_confidence ?? 0) >= 0.85;
    const knOk = k.kn && r.local_name ? k.kn.some((n) => r.local_name.includes(n)) : null;
    rows.push({ key, model: res.model, ms: Date.now() - t0, species_ok: k.match.some((m) => names.includes(m)), common_name: r.common_name, scientific_name: r.scientific_name, confidence: r.confidence, local_name: r.local_name, local_conf: r.local_name_confidence, local_shown: Boolean(shown), local_ok: knOk, safety: r.safety?.level });
  } catch (e) {
    rows.push({ key, error: e.message, ms: Date.now() - t0 });
  }
  const x = rows.at(-1);
  console.log(`${x.species_ok ? "✓" : "✗"} ${key.padEnd(11)} ${x.common_name ?? x.error} | conf ${x.confidence} | local ${x.local_name ?? "-"} (${x.local_conf ?? "-"}) ${x.local_ok == null ? "" : x.local_ok ? "correct" : "WRONG"} ${x.local_shown ? "[shown]" : "[hidden]"} | ${Math.round(x.ms / 1000)}s`);
  writeFileSync(out, JSON.stringify(rows, null, 1));
}
const ok = rows.filter((r) => r.species_ok).length;
const shown = rows.filter((r) => r.local_shown), shownChecked = shown.filter((r) => r.local_ok != null);
console.log(`\nSpecies correct: ${ok}/${rows.length} · local names shown: ${shown.length} (${shownChecked.filter((r) => r.local_ok).length}/${shownChecked.length} correct where we know the answer) · local names given but hidden: ${rows.filter((r) => r.local_name && !r.local_shown).length}`);
