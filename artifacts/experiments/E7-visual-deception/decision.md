# E7 — verdict

**Date:** 2026-09-13 · **Workstation:** W2 · **Pre-registered:** `7948136`

**Verdict:**
- **Vision stays non-gating: CONFIRMED.**
- **The pre-registered GO condition is NOT met.** It required every deception except D5c caught
  deterministically with zero legitimate refusals. D4b is caught by nothing, and L3 is refused by the
  existing hit-test gate.
- **The NO-GO condition is not met either.** No case is caught *only* by the detector.

| Question | Answer |
|---|---|
| Does the existing pipeline stop visual deception? | **No: 6 / 10 would dispatch** (D1, D4b, D5a, D5b, D6, D7) |
| Do candidate deterministic checks close the gap? | **5 of those 6**, every run, with 0 false refusals of their own on 6 legitimate controls |
| What survives everything deterministic? | **D4b**: a control under a pass-through cover that shows another label |
| Does the detector catch anything the checks miss? | **No.** On D4b it sees the cover's box |
| Is the detector usable as a gate on this fixture? | **No.** Ordinary buttons seen 0/30 at 1024×768 and 0/30 at 1280×800 |
| Does the existing gate refuse legitimate controls? | **Yes: every icon-only button** (15/15), by exact-element hit matching |

## Owner decisions this creates

| # | Decision | Options |
|---|---|---|
| **D-E7-1** | Which deterministic visibility and identity checks become the mandatory visibility input to permit mint (ADR-0008 §6) | Core set measured here, with thresholds to approve (`opacity` / `filter` products; tested values were exactly 0) |
| **D-E7-2** | Hit-test identity: exact element, or validated element **or a descendant** | Exact: refuses every icon-only button. Descendant: allows them, and loses the accidental D5c catch |
| **D-E7-3** | Icon-only controls with an aria-label and a graphic child | Refuse (`LABEL_UNVERIFIABLE`, conservative) or allow, accepting canvas-label deception as a residual |
| **D-E7-4** | D4b pass-through-cover residual | Accept and state it, or require OCR (not in V1) |

## Not done

No check was added to production, no threshold approved, no detector change, no NMS or threshold
change. Nothing was clicked.
