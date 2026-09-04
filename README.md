# SlopeWatch — offline landslide observation reporter

Problem statement B1 (report-up half): "Code for Communities", GDG Siliguri.

On 4–5 October 2025, the Geological Survey of India issued an orange-level
landslide warning and the IMD issued a red alert for the Darjeeling hills —
but over 300mm of rain in 12 hours still triggered landslides that killed
dozens, in part because warnings and on-the-ground observations don't reach
each other fast enough in low-signal terrain. SlopeWatch lets anyone walking
a slope log what they see, get a plain-language risk explanation on-device,
and queue the report to sync the moment a connection appears.

## On-device model(s) used
- **Chrome Prompt API (`LanguageModel`)**, running Gemini Nano locally, for
  turning a severity level + notes into a short, plain-language explanation
  in the observer's chosen language. No network call after the one-time
  ~4GB model download; nothing is sent to a server.
- **Image classification: not yet trained.** The severity level is currently
  chosen manually by the observer. `app.js` has a `classifySeverity()` hook
  ready for a small MediaPipe Image Classifier fine-tuned on slope-hazard
  photos (crack / seepage / bulging wall / debris) — see the TODO comment
  in that function for the exact integration code.

## Minimum device tested
- Desktop Chrome (Stable, 2026), simulated offline via DevTools + real
  airplane mode.
- *(Fill in before submission: lowest-end Android phone actually tested,
  Chrome version, and whether Gemini Nano downloaded successfully on it.)*

## What happens when the model is unavailable
`explainWithLLM()` checks `LanguageModel.availability()` before use. If the
Prompt API doesn't exist on the browser, the model isn't downloaded, or the
call throws an error, the app falls back to a pre-written plain-language
template per severity level (see `SEVERITY_TEMPLATES` in `app.js`) so the
report is never blocked on the model being present. The fallback text says
plainly that it's a template, not a hallucinated claim of AI analysis.

## Offline behavior
- `sw.js` cache-first-serves the app shell (HTML/JS/manifest/icons), so the
  PWA loads and fully functions with zero network after the first visit.
- Reports are written to IndexedDB immediately on submit — nothing waits
  on a network call to save.
- Sync is attempted on the `online` event and on app open (Background Sync
  API is used where available, e.g. Android Chrome; iOS Safari has no
  Background Sync API, so the `online`-event + on-open fallback covers it).
- The current build simulates the sync target (marks reports as synced
  locally) since no backend/relay endpoint exists yet — this is flagged
  in `trySync()` as a TODO for a real deployment.

## Not yet built (honest scope)
- The "relay down" half of B1 (rebroadcasting an official alert
  peer-to-peer via WebRTC) — cut for the hackathon to keep the demo
  reliable; report-up is a complete, usable loop on its own.
- A trained hazard-image classifier — currently manual severity selection.
- Native-speaker review of the Nepali/Hindi/Bengali explanations — the
  Prompt API output should be checked by a native speaker before demoing.
- A real backend for cross-device sync.

## Local build & run
No build step — plain HTML/JS. Serve the folder over HTTPS or localhost
(PWAs require a secure context):

```
npx serve .
```

Then open the served URL in Chrome, allow camera access, and test:
1. Load once online.
2. Turn on airplane mode.
3. Reload — the app should still load and let you submit a report.
