# M12 — QG-04 enforcement infrastructure

> **Status: ENFORCEMENT BUILT AND TESTED. Production frame egress remains IMPOSSIBLE.** M12 builds the
> production handoff layer that [ADR-0012](../../../docs/adr/ADR-0012-production-frame-handoff.md)
> specifies, and proves it refuses everything. It does not enable frame egress: there is no production
> origin (B1), no verifier can return VERIFIED (B2), there is no server (B4) and no authentication (B6).
> **J7 / B5 is OPEN** (stream RE-1 G4 failed in two of four windows). **B7 remains OPEN** (the CSP
> leaves non-`connect-src` channels unrestricted; finding F-M12-1).
>
> Verdict: [`decision.md`](decision.md). QG-04 status: [`qg04-matrix.md`](qg04-matrix.md).

## Hypothesis

The approved QG-04 contract (manifest v1.2, one multipart body hashed once, VERIFIED-only frame
egress, structure-only fallback) can be enforced in code so that:

1. no network primitive exists outside `@pratibimb/egress` except listed, non-egress reads;
2. the M10/M11 evidence emitters (`CSP_PROBE`, `E4_EMIT`) are absent from a product build;
3. every frame state short of VERIFIED, every forged attestation, a raw frame and a malformed payload
   are refused **before any network I/O**, in Node and in the real extension realm;
4. the structure-only fallback carries no image byte;
5. with no origin and no authentication configured, nothing can be sent at all; and
6. TR-01's redaction meets RE-1 on **real gesture-stream frames** at four device scales (J7).

## Environment

- **Workstation:** W1 (`LAPTOP-6E14K34L`), Windows 11 10.0.26200, Intel Core 7 240H, Node v24.19.0,
  Playwright 1.63.0.
- **Browser:** Chrome for Testing, Playwright `chromium-1243`
  (`ms-playwright/chromium-1243/chrome-win64/chrome.exe`), headed.
- **Backend:** TR-01 = `PP-OCRv4_mobile_det` ONNX (the pin in `apps/extension/host-lib/tr01-pin.ts`),
  ORT Web 1.29.0 WASM (`db816fad…`, the pin in `packages/security/src/generated/ortPin.ts`).
- **Date:** 2026-10-01.
- **Branch:** `feature/main-product-development`, M12 units 1–4.

## Expected result

- Hypotheses 1–5: PASS. Production frame egress stays impossible by three independent locks: no
  VERIFIED, no destination, no transport.
- Hypothesis 6: unknown going in. The M10.6 finding was that stream boxes differ from screenshot boxes
  by up to 2.71 px at one scale. The verdict is RE-1's own and is not tuned.

## Actual result

### Static enforcement (Node; `npm test`)

| Test | What it proves |
|---|---|
| `apps/extension/test/networkBoundary.test.ts` (11) | Every network primitive in product source is on an exact-count allowlist. That means egress authority, packaged-resource reads, pinned loaders and test-build-only probes. A new call fails (mutation-checked). The evidence aliases default to clean stubs. |
| `packages/egress/test/qg04.test.ts` (18) | Manifest v1.2 build, strict parse and canonical serialization. A deterministic multipart body. A whole-body attestation that is single-use and re-hashed before send. Every sender gate refuses before `fetch`, which is stubbed to throw and asserted never called. |
| `packages/egress/test/qg04Fallback.test.ts` (11) | Every frame problem gives a structure-only body with `format: none`: no frame part, no RIFF/WEBP/VP8 bytes, and an `IMAGE_WITHHELD` notice. |
| `apps/extension/test/productionFrameEgress.test.ts` (4) | **Part R.** Lock 1: the attested states are STRUCTURE_ONLY and MASK_VERIFIED, and nothing writes the verdict register (mutation-checked). Lock 2: the production config is `{origin: null, authentication: NOT_CONFIGURED}` and frozen. Lock 3: the sender's module has no network primitive. Outside test-build probes, the only egress *value* the product imports is `sendVerified`, the structure-only JSON sender. |

### Runtime interception — [`logs/w1-cft-qg04-interception.json`](logs/w1-cft-qg04-interception.json)

