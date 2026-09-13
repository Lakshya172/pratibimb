# E4-offscreen — re-validating the E4 leak instrument in the MV3 offscreen document

> **PRE-REGISTRATION. NO RESULT YET.** Written and committed before the harness or the host handler
> exists. Nothing in this file may be cited as a result until the *Actual result* section is filled
> by the run it describes.
>
> **This is instrument validation, not a privacy claim.** No PratiBimb product component takes part:
> there is no sanitizer, verifier or egress module to test. A PASS would say the instrument still
> measures leakage when the bytes leave from the cell the product would send from. It would say
> nothing about whether PratiBimb leaks.

- **Date:** 2026-09-13 · **Workstation:** W2 (`LAPTOP-SRCINK2B`, GPU UUID `GPU-acde8e3a-c29b-9943-557e-04dd0b20a09a`)
- **Parent evidence:** [`E4-leak-instrument`](../E4-leak-instrument/README.md) — PASS on attempt 2, W2, Node → loopback
- **Why now:** E4's own [`decision.md`](../E4-leak-instrument/decision.md) licenses measurement only
  *"after re-validation in the cell of use (the MV3 offscreen document)"*.
- **Bootstrap this depends on:** [`docs/handoff/w2-bootstrap/2026-09-13-bootstrap.md`](../../../docs/handoff/w2-bootstrap/2026-09-13-bootstrap.md)

## A defect found before this was written, and how it is handled

`E4-leak-instrument/harness/run-e4.mjs` on `main` **does not parse**. Commit
`c497aee22b7f50eac1317d0a3d7f9fb68eaf5eee` (*fix(e4): hash the instrument's identity over
LF-normalised content*) wrote a literal line break inside a regex literal at line 253. The only
earlier revision, **`b027fc54fad51511153689b347bb77bc053a3691`**, parses. On W2 it reproduces the
committed attempt-2 log exactly: `totals`, `blindSpotSummary` and all 10 per-run records are equal as
JSON (bootstrap record §4).

**Decision taken for this run (confirmed by the user on 2026-09-13):** reuse `b027fc5`'s code, which
is the code that produced the evidence. `main`'s broken file is **not** edited here; the defect is
recorded. The scanner and collector are untouched by either commit.

## Question

When the exact E4 request bytes are emitted by the MV3 offscreen document's own `fetch`, does the
byte-identical E4 instrument still:
- detect every in-scope canary with exactly its own class;
- stay silent on near misses, clean traffic and an empty canary set;
- receive every request with its SHA-256 intact;
- keep its six declared blind spots?

## Hypothesis

**H1.** The instrument's verdict does not depend on the emitting cell. Emitted from the MV3 offscreen
document, the E4 attempt-2 corpus produces the same PASS as from Node.

**H0.** Something the browser cell does breaks the instrument, and the verdict is FAIL or
NOT_OBSERVABLE. Candidates: a CORS preflight that stops a request, browser-added headers that trigger
a false positive, a body re-encoding that breaks integrity, or a request never reaching the wire.

## What is reused unchanged

| Component | Identity | How it is used |
|---|---|---|
| Scanner `e4-scanner-2` | LF-normalised SHA-256 `96979ebde6774f734fa14e4ae94dcabc33c962358874e850148cdccb0f0b6fab` | imported from the committed file; the harness refuses to run on any other hash |
| Collector | LF-normalised SHA-256 `1ff60ed52539d6beb6c1f545aea15283a3cb8563eee4994b2b2b1adc4298ea77` | started from the committed file on `127.0.0.1:8995`; same refusal |
| Canary generator, variants, near misses, blind-spot probes, transports, request construction (`send`, `sendSplit`), seeded shuffle, per-request matching and scanning, per-run record, totals and pass computation | `run-e4.mjs` blob at `b027fc5`, SHA-256 `21f8e2aba754df59956bc9d8c11e4d456c58e470a5626747654bd311c9b2a226` | **loaded from the git blob at run time, not re-typed.** The harness hashes the blob and refuses on mismatch. It then evaluates three marked regions verbatim: lines 1–247, the per-run loop body, and the totals block. Appended glue only exports them |
| Seed block | `ATTEMPT = 2`, seeds **20260923–20260932** | the same canaries as the committed PASS |

