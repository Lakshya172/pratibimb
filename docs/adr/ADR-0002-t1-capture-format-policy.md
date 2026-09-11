---
id: ADR-0002
title: "QG-03b-2c — T1 Capture Format Policy"
version: 1.0
status: PROPOSED — for human-architect approval
owner: pratibimb-architect
proposed_by: browser-engineer · ml-engineer
approved_by: —
approved_on: —
created: 2026-09-11
modified: 2026-09-11
supersedes: none
related_gates: ["QG-03", "QG-03a", "QG-03b-2", "QG-03b-2a", "QG-03b-2c"]
related_follow_ups: ["QG-03b-2d (closed by this ADR)", "QG-03b-2b", "QG-03a-4", "QG-03b-3"]
related_invariants: none changed
---

# ADR-0002 — QG-03b-2c: T1 Capture Format Policy

> **STATUS: PROPOSED.** Not approved. Per the amendment procedure in `docs/adr/README.md`,
> the human architect approves or rejects; no agent approves its own ADR. The accompanying
> code **enforces the behaviour production already had** (an explicit PNG request) and
> refuses what it previously accepted silently. If this ADR is rejected, that code is
> reverted (§12) and production keeps requesting PNG either way.

---

## 1 · Status

`PROPOSED` 2026-09-11 on `feature/qg03b2c-capture-format-policy`, based on `main` =
`0aad4f0`. Approval block in §14, left blank for the human architect.

## 2 · Context

T1 is UI perception: the `UIElementDetector` and DOM + vision fusion. Its visual input is a
frame from `chrome.tabs.captureVisibleTab`. That API can encode the frame as **PNG or JPEG**.
Chromium rejects `{format:"webp"}` at schema validation.

**What the dossier says, verified against `docs/dossier/PratiBimb-Engineering-Dossier-v4.0.txt`:**

| Question | Dossier v4.0 |
|---|---|
| Is PNG mandated for capture? | **No.** PNG is not mentioned anywhere in the dossier. |
| Is JPEG permitted or forbidden? | **Neither.** JPEG is not mentioned anywhere in the dossier. |
| Is a caller-selectable capture format required? | **No.** |
| Is capture distinguished from egress? | **Yes, structurally.** Device pixels are the `tabs.captureVisibleTab` output. Capture pixels are the "downscaled frame sent to the server" (coordinate table, §05). The wire carries a **WebP** frame (§05 trust boundary; §07 *"Encode WebP q62, then decode the bytes back"*; the payload is *"the encoded WebP frame and the serialized manifest"*). |
| Performance constraint | Projected p50 **"Capture + downscale 18 ms"** (§10 per-step budget). It is labelled a budget, not a measurement. |
| Robustness evidence for QG-03 | Four browser/backend cells × four values (load, p50, peak heap, correctness), WASM columns passing, coexistence, and a benchmark artifact (`agentos/gates/README.md` QG-03). **The dossier names no compression-robustness requirement.** QG-03a is a project-derived follow-up (W1-QG03 decision), not a dossier requirement. |

So the capture encoding is a decision the dossier leaves open. This ADR records it. It is
**not** a deviation from a frozen contract. `docs/architecture/constitution.md` §5 names the
mechanism (`tabs.captureVisibleTab`) and nothing about its encoding.

**Naming hazard, recorded so nobody trips on it.** Manifest v1.1 has a block called
`capture` containing `"format": "webp", "q": 62` (`docs/architecture/manifest-schema.md`).
That block describes the **sanitized frame on the wire** (T2 egress). It is not the T1
capture encoding. The two share a word and nothing else.

## 3 · Existing evidence

All figures are **measured** on **workstation 1** (`LAPTOP-6E14K34L`, Intel Core 7 240H,
Intel `gen-12lp` iGPU, Windows 11 build 26200), Chromium **151.0.7922.34**, unless stated.
No new measurement was made for this ADR, and none is needed. The decision rests on the
evidence below, and the tests in §10 check behaviour rather than performance.
**None of these figures is a claim about workstation 2.**

