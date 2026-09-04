# Problem Statement — SlopeWatch

**Track:** B — AI for the Hills
**Problem statement:** B1, "Offline Landslide Reporter & Last-Mile Alert Relay" (report-up half)
**Event:** Code for Communities, GDG Siliguri

## The gap

On 4–5 October 2025, the Geological Survey of India issued an orange-level
landslide warning and the India Meteorological Department issued a red
alert for extremely heavy rainfall across sub-Himalayan West Bengal,
including Darjeeling and Kalimpong. The warning cited saturated soil
conditions and the risk of further landslides. Despite this, over 300mm of
rain fell in 12 hours and triggered landslides across the Darjeeling hills
and the Dooars region, killing dozens and destroying infrastructure
including the Dudhia bridge and the Teesta Bazaar link road. Fatalities
were reported from Sarsaly, Jasbirgaon, Mirik Basti, Dhar Gaon (Mechi),
Nagrakata, and the Mirik Lake area.

The warning existed. It did not reach most of the people it needed to
reach, in time, in a place with patchy-to-nonexistent mobile signal.

This is not a one-off. The Darjeeling hills have a long, repeating history
of disaster years — 1899, 1934, 1950, 1968, 1975, 1980, 1991, 2011, 2015 —
with a pattern of specifically post-monsoon, October-timed failures in
1968, 2015, and 2025, suggesting a structural shift toward high-intensity
late-season rainfall events rather than a single unlucky year.

## Who is affected

- **Walkers, commuters, and local residents** who move through slopes
  daily and are often the first to see early warning signs — a new crack,
  a damp patch, a leaning tree — long before any official survey reaches
  that spot.
- **People living below or near vulnerable slopes**, who need actionable,
  local, plain-language risk information, not a district-level bulletin.
- **Local governance (Panchayat/ward level)**, which currently has no
  structured, low-friction way to receive slope observations from
  residents before they become emergencies.

## Why existing approaches fall short

- **Official warnings (GSI/IMD)** are accurate but broadcast at a
  district/regional level, distributed through channels (TV, official
  websites, SMS where signal exists) that do not reliably reach hill
  villages with no mobile signal, and do not carry hyper-local,
  spot-specific information.
- **Word of mouth** works but is slow, inconsistent, and not documented —
  there's no growing record of which slopes are showing early warning
  signs over a season.
- **A normal "report a hazard" app** would be useless here because it
  assumes connectivity to submit; in the exact terrain and weather
  conditions where landslides happen, signal is the first thing lost.

## What "solved" looks like

A resident or walker who spots a warning sign — a fresh crack, seepage,
a bulging retaining wall, fresh debris — can:
1. Photograph and log it in seconds, entirely offline.
2. Get an immediate, plain-language explanation of what it might mean and
   what to do, in their own language (Nepali, Hindi, Bengali, or English),
   generated on-device with no signal required.
3. Trust that the report is saved locally and will sync automatically the
   moment the phone finds a connection — at the next village, the next
   ridge, or the next hotspot — without the user having to do anything.

This does not replace GSI/IMD's official warning systems. It closes the
"last mile" on the *reporting* side: turning informal, on-the-ground
observation into a structured, timestamped, geotagged, severity-classified
record — offline-first, because that is the only way it will actually get
used in the conditions where it matters.

## Explicitly out of scope for this build

- The "relay down" half of the original B1 brief (rebroadcasting an
  *official* alert peer-to-peer via WebRTC to phones with no signal) —
  cut to keep a solo build reliable; see `05-phases.md` for rationale.
- Replacing or interfacing directly with GSI/IMD's own alert
  infrastructure — this is a community reporting tool, not an official
  early-warning system.