## What is added — the minimum to place the instrument in the cell

1. **One offscreen handler, `E4_EMIT`, in `apps/extension/host/offscreen/main.ts`.**
   - Receives a fully built request (URL, method, headers, base64 body) and performs **one** `fetch`
     from the offscreen document.
   - Returns how the fetch settled and the emitting document's URL.
   - Accepts only messages from this extension with no `sender.tab`, i.e. the service worker.
   - Refuses any URL outside `http://127.0.0.1:8995/`. The manifest's pinned `connect-src` would
     block other origins anyway.
   - Builds nothing and chooses nothing.
2. **`harness/run-e4-offscreen.mjs`.** It runs two phases, both driven by the verbatim `b027fc5`
   code:
   - **Phase A — Node control.** `send`/`sendSplit` use Node's `fetch`, exactly as in E4. **It must
     reproduce the committed attempt-2 per-run records exactly (JSON equality)**, or the run stops
     as `ABORTED_CONTROL_MISMATCH` and Phase B does not start. This proves the corpus, seeds, order
     and scanner are the ones that passed.
   - **Phase B — MV3 offscreen cell.** The same code runs, with the global `fetch` replaced by a relay:
     `(url, init)` goes to the service worker, which forwards it to `E4_EMIT`, and the offscreen
     document sends it. Every request byte is built by E4's own `send`/`sendSplit` in Node, including
     the multipart body, which Node serialises once. The browser only puts those bytes on the wire.
     The collector's recomputed SHA-256 is the check that it did so unchanged.

## Environment

| | |
|---|---|
| Machine | W2 · `LAPTOP-SRCINK2B` · AMD Ryzen AI 7 350 · Windows 11 10.0.26200.9445 |
| Node / npm | v26.4.0 / 11.17.0 |
| Browser cell | **Chrome for Testing 153.0.8010.12**, headful, `C:\Users\OMEN\cft\chrome.exe`, loaded with `--load-extension` through Playwright `launchPersistentContext` (the Track G pattern). **One cell only**; Edge is not part of this pre-registration |
| Extension | the minimal MV3 host, built from this branch; CSP `connect-src 'self' http://127.0.0.1:8995` |
| Collector | `127.0.0.1:8995` — the host's pinned `connect-src` origin, so **no CSP change** |
| Scanner location | **Node, over the bytes the collector received — exactly where it ran in E4.** The cell change is the *emitter*, which is the question. The scanner is not moved into the browser |
| Detector artifact | `t1-ui-head.onnx` (sha256 `ba6d9e93…5179d0`) is present **only because the host build hard-requires it**. E4-offscreen never loads it (`ORT_SMOKE` is not sent). No detector evidence is produced |

## Exact command

```bash
npm ci
cd apps/extension && npm run build && cd ../..
CHROME_PATH="C:\Users\OMEN\cft\chrome.exe" node artifacts/experiments/E4-offscreen-revalidation/harness/run-e4-offscreen.mjs
```

It writes `logs/e4-offscreen.json` and exits 0 only on PASS.

## Expected result — pass / fail conditions, fixed before the run

**Per phase:** 10 runs × 252 requests = **2,520** requests, broken down as:
- **1,800** positives: 45 in-scope variants × 4 transports × 10;
- **480** negative controls: 44 near misses + 4 clean, per run × 10;
- **240** blind-spot probes: 6 × 4 × 10, reported and not counted;
- every request re-scanned with an **empty** canary set (2,520).

