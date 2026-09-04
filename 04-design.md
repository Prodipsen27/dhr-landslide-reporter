# Design — SlopeWatch

## 1. Design principles
1. **Legible over pretty.** Every visual decision is tested against "can
   this be read on a cracked, cheap-phone screen in direct sunlight?"
   before it's tested against "does this look nice."
2. **The happy path is the offline path.** No "you're offline" banner or
   degraded state — offline is not an edge case here, it's the default
   assumption baked into the UI.
3. **Never a dead end.** Every action (camera denied, geolocation denied,
   model unavailable) has a visible, non-blocking fallback so the user
   can always still finish logging a report.
4. **Minimum literacy load.** Short sentences, icons + text together
   (🏔️, 📍), severity described in concrete physical terms ("small
   crack," "big crack across road") rather than abstract risk language.

## 2. User flow

```
Open app (installed PWA icon or browser)
        │
        ▼
Camera view opens automatically ──(denied/unavailable)──▶ show inline
        │                                                  error, allow
        ▼                                                  photo-less report
Select severity (plain-language options, no jargon)
        │
        ▼
Optional: add notes, pick explanation language
        │
        ▼
Tap "Log this observation"
        │
        ▼
Photo captured (if available) → severity confirmed →
on-device explanation generated (or fallback template if
model unavailable) → geolocation attached (if available)
        │
        ▼
Report saved locally, appears at top of "Your reports" list
with a "queued" badge
        │
        ▼
(later, automatically) connection detected → badge flips to
"synced" → no user action required
```

## 3. Screen: main / report form

**Layout (single scrollable screen, mobile-first, max-width 480px
centered on larger screens):**
- Header: app name + one-line purpose statement (sets expectations
  immediately — "works with no signal").
- Live camera preview (large, top of content — the primary input).
- Inline camera-error text if permission denied (never blocks the form
  below it).
- Form:
  - Severity `<select>` — three options, each described in plain
    physical terms rather than a bare "Low/Medium/High" label, so the
    choice doesn't require any prior training.
  - Notes `<textarea>` — optional, placeholder text uses a real local
    place name to model the kind of specificity that's useful.
  - Language `<select>` — native scripts shown alongside the English
    name (e.g. "नेपाली (Nepali)") so users can find their language by
    sight, not by reading English.
  - Submit button — full-width, high-contrast, single clear verb +
    icon ("📍 Log this observation").
- Status line — shows progress ("Thinking through this offline…") then
  result ("Saved locally. Will sync automatically when online.").
- Report list — newest first, color-coded left border by severity,
  sync badge, explanation text, timestamp + coordinates if available.

## 4. Visual system

| Token | Value | Rationale |
|-------|-------|-----------|
| Background | `#0f1b12` (near-black green) | Dark background reduces glare/battery use; evokes hill forest without literal imagery |
| Card | `#16261a` | Slightly lifted from background for hierarchy without a hard border |
| Text | `#f2f5ee` | High contrast against dark background |
| Muted text | `#a9bba6` | Secondary info (timestamps, status) recedes without disappearing |
| Low severity | `#5a9c5a` (green) | |
| Medium severity | `#d9a441` (amber) | |
| High severity | `#d9534f` (red) | Standard traffic-light mapping — no learning curve |
| Accent / CTA | `#c97b3a` (burnt orange) | Draws the eye to the one primary action per screen |
| Base font size | 18px | Larger than typical web default; deliberate choice for outdoor/low-end-screen legibility over information density |

Severity is communicated **redundantly** — color *and* the word itself
*and* a plain description — so the app doesn't rely on color perception
alone (colorblind-safe by construction, not just by luck).

## 5. Content & language design
- English copy is written at a plain, conversational reading level —
  short sentences, concrete nouns, no bureaucratic phrasing ("bulging
  wall" not "structural deformation indicators").
- Non-English explanation text is model-generated per report (not
  pre-translated static copy), which is why native-speaker review of
  *actual generated samples* — not just the English source — is a
  required step before this ships or is demoed (tracked in
  `05-phases.md`).
- The fallback template explicitly says "(showing a plain-language
  template instead)" — the design choice is to be visibly honest about
  when AI generation didn't happen, rather than paper over it.

## 6. Accessibility & device constraints
- Large tap targets (form fields and button use generous padding, not
  browser-default sizing) — designed for use with a thumb, one-handed,
  possibly while standing on an uneven slope.
- No reliance on hover states (nothing works via hover; this is a
  touch-first design).
- No animation/motion — nothing to cause jank on a low-end GPU, nothing
  to distract from a genuinely time-pressured use case.
- Works with camera or geolocation permission denied — both are
  optional inputs, never blockers.

## 7. What's deliberately not designed yet
- Panchayat/authority-facing dashboard/rollup view (Phase 4 — see
  `05-phases.md`).
- Any multi-report/map visualization of a user's own or community
  reports (v1 is a flat chronological list only).
- Onboarding/tutorial flow — v1 is designed to be self-explanatory in a
  single screen; if user testing shows otherwise, this becomes a Phase 4
  candidate.
