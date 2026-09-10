# T1 — UI element detector and DOM/vision fusion

> **Status: the FUSION half is complete and gated. The DETECTOR half is a contract with no
> admissible implementation.**
> This is a real checkpoint for D4-equivalent work and explicitly **not** one for D3.

## A note on naming, because it matters

The dossier's **D3 and D4 are PII redaction channels** — D3 semantic NER (GLiNER), D4
visual (YuNet faces plus a fine-tuned head for signatures, ID cards, QR) — feeding the
fail-closed union and the redaction manifest, whose schema already serializes
`"detectors": ["D1","D2"]`. **Those are T2.**

This work is the **T1 `UIElementDetector`** and its fusion — the week-3 *"own detector head
starts here regardless"* path from constitution §8. It is named for what it is so the frozen
taxonomy is not overloaded, and so a future `D4` field in a redaction manifest cannot be
confused with a UI detector.

---

## D3-equivalent — the detector

| # | Criterion | Result | Basis |
|---|---|---|---|
| 1 | Input format specified | **PASS** | `[1, 3, 640, 640]` float32 NCHW, RGB, 0..1, pad `114/255`. Declared in `HEAD_CONTRACT`, asserted by test. |
| 2 | Output schema specified | **PASS** | `[1, 4+C, A]` anchor-free; cx, cy, w, h in model px then one score per class. No objectness channel. |
| 3 | Visual classes defined | **PASS** | 8 interactable classes. Text and images deliberately excluded — OCR and the DOM already describe those better. |
| 4 | Box coordinate space explicit | **PASS** | Model px → capture px → **CSS viewport px, canonical**. Branded types; a raw number cannot pass as a coordinate. |
| 5 | Confidence semantics | **PASS** | Anchor-free, so the class score *is* the confidence. Scores > 1 are refused as malformed — the head is then not emitting probabilities. |
| 6 | Pre/post-processing | **PASS** | Centred letterbox; per-class deterministic NMS at IoU 0.5. |
| 7 | Model size | **NOT APPLICABLE YET** | No weights. Reference for the slot is ~12 MB at 640 px. |
| 8 | Runtime/backend requirements | **CONTRACT ONLY** | Runs through ADR-0001's pinned ORT session, injected. This package never imports ORT and never compiles WebAssembly. |
| 9 | Browser memory implications | **NOT MEASURED** | No weights to load. |
| 10 | Licensing/provenance | **PASS by construction** | Option B: our own head, *"no external dependency and no licence question"*. Option A stays excluded. |
| 11 | Training/eval data provenance | **NOT STARTED** | The synthetic set and the labelled pipeline are a separate workstream. |
| 12 | Inference inside the approved runtime | **PASS by design** | ONNX via the pinned ORT runtime; no new runtime, no new egress. |
| — | **Admissible implementation** | **FAIL — none exists** | Reported as `MODEL_ASSET_UNAVAILABLE`. |

**The detector half is NOT complete, and nothing here claims it is.** Option A is
licence-excluded, option B is untrained, and **option C — the DOM-only floor — is the
admissible configuration today.**

**Not benchmark-complete.** The dossier's prescribed metric for this role is *element
mAP@0.5, element recall and grounding accuracy*, over ScreenSpot-v2's web subset plus 300
self-labelled Indian government and banking screens, reported on clean **and** redacted
frames. That is the QG-05 harness and neither the harness nor the data exists. **No accuracy
claim is made and none is possible from this work.**

---

## D4-equivalent — fusion

| # | Criterion | Result | Basis |
|---|---|---|---|
| 1 | Deterministic | **PASS** | Best-IoU wins, ties by index. Asserted in unit tests and again end-to-end in the browser. No LLM, no randomness. |
| 2 | Provenance preserved, not collapsed | **PASS** | `dom` / `vision` / `dom+vision` / `unresolved` as a discriminated union; detector score rides alongside, never blended in. |
| 3 | Model identity survives | **PASS** | Every detection carries pinned `modelId` + `revision`, so swapping weights cannot silently rewrite stored observations. |
| 4 | Frame freshness enforced | **PASS** | `assertSameFrame` refuses `STALE_FRAME`; verified on real browser data. |
| 5 | Disagreement preserved | **PASS** | DOM-only records *why* (`OFFSCREEN` / `NOT_DETECTED` / `NO_DETECTOR`); vision-only gets a synthetic id; the 0.2–0.5 IoU band flags an overlay (threat model A2). |
| 6 | Off-screen never acquires evidence | **PASS** | Structural: the `OFFSCREEN` variant has no viewport box to match against. |
| 7 | Malformed output fails closed | **PASS** | Wrong rank, wrong channel count, non-finite values, scores > 1, boxes outside the frame — all refused. |

---

## Measured — Chromium, real browser, real frame

Viewport 1024×640 CSS, capture 2048×1280, DPR 2.0.

```
detector (no weights)  : MODEL_ASSET_UNAVAILABLE
floor  elements=18  domOnly=18  NO_DETECTOR=16
fused  detections=5  matched=5  visionOnly=0  overlaySuspects=0
stale frame refused    : true (STALE_FRAME)
clipped element        : CLIPPED
off-screen Submit      : visible=false offscreen=true bbox=false
```

The 5/5 match is the **coordinate chain** being exact: detections were round-tripped
CSS → capture → model → capture → CSS and landed back on the DOM boxes at IoU 1.0.

**Those detections are derived from the measured DOM boxes. They are NOT a detector**, they
are how the fusion path and the model-space chain are exercised on real geometry, and they
support no accuracy claim whatsoever.

`NO_DETECTOR = 16` of 18 is correct: the other two are the off-screen `Submit` and
`Privacy policy`, which record `OFFSCREEN` instead.

| Browser | Status |
|---|---|
| Chromium | **PASS**, 0 findings |
| Firefox | **CI only** — Playwright's browser CDN returns HTTP 400 on the Windows workstation (`agentos/blockers.md`) |

---

## What this checkpoint does and does not establish

**Does:** a reusable perception layer T2 can consume without an architectural rewrite. The
coordinate chain, the provenance model, the freshness rule and the failure semantics are
all fixed and tested.

**Does not:** a working visual detector. Until weights exist and pass the QG-03 matrix, the
`UIElementDetector` role stays `UNAVAILABLE` and the shipped configuration is option C.

**QG-02 is unaffected** — criteria 1–6 PASS, **criterion 7 remains CONDITIONAL** because no
executor exists to enforce the preceding-scroll rule.
