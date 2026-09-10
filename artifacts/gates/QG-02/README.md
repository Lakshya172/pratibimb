# QG-02 — coordinate contract

> **Status: criteria 1–6 PASS on Chromium AND Firefox. Criterion 7 CONDITIONAL.**
> The Firefox cell is produced in CI; it is not runnable on the Windows workstation.
> Owner: `browser-engineer`. Due: **before the executor is written** — which it is, since no
> executor exists.

The gate is `agentos/gates/README.md#qg-02`. A gate is binary: all items or `FAIL`. Its
seven criteria are reproduced below verbatim, each with how it was established.

## Criteria

| # | Criterion (verbatim) | Result | Established by |
|---|---|---|---|
| 1 | CSS viewport pixels is the only space in any manifest or action plan | **PASS** | `SanitizedElement.bbox` is the only serialized geometry and is produced by `toBboxArray(CssBox)`, which accepts the canonical brand only. Passing a device- or capture-space box is a compile error. |
| 2 | Conversion happens at the edge of every component, and each conversion is unit tested | **PASS** | All four spaces convert only in `coordinates.ts`. 38 unit tests over conversion, round trips, fractional values and refusal paths. |
| 3 | The CI fixture renders at **DPR 1.0, 1.5, 2.0** and **100%, 125% zoom** | **PASS** (Chromium + Firefox) | Six configurations, measured. `devicePixelRatio` observed 1.0 → 2.5, frame 1024×640 → 2560×1600. |
| 4 | The same logical element resolves to the **same CSS-pixel box in all six** | **PASS** (Chromium + Firefox) | `#phone` = `[400, 260, 300, 32]` in all six. Also `#cancel`, `#help-link`, `#phone-label`. |
| 5 | `capture` records `dpr`, `zoom`, `scale_to_css`, `scroll`, `origin` — always, even when 1.0 | **PASS** | `CaptureGeometry` has no optional fields; `geometryFrom` refuses an incomplete one. Proven on real data — see "What the gate caught". |
| 6 | Off-screen elements reported `visible: false, offscreen: true`, document space, **no pixel evidence** | **PASS** | Enforced by shape: the `OFFSCREEN` variant has no `frameId` and no viewport box. At the serialization edge an off-screen element emits **no `bbox` key**. Measured in all six configurations. |
| 7 | An off-screen element is never actioned without a preceding scroll | **CONDITIONAL** | Perception cannot violate this — it emits no actionable viewport coordinate for an off-screen element. But the **executor does not exist**, so the second half of the sentence has nothing to enforce it against yet. See below. |

## Criterion 7 is CONDITIONAL, not passed

Perception discharges its half: an off-screen element reaches the manifest with no pixel
evidence, so there is no coordinate for an executor to action. The rule as written also
constrains the executor, and no executor exists. Marking this `PASS` would claim
enforcement over a component that has not been written.

**QG-02 is therefore recorded as PASS on criteria 1–6 with criterion 7 CONDITIONAL, and is
re-verified when the executor lands.** That is the gate's own instruction — it is due
*before the executor is written*, which is a sequencing requirement, not a licence to
close it early.

## Browser matrix

| Browser | Result | Where |
|---|---|---|
| Chromium | **PASS**, 6/6 configurations, 0 findings | Local + CI · `qg02-chromium.json` |
| Firefox | **PASS**, 6/6 configurations, 0 findings | **CI only** · `qg02-firefox.json`, run `34485366327`, 2026-09-10 |

**Firefox is not runnable on the Windows workstation** — Playwright requires its own patched
build and that download fails there, the standing environment fact in `agentos/blockers.md`
(Playwright's browser CDN returns HTTP 400 on that machine). The cell is real, and it exists
because CI produced it. Both engines report identical CSS boxes:

| config | dpr | capture | scale_to_css | `#phone` CSS box (both engines) |
|---|---|---|---|---|
| DPR 1.0 @ 100% | 1.0 | 1024×640 | 1.000000 | `[400, 260, 300, 32]` |
| DPR 1.0 @ 125% | 1.25 | 1280×800 | 0.800000 | `[400, 260, 300, 32]` |
| DPR 1.5 @ 100% | 1.5 | 1536×960 | 0.666667 | `[400, 260, 300, 32]` |
| DPR 1.5 @ 125% | 1.875 | 1920×1200 | 0.533333 | `[400, 260, 300, 32]` |
| DPR 2.0 @ 100% | 2.0 | 2048×1280 | 0.500000 | `[400, 260, 300, 32]` |
| DPR 2.0 @ 125% | 2.5 | 2560×1600 | 0.400000 | `[400, 260, 300, 32]` |

### The Firefox cell earned its place immediately

Its first CI run **failed**, with
`CAPTURE_DIMENSION_MISMATCH: viewport 1024x64 CSS px vs capture 1024x640 px`.

The fixture had no `<!DOCTYPE html>` and rendered in **quirks mode**, where
`document.documentElement.clientHeight` is the html element's *content* height — 64 px, the
`padding-top` of `#content` — rather than the viewport. **Chrome reported 640 and passed.
Firefox reported 64 and failed.** The same page, two engines, one missing line, and a
viewport height wrong by a factor of ten producing boxes that would be wrong everywhere
while still looking like plausible numbers.

Fixed with the DOCTYPE, plus a `document.compatMode` assertion inside the measurement so
dropping it again fails loudly rather than silently. **Running only Chromium would have
shipped this.**

## How zoom is emulated — stated plainly

Playwright has no "press Ctrl +". Zoom is emulated through `deviceScaleFactor`, which is
legitimate for a precise reason: `window.devicePixelRatio` **already folds browser zoom
in**, so a physically-2.0 display at 125% reports 2.5 — and 2.5 is what the page sees
either way. That identity is the fact the whole contract turns on, so the emulation
reproduces the condition under test.

**What it does not reproduce** is Chrome's zoom-specific layout rounding at fractional
scale factors. Recorded as emulated zoom, not as a user zooming.

## What the gate caught

On its first real-browser run the gate **failed**, with
`COORDINATE_TRANSFORM_AMBIGUOUS: zoom = undefined`.

The cause is a genuine property of the platform: **a page cannot read its own browser
zoom**, because `devicePixelRatio` folds it in. In production the value comes from
`chrome.tabs.getZoom()` in the privileged context; the harness now supplies the value it
configured. Criterion 5 is not decorative — the fail-closed guard fired on real data before
anyone noticed the gap.

## Reproducing

```bash
npm ci
npm run typecheck                                     # the gate runs the COMPILED package
node tests/browser/qg02/run-qg02.mjs                  # Chromium
node tests/browser/qg02/run-qg02.mjs --browser=firefox
```

## Reading the evidence

- **`reportedDpr` must differ across rows.** If it did not, the emulation silently no-opped
  and criterion 4 would pass trivially. This is asserted, not assumed.
- **`captureSize` is read from the returned PNG's IHDR**, never computed as
  `viewportCss × dpr`. Computing it would feed the `CAPTURE_DIMENSION_MISMATCH` guard its
  own assumption, leaving it structurally incapable of ever firing.
- **`QG02_onscreen_has_bbox` is the observer sanity control.** An implementation emitting no
  `bbox` for anything would satisfy the off-screen criterion while being entirely broken.
