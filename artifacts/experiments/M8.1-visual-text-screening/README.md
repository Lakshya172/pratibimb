# M8.1 — visual-text candidate screening

> **W1, 2026-09-25.** The first real screening of text-region candidates, under owner decisions
> D1–D3 (Ronit Saha): **TR-01 `PP-OCRv4_mobile_det`** and **TR-02 `PP-OCRv3_mobile_det`**,
> acquired at their M8 pins, converted with the approved measurement-only Paddle venv, and judged
> by frozen RE-1 and the approved QG-03 text-region WASM reading. TR-08 was not touched.
>
> **Both candidates, independently: `ELIGIBLE FOR QG-03 / ADOPTION REVIEW`.** Neither is adopted,
> integrated or preferred. No weights are in Git, and no product file changed.

- **Per candidate:** [`TR-01.md`](TR-01.md) · [`TR-02.md`](TR-02.md)
- **Decision:** [`decision.md`](decision.md), including the side-by-side comparison
- **Evidence:** [`logs/`](logs/) conversion records · [`results/`](results/) three runs per candidate, cross-run verdicts, post-hoc diagnostics
- **Code:** [`conversion/acquire-convert.py`](conversion/acquire-convert.py) · [`harness/`](harness/) · rules in [`tests/browser/support/text-detector-screening.mjs`](../../../tests/browser/support/text-detector-screening.mjs)

## Hypothesis

That at least one of TR-01 and TR-02 can serve as a privacy-safe text-region detector for the
visual-only policy. That means it:

- reproduces from pinned source;
- agrees between ORT Web WASM and native on realistic input within the frozen bound;
- leaves no sensitive glyph of the frozen held-out set exposed, within RE-1's over-masking and
  blanket-box limits;
- behaves deterministically, and emits nothing that can hold text.

**What would falsify it, per candidate:** a source hash mismatch or an irreproducible conversion
(BLOCKED); any realistic-input relErr above 2e-2, any exposed sensitive glyph, any image over the
over-mask budget or with a blanket box, any byte difference between runs, or any text-capable
output (REJECTED).

## Pre-registration

The rules were committed in `1d74537`, **before** any source was downloaded or any model run:

- the verdict function;
- DB post-processing;
- the WASM rule;
- the G6 check;
- the acquisition hashes;
- each candidate's preprocessing;
- the run order.

After results, two things were added, and neither can change a verdict:

- a **timing-only** third run, after TR-01's run 2 came out ~4× slower with identical outputs;
- **post-hoc diagnostics** that gate nothing.

No threshold, resolution, post-processing parameter or configuration was changed after any
result. There was one configuration per candidate. The held-out set was scored under that single
configuration in each of three runs, with byte-identical outputs.

## Environment

| | |
|---|---|
| Workstation | W1 (`LAPTOP-6E14K34L`, Intel Core 7 240H), Windows 11, Node v24.19.0 |
| Browser | Chrome for Testing 153.0.8010.12 (Playwright `chromium-1243`), headed, 1280×720, DPR 1 |
| Web runtime | `onnxruntime-web` 1.29.0, `wasm` EP, one thread, pinned binary `db816fad…` (served hash checked every run) |
| Reference runtime | `onnxruntime` 1.29.0 CPU, in the measurement venv |
| Measurement venv | CPython 3.12.14 · paddlepaddle 3.1.0 · paddle2onnx 2.1.0 · onnx 1.17.0 — owner-approved (D2), outside the repository |
| Inputs | dev fixture `visual.html` (also QG-03's fixed realistic fixture; screenshot identical to M7.1's, `7fb4bb0a…`) · held-out H1–H6, re-measured against the frozen geometry each run · S-04a-1 synthetic tensor (diagnostic) |
| Scorer | RE-1 as committed, through `packages/privacy/src/redactionGeometry.ts` |

## Expected result

1. Both sources verify at their pins and convert reproducibly.
2. Realistic-input WASM agrees with native well inside 2e-2. M7.1 measured 4.2e-06 for the related
   v5 graph.
3. The synthetic input is again non-representative, over the bound or degenerate, and decides
   nothing.