`tests/browser/extension/run-qg04-interception.mjs`, no click. The harness watches three things at
once:

- the DevTools Network domain on the **offscreen document** and the **service worker**, via a raw CDP
  attach (`tests/browser/support/cdp-offscreen.mjs`);
- the test sink on `127.0.0.1:8995`;
- an independently instrumented foreign origin on `127.0.0.1:8996`.

**Phase A, the product build: PASS (5/5 gated checks).**

- The bundle carries none of the send-path markers: the QG-04 sender, planner and protocol id, frame
  egress, the sink path, the CSP probe, and the E4 emitter and collector.
- `CSP_PROBE` and `E4_EMIT` → `{refused: "UNKNOWN_KIND"}`, with 0 offscreen requests, 0 sink arrivals
  and 0 foreign arrivals.
- Injected code in the offscreen document and the worker tried fetch, XHR, WebSocket, sendBeacon and
  EventSource against the foreign origin. **0 arrivals.** CDP shows `blockedReason: "csp"` where a
  request was issued.

**Finding F-M12-1, measured and not gated; it keeps B7 open.** Injected code in the offscreen
document **did reach the foreign origin** through two channels:

- an `<img>` load: 1 arrival, `GET /offscreen/img?q=1`, status 200;
- an `<iframe>` load: 1 arrival, `GET /offscreen/iframe`.

ADR-0001's `extension_pages` CSP pins only `connect-src`, `script-src` and `object-src`, so these
channels are unrestricted. Injected code can also POST to the pinned loopback `127.0.0.1:8995`, which
the sink refused as "not RIFF". **No product code does either** (static boundary test plus bundle
scan). This is a bound on what *code running in the realm* could do, not a product path. Closing it
needs an ADR amending the approved CSP. M12 does not change it.

**Phase B, the evidence build (`TR01_PROBE=1 M3_WORKER_FRAME=1`): PASS (13/13).** This is the degraded
route with no click. The frame is a real tab frame, 1600×900 at scaleToCss 0.8, sanitized in the
realm (SANITIZED). The probe op `qg04-attempts` drives the production handoff code with:

- the realm's real MASK_VERIFIED artifact;
- a verified handoff from the real `sanitize()`.

Results:

- **MASK_VERIFIED body:** attested (8429 bytes), then refused with `STATE_NOT_ADMISSIBLE` under both
  the production config and a test config.
- **Forged attestations:** every state, VERIFIED included, is refused as `NOT_ATTESTED`.
- **Raw frame:** `attestHandoffBody` refuses it with `FRAME_NOT_MASK_VERIFIED`.
- **Malformed payload:** the server check refuses it ("the body does not hash to its declared
  digest").
- **The five fallbacks** — verifier BLOCK, MASK_VERIFIED verdict, DETECTOR_VERIFIED verdict, raw frame
  and REFUSED — each gave STRUCTURE_ONLY with no image bytes:
  - bodies were 1344 B, or 690 B when there was no trustworthy frame;
  - production send returned `CONFIGURATION_MISSING` every time.
- **Requests before the permitted send:** 0.
- **Permitted send:** exactly one, the test-only `sendMaskVerifiedFrame` to the sink: 200, accepted,
  with the hash matching. CDP saw exactly that one request. The foreign origin received nothing.

### Stream-native RE-1 (J7, B5) — [`logs/w1-cft-stream-re1.json`](logs/w1-cft-stream-re1.json)

`tests/browser/extension/run-stream-re1.mjs`. The setup:

- **Clicks:** four windows, **one real toolbar click by the owner in each** (`realGesture: RECORDED`
  ×4).
- **Images:** the frozen held-out set H1–H6, shown 1:1 in the granted document and captured through
  the gesture stream **three times each**.
- **Build:** the evidence build's capture route is byte-identical to the product's.
- **Scoring:** the frozen scorer. TR-01, its post-processing, the geometry and the RE-1 thresholds are
  unchanged.

| Device scale | Capture | scaleToCss | G1 exposed | G2 ≤ 1.0 | G3 < 0.9 | G4 deterministic (3 passes) |
|---|---|---|---|---|---|---|
| 1 | 1280×720 | 1 | 0 | pass | pass | **pass** |
| 1.25 | 1280×720 | 1 | 0 | pass | pass | **FAIL (H4)** |
| 1.5 | 1280×720 | 1 | 0 | pass | pass | **FAIL (H3)** |
| 2 | 1280×720 | 1 | 0 | pass | pass | **pass** |

Additional measurements:

- **Exposure:** **0 of 1224** sensitive glyph instances exposed (306 × 4 windows).
- **Worst G2 and G3:** worst G2 over-mask ratio 0.376, worst G3 largest-box share 0.050.
- **Detection counts:** equal to M8.1's in every image, pass and window.
- **Box deviation from M8.1's screenshot boxes:** up to **3.017 px** (M10.6 measured 2.71 px at scale
  1 only).
