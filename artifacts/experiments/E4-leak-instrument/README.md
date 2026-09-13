# E4 — validating the leak instrument

> **What this proves:** the instrument — a loopback collector plus a canary scanner — detects every
> deliberately leaked synthetic canary in every declared encoding and transport, raises no false
> alarm on near misses, and has six declared blind spots that are real.
>
> **What this does NOT prove:** anything about the privacy of PratiBimb. No product component took
> part. The emitter is test code that leaks on purpose. A "0 leaks" claim about the product
> becomes possible only when this same instrument (by SHA-256) observes the product's egress, with
> a live sentinel leak detected in the same run.

- **Date:** 2026-09-13 · **Workstation:** W2 (`LAPTOP-SRCINK2B`) · **Cell:** Windows host · Node
  v26.4.0 emitter → `127.0.0.1:8995` collector · no browser
- **Log:** [`logs/e4.json`](logs/e4.json) (attempt 2, PASS) ·
  [`logs/e4-attempt-1-FAIL.json`](logs/e4-attempt-1-FAIL.json) (attempt 1, FAIL, kept) ·
  **Verdict:** [`decision.md`](decision.md)

## Hypothesis

A deterministic scanner, given the synthetic canary values and the exact bytes a loopback collector
received, detects each canary in every in-scope variant and transport, and reports nothing for near
misses, clean traffic, or an empty canary set.

## Environment

| | |
|---|---|
| Collector | `harness/collector.cjs`, **derived from B-02's** `W1-B02-invariant-e-observation/harness/collector.js` (recorded on W2). The transport (Node `http`, 127.0.0.1 only), body accumulation, SHA-256 recomputation and declared-hash header are unchanged. **The one addition:** it keeps the received request line, raw headers and body, because a scanner needs bytes and B-02 only needed a hash. B-02's file is not edited |
| Scanner | `harness/scanner.mjs`, `e4-scanner-2`, SHA-256 `feeb1be894ae91c8…` (full hash in the log) |
| Emitter | `harness/run-e4.mjs`, Node `fetch`, sequential |
| Canaries | Synthetic, fresh per run from `mulberry32(seed)`: PHONE (10 digits, leading 6–9), AADHAAR (12 digits), DOB (day 13–28, so D-M-Y and M-D-Y cannot collide; a property of the canary, not of users), NAME (two synthetic tokens), OTP (6 digits) |
| Correlation ids | Letters only, so the instrument's own metadata cannot resemble a numeric canary |

## Expected result

For each of 10 runs, with 252 requests per run in seeded-shuffled order:

| Traffic | Count per run | Required |
|---|---|---|
| **Positive control**: 45 in-scope variants × 4 transports (POST JSON · query · header · multipart) | 180 | detected, **with exactly its own class** |
| **Negative control**: near misses (one digit changed, transposed, day ±1, month changed, year +1, one letter changed) × 4 transports | 44 | nothing detected |
| **Clean** payloads × 4 transports | 4 | nothing detected |
| **Blind-spot probes**: split across fields, last four, reversed digits, embedded in a longer digit run, reversed name order, base64 fused into text × 4 transports | 24 | reported; **not counted** |
| **Blind instrument**: every request re-scanned with an **empty** canary set | 252 | nothing detected |
| **Byte integrity**: collector-recomputed SHA-256 vs sender's SHA-256 | 252 | equal |

**In-scope variants:**

| Class | Variants |
|---|---|
| PHONE | exact, `5 5` / `3 3 4` spacing, `-`, `.`, `( )`, `+91 `, `+91-`, leading zero, JSON `\uXXXX`, URL-encoded, base64 |
| AADHAAR | exact, `4 4 4` spacing, `-`, `.`, JSON escape, URL-encoded, base64 |
| DOB | ISO, digits only, D/M/Y with `/ - . space`, Y/M/D, M/D/Y, JSON escape, URL-encoded, base64 |
| NAME | exact, upper, lower, double space, `_`, `.`, JSON escape, URL-encoded, `+`, base64 |
| OTP | exact, `3 3` spacing, `-`, JSON escape, base64 |

`+91` and leading zero apply to PHONE only. URL-encoding an OTP changes nothing, so that variant is not duplicated.

## Actual result

### Attempt 1 — FAIL (`e4-scanner-1`, seeds 20260913–22)

**100 of 1,800 positives missed**, the same ten cells in every run:

| Missed cell | Cause (a scanner defect) |
|---|---|
| JSON `\uXXXX` escape × POST JSON, all 5 classes | `JSON.stringify` doubles the backslash. The scanner decoded `\uXXXX` before `\\`, so it mis-parsed the sequence and left digits separated by backslashes |
| base64 × query, all 5 classes | After percent-decoding, the token follows `note=`. The scanner refused `=` as a token's left delimiter, so it never decoded it |

False positives 0, blind-instrument 0, integrity failures 0. **Per protocol, the instrument was fixed
and E4 re-run from scratch on a fresh seed block.**

An edit to apply the fix initially failed silently, so the attempt-1 harness ran a second time
unchanged, on the same seeds. It reproduced the identical 100 misses. That confirms the failure was
deterministic, but it is **not** counted as a separate attempt. Its output was overwritten; the
preserved attempt-1 log is the first execution.

### Attempt 2 — PASS (`e4-scanner-2`, seeds 20260923–32)

| Measure | Result |
|---|---|
| Positives detected, with exactly their own class | **1,800 / 1,800** in 10 of 10 runs |
| False positives on negative + clean controls | **0 / 480** |
| Detections with an empty canary set | **0 / 2,520** |
| Requests that did not arrive | **0 / 2,520** |
| SHA-256 integrity failures | **0 / 2,520** |
| Blind-spot probes detected | **0 / 240**, all six blind spots real, as declared |

## Conclusion

**The instrument is validated, in the declared scope and in this cell.** It may be used to measure
product egress on condition that:
1. it is the byte-identical scanner (`e4-scanner-2`, SHA-256 in the log) and collector;
2. every "0 leaks" statement names the declared blind spots;
3. every evidence run includes a live sentinel leak on a labelled channel, detected in that same run,
   or the run is void;
4. identity is checked on **LF-normalised** content, since `core.autocrlf` may check the files out with CRLF;
5. **it is re-validated in the cell where it will be used.** This run is Node → loopback on the
   Windows host. The product sends from an MV3 offscreen document, and B-02 already showed that
   browser-side observation mechanisms differ.

## Reproducibility

```bash
node artifacts/experiments/E4-leak-instrument/harness/run-e4.mjs
```

Deterministic canaries and order (seeded). No browser, no network beyond 127.0.0.1, no dependencies
beyond Node ≥ 18's `fetch`. Exits 0 only on PASS. `ATTEMPT` in the harness selects the seed block;
a re-run after any scanner change must increment it and bump `SCANNER_VERSION`.