4. RE-1: unknown in advance. That is the point of the screen.
5. Latency of the order of M7.1's PP-OCRv5 figures on this machine (~1.2 s load, ~0.7 s inference).

## Actual result

| # | expected | TR-01 | TR-02 |
|---|---|---|---|
| 1 | verified pins, reproducible conversion | **yes** — `18aaccf9…`, 4 766 440 B, identical ×4 | **yes** — `322c3e63…`, 2 436 135 B, identical ×4 |
| 2 | realistic WASM ≤ 2e-2 | **6.52e-07** on the QG-03 cell; ≤ 4.08e-06 on all 7 | **6.87e-07**; ≤ 1.10e-05 on all 7 |
| 3 | synthetic non-representative | **1.04e-01**, over the bound (saturated tail) | **degenerate** — all-zero output on both runtimes |
| 4 | RE-1 | **all gates PASS** — 0 / 306 exposed, over-mask ≤ 0.376, largest box ≤ 0.046 | **all gates PASS** — 0 / 306 exposed, over-mask ≤ 0.175, largest box ≤ 0.045 |
| — | development screen | not rejected — 0 / 23 exposed, over-mask 0.298 | not rejected — 0 / 23 exposed, over-mask 0.065 |
| — | G4 across two complete runs | **byte-identical** | **byte-identical** |
| 5 | latency | load ~1.0 s; inference **~0.49–0.51 s** fast mode, **~1.6–2.4 s** slow mode observed (bimodal, cause unknown) | load ~0.9 s; inference **~0.56–0.58 s**, no slow mode observed |
| — | WASM memory after inference | 119.6 MB | 152.2 MB |

**One unexpected fact.** TR-01's `inference.json` is byte-identical to PP-OCRv5_mobile_det's, so it is
the same network definition with different weights. M8 had only inferred this. It changes nothing
about PP-OCRv5, which was not run, scored or used as a control.

**One unexplained observation.** TR-01's inference time is bimodal on W1 with identical outputs.
It is recorded as measured, with no cause claimed.

## Conclusion

| | |
|---|---|
| **ELIGIBLE FOR QG-03 / ADOPTION REVIEW** | TR-01 `PP-OCRv4_mobile_det` — independently |
| **ELIGIBLE FOR QG-03 / ADOPTION REVIEW** | TR-02 `PP-OCRv3_mobile_det` — independently |
| **EXPERIMENTALLY VERIFIED (W1, this set)** | reproducible acquisition and conversion; realistic-input WASM correctness; RE-1 G1–G6 on the frozen held-out set; determinism; no plaintext-capable output |
| **NOT YET VERIFIED** | QG-03 in full (Firefox cells, WebGPU cells, coexistence, teardown, benchmark artifact); any product integration; recall on real pages, other scripts, rotations, photographs; the cause of TR-01's slow mode |
| **REJECTED FOR V1 — unchanged** | `PP-OCRv5_mobile_det` |
| **DEFERRED — unchanged** | TR-08 |
| **NOT YET VERIFIED** | visual-only PII protection in the product |

**Not claimed:** adoption, production readiness, that either candidate is preferable, or that zero
exposures in 306 glyphs means zero leaks. On this set it bounds the per-glyph miss rate below about
1 % at 95 % confidence, and nothing wider.

## Reproducibility

```bash
PY=<measurement venv>/Scripts/python.exe
$PY artifacts/experiments/M8.1-visual-text-screening/conversion/acquire-convert.py TR-01
$PY artifacts/experiments/M8.1-visual-text-screening/conversion/acquire-convert.py TR-02
CHROME_PATH=<chromium-1243 chrome.exe> REF_PYTHON=$PY node artifacts/experiments/M8.1-visual-text-screening/harness/run-screening.mjs --candidate TR-01 --run run1
#   … run2, and the same for TR-02; run3 is a timing repeat
node artifacts/experiments/M8.1-visual-text-screening/harness/compare-runs.mjs TR-01
node artifacts/experiments/M8.1-visual-text-screening/harness/diagnostics.mjs TR-01
```

Acquisition refuses any byte that differs from the hashes recorded in the script, so a re-run
either reproduces this record or stops.
