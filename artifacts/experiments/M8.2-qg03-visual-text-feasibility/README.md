# M8.2 — QG-03 feasibility for the text-region candidates

> **W1 only, 2026-09-25/26.** Full QG-03 feasibility for **TR-01 `PP-OCRv4_mobile_det`** and
> **TR-02 `PP-OCRv3_mobile_det`**, under owner authority (Ronit Saha): both enter M8.2 for
> feasibility only. Not adoption, not a ranking.
>
> **Result, per candidate and independently, under the frozen protocol:**
> **TR-01 — QG-03 PASS → ELIGIBLE FOR ADOPTION REVIEW.** **TR-02 — QG-03 FAIL**: its Firefox WASM
> (Linux) cell is CONDITIONAL because one launch never reported. A controlled diagnostic ties that
> symptom to Firefox's MV3 event-page idle limit, for both candidates. No verdict was changed.
> **Two deviations are disclosed below.**

- **Protocol (frozen first):** [`protocol.md`](protocol.md) · **Decision:** [`decision.md`](decision.md) · **Per candidate:** [`TR-01.md`](TR-01.md) · [`TR-02.md`](TR-02.md)
- **Evidence:** `results/` (every launch, `cells.json`, `qg03-verdict.json`) · `teardown/summary.json` · `coexistence/summary.json` · `benchmarks/summary.json` · `logs/` (environment, fixture integrity, diagnostic) · [`artifacts/benchmarks/M8.2-text-region-qg03.json`](../../benchmarks/M8.2-text-region-qg03.json)
- **Harness:** `browser/` · rules: [`tests/browser/support/qg03-feasibility.mjs`](../../../tests/browser/support/qg03-feasibility.mjs) (23 tests)

## Hypothesis

That each candidate, independently, can satisfy QG-03 in the browser. That means:

- it loads, runs correctly and deterministically in all four required cells, with the WASM columns
  passing on the fixed realistic fixture;
- it coexists with the UI head and YuNet without changing anyone's output;
- it survives repeated create/run/release with a bounded footprint;
- it can be timed reproducibly enough for adoption review.

All of this without a plaintext path or any product change.

**What would falsify it, per candidate:** a WASM column not ACCEPT, an incorrect or
non-deterministic output, an interfering coexistence, unbounded growth or a failed recreation, or
a cell that cannot be run (BLOCKED).

## Environment

| | |
|---|---|
| Workstation | W1 `LAPTOP-6E14K34L`, Windows 11 build 26200, Intel Core 7 240H, Intel `gen-12lp` + RTX 5050 |
| Chromium | Chrome for Testing **153.0.8010.12** (Playwright `chromium-1243`), unbranded, W1-QG03's args |
| Firefox, Windows | frozen **155.0.1**; **measured 156.0.1** — see Deviation 1 |
| Firefox, Linux | **155.0.1** tarball, signature-verified, in a **WSL2 Ubuntu 26.04.1** guest installed on W1 for M8.2 (the S-02a guest no longer existed) — kernel 6.6.87.2, WSLg for headful |
| Firefox driver | `web-ext` 8.3.0 from the committed lockfile, outside the repository |
| Runtime | ORT Web 1.29.0, pinned `.wasm` `db816fad…` verified by the shipped `installVerifiedOrtRuntime()` in every launch; `numThreads` 1; sessions by the shipped `createPinnedInferenceSession()` |
| Context | throwaway MV3 probe extensions from the shipped `@pratibimb/security` / `@pratibimb/perception` `dist/`: Chromium offscreen document, Firefox event page |
| Coexistence set | UI head `ba6d9e93…` (shipped); YuNet `8f2383e4…` at S-04a-1's pin — **not in the product** |
| Inputs | re-generated and required to equal M8.1's **byte for byte** (`logs/fixture-integrity.json`); held-out geometry re-measured exactly |
| Full detail | `logs/environment.json` |

## Expected result

1. Chrome WASM and Chrome WebGPU ACCEPT for both, as for the UI head (W1-QG03).
2. Firefox WebGPU CONDITIONAL — headful works, headless has no adapter at defaults, as for the UI
   head.
3. Firefox WASM (Linux) unknown: it had never been measured for any model row.
4. Teardown: a plateau after cycle 1 (S-04a/S-04a-1). Coexistence: exact outputs.
5. Benchmark: the fast mode reproduces. Whether TR-01's M8.1 slow mode recurs is unknown.

## Actual result

