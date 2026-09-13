# E7 — visual deception: does the existing pipeline catch it, and does vision add anything?

> **Headline:** the hit-test gate on `main` would dispatch **6 of 10** synthetic visual deceptions,
> including the classic opacity-0 clickjack. A small set of deterministic in-page checks closes five
> of those six in every run. The one that survives every deterministic check — a real control under
> a pass-through cover — is **not** caught by the detector either. The detector adds nothing as a
> safety signal here, and fails to see ordinary buttons at two of three viewports.
>
> The gate also **refuses every icon-only button** (15/15), because the hit test compares the exact
> element under the point and the point lands on the `<svg>` inside the button.

- **Date:** 2026-09-13 · **Workstation:** W2 (`LAPTOP-SRCINK2B`) · **Cell:** Windows host, Chrome for
  Testing 153.0.8010.12 headless via Playwright (`CHROME_PATH`), 127.0.0.1
- **Pre-registration:** cases, expected verdicts and fixture committed at `7948136`, before the
  harness existed; unchanged when run
- **Log:** [`logs/e7.json`](logs/e7.json) · **Verdict:** [`decision.md`](decision.md)

## Hypothesis

Deterministic browser checks already cover the visual-deception cases where the detector might look
useful as a safety signal, so vision need not become a safety authority.

## Environment

| Table | What | Role |
|---|---|---|
| **A. Existing pipeline** | `main` @ `eb4604b`: `validateActionFreshness` → `confirmationTierOf` → `establishHitAgreement`, with a raw `document.elementFromPoint` bridge whose role and name templates are copied **verbatim** from the MVP-2 harness (workstation 1). **Nothing is clicked**; only the gate's verdict is recorded | Security |
| **B. Candidate deterministic checks** | In-page, for `#target`:<br>• `checkVisibility({opacityProperty, visibilityProperty, contentVisibilityAuto})`<br>• opacity product over ancestors < 0.1 *(PROPOSED)*<br>• `filter: opacity()` product < 0.1 *(PROPOSED)*<br>• 5-point hit sampling, where a descendant counts as the target<br>• aria-label vs `textContent`<br>• `::before`/`::after` text not in the name<br>• `LABEL_UNVERIFIABLE`: aria-label only, no text, a canvas/img/svg child. Kept apart from the "core" set, because it is expected to refuse icon buttons | Security, **experimental** |
| **C. Detector** | T1 artifact `ba6d9e93…`, **unadopted, unchanged**, frozen operating point 0.55. "Sees" means a detection overlaps `#target`'s DOM box at IoU ≥ 0.5 (the frozen fusion rule) | **Diagnostic only**; never contributes to a verdict |

- **Design:** 16 cases × 3 viewports (1024×768, 1280×800, 1366×768) × 5 runs = **240 page loads**.
- **Legitimate (6):** plain button · icon + text · icon-only with aria-label · `::before` arrow · textbox · soft effects (opacity 0.99, drop-shadow).
- **Deceptions (10):** listed below.

## Expected result

Every deception refused; no legitimate control refused.

## Actual result

Counts are refusals out of 15 page loads per case.

