# PRD — SlopeWatch

## 1. Product summary
SlopeWatch is an offline-first Progressive Web App that lets anyone in the
Darjeeling hills log a slope hazard observation — with a photo, severity,
location, and notes — entirely without a network connection, receive an
on-device, plain-language explanation of the risk in their own language,
and have the report automatically sync once connectivity returns.

## 2. Goals
- **G1.** A resident can complete a full report (photo → severity →
  explanation → save) in under 60 seconds, in airplane mode, with zero
  errors or hangs.
- **G2.** The explanation text is understandable and locally natural in
  at least Nepali, Hindi, Bengali, and English.
- **G3.** No report is ever lost due to lack of connectivity — everything
  is written to local storage before any network activity is attempted.
- **G4.** The app installs and runs usably on a low-end Android phone with
  a small/no data plan.

## 3. Non-goals
- Replacing GSI/IMD's official warning systems.
- Guaranteeing reports reach a real emergency-response authority (this
  version simulates the sync target — see TRD §5).
- Peer-to-peer relay of official alerts (deliberately deferred, see
  `05-phases.md`).
- Automated slope-hazard image classification in v1 (deferred — severity
  is manually selected by the observer in this version; see TRD §3).

## 4. Target users & primary user story

**Primary user:** A hill resident, farmer, or walker with a basic
Android smartphone and an inconsistent data connection.

> As a resident walking near a slope, when I notice a crack, seepage, a
> leaning tree, or a bulging wall, I want to log it with a photo and get
> a clear explanation of what to do, even with no signal, so that the
> observation isn't lost or forgotten before I can report it.

**Secondary user:** Local governance / Panchayat staff who would
eventually consume a rollup of these reports (not built in v1 — see
Phase 4 in `05-phases.md`).

## 5. Functional requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| F1 | User can open the camera and capture a photo of the hazard | Must |
| F2 | User can select a severity level (low / medium / high) with plain descriptions of each | Must |
| F3 | User can add free-text notes | Should |
| F4 | User can choose an explanation language (EN/NE/HI/BN) | Must |
| F5 | On submit, the app generates a 2-sentence plain-language explanation of the risk and recommended action, on-device | Must |
| F6 | If the on-device model is unavailable, the app shows a pre-written fallback explanation instead of failing | Must |
| F7 | The report (photo, severity, notes, language, explanation, location, timestamp) is saved locally immediately on submit | Must |
| F8 | The app attempts geolocation and attaches it if available/granted | Should |
| F9 | A list of the user's own past reports is viewable in-app, newest first | Must |
| F10 | Reports show a "queued" / "synced" status | Must |
| F11 | Reports automatically attempt to sync when a connection becomes available, without user action | Must |
| F12 | The full app (shell, assets, form) loads and is usable with zero network connection, after one prior online load | Must |

## 6. Non-functional requirements

| ID | Requirement |
|----|-------------|
| N1 | First load ≤ a few seconds on a throttled "Slow 3G" connection |
| N2 | Repeat load (cached) is near-instant, no network dependency |
| N3 | Legible at default zoom on a small (~5") screen in bright/sunlit conditions |
| N4 | No user data leaves the device at any point in v1 (no backend calls) |
| N5 | Works on Chrome for Android at minimum; degrades gracefully (fallback explanation) on browsers without the Prompt API |
| N6 | All user-facing text in EN is professionally clear; NE/HI/BN text is reviewed by a native speaker before demo/launch |

## 7. Success metrics (for the hackathon submission)
- Airplane-mode demo completes end-to-end with zero errors, on camera.
- All 4 languages produce natural, native-speaker-approved explanations.
- App loads in under [X] seconds on the lowest-end test device (target:
  ≤5s on throttled 3G, then instant on repeat/cached load).
- Judges' scoring rubric: Works offline (25%), Usefulness to the hills
  (25%), On-device AI done well (20%), Craft (15%), Belonging (15%).

## 8. Open product questions
- Should severity selection eventually be assisted (not replaced) by an
  on-device classifier, with the user able to override it? (Leaning yes —
  keeps a human in the loop for a safety-relevant judgment.)
- Should there be any local-only leaderboard/streak mechanic to encourage
  repeat use by regular walkers of the same route? (Not in v1 — flagged
  as a possible Phase 5 idea, not committed.)