| # | Fact | Source |
|---|---|---|
| E1 | Production already requests `{format: "png"}` explicitly. | `packages/perception/src/capture.ts` (pre-change) |
| E2 | **Omitting `format` yields JPEG**, byte-identical to `{format:"jpeg"}` (203,294 B, magic `ff d8 ff e0`). `{format:"webp"}` is **rejected at schema validation**. `quality` is ignored for PNG. | W1-QG03b-2a `metrics.json` → `capture.apiSurface` |
| E3 | Chromium's JPEG is baseline, 4:2:0, IJG quality **exactly 90**, with a 456-byte sRGB ICC profile. It is deterministic across repeats and across headful/headless. | W1-QG03b-2a README; `preprocessing-contract.md` §7 |
| E4 | **Capture latency, median of 20 calls: PNG 37.0 ms headful / 37.7 ms headless. JPEG 21.5 ms / 19.7 ms.** JPEG capture is **faster** by 15.5 ms (headful) and 18.0 ms (headless). | W1-QG03b-2a `metrics.json` → `captureLatency`; `agentos-review.md` §performance |
| E5 | Decode: PNG 9.7 ms, JPEG 9.8 ms (W1-QG03b-2a, local benchmark). On Pillow-encoded fixtures, JPEG q62 decodes in 13–16 ms against 8–13 ms for PNG (W1-QG03b-2). Preprocessing takes 19.5–20.8 ms and runs on decoded RGBA, so it is format-independent. | W1-QG03b-2a `agentos-review.md`; W1-QG03b-2 `decision.md` |
| E6 | Encoded size of a real Chromium capture: **PNG smaller on 9 of 10 fixtures** (JPEG/PNG = 1.03–2.86×). JPEG is smaller only on `gradients-edges` (0.78×), which is not a UI. Median 69,943 B (PNG) vs 140,516 B (JPEG). On Pillow fixtures, PNG is smaller than JPEG q62 on 9 of 9. | W1-QG03b-2a `metrics.json` → `compressionSensitivity.perFixture`; W1-QG03b-2 README §7 |
| E7 | Browser decode vs reference decode **of the same bytes** is bitwise identical for PNG and JPEG, in every cell. The capture path is **ACCEPT in all 8 cells**. | W1-QG03b-2, W1-QG03b-2a |
| E8 | **Compression sensitivity**, meaning JPEG capture vs PNG capture of the same paint: decoded max abs 104–142, mean 0.37–3.19. On Pillow fixtures, the detector keeps 96–98% of detections at JPEG q95 and **91–92% at q62**, i.e. it loses 8–9%. | W1-QG03b-2a `metrics.json`; W1-QG03b-2 `decision.md` |
| E9 | QG-03b-2a is `CONDITIONAL` for one reason: on `gradients-edges`, JPEG, WASM, a matched box is 15.95 CSS px from its reference (bound 2.0). **That is not a capture-format result.** The tensor was bitwise identical to the reference, the same bytes gave 0.002 px on WebGPU, and a 1e-07 perturbation of model output moves a box 47 px. The mechanism is NMS ordering sensitivity (QG-03a-4). | W1-QG03b-2a `decision.md`, `saturation-control.json` |
| E10 | Capture cadence is bounded by the browser's quota, not by encode time. Safe spacing is **500 ms** on Chromium (`minCaptureIntervalMs`). The constitution's tier distribution is ~8 captures per task. | W1-S05-rate; `constitution.md` §7 |
| E11 | Firefox's **own** `captureVisibleTab` output has **not** been measured for either format. Firefox decode conformance (Pillow-encoded fixtures) is bitwise for both. | W1-QG03b-2a `decision.md` "What this does not say"; W1-QG03b-2 |

## 4 · Alternatives considered

| | Option | Assessment |
|---|---|---|
| **A** | **Explicit PNG only** | Lossless and deterministic, and already production behaviour. Smaller on 9/10 measured UI frames. Slower to capture by ~15–18 ms. |
| B | Caller-selected PNG / JPEG | Two production formats, and therefore two robustness matrices. It requires the compression-robustness evidence the detector does not have (E8), and doubles the unmeasured Firefox capture cells (E11). Its only benefit is E4. |
| C | Browser default (omit `format`) | **Rejected outright.** It *is* JPEG on the measured browser (E2), but an undeclared one. The format becomes a property of whichever browser build runs, and no test or reviewer would see it change. |
| D | Explicit JPEG only | Fastest capture (E4). Lossy, larger on 9/10 UI frames (E6), loses 8–9% of detections at q62 (E8), and makes compression robustness a hard adoption requirement. |

## 5 · Decision

**Adopt A. T1 production capture is PNG, requested explicitly, and nothing else is
accepted.** Concretely:

