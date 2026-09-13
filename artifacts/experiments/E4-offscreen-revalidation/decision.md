# E4-offscreen — verdict

**Date:** 2026-09-13 · **Workstation:** W2 (`LAPTOP-SRCINK2B`, GPU `GPU-acde8e3a-c29b-9943-557e-04dd0b20a09a`) ·
**Cell:** Chrome for Testing 153.0.8010.12, headful, the MV3 offscreen document of the experimental host ·
**Pre-registered:** `3a9e57268cdddccb179e04ba546549f157d67089` · **Harness:** `8abca5475aa560d41698dedbca6a329fe4c69f7d` ·
**Log:** [`logs/e4-offscreen.json`](logs/e4-offscreen.json), SHA-256 of the bytes as written (LF)
`a2006853c32a20b43cd78af4c1b1d084e76628302efbff12ae987f1cb6bd1efd`, 50,878 B

**Verdict: PASS.** The byte-identical E4 instrument detects every in-scope canary, stays silent on
every control, and receives every request intact when the bytes are emitted by the MV3 offscreen
document. **This is instrument validation, not a privacy claim about PratiBimb.**

| Pre-registered condition | Result |
|---|---|
| Phase A reproduces the committed attempt-2 per-run records and totals | **yes**: records, totals and blind-spot summary all equal |
| Phase B `requests` / `positives` / `negativeControls` | **2,520 / 1,800 / 480** |
| Positive misses · extra classes · false positives | **0 · 0 · 0** |
| Detections with an empty canary set | **0 / 2,520** |
| Not arrived · hash-integrity failures | **0 · 0** |
| Live sentinels arrived intact and detected as PHONE | **20 / 20** |
| Offscreen `instanceId` identical before and after every run | **yes**: one instance for all 10 runs |
| Every relay reports the extension's `offscreen.html` as emitter | **yes**: 2,540 / 2,540 |
| At least one correlated Phase B arrival (else NOT_OBSERVABLE) | **2,540** |

## Recorded, not criteria

| Observation | Value |
|---|---|
| Phase B per-run records vs the committed attempt-2 records | **equal** (not required; the cell changed nothing the instrument sees) |
| Blind-spot probes detected | 0 / 240 — all six declared blind spots still real |
| Offscreen `fetch` settled | 2,540 resolved, 0 rejected |
| Uncorrelated arrivals (e.g. CORS preflight) | **0** |
| `Origin` header on Phase B arrivals | `chrome-extension://pgpklppkdeekblhldmoggnhhfjalhebo` on **1,280** (every POST); **absent on 1,260** (every GET: QUERY and HEADER). Phase A arrivals: absent on all 2,520 |
| Playwright `context.on("request")` saw collector-bound requests | **0 / 2,540** — the page-side observer is blind to the offscreen document (consistent with S-01b); the PASS rests on the collector alone |
| In-document fetch duration | p50 3.3 ms · p95 15.1 ms |

## What this PASS licenses

The E4 instrument may be used to observe egress **emitted by an MV3 offscreen document's `fetch`**, in
Chrome for Testing 153.0.8010.12 on W2. Each condition from E4 still applies:
- a byte-identical scanner and collector, checked by LF-normalised SHA-256;
- the six blind spots stated;
- a live sentinel in every run.

## What it does not license

- Any statement about PratiBimb's privacy, and any "zero leaks" claim. No product egress, sanitizer or
  verifier exists or took part.
- Other channels:
  - WebSocket;
  - `sendBeacon`;
  - image or navigation requests;
  - service-worker or content-script `fetch`;
  - DNS.
- Canaries inside image pixels, or compressed bodies.
- Edge, Firefox, other Chrome versions, Linux or the CI cell.
- **W1.** This is W2 evidence.

**Limit on attribution.** For the 1,260 GET arrivals, attribution to the offscreen document rests on
the in-document emitter report and the phase separation, not on a collector-side `Origin` header,
because Chrome sent none. The collector's raw headers for those requests were not written to the log.

## Status changes

- **B-02: unchanged, OPEN.** It concerns Invariant E *enforcement* mechanism (2), and the B-02-2 ADR
  is unwritten. This run validates an *observation* instrument.
- **QG-04: unchanged, unsigned.**
- **Detector: UNADOPTED.** The artifact was present only to satisfy the host build and was never loaded.
- **The MV3 host remains experimental.** `E4_EMIT` is experiment code.
- **`main`'s `run-e4.mjs` defect (`c497aee`) is still present.** This run used `b027fc5`'s code by
  decision. Repairing or annotating `main`'s file is a separate, owner-visible change.

## Follow-ups

| Item | Why |
|---|---|
| Repair or annotate `E4-leak-instrument/harness/run-e4.mjs` on `main` | it does not parse, and the handoff lists it as runnable |
| Record `User-Agent` / raw headers for GET arrivals in any future re-validation | closes the attribution limit above |
| An Edge 153 cell, and Firefox once D-J is decided | one cell measured |
| Re-validate against the real egress path when a product egress module exists | this validates the instrument, not a sender |
