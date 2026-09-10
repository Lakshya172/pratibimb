# QG-02 — coordinate contract

> **Status: PASS on Chromium. Firefox CELL PRODUCED IN CI ONLY.**
> Owner: `browser-engineer`. Due: **before the executor is written** — which it is, since no
> executor exists.

The gate is `agentos/gates/README.md#qg-02`. A gate is binary: all items or `FAIL`. Its
seven criteria are reproduced below verbatim, each with how it was established.

## Criteria

| # | Criterion (verbatim) | Result | Established by |
|---|---|---|---|
| 1 | CSS viewport pixels is the only space in any manifest or action plan | **PASS** | `SanitizedElement.bbox` is the only serialized geometry and is produced by `toBboxArray(CssBox)`, which accepts the canonical brand only. Passing a device- or capture-space box is a compile error. |
| 2 | Conversion happens at the edge of every component, and each conversion is unit tested | **PASS** | All four spaces convert only in `coordinates.ts`. 38 unit tests over conversion, round trips, fractional values and refusal paths. |
| 3 | The CI fixture renders at **DPR 1.0, 1.5, 2.0** and **100%, 125% zoom** | **PASS (Chromium)** | Six configurations, measured. `devicePixelRatio` observed 1.0 → 2.5, frame 1024×640 → 2560×1600. |
| 4 | The same logical element resolves to the **same CSS-pixel box in all six** | **PASS (Chromium)** | `#phone` = `[400, 260, 300, 32]` in all six. Also `#cancel`, `#help-link`, `#phone-label`. |
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

| Browser | Result | Note |
|---|---|---|
| Chromium | **PASS**, 6/6 configurations | `artifacts/gates/QG-02/qg02-chromium.json` |
| Firefox | **NOT RUN on the Windows workstation** | Playwright needs its own patched build; the download fails here. This is the standing environment fact in `agentos/blockers.md` — Playwright's browser CDN returns HTTP 400 on this machine. The CI job runs it; the cell is produced there or not at all. |

**Firefox is NOT a FAIL and NOT a PASS.** It is not run. Nothing here promotes it, and it
must not be read as evidence either way.

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