| # | expected | TR-01 | TR-02 |
|---|---|---|---|
| 1 | Chrome cells ACCEPT | ✅ WASM 482/521 ms p50 · WebGPU 140/138 ms | ✅ WASM 575/565 ms · WebGPU 176/164 ms |
| 2 | Firefox WebGPU CONDITIONAL | ✅ CONDITIONAL (201 ms headful; headless no adapter) | ✅ CONDITIONAL (301 ms; headless no adapter) |
| 3 | Firefox WASM (Linux) | **ACCEPT** — 6/6, 554/540 ms | **CONDITIONAL** — 5/6; one launch never reported |
| 4a | teardown plateau | ✅ 0 grows after cycle 1, 4/4 envs; fresh context at 0 MB | ✅ same |
| 4b | coexistence exact | ✅ 5/5, bit-identical, peak 131.1 MB | ✅ 5/5, bit-identical, peak 152.4 MB |
| 5 | benchmark | **no slow mode**: 0/20 launches, 400 inferences, median 470.5/471.1 ms, max 560.9 | no slow mode: 0/20, median 557.0/561.5 ms, max 628.6 |
| — | correctness | fixed-fixture relErr 6.52e-07 (WASM), 6.32e-07 / 6.02e-07 (WebGPU) | 6.87e-07 (WASM), 1.54e-06 / 1.82e-06 (WebGPU) |
| — | vs M8.1 | every WASM output and box byte-identical | every completed WASM output and box byte-identical |
| — | RE-1 on each cell's boxes | 0/306 exposed everywhere, WebGPU included | 0/306 exposed everywhere |
| — | **QG-03** | **PASS** | **FAIL** |

**Not expected — the Firefox event-page limit.** Two recorded launches, one per candidate, started
and never reported. The diagnostic below reproduces this deterministically.

**Not expected — Windows Firefox updated itself** mid-run (Deviation 1).

## Deviations — disclosed, not folded in

1. **Firefox version (Windows).** Frozen: 155.0.1. Firefox's own updater replaced it with
   **156.0.1** at 18:50:27Z. The first recorded Firefox-Windows launch began at 18:50:05Z, and
   every recorded Firefox-Windows report carries `rv:156.0`. The harness did not request an update,
   and its `web-ext` profiles did not disable one. **Affected:** the Firefox WebGPU cell, the
   supplementary Firefox WASM (Windows) cell, and Firefox-Windows teardown and coexistence.
   **Unaffected:** the Firefox WASM (Linux) cell, 155.0.1. No re-run, no recomputation. Evidence:
   `logs/environment.json` (updater log times).
2. **Harness changes after results, both decision-free:**
   - `run-firefox.mjs` gained **diagnostic-only** flags (`--warm`, `--pref`, `--deadline-ms`),
     unused by any recorded launch;
   - `aggregate.mjs` now also excludes `diag-*` files.

## Diagnostic — Firefox's MV3 event-page lifetime (decides nothing)

`logs/diagnostic-firefox-event-page-lifetime.json`:

- **Observation:** among the 42 completed recorded Firefox launches, the longest probe ran
  **28.0 s** inside the event page. The two silent launches' siblings ran 17–29 s.
- **Test:** an A/B on one pref. The same probe at `warm=40` (past 30 s), Linux headless, both
  candidates, alternating arms.

  | arm | TR-01 | TR-02 |
  |---|---|---|
  | release defaults | **0/2 reported** | **0/2 reported** |
  | `extensions.background.idle.timeout=900000` | 2/2 reported (41 s), correct | 2/2 reported (48 s), correct |

- **Established on W1 / Firefox 155.0.1:** at defaults, a probe that runs past the idle limit in
  an MV3 event page never reports. The pref is read by Firefox's background-page idle manager
  (`ExtensionCommon.sys.mjs`, `ext-backgroundPage.js`).
- **Not established:** the direct cause of the two recorded silent launches. They share the exact
  symptom.
- **Product relevance, stated as an open item:** a Firefox build of the product would run
  perception in an event page, so a long uninterrupted computation there is subject to the same
  limit. The product runs one inference per request (~0.6 s) and is not near it. Whether any
  product path could approach it is **not yet verified**.

## Smoke launches — discarded

Nine single launches were run **before** the protocol commit, to find harness defects, and were
deleted unread as results:

- `smoke-chromium`, `smoke-firefox`, `smoke-firefox-linux`;
- `smoke-webgpu`, `smoke-teardown`, `smoke-coexist`, `smoke-bench`;
- `smoke-ff-webgpu`, `smoke-ff-linux-headful`.

The aggregator was dry-run on temporary copies, which were deleted too.

## Conclusion

| | |
|---|---|
| **QG-03 PASS** | TR-01 — **ELIGIBLE FOR ADOPTION REVIEW** |
| **QG-03 FAIL** | TR-02 — Firefox WASM (Linux) CONDITIONAL (one launch unreported; symptom reproduced by a Firefox event-page limit that affects both candidates) |
| **EXPERIMENTALLY VERIFIED (W1)** | four-cell browser feasibility; realistic-input correctness in every cell; byte-identity with M8.1 on WASM; teardown plateau and fresh-context reclamation; exact coexistence with the UI head and YuNet; controlled timing with no slow mode; no plaintext path |
| **NOT YET VERIFIED** | the cause of M8.1's TR-01 slow mode (not reproduced); WebGPU coexistence; Firefox context teardown; any product integration; **visual-only PII protection in the product** |
| **OWNER DECISION REQUIRED** | TR-02's FAIL (accept, or amend the harness and re-run the Linux cell for both); the Firefox version deviation; TR-01 adoption review |

