# Wayside

**A pocket field guide for walks.** Snap a plant, bird or insect you spot outside; Gemma names it in English and your local language, gives you two things to check with your own eyes, says whether it is safe to touch, and suggests what to look for next. Then you put the phone back in your pocket.

**Try it:** https://wayside-1037019152152.asia-south1.run.app (works on any phone; add it to your home screen)

Built for the DEV Hacktoberfest Open-Source AI Challenge, Week 1: *Touch Grass*.

## Why

Most nature apps keep you looking at the screen. Wayside is built the other way round:

- **Snap and keep walking.** Identification takes a few seconds; your phone buzzes when it is ready.
- **Look up from the screen.** Every result comes with two things to check in person (count the petals, look at how the leaves pair up, listen for the call).
- **Ask someone nearby.** Local names change from village to village, so Wayside only shows a local name when the model is very sure. Otherwise it asks you to ask a neighbour what they call it, and saves their answer.
- **A quest a day.** Three things that are common where you are in this season, to give the walk a purpose.
- **Patchy signal is fine.** The app opens offline; photos taken with no signal are saved on the phone and identified automatically when you are back in range.
- **Screen time is counted.** At the end of a walk you see how much of it you spent with the screen off.

## How it works

```
phone (PWA, IndexedDB, service worker)
   │  photo (resized to 1024 px) + region name + month      location stays on the phone
   ▼
Node server (src/server.mjs, no dependencies)
   │  strict JSON prompt
   ▼
Gemma (src/gemma.mjs)
   ├─ google: Gemma 4 (gemma-4-26b-a4b-it, fallback gemma-4-31b-it) via Google AI Studio
   └─ ollama: Gemma on your own machine (for example gemma3:4b), no internet needed
```

- **Gemma is the whole brain.** One multimodal call identifies the photo and returns names, a confidence score, alternatives, look-closer checks, a local fact, a safety level and the next thing to find. A second call writes the day's seasonal quest.
- **Honesty is in the prompt and the UI.** The model reports how sure it is about the local name, and the app hides names below 0.85. In testing, a looser prompt gave an Ixora the Marathi name "Rangan" for a Kannada request; the strict prompt returns "not sure" instead. Wild plants and mushrooms are never called safe to eat.
- **Privacy.** Only the photo, the region name (for example "Karnataka, India") and the month are sent. GPS stays on the phone, used only to draw your route and pin finds on the map.

## Run it yourself

```bash
git clone https://github.com/Ankith-m1006/wayside.git
cd wayside
cp .env.example .env      # add a Gemini API key (free in Google AI Studio)
npm start                 # http://localhost:4300
```

Fully local, with no internet: install [Ollama](https://ollama.com), run `ollama pull gemma3:4b`, then set `GEMMA_BACKEND=ollama` in `.env`.

Deploy (Google Cloud Run):

```bash
gcloud run deploy wayside --source . --region asia-south1 --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

## Files

```
src/server.mjs     HTTP server, prompts, /api/identify and /api/quest
src/gemma.mjs      Gemma backends (Google AI Studio or Ollama), JSON parsing, retries
public/index.html  the whole app (walk, journal, map), no build step
public/sw.js       offline app shell and tile cache
```

## Limitations

- Identification from one photo can be wrong, and the app says how sure it is. Never eat anything wild because an app named it.
- Gemma 4 through the API takes about 20–30 seconds per photo; the app is designed so you keep walking meanwhile.
- Map tiles need a connection the first time an area is viewed.

## License

[MIT](LICENSE)
