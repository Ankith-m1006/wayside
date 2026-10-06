// Gemma, the open-weight model behind Wayside. Two interchangeable backends:
//   google  Gemma 4 served by Google AI Studio (default, works anywhere)
//   ollama  Gemma running on your own machine through Ollama (no internet at all)
const BACKEND = process.env.GEMMA_BACKEND || "google";
const GOOGLE_MODELS = (process.env.GEMMA_MODEL || "gemma-4-26b-a4b-it,gemma-4-31b-it").split(",");
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma3:4b";

// Pulls the first JSON object out of a reply, tolerating code fences and stray text.
export function parseJson(text) {
  const t = String(text ?? "");
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return JSON.");
  return JSON.parse(t.slice(start, end + 1));
}

async function google(prompt, image) {
  const parts = [...(image ? [{ inline_data: { mime_type: image.mime, data: image.base64 } }] : []), { text: prompt }];
  let lastError;
  for (const model of GOOGLE_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.2 } }),
        signal: AbortSignal.timeout(90000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const text = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
        return { text, model };
      }
      lastError = new Error(`${model} ${r.status}: ${j.error?.message ?? "error"}`);
      if (r.status !== 429 && r.status < 500) break;
      await new Promise((res) => setTimeout(res, 1500 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function ollama(prompt, image) {
  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, images: image ? [image.base64] : undefined, stream: false, format: "json", options: { temperature: 0.2 } }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  return { text: (await r.json()).response, model: `${OLLAMA_MODEL} (local)` };
}

export async function askGemma(prompt, image) {
  return BACKEND === "ollama" ? ollama(prompt, image) : google(prompt, image);
}

export const backendInfo = () => (BACKEND === "ollama" ? { backend: "ollama", model: OLLAMA_MODEL } : { backend: "google", model: GOOGLE_MODELS[0] });
