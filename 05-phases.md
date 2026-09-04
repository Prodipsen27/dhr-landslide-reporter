# Phases — SlopeWatch

Solo build. Pre-hackathon prep absorbs the highest-risk/longest-lead-time
work; hackathon time is reserved for integration, polish, and the
local-specific details that can't be prepped generically in advance.

## Phase 0 — Pre-hackathon prep (do before the event starts)

**Goal:** eliminate every risk that doesn't require being physically at
the event, so event time is spent assembling and polishing, not
debugging fundamentals.

| Task | Status |
|------|--------|
| Lock stack decision (plain JS PWA, IndexedDB, Chrome Prompt API) | ✅ Done |
| Build offline app shell (service worker, manifest, cache-first) | ✅ Done |
| Build report form + camera capture + IndexedDB queue | ✅ Done |
| Wire Prompt API with availability-check + fallback template | ✅ Done |
| Test real airplane-mode load + submit on an actual phone | ⬜ Not started |
| Confirm Prompt API/Gemini Nano actually works on demo device | ⬜ Not started |
| Source 15–20+ real hazard photos per class (crack, seepage, bulging wall, debris) | ⬜ Not started |
| Train/fine-tune a small MediaPipe image classifier on that set | ⬜ Not started |
| Wire classifier into `classifySeverity()` | ⬜ Not started |
| Get NE/HI/BN sample explanations reviewed by native speakers | ⬜ Not started |
| Seed 2–3 more real local place-name references into placeholder/demo content | ⬜ Not started |
| Write first draft of README's "min device tested" section | ⬜ Partial (template in place, needs real numbers) |

**Exit criteria for Phase 0:** app installs and fully functions in real
airplane mode on a real phone, in all four languages, with either a
working classifier or a consciously-accepted manual-severity v1.

## Phase 1 — Event kickoff: assemble, don't rebuild

**Goal:** get the pre-tested pieces integrated into the final submission
repo and confirm nothing broke in transit.

- Re-run the full offline test immediately on-site (different network
  environment than prep = worth re-verifying).
- Confirm camera/geolocation permissions behave correctly on whatever
  device you're demoing from at the venue.
- If the classifier wasn't finished in Phase 0, make the deliberate call
  now: ship manual severity for v1, or spend limited event time finishing
  it. Default recommendation: ship manual severity, keep the classifier
  as a documented "not yet trained" gap — a working, honest v1 beats a
  half-integrated classifier that might fail live.

## Phase 2 — Polish

**Goal:** move the score on Craft (15%) and Belonging (15%) — the two
criteria most likely to separate similar submissions.

- Sunlight/low-end-screen legibility check (real outdoor test, not just
  simulated).
- Throttled-connection load-time check; trim anything slow.
- Insert native-speaker-approved language review corrections if any
  issues were found in Phase 0.
- Fix the known fallback-template-is-English-only gap (translate the
  three fallback templates, or make the "template mode" notice clearer)
  if time allows — documented as a known gap either way.
- Tap-target and one-handed-use pass on the actual demo device.

## Phase 3 — Optional scope expansion (only if Phase 0–2 finished early)

Only attempt if there's genuine slack time left, in this priority order:

1. **C4-style hazard-sign reading** folded in as a second screen — reuses
   the existing camera + on-device-AI pipeline, adds breadth without new
   architectural risk.
2. **Real (minimal) sync backend** — replacing the simulated sync in
   `trySync()` with an actual lightweight endpoint, if a safe/simple
   option exists (e.g. a serverless function) without adding demo-day
   fragility.
3. The "relay down" half of B1 (WebRTC peer-to-peer alert rebroadcast) —
   lowest priority; only attempt if everything else is rock-solid, since
   this is historically the most demo-fragile piece (live peer discovery
   on stage).

**Do not** start Phase 3 items if Phase 0–2 aren't fully solid — a
narrower, fully-working submission outscores a broader, shakier one on
this rubric.

## Phase 4 — Submission

- Record the 2-minute video: open with airplane mode visibly toggled on
  camera, then one smooth, unnarrated-technical, real end-to-end flow
  (capture → severity → explanation → save → later, sync).
- Finalize README: fill in real "minimum device tested" details, confirm
  the "what happens when the model is unavailable" section still matches
  actual current behavior.
- Submit with real time to spare — no code changes in the final stretch
  before the deadline.

## Phase 5 — Beyond the hackathon (not part of this submission)

Ideas explicitly deferred, listed so they're not forgotten but also not
mistaken for committed scope:
- Panchayat/authority-facing rollup dashboard of community reports.
- Map view of a user's or community's reports over a season.
- The relay/rebroadcast half of B1, built properly with a real signaling
  fallback (QR/manual SDP) rather than attempted live under time
  pressure.
- A real backend with proper multi-device sync and conflict resolution.