1. The adapter calls `captureVisibleTab({ format: "png" })` and never relies on the default.
2. A payload that is not PNG is **refused** (`CAPTURE_FAILED`). This covers a JPEG returned
   for a PNG request, WebP/GIF/SVG, a MIME label the bytes contradict, and an empty payload.
   It is never accepted as a lossy frame and **never re-requested in another format**.
   There is no PNG→JPEG fallback.
3. `CaptureFrame.format` is narrowed from `"png" | "jpeg" | "webp"` to `"png"`
   (`T1_CAPTURE_FORMAT`), so a non-PNG T1 frame does not typecheck. This closes follow-up
   **QG-03b-2d**.
4. `decodeDataUrl` still decodes both formats the browser API can produce. It now requires
   the declared MIME type to agree with the bytes' signature. The **policy** lives in the
   adapter, and the decoder stays a faithful description of the API.

## 6 · Rationale

- **Production already requests PNG (E1).** This makes the existing behaviour a stated,
  tested policy. It does not change which format production uses.
- **The default is not a neutral choice (E2).** Omission silently means lossy capture at q90
  with 4:2:0 chroma. An explicit request, plus refusal of anything else, is the only way the
  format stays a decision rather than an accident of the browser build.
- **Lossless input suits a detector whose localisation is still under scrutiny.** The T1
  detector is unadopted, its NMS is measurably sensitive to tiny input changes (E9), and it
  loses detections under compression (E8). **PNG was preferable on the tested PratiBimb
  fixture set because it preserved lossless visual input and avoided the measured JPEG
  compression sensitivity, despite JPEG having faster capture latency in the tested
  environment.**
- **JPEG adds a robustness dimension with no demonstrated product benefit.** JPEG's one
  advantage is E4. Capture cadence is bounded by the 500 ms quota spacing (E10), not by the
  15–18 ms encode difference. And neither format meets the projected 18 ms "capture +
  downscale" budget on capture alone (37.0 vs 21.5 ms), so JPEG narrows that gap without
  closing it (QG-03b-3).
- **One format keeps QG-03a and the browser matrix smaller.** Compression robustness leaves
  the T1 production path (§11), and the unmeasured Firefox capture matrix (E11) has one
  format instead of two.
- **The JPEG evidence is kept, not discarded.** W1-QG03b-2 and W1-QG03b-2a stay in the
  repository unchanged, with their tests. JPEG was characterised; it is simply not part of
  the supported T1 production capture matrix.

## 7 · Tradeoffs

| We give up | Size of the cost |
|---|---|
| **Faster capture.** JPEG captured 15.5 ms faster (headful median) and 18.0 ms faster (headless). | Measured, workstation 1 only. At ~8 captures per task, that is roughly 124–144 ms per task (**INFERENCE**, projected, not measured). |
| Smaller files on flat-gradient content | One fixture of ten (`gradients-edges`, 0.78×), and it is not a UI. |
| The option to trade quality for size | Not used by anything today. Reinstating it needs a new ADR (§12). |

What we do **not** claim: that PNG is universally smaller, universally faster to decode, or
that PNG makes the detector good. None of those is supported by the evidence.

## 8 · T1 scope

This ADR governs **only** the T1 capture adapter (`createTabCaptureAdapter`) and the
`CaptureFrame` it produces. It does not change:

- preprocessing, the letterbox, the tensor contract, the detector, its threshold (0.55,
  frozen) or its adoption status (**UNADOPTED**);
- the capture rate policy (`minCaptureIntervalMs` 500 ms), the throttle classification,
  staleness or geometry checks;
- Firefox or Linux status: **Firefox WebGPU headless remains REJECT; Firefox Linux remains
  UNKNOWN.**

## 9 · T2 / egress separation

**T1 capture** is local screenshot acquisition for UI perception. **T2 egress** is the future
privacy-sanitized frame that leaves the machine. The dossier specifies it as **WebP q62**,
built once, verified on its decoded bytes, and hash-pinned with the manifest.

This ADR **does not touch T2**. WebP stays in `manifest-schema.md` (`capture.format: "webp"`),
in `security-invariants.md` (encode WebP q62, verify on the decoded bytes, fail closed if
WebP encode returns empty), and in the payload-pin design. Narrowing `CaptureFrame.format`
removes WebP only from the **T1 capture** type, where it was never producible (E2). The T2
sanitize, verify and egress tiers do not exist yet. When they are built, their encoding is
theirs to decide under their own contracts. **D3 (semantic NER) and D4 (visual PII) are T2
concerns and are untouched.**

## 10 · Testing implications

