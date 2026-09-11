---
id: W1-QG03b2-agentos-review
workstream: QG-03b-2 — capture-format preprocessing conformance
date: 2026-09-12
branch: feature/qg03b2-capture-format-conformance
---

# QG-03b-2 — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author.
> **Not a transcript of independent agents** and not presented as one.

---

## `pratibimb-architect` — L1

**Status: `PASS`.**

### Scoping

**PASS, and it was the first thing done.** The brief asked for JPEG and WebP. Checking what
the capture path can actually produce revealed that **WebP is not a capture format** —
`captureVisibleTab` declares `png | jpeg`, and every WebP reference in dossier v4.0 is the
**T2 egress** encoding. Measuring it anyway was right; presenting it as a capture format
would not have been.

That check also closed a latent inconsistency: `CaptureFrame.format` permits `"webp"` while
no adapter can produce one. Recorded as QG-03b-2d rather than silently narrowed — the type
may legitimately want to stay wide for T2.

### Contract discipline

**PASS.** `preprocessing-contract.md` gained §7 (formats) and §8 (opacity) rather than a new
document. One authoritative contract remains one document. The rounding, kernel and padding
sections are untouched — this experiment had no reason to reopen them and did not.

### Boundaries

**PASS.** Entirely T1. No T2, no D3/D4, no server. **No new dependency** — the codecs are the
browser's and Pillow's, and nothing was added to make them agree. `preprocess.ts` still takes
decoded pixels and has no canvas, DOM or filesystem dependency.

### Registry

**PASS.** Matrix annotated; `model-registry.md` untouched; **no QG-03 cell verdict changed**,
including Firefox WebGPU headless, which stays `REJECT`.

---

## `browser-engineer` — L2

**Status: `PASS`.**

### Was the real browser pipeline measured?

**Yes.** Decoding at **native size** is again the load-bearing decision: the canvas resamples
nothing, so what comes back is the decoder's output and nothing else. Any divergence is
attributable to the decoder rather than to the resize.

### Codec results

**PASS, and stronger than expected.** JPEG decodes **bitwise identically** to Pillow — max
abs **0**, both qualities, both browsers, all 9 sources. Pillow and the browsers share
libjpeg-turbo with the same default IDCT, so the pre-registered ±2 bound had nothing to bound.
Same for WebP via libwebp.

**Colour management was isolated, not assumed away.** `colorSpaceConversion: "none"` changed
nothing anywhere, and fixtures carry no ICC profile — which is why a colour transform could
not have masqueraded as decoder variance.

### The alpha finding

**PASS, and this is the substantive browser result.** Three decode variants made the cause
attributable rather than merely observed:

| | PNG+alpha | WebP+alpha | `premultiplyAlpha: "none"` |
|---|---|---|---|
| Chromium | 15/255 | 31 → **15** | **honoured** |
| Firefox | **27/255** | 31 → **31** | **ignored** |

Firefox ignoring `premultiplyAlpha` is the same pattern QG-03b measured for
`imageSmoothingQuality`. **Neither browser can be configured into correctness**, which is
exactly why a guard is the right answer rather than a decode option. A weaker experiment
would have found "the numbers differ" and stopped.

### Cross-browser discipline

**PASS.** Per browser × format throughout, never averaged. Firefox on Linux untouched and
still `UNKNOWN`.

---

## `ml-engineer` — L2

**Status: `PASS`. No retraining is required by this work.**

### Is the reference correctly defined for a lossy format?

**Yes, and this is the whole experiment.** Comparing a JPEG-decoded tensor against the
original PNG's would measure compression and call it conformance. The reference is the
**same encoded bytes** decoded by Pillow, with the file's SHA-256 re-verified *inside the
browser* — so "both sides decoded the same file" is a measurement, not an assumption.

### Is the artifact still valid?

**Yes.** Nothing in the training pipeline changed. Detector conformance is **100%** with
exact counts and worst CSS delta ~1e-03 px, on every format.

### The separation that matters

**PASS, after a correction.** An earlier aggregation merged *conformance* with *compression
sensitivity* and reported "jpeg-q62 91% MISS" — which reads as a browser defect and is
nothing of the kind. They are now separate fields, and a test asserts the classification
comes from conformance alone.

**Losing 8–9% of detections at JPEG q62** is a genuine finding and belongs to **QG-03a**:
the model was trained with `augmentation: "none"` and has never seen a compressed frame.

### Implications for QG-03a, stated rather than assumed

QG-03a's scope grows to three items — resampler robustness, **compression robustness**, and
the label/raster inconsistency (QG-03b-1) — all wanting the *same* retrain. And the review
notes the cheaper alternative honestly: **if capture is pinned to PNG (QG-03b-2c), the
compression item drops to low priority**, because the cheapest fix to a robustness problem is
not needing the robustness.

### Restraint

No retrain, no architecture change, no threshold change, no registry edit. The frozen
DEV-only threshold rule is untouched and the consumed test split was not reopened.

---

## `performance-engineer` — L2

**Status: `CONDITIONAL_PASS`.**

### Measurement validity

**PASS, after two corrections, and both are worth recording.**

1. **Latency was initially measured after the comparison loop**, reporting a preprocess p50 of
   **108 ms** for an image QG-03b measured at 17–24 ms. By then the probe had fetched ~180 MB
   of reference dumps and run 135 decode cycles; the figure was measuring GC pressure. Moved
   to the start, on a clean heap.