**Phase B adds 20 live sentinels:** two per run, labelled `e4-sentinel-a` (before the plan) and
`e4-sentinel-z` (after). Each is a PHONE `exact` canary over `POST_JSON`, built by E4's own `send`.
Sentinels are reported separately and are not part of the 2,520.

**Transports:** `POST_JSON`, `QUERY`, `HEADER`, `MULTIPART`.

| Verdict | Condition |
|---|---|
| **ABORTED_CONTROL_MISMATCH** | Phase A's per-run records ≠ the committed attempt-2 per-run records. No cell verdict |
| **ABORTED** | the harness cannot load the host, reach the service worker or the offscreen document, or an identity check fails. No cell verdict |
| **NOT_OBSERVABLE** | Phase B produced **zero** correlated arrivals at the collector. *An observer that saw nothing is never evidence that nothing was sent* — this is never read as PASS |
| **PASS** | **every** one of: Phase A reproduced the committed records exactly; Phase B `positiveMisses = 0`, `positiveExtraClasses = 0`, `falsePositives = 0`, `blindInstrumentDetections = 0`, `notArrived = 0`, `hashIntegrityFailures = 0`, with `requests = 2,520`, `positives = 1,800`, `negativeControls = 480`; **20/20** sentinels arrived with intact SHA-256 and detected as PHONE; the offscreen document's `instanceId` was identical before and after every run; every Phase-B relay reported the emitter as the extension's `offscreen.html` |
| **FAIL** | anything else |

These are E4's own criteria, unchanged. The sentinel, control-equality, `instanceId` and emitter
conditions are **additions that can only make PASS harder**.

**Blind spots are reported, never counted,** exactly as in E4. They are:
- a value split across fields;
- a partial value (e.g. last four digits);
- reversed digits;
- a numeric value embedded in a longer digit run;
- name tokens in reversed order;
- base64 fused into surrounding text.

**Pre-declared handling, fixed now:**
- An offscreen `fetch` that **rejects** is recorded (error name and message) and **does not abort**.
  Whether the bytes reached the wire is decided only by the collector. A rejection with an arrival
  counts as arrived; a rejection without one counts as `notArrived`.
- Arrivals without a correlation id (for example a CORS preflight `OPTIONS`) are counted by method and
  reported. They are never matched to a request and never scanned in its place (lesson C5 of
  `W1-S02a2a3`).
- Headers the browser adds (`Origin`, `User-Agent`, `sec-ch-*`, …) are part of the received bytes and
  **are scanned.** A false positive caused by them is a real cell finding and fails the run.
- **Recorded for information, not criteria:**
  - how many of the 8995-bound requests Playwright's `context.on("request")` observed (S-01b showed
    Playwright interception is blind to the offscreen document);
  - the `Origin` header distribution per phase;
  - relay and fetch timings;
  - the extension build's file hashes;
  - `git HEAD`.

**No threshold, criterion, seed or instrument file may change after the first Phase-B request.** A
changed scanner is a new instrument version and requires a new seed block and a full E4 re-run.

## Actual result

**MEASURED 2026-09-13T15:21:23Z on W2.** Everything above this section is unchanged from the
pre-registration (`3a9e572`). The harness is `8abca54` and the host emitter `930ad93`; the run
recorded `git HEAD` `8abca54` with a clean tree. Log: [`logs/e4-offscreen.json`](logs/e4-offscreen.json)
(SHA-256 as written `a2006853c32a20b43cd78af4c1b1d084e76628302efbff12ae987f1cb6bd1efd`).

**Provenance, from the log:**
- `LAPTOP-SRCINK2B` · RTX 5050 `GPU-acde8e3a-c29b-9943-557e-04dd0b20a09a`, driver 592.82;
- Node v26.4.0 · Playwright 1.63.0 · Chrome for Testing **153.0.8010.12**;
- extension `pgpklppkdeekblhldmoggnhhfjalhebo`, one offscreen context;
- built manifest SHA-256 `1d6556db8d70a9826606560686baa8cd9b4aca916344f2f20450dafe49072d01`.

