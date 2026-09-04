# TRD — SlopeWatch

## 1. Architecture overview

Client-only PWA. No backend in v1. All logic runs in the browser; all
data is stored in the browser (IndexedDB). No servers, no API keys, no
external calls after the initial page load and one-time model download.

```
┌─────────────────────────────────────────────┐
│                index.html (shell)             │
│  ┌───────────────┐  ┌────────────────────┐  │
│  │  camera view   │  │   report form       │  │
│  └───────────────┘  └────────────────────┘  │
│                                                │
│                   app.js                      │
│  ┌────────────┐ ┌───────────┐ ┌────────────┐ │
│  │ IndexedDB  │ │ severity  │ │ Prompt API  │ │
│  │  queue     │ │ classify  │ │ (LanguageModel)│
│  └────────────┘ └───────────┘ └────────────┘ │
└─────────────────────────────────────────────┘
              │
              ▼
         sw.js (service worker)
     cache-first for app shell + assets
```

## 2. Stack & rationale

| Layer | Choice | Why |
|-------|--------|-----|
| UI | Plain HTML/CSS/JS, no framework | Zero build step = nothing to break on demo day; smallest possible bundle for craft/load-time scoring |
| Offline shell | Service Worker, `CACHE_NAME` cache-first strategy | Cache-first means airplane mode is the *normal* code path, not a fallback branch — more reliable under live demo conditions than network-first |
| Local storage | IndexedDB (`slopewatch` DB, `reports` object store) | Structured data (photo blob/data-URL, geolocation, severity, text) exceeds what `localStorage` handles well; also artifacts-storage APIs are unavailable outside the Claude artifact runtime, so this is a real standalone browser app choice |
| On-device LLM | Chrome Prompt API (`LanguageModel`, Gemini Nano) | Browser-built-in, no model file to host/serve, few lines of integration; explicit `availability()` check drives graceful fallback |
| Image classification | Not implemented in v1 (manual selection) | No labeled training data yet; hook (`classifySeverity()`) is in place for a MediaPipe Image Classifier once a small hazard-photo dataset exists |
| Camera | `getUserMedia` (`facingMode: environment`) | Standard, no dependency |
| Geolocation | `navigator.geolocation.getCurrentPosition` | Standard, best-effort with 5s timeout, non-blocking on denial/failure |
| Install | Web App Manifest (`manifest.json`) | Enables "Add to Home Screen" / installable PWA behavior |

## 3. On-device AI integration detail

### 3.1 Explanation generation (implemented)
`explainWithLLM(severity, notes, lang)` in `app.js`:
1. Checks `'LanguageModel' in self` — if false, returns fallback template.
2. Calls `LanguageModel.availability()` — if `'unavailable'`, returns
   fallback template.
3. Creates a session via `LanguageModel.create()` and prompts with a
   severity + notes + target-language instruction.
4. Wraps the whole call in try/catch — any runtime error also falls back
   to the template, never a broken UI state.

Fallback templates (`SEVERITY_TEMPLATES`) exist for all three severities
in English; the UI's language selector currently only reliably affects
LLM-generated output, not the fallback template — **known gap**, see
§7.

### 3.2 Severity classification (not yet implemented)
Planned integration, once a labeled photo set exists:
```js
import { ImageClassifier, FilesetResolver } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";
const vision = await FilesetResolver.forVisionTasks(".../wasm");
const classifier = await ImageClassifier.createFromOptions(vision, {
  baseOptions: { modelAssetPath: "./models/slope-hazard.tflite" }
});
const result = classifier.classify(imageElement);
```
Model: a small, fine-tuned image classifier (4 classes — crack, seepage,
bulging wall, debris) trained on a locally-sourced photo set (target:
15–20+ images/class minimum for a v1 model).

The classifier's output should *suggest* a severity, with the observer
able to confirm or override — not silently auto-submit, since this is a
safety-relevant judgment.

## 4. Data model

`reports` object store (IndexedDB), keyPath `id` (autoincrement):

| Field | Type | Notes |
|-------|------|-------|
| id | number | autoincrement PK |
| severity | 'low' \| 'medium' \| 'high' | |
| notes | string | free text, optional |
| lang | 'en' \| 'ne' \| 'hi' \| 'bn' | |
| photo | string (data URL) or null | JPEG, quality 0.7, captured from video frame |
| location | `{lat, lng}` or null | best-effort |
| explanation | string | LLM output or fallback template |
| synced | 0 \| 1 | |
| createdAt | number (epoch ms) | |

## 5. Sync (v1: simulated)

`trySync()` currently marks all pending reports as synced locally with no
real network call — there is no backend in v1. This is a deliberate,
documented placeholder to demonstrate the queue-and-sync *pattern*
without introducing operational risk (a live backend that could go down
during judging). A real integration point is marked with a `TODO` in
`app.js`.

Sync triggers:
- `window.addEventListener('online', ...)`
- App open / page load
- `sync` event via Background Sync API (Android Chrome only)

**Known platform gap:** Background Sync API does not exist on iOS Safari.
The `online` event + on-open triggers are the fallback for that platform
and are the primary mechanism to test there.

## 6. Offline caching strategy

`sw.js`:
- `install`: pre-caches `CORE_ASSETS` (shell files, manifest, icons).
- `fetch`: cache-first for all GET requests; opportunistically caches any
  same-origin response not already cached (covers future model files);
  falls back to whatever's cached (or fails silently) if both cache miss
  and network fail.
- `activate`: purges old cache versions on `CACHE_NAME` bump.

## 7. Known gaps / risks (tracked, not hidden)
- Fallback template text is English-only regardless of selected
  language — needs either translated fallback strings or a clearer UI
  note when falling back.
- No automated test suite — verification is manual per `04-design.md` /
  test plan discussed in chat.
- Prompt API language adherence is not 100% guaranteed by the model;
  needs empirical testing across all four languages before relying on it
  in a demo.
- No conflict resolution for sync (moot while sync is simulated locally;
  becomes relevant once a real backend exists).