- **Boxes across device scales:** the same image at the same capture size (1280×720, scaleToCss 1)
  gives different boxes at different device scales, up to **3.017 px** apart (H1). The browser's
  device-to-CSS downscale of the stream changes the pixels TR-01 sees.
- **The product route is CSS-capped:** every capture was 1280×720 at scaleToCss 1 whatever the device
  scale. A stream frame with `scaleToCss ≠ 1`, which J7's text names, is **not produced by this
  route**.
- **The non-deterministic passes:** for H4 at 1.25 and H3 at 1.5, the detection count was stable (8
  and 7), but the boxes of at least one later pass differed from the first. Formal run 1 recorded only
  the first pass's boxes, so the **size** of that movement was not recorded. The harness now records
  every pass (`laterPassBoxes`, `maxPassDeviationPx`) for any later run, which would be written as
  `…-run2.json`.

**The dry run** ([`logs/w1-cft-stream-re1-dryrun.json`](logs/w1-cft-stream-re1-dryrun.json)) used the
degraded `captureVisibleTab` route with no click. It is mechanics only and not stream evidence. It
passed every gate at all four scales. On that route the frames are device-sized (scaleToCss 1, 0.8,
0.667, 0.5), and boxes are mapped to CSS by the frozen `× scaleToCss` contract before scoring. A first
dry run that omitted the mapping scored capture-px boxes against CSS-px truth; that was a harness bug,
corrected before the formal run.

## Conclusion

- **QG-04 enforcement: built and verified.**
  - Statically, there is one network authority, the evidence emitters are build-gated, and three
    independent locks hold.
  - At runtime, in the real realm, nothing short of VERIFIED leaves, nothing forged leaves, and no
    raw frame, malformed payload or fallback image leaves.
  - The only request the realm made was the one explicitly permitted test send.
  - **Production frame egress is impossible**, and it remains so until B1, B2, B4 and B6 are each
    lifted by their own decision.
- **J7 / B5: OPEN.**
  - G1–G3 pass on real stream frames at all four scales with 0 exposure.
  - **G4 is not met on the stream at device scales 1.25 and 1.5**: the same displayed image gave
    different boxes across three captures.
  - The existing criteria are therefore not satisfied, and this run does not close J7.
- **B7: OPEN.** Finding F-M12-1 (img/iframe channels outside `connect-src`) needs a CSP decision
  under an ADR.

## Reproducibility

```
CHROME_PATH=<chrome for testing> node tests/browser/extension/run-qg04-interception.mjs
CHROME_PATH=<chrome for testing> M12_DRY_RUN=1 node tests/browser/extension/run-stream-re1.mjs
CHROME_PATH=<chrome for testing> M12_RUN=<n> node tests/browser/extension/run-stream-re1.mjs   # four real toolbar clicks
npm test
```

- Both harnesses build the product and evidence extensions themselves and restore the product build
  at the end.
- The held-out frames are M8.2's git-ignored copies under
  `artifacts/experiments/M8.2-qg03-visual-text-feasibility/models/fixtures/screenshots/`.
- The M10/M11 evidence emitters now need `EGRESS_EVIDENCE_PROBE=1` at build time. Forward pointers sit
  in the E4 and G-mv3-host READMEs.