2. **A median over two runs is whichever of the two the index lands on.** The first run of the
   batch paid browser launch and JIT warm-up (34.5 ms decode, 107.7 preprocess) against 8–13
   and 26–31 for every other run of identical code. The aggregator reported the outlier as
   *the* figure. It now reports **min/median/max across runs**, so an outlier is visible
   rather than authoritative.

Reporting the outlier explicitly rather than dropping it is the right call — it is real, it
is cold start, and a reader deserves to see both.

### The findings

- **Decode cost is format-dependent**: PNG **8–13 ms** < JPEG q62 **13–16 ms** < WebP
  **22–25 ms**, consistent in both browsers.
- **Preprocessing is format-independent** (26–31 ms), as it must be — by then the pixels are
  just pixels.
- **PNG is smaller than JPEG on 9 of 9 fixtures.** For UI content JPEG is larger, slower and
  lossier. That is an unusually clean recommendation and it is backed by measurement.

### Why CONDITIONAL

**Combined decode + preprocess is 35–54 ms against the dossier's 18 ms** for "capture +
downscale" — 2–3× over, consistent with the 28–44 ms QG-03b already recorded. Unchanged and
still open as QG-03b-3. Choosing PNG improves it; it does not close it.

The opacity guard adds no measurable cost — folded into the existing RGBA→RGB pass.

---

## `privacy-security-engineer` — L1, blocking

**Status: `PASS`.**

| Invariant | Result |
|---|---|
| ADR-0001 preserved | **PASS** — untouched; the harness uses the shipped pin module |
| G5 | **PASS** — no `node:fs`, no network, no canvas inside `preprocess.ts` |
| No new dependency | **PASS** — no image library added. The codecs are the browser's own |
| No new egress | **PASS** — reference dumps are same-origin extension reads, the mechanism ADR-0001 already uses; harness `connect-src` pinned to loopback |
| No runtime model download | **PASS** — model inlined, unchanged |
| No arbitrary WASM, no `eval` | **PASS** |
| No server, no T2, no D3/D4 | **PASS** — WebP is *scoped as* T2's format but no T2 code exists or was written |
| Secrets, PII, weights in git | **PASS** — `verify-repo` 0 failures, 0 warnings; ~180 MB of dumps gitignored |
| QG-04 | **UNSIGNED**, unchanged |
| B-02 | **OPEN**, unchanged |

### One note worth making

The `FRAME_NOT_OPAQUE` guard is a **fail-closed** addition in a tier whose stated philosophy
is exactly that. A tensor silently wrong by 31/255 would have produced confident detections
that nothing downstream could question — the same failure shape as a silently dead detector
returning an empty list, which this project already refuses.

---

## `evaluation-qa-engineer` — L2

**Status: `PASS`.**

### Do the guards fire?

**Three negative controls, all fired:**

| mutation | reported |
|---|---|
| disable the opacity guard | *a non-opaque frame is REFUSED* + *the refusal carries FRAME_NOT_OPAQUE* both fail |
| claim a lossy format's max abs is 9 | *a LOSSY format marked ACCEPT must be inside the pre-registered bound* fails |
| classify a harness error as REJECT | *any format with a harness error is UNKNOWN, never REJECT* fails |

Suite restored to green afterwards.

### The near-miss worth recording

**A harness failure was almost published as a browser defect.** The probe fetched the same
1.2 MB reference three times per fixture; Firefox aborted reads under the IO load; and the
aggregator scored the aborted fixture as **non-conformant** — which would have put a Firefox
WebP decoding defect into the registry that does not exist.

Fixed three ways: fetch once per fixture, retry once, and **a harness error now yields
`UNKNOWN`, never `REJECT`** — with a test that says so. *"The evidence is missing"* and
*"the thing is wrong"* are different claims, and an aggregator that cannot tell them apart
will eventually publish the second when it means the first.

### Coverage against the brief

JPEG ✅ · WebP ✅ · alpha handling ✅ · RGB conversion ✅ · codec-specific dimensions ✅ ·
odd/fractional resize ✅ · letterbox padding ✅ · deterministic tensor production ✅ ·
detector output equivalence ✅ · **PNG regression tests continue passing** ✅ (explicitly
asserted, so a lossy tolerance cannot mask a lossless regression).

**504 tests.** `typecheck`, lint and `verify-repo` clean.

### Two test-quality defects, self-inflicted and fixed

1. Two pre-existing tests built RGBA buffers whose alpha was not 255. They were testing
   opaque preprocessing and did not know it. Fixed to be explicitly opaque — **not** by
   weakening the guard.
2. A refusal-count assertion hard-coded `1` and broke at `RUNS=2`. Fixed to scale with runs.

---

## Summary

| Agent | Verdict |
|---|---|
| `pratibimb-architect` | `PASS` |
| `browser-engineer` | `PASS` |
| `ml-engineer` | `PASS` — **no retrain required** |
| `performance-engineer` | `CONDITIONAL_PASS` — decode + preprocess is 2–3× over the 18 ms budget |
| `privacy-security-engineer` | `PASS` |
| `evaluation-qa-engineer` | `PASS` |

**No agent recommends retraining in this task, and none recommends adopting the detector.**
Two independently recommend **pinning capture to PNG** (QG-03b-2c) on size, latency and
accuracy evidence.