**Not claimed:** adoption, production readiness, full PII recall, zero leakage, or that either
candidate is preferable.

## Reproducibility

```bash
CHROME_PATH=<chromium-1243 chrome.exe> REF_PYTHON=<measurement venv python> node artifacts/experiments/M8.2-qg03-visual-text-feasibility/browser/prepare-fixtures.mjs
node artifacts/experiments/M8.2-qg03-visual-text-feasibility/browser/build-extension.mjs
CHROME_PATH=<…> WEB_EXT_WIN=<web-ext.js> bash artifacts/experiments/M8.2-qg03-visual-text-feasibility/browser/run-all.sh
node artifacts/experiments/M8.2-qg03-visual-text-feasibility/browser/aggregate.mjs
```

`prepare-fixtures.mjs` refuses unless every input equals M8.1's byte for byte. The build refuses
unless every model matches its frozen hash. The Linux cell needs the WSL2 guest described in
`logs/environment.json`.

---

## Amendment 2026-10-02 — the real-frame baseline is per workstation

> Added when W2 became the development machine. **No result above changed, no threshold moved, no
> comparison was relaxed, and W1's records were not touched.** What changed is which record is
> authoritative for which machine.

**M8.2's native reference is machine-local.** `prepare-fixtures.mjs` used to refuse unless every input
and native output equalled M8.1's, and to stamp every record `workstation: "W1"` whatever machine it
ran on. On W2 that comparison fails for **two independent, measured reasons**, both recorded in
[`logs/baseline-divergence-w1-vs-w2.md`](logs/baseline-divergence-w1-vs-w2.md):

1. **Rasterisation.** The same browser build, viewport and DPR render the same DOM — *identical*
   geometry, verified against the frozen held-out ground truth — to different glyph pixels on a
   different GPU. Every screenshot and every tensor derived from one differs.
2. **CPU floating-point kernels.** onnxruntime 1.29.0, handed the **byte-identical** synthetic tensor
   and the **byte-identical** model, returns a different output on W1 and W2. `min` and `max` agree
   exactly; the summations diverge at ~1e-7; each machine is deterministic. No screenshot is involved.

So **byte-identical cross-machine native output is not assumed**, and the fixtures are workstation
scoped (`models/fixtures/<W1|W2>/`, still git-ignored).

**Exact equality remains mandatory within a workstation.** `tests/browser/support/m82-baseline.mjs`
resolves the baseline for the machine that is running: W1 → M8.1's historical record, read-only;
another machine → its own `logs/<ws>-baseline-<candidate>.json`. **An unknown workstation fails
closed** — it refuses rather than silently borrowing another machine's baseline, which would be
indistinguishable from a pass.

**W1 evidence remains historical and immutable.** `results/tr-01-run1.json`,
`logs/fixture-integrity.json` and the conversion records keep their bytes. W2 writes
`logs/w2-fixture-integrity.json` and `logs/w2-baseline-tr-0{1,2}.json`.

**W2 has a separate validated baseline:** fixtures bit-stable across two independent runs; WASM and
native box geometry identical (0 px) on all seven frames, reproducing M8.1's own W1 diagnostic; RE-1
scores and redaction masks bit-identical to M8.1's; 0/306 sensitive glyphs exposed.

**TR-02 has a native stage on W2 and no WASM stage**, because no product harness runs the rollback
candidate through ORT WASM. `loadBaseline` refuses to use its native boxes for a WASM comparison, and
`build-extension.mjs` refuses on any workstation but W1, which needs M8.2's own browser cells.

### Reproducibility on a machine with no baseline

```bash
# 1 — native stage (refuses on W1: that baseline is M8.1's and is immutable)
CHROME_PATH=<cft chrome.exe> REF_PYTHON=<measurement venv python> \
  node artifacts/experiments/M8.2-qg03-visual-text-feasibility/browser/prepare-fixtures.mjs --establish-baseline
# 2 — WASM stage, TR-01 only
TR01_PROBE=1 npm run build -w @pratibimb/extension
CHROME_PATH=<cft chrome.exe> node tests/browser/extension/run-tr01-worker.mjs --establish-baseline
# 3 — verify against what was established
CHROME_PATH=<cft chrome.exe> REF_PYTHON=<…> \
  node artifacts/experiments/M8.2-qg03-visual-text-feasibility/browser/prepare-fixtures.mjs
```

Both establishment steps exit **non-zero** on purpose: an establishment run measured nothing against a
baseline, so it must never be read as a passing verification.