**Instrument identity, checked by the harness before running:**
- scanner `e4-scanner-2` `96979ebd…f0b6fab`;
- collector `1ff60ed5…98ea77`;
- runner blob `b027fc5` `21f8e2ab…b2a226`;
- verbatim regions: prefix `141347f8…`, body `bcbaaec7…`, summary `eedccb5f…`.

### Phase A — Node control

| | |
|---|---|
| Reproduces the committed attempt-2 per-run records | **yes** |
| Totals / blind-spot summary equal to the committed log | **yes / yes** |
| Arrivals | 2,520, no `Origin` header |

### Phase B — MV3 offscreen document as the emitter

| Measure | Result |
|---|---|
| Requests · positives · negative controls | **2,520 · 1,800 · 480** |
| Positives detected with exactly their own class | **1,800 / 1,800** |
| False positives (negative + clean controls) | **0 / 480** |
| Detections with an empty canary set | **0 / 2,520** |
| Not arrived · hash-integrity failures | **0 · 0** |
| Blind-spot probes detected | **0 / 240** (reported, not counted) |
| Live sentinels (arrived, intact, detected as PHONE) | **20 / 20** |
| Offscreen `instanceId` stable across every run | **yes**: one instance, `52d908e7-…` |
| Relays whose emitter was `chrome-extension://…/offscreen.html` | **2,540 / 2,540**, all fetches resolved, 0 refused |
| Arrivals at the collector | **2,540**, all correlated; **0** uncorrelated (no preflight) |
| `Origin` header | `chrome-extension://pgpklppkdeekblhldmoggnhhfjalhebo` on 1,280 (all POSTs); absent on 1,260 (all GETs) |
| Playwright `context.on("request")` observed | **0 / 2,540** |
| Per-run records vs committed attempt-2 | equal |
| In-document fetch duration | p50 3.3 ms · p95 15.1 ms |

**No deviation from the pre-registered protocol.**

One limit surfaced in audit. The 1,260 GET arrivals carry no `Origin` header, so their attribution to
the offscreen document rests on the emitter report and the phase separation, not on a
collector-side header.

## Conclusion

**PASS.** The byte-identical E4 instrument keeps its detection, silence, integrity and blind-spot
behaviour when the bytes leave from the MV3 offscreen document of a real loaded extension. It is now
validated in the cell of use for this browser and machine. The page-side observer saw none of these
requests, and the collector saw all of them. **Instrument validation only.** Verdict record:
[`decision.md`](decision.md).

The pre-registered statements below stand unchanged.

- **Would prove, if PASS:** the byte-identical E4 instrument detects the declared canary encodings in
  bytes emitted by an MV3 offscreen document's `fetch`, in Chrome for Testing 153.0.8010.12 on W2,
  over four transports. It would do so with E4's false-positive, integrity and blind-spot behaviour
  intact, which validates it in the cell the product would send from.
- **Would NOT prove:**
  - anything about PratiBimb's privacy, or "zero leaks" (no product egress exists);
  - other channels: WebSocket, `sendBeacon`, image or navigation requests, service-worker or
    content-script `fetch`, DNS;
  - canaries inside image pixels (the scanner does not read WebP frames);
  - compressed bodies;
  - Firefox, Edge, other Chrome versions, Linux or the CI cell;
  - W1 (this is W2 evidence only).
- **B-02 and QG-04 do not change on any result.** B-02 is about Invariant E *enforcement* mechanism (2)
  and its interception gap. This run validates an *observation* instrument, and the ADR that B-02
  needs (B-02-2) is unwritten. B-02 stays OPEN; QG-04 stays unsigned.

## Reproducibility

The command above. The harness refuses to run unless:
- the scanner, collector and `b027fc5` runner blob match the hashes in this file;
- a built host exists at `apps/extension/.output/chrome-mv3`;
- `CHROME_PATH` points to an executable.

It records the browser version the run actually used.