| Case | Expected | **A. Existing pipeline** | **B. Core checks** that fired | A + core | **C. Detector sees target** |
|---|---|---|---|---|---|
| L1 plain button | ALLOW | 0 · MATCH | none | 0 | 5 / 15 |
| L2 icon + text | ALLOW | 0 · MATCH | none | 0 | 5 / 15 |
| **L3 icon-only, aria-label** | ALLOW | **15 · MISMATCH `DIFFERENT_ELEMENT`** (point lands on the `<svg>`) | none (`LABEL_UNVERIFIABLE` 15, non-core) | **15** | 5 / 15 |
| L4 `::before` arrow | ALLOW | 0 · MATCH | none | 0 | 5 / 15 |
| L5 textbox | ALLOW | 0 · MATCH | none | 0 | **0 / 15** |
| L6 soft effects | ALLOW | 0 · MATCH | none | 0 | 5 / 15 |
| **D1 opacity 0 over decoy** | REFUSE | **0 · MATCH** | `CHECKVISIBILITY_FALSE`, `OPACITY_PRODUCT_LOW` (15) | 15 | 5 / 15 (sees the decoy's box) |
| D2 clip-path | REFUSE | 15 · MISMATCH | `HIT_POINT_NOT_TARGET` (15) | 15 | 0 / 15 |
| D3 off canvas | REFUSE | 15 · VALIDATE `NOT_VISIBLE` | `HIT_POINT_NOT_TARGET` (15) | 15 | 0 / 15 |
| D4a plan targets a pass-through decoy | REFUSE | 15 · MISMATCH | `HIT_POINT_NOT_TARGET` (15) | 15 | 5 / 15 |
| **D4b plan targets a control under a pass-through cover** | REFUSE | **0 · MATCH** | **none** | **0** | 5 / 15 (sees the cover) |
| **D5a aria-label ≠ visible text** | REFUSE | **0 · MATCH** | `NAME_TEXT_MISMATCH` (15) | 15 | 5 / 15 |
| **D5b visible text only in `::after`** | REFUSE | **0 · MATCH** | `PSEUDO_TEXT_NOT_IN_NAME` (15) | 15 | 5 / 15 |
| D5c visible text only in a canvas | REFUSE | 15 · MISMATCH (point lands on the `<canvas>`) | none (`LABEL_UNVERIFIABLE` 15, non-core) | 15 | 5 / 15 |
| **D6 ancestor opacity 0** | REFUSE | **0 · MATCH** | `CHECKVISIBILITY_FALSE`, `OPACITY_PRODUCT_LOW` (15) | 15 | 0 / 15 |
| **D7 `filter: opacity(0)`** | REFUSE | **0 · MATCH** | `FILTER_OPACITY_LOW` (15) | 15 | 0 / 15 |

- Every verdict was identical across all 15 page loads of its case; no flakiness.
- `checkVisibility` was available in all 240 loads.
- Measured opacity products for D1 and D6, and the filter product for D7, were exactly **0**, so any positive threshold separates them. The value 0.1 is untested against near-zero attacks.
- **Detector by viewport, legitimate controls:**
  - **0/30 seen at 1024×768 and at 1280×800**
  - 25/30 at 1366×768
  - at 1024×768 on L1, it produced 21 detections with best IoU **0.417** against the button, so it is detecting something there, just not at the 0.5 fusion bar.

## Conclusion

1. **The gate on `main` is not a visual-deception defence.** VALIDATE plus hit-test agreement proves
   the *element* under the point is the validated one. It does not prove the element is *perceivable
   as itself*: 6 of 10 deceptions pass.
2. **Deterministic checks close most of that gap**, with no false refusal of their own on the six
   legitimate controls: `checkVisibility`/opacity product, filter opacity, multi-point hit sampling,
   name-vs-text and pseudo-element text. This is the concrete answer to ADR-0008 §6 (*"computed-style
   visibility at mint waits for E7"*). It is an owner-approved ADR decision, not something applied here.
3. **The hit-test comparison has a defect of its own:** exact-element matching refuses every icon-only
   button. Accepting a **descendant** of the validated element (as check B's sampling does) would fix L3,
   and would then **stop catching D5c** by accident. Deterministically, "aria-label + graphic child + no
   text" describes both a legitimate icon button and a canvas-label deception. That is a real trade-off
   for the owner: refuse icon-only buttons, or accept canvas-label deception as a residual.
4. **One residual survives every deterministic check: D4b.** A real control visually covered by a
   `pointer-events: none` element that looks like a different button. Hit testing ignores the cover by
   design. Only something that reads the rendered label (OCR) could see it; the detector cannot, because
   it sees a button-shaped box either way.
5. **Vision stays non-gating.** On every case the detector could have flagged by *not* seeing the
   target (D2, D3, D6, D7), deterministic checks already refuse. On the residual (D4b) it sees a box and
   is silent. And it fails to see ordinary buttons at 1024×768 and 1280×800 on this fixture, so as a
   gate it would refuse legitimate controls wholesale.

**Not claimed:**
- Anything about real sites; this is a synthetic local fixture.
- Anything about the detector beyond this fixture and these three viewports.
- Anything about W1 or any browser other than Chrome for Testing 153 on W2.

## Reproducibility

```bash
npm run typecheck      # the harness measures main's API; it refuses to run against the permit branch
CHROME_PATH="<chrome for testing>" E7_TMP="<scratch dir>" \
  node artifacts/experiments/E7-visual-deception/harness/run-e7.mjs
```

Screenshots and RGBA buffers are written to `E7_TMP`, never to the repository. The harness verifies
the detector artifact's SHA-256 and `PROVISIONAL_THRESHOLDS` before it runs.