New behaviour tests in `packages/perception/test/capturePolicy.test.ts` drive the **real
adapter** against a browser model with the measured Chromium semantics (E2):

- the adapter calls `captureVisibleTab` **once**, deep-equal to `{format:"png"}`, with no
  omitted format and no added `quality`;
- omission is distinguishable from policy: the modelled default returns JPEG while the
  adapter still yields PNG;
- a JPEG returned for a PNG request is **refused** before any further processing, with no
  second call;
- **no fallback**: a failed PNG capture is reported and never re-requested as JPEG;
- WebP, GIF, SVG and AVIF payloads are refused;
- a PNG label on JPEG bytes, a JPEG label on PNG bytes, and an empty PNG are all refused;
- frame metadata is consistent: format, PNG signature, the size-probe input and the geometry;
- **compile time**: a JPEG or WebP `CaptureFrame` fails to typecheck. The
  `@ts-expect-error` directives turn unused, and `npm run typecheck` fails, if the type is
  ever widened again.

Historical tests are **unchanged**: `captureFormatConformance.test.ts`,
`realCaptureConformance.test.ts` (including its source-text guards), and the 15
fixture-dependent preprocessing skips. No held-out detector data is touched.

## 11 · QG-03a impact

QG-03a stays **open** and continues to **block detector adoption**. With this ADR approved,
its T1 scope becomes:

| QG-03a item | Before | After ADR-0002 |
|---|---|---|
| Resampler robustness (original QG-03a) | required | **required, unchanged** |
| **Compression (JPEG) robustness** | required (W1-QG03b-2 §Implications) | **Not required for the T1 production path.** No compression step exists between `captureVisibleTab` and preprocessing. It becomes required again only if a later ADR admits a lossy T1 capture format. |
| Box-decode stability under inference noise (QG-03a-4) | required | **required, unchanged.** PNG does not address it (E9 happened on a bitwise-identical tensor). |
| Label/raster inconsistency (QG-03b-1), bundled with the retrain | required | **required, unchanged** |
| Adoption items 11 and 14 (acceptable metrics, usable grounding) | required | **required, unchanged** |

**Compression robustness does not disappear globally.** The T2 verifier re-reads and
re-detects over the **decoded WebP q62** bytes (dossier §07). Whether D3/D4 detection
survives that encoding is a T2 verification question, to be evidenced when T2 exists. It is
not a T1 or QG-03a item.

Two other follow-ups change:
- **QG-03b-2b** (progressive or ICC-tagged JPEG from other sources) leaves the T1 production
  capture path. It stays open for any future non-capture image source.
- **QG-03b-2d** (`CaptureFrame.format` permitted `"webp"`) is **closed** by §5.3.

## 12 · Rollback and reconsideration triggers

**Rollback:** `git revert` the capture commit. `CaptureFrame.format` returns to
`"png" | "jpeg" | "webp"` and the adapter again accepts a JPEG payload. The production
request stays `{format:"png"}` either way, so revert changes no captured frame.

**Reconsider (a new ADR, superseding this one) if any of these holds:**

1. **QG-03b-3** finds capture encode time on the critical path of a published latency budget
   that JPEG would meet and PNG would not, measured on the target machines. A difference on
   workstation 1 alone is not enough.
2. A T1 detector passes QG-03a **including** a compression-robustness evaluation at the
   browser's JPEG settings, so that JPEG no longer costs accuracy.
3. Firefox's own `captureVisibleTab` output is measured and PNG turns out to be
   unavailable, non-deterministic or materially worse there.
4. A browser changes `captureVisibleTab` so that PNG is unavailable, or the PNG size
   advantage reverses on real UI frames at the resolutions being judged.

## 13 · What this ADR does NOT do

- Does not adopt the T1 detector, change its threshold or tolerances, retrain it, or touch
  the held-out split.
- Does not start QG-03a, T2, D3 or D4.
- Does not change ADR-0001, the CSP, `connect-src`, the ORT hash pin, B-02, Invariant E or
  QG-04. **No network request is added**: capture remains local.
- Does not mark QG-03 ACCEPT. **QG-03 remains CONDITIONAL.**
- Does not edit `docs/architecture/constitution.md`. Per amendment step 6, §5's capture row
  gains "PNG, explicit (ADR-0002)" **on approval**, not before.

## 14 · Approval

| Field | Value |
|---|---|
| Decision | ☐ APPROVED ☐ REJECTED ☐ APPROVED WITH CONDITIONS |
| Human architect | |
| Date | |
| Conditions | |
