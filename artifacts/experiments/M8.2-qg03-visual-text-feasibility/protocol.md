# M8.2 — QG-03 feasibility protocol for TR-01 and TR-02

> **Status: FROZEN before any M8.2 measurement.** Committed with the harness, before any
> measurement that enters the record. Before the commit, the harness *mechanics* were smoke-tested:
> fixture preparation, the build, and single launches used to find harness defects. Those launches
> were **discarded, not recorded as results**, and are listed in `README.md`. Nothing below is
> tuned per candidate, and nothing is changed after a result. A deviation forced by the environment
> is recorded in `README.md` as a deviation, never folded in silently.
>
> **Owner authority:** Ronit Saha, 2026-09-26 — both TR-01 and TR-02 enter M8.2 for full QG-03
> feasibility only. Not adoption, not a ranking.

## 1. What QG-03 requires, quoted — and how each item is applied here

From `agentos/gates/README.md`:

| # | QG-03 item (quoted) | application in M8.2 |
|---|---|---|
| 1 | *"The exact repository and revision hash are pinned in `agentos/registry/model-registry.md`."* | M8.1 screening record: `3cc09f3a` / `58f4e5b1`, converted hashes recorded. Re-checked, not re-done |
| 2 | *"The licence has been read from the pinned revision, with URL and date recorded."* | M8.1 (Apache-2.0, card at revision, 2026-09-25). Re-checked, not re-done |
| 3 | *"All four feasibility cells are filled: Chrome WebGPU, Chrome WASM, Firefox WebGPU, Firefox WASM (Linux)."* | §4. A cell is **filled** when all four values exist, even if a value is `no` (the UI-head precedent filled Firefox WebGPU headless with `no 0/3`) |
| 4 | *"Each cell records all four values: session loads, p50 on the fixed fixture, peak heap, correctness vs known-good reference."* | §4.3 |
| 5 | *"The WASM columns pass. A model that fails them is not shipped whatever it does on WebGPU."* | §4.4: **Chrome WASM** and **Firefox WASM (Linux)** must each be `ACCEPT` |
| 6 | *"Coexistence with the other resident sessions is verified, and teardown reclaims memory."* | §6 and §5, with the meaning S-04 / S-04a / S-04a-1 established (quoted there) |
| 7 | *"A benchmark artifact exists under `artifacts/benchmarks/`."* | §7 writes `artifacts/benchmarks/M8.2-text-region-qg03.json` |
| 8 | *"An ADR exists if a pinned default or a fallback ranking changed."* | **Not triggered by feasibility**: no default changes in M8.2. It becomes required at adoption (replacing `OCRProvider`'s pinned default) and is recorded as an open adoption precondition |

The WASM correctness input for a text-region model is fixed by the owner's QG-03 Option A decision
(`docs/testing/qg03-wasm-correctness-decision.md`): **the fixed realistic text-bearing fixture
governs; relative `sumAbs` ≤ 2e-2; exact output count.**

## 2. Frozen inputs

| item | frozen value |
|---|---|
| TR-01 | `PP-OCRv4_mobile_det` @ `3cc09f3a`, ONNX sha256 `18aaccf9c9cd27656becda13bc0ef31eaa0ea3aef4d45166839f2093561575e8`, 4 766 440 B |
| TR-02 | `PP-OCRv3_mobile_det` @ `58f4e5b1`, ONNX sha256 `322c3e636b936e5bc695ed29ccf2e1588a827989b23e6f395ad7e7edbc236f55`, 2 436 135 B |
| coexistence set | UI head `pratibimb-t1-ui-head` @ `ba6d9e93695b`, 302 960 B, sha256 `ba6d9e93…79d0` (the product's shipped detector) · YuNet `face_detection_yunet_2023mar` @ opencv_zoo `47534e27`, 232 589 B, sha256 `8f2383e4…2fa4` (S-04a-1's pin; **not in the product** — see §6) |
| fixed realistic fixture (QG-03 cell) | the development fixture `visual.html` screenshot, 1280×720 at DPR 1, as in M8.1 |
| further realistic inputs | the six frozen held-out pages H1–H6 |
| diagnostic input | S-04a-1's synthetic tensor, recorded, never deciding |
| input tensors | produced by M8.1's `prep-native.py` from fresh screenshots; **each must equal the M8.1 input sha256 byte for byte, or the run refuses** |
| held-out integrity | `run-heldout-groundtruth.mjs --check` before any run, and every page's re-measured geometry must equal `groundtruth.json` |
| preprocessing | M8.1's, per candidate's own `inference.yml` (TR-01 640×1024; TR-02 736×1312 on the 720×1280 frame). Every browser is fed the **same Python tensor bytes** — no fixture differs across browsers |
| post-processing | `dbPostprocess` from `tests/browser/support/text-detector-screening.mjs` (M8.1), **its source text injected verbatim** into the probe and its sha256 recorded; boxes compared with M8.1's |
| canonical geometry | untouched; RE-1 re-scoring of each cell's boxes uses the committed scorer |

## 3. Frozen runtime and browsers

| item | frozen value |
|---|---|
| ORT Web | `onnxruntime-web` 1.29.0, `ort.all.min.js`; the `.wasm` hashed against `ORT_PIN` (`db816fad…`) by the **shipped** `installVerifiedOrtRuntime()` before ORT is touched; sessions made by the **shipped** `createPinnedInferenceSession()` (ADR-0001's path, as W1-QG03) |
| session options | `executionProviders: [backend]`, `graphOptimizationLevel: "all"` |
| WASM threads | `ort.env.wasm.numThreads = 1` |
| WebGPU | ORT's default adapter request; **no browser flag, no about:config change** (S-02a's rule) |
| context | a throwaway MV3 probe extension built from the shipped `@pratibimb/security` and `@pratibimb/perception` `dist/`. Chromium: service worker → **offscreen document** (ORT cannot run in an MV3 service worker). Firefox: **MV3 event page**. CSP from the shipped `buildExtensionPagesCsp` |
| Chromium | Playwright `chromium-1243` = Chrome for Testing **153.0.8010.12**, unbranded (branded Chrome refuses `--load-extension`). Args exactly W1-QG03's: `--disable-extensions-except=<ext>`, `--load-extension=<ext>`, `--no-sandbox` |
| Firefox, Windows | **155.0.1** release, `C:/Program Files/Mozilla Firefox/firefox.exe` |
| Firefox, Linux | **155.0.1** release tarball (signature-verified), W1's WSL2 guest **Ubuntu 26.04.1 LTS**, kernel 6.6.87.2-microsoft-standard-WSL2, WSLg for headful |
| Firefox driver | `web-ext` 8.3.0 from the committed lockfile; one pref only, `extensions.originControls.grantByDefault=true` (report delivery — W1-QG03's reason); `dom.webgpu.enabled` **not** touched |
| display modes | headful and headless, every cell |

## 4. The feasibility cells

### 4.1 Cells run, per candidate

| cell | browser / platform | backend | status for QG-03 |
|---|---|---|---|
| **Chrome WASM** | Chromium 153 / Windows | `wasm` | **required, must pass** |
| **Chrome WebGPU** | Chromium 153 / Windows | `webgpu` | required, must be filled |
| **Firefox WebGPU** | Firefox 155.0.1 / Windows | `webgpu` | required, must be filled (the UI-head row's platform) |
| **Firefox WASM (Linux)** | Firefox 155.0.1 / Linux (WSL2) | `wasm` | **required, must pass** |
| Firefox WASM (Windows) | Firefox 155.0.1 / Windows | `wasm` | supplementary; **not** the Linux cell and never quoted as it |

### 4.2 One cell launch

Fresh browser profile. Pin installed → model bytes read from the extension package and hash-checked
→ **session create (cold load, timed)** → **first inference on the fixed fixture (cold inference)**
→ **10 warm inferences** on the fixed fixture → one inference on each of H1–H6 → 3 more on the
fixed fixture, byte-compared (determinism) → one synthetic inference (diagnostic) → the verbatim
`dbPostprocess` on every realistic output, timed → `session.release()` → memory snapshot.
**3 launches per display mode** (W1-QG03's count).

### 4.3 The four values

| value | definition |
|---|---|
| **LOAD** | session created and the run completed, per launch (`k/3`) |
| **P50** | median of all warm fixed-fixture inferences across the mode's launches |
| **HEAP** | WASM linear memory, maximum over the launch's snapshots (linear memory only grows, so this is the peak); JS heap recorded separately where the browser exposes it |
| **CORRECT** | on the fixed fixture: exact output count **and** relative `sumAbs` ≤ 2e-2 vs native `onnxruntime` 1.29.0, **in every launch**. The other six realistic inputs are recorded the same way. The synthetic input is recorded and decides nothing |

For WebGPU cells the same statistic, bound and fixture are applied. It is the only correctness
rule the repository has for this model class, and S-04a-1 applied it to WebGPU. This record says
so, rather than inventing a WebGPU-specific bound.

### 4.4 Cell verdicts

Per display mode: **ACCEPT** = LOAD 3/3 and CORRECT in all 3; **REJECT** otherwise. Per cell:
**ACCEPT** if both modes accept · **CONDITIONAL** if exactly one does · **REJECT** if neither. A cell
that could not be run on W1 is **BLOCKED — NOT VERIFIED** and is never counted as filled or
passed. The WASM columns pass only if Chrome WASM **and** Firefox WASM (Linux) are **ACCEPT**.

### 4.5 Regression against M8.1, per cell

Boxes from each cell's own outputs are re-scored by the committed RE-1 scorer on H1–H6 and on the
development screen, and the boxes' sha256 is compared with M8.1's. A difference is recorded as a
finding, and a changed RE-1 verdict would be reported, not hidden.

## 5. Teardown — the established meaning, quoted

S-04 and S-04a established that *"A `WebAssembly.Memory` cannot shrink … So the heap returning to
baseline after teardown is NOT the success criterion"*. What they measured instead was **whether
repeated lifecycles plateau**: *"Sessions 2 and 3 added zero pages and zero grows."* Real release
of memory comes from **tearing down the context** (constitution §7). M8.2 applies exactly that:

- **In-heap:** 5 cycles of create → run the fixed fixture → `release()`, with a snapshot after
  each stage. **Pass:** every cycle succeeds; every output is byte-identical to cycle 1; **zero
  `Memory.grow` calls in cycles 2–5**.
- **Context (Chromium):** after the cycles the offscreen document is closed and a new one created,
  which runs one more cycle. **Pass:** the new context starts from an empty WASM heap and
  reproduces the output byte for byte. Firefox's event page is not torn down by the harness, so
  there only the in-heap part is claimed.
- Run in: Chromium `wasm` headful, Chromium `webgpu` headful, Firefox/Windows `wasm` headful,
  Firefox/Linux `wasm` headless — one launch per candidate each.
- **"Teardown reclaims memory" = PASS** when every run above passes.

## 6. Coexistence

The product's resident perception is the UI head, which is shipped. **YuNet is not in the
product.** It is included because QG-03 and the owner name it, at S-04a-1's pin. The probe loads all
three through the shipped pinned-runtime path, in one context, sharing one WASM heap, as the
product's offscreen perception would.

1. **Solo:** each model alone — create, run, record the output hash, release — in the same
   context: candidate on the fixed fixture; UI head and YuNet on S-04a-1's synthetic tensor.
2. **Coexist:** create UI head, then YuNet, then the candidate; 5 rounds of (UI head, YuNet,
   candidate); every output hash must equal its solo hash; per-model latency; memory.
3. **Release all, recreate all, one more round**; hashes must still match.

**Pass:** every session creates, every output is byte-identical to solo, no error, and recreation
succeeds. Also recorded: aggregate round latency, peak WASM memory, and the instrumented network
log (only same-origin extension reads and the loopback collector are permitted). In Chromium,
browser responsiveness is measured as the longest `requestAnimationFrame` gap in an ordinary tab
while the round runs.

Run in: Chromium `wasm` headful ×3, Firefox/Windows `wasm` headful ×1, Firefox/Linux `wasm`
headless ×1, per candidate. WebGPU coexistence is **not tested**, and this record says so.

## 7. Controlled benchmark (Chromium `wasm`, the operative cell)

- **40 launches**, interleaved to spread any machine-state drift over both candidates:
  `[TR-01 headful, TR-02 headful, TR-01 headless, TR-02 headless] × 10`.
- **Per launch:** JS decode + preprocessing of the fixture PNG (1 cold + 5 warm) → session create
  (cold load) → cold inference → **20 warm candidate inferences, each followed by one UI-head
  inference** (a control that sees the same context and machine state) → post-processing timed on 5
  outputs → release.
- **Reported per candidate and mode:** median, p90, min, max and n of warm inferences; cold load;
  cold inference; preprocessing; post-processing; total (decode + preprocessing + warm median +
  post-processing); the distribution of per-launch medians, and the UI head's per-launch median
  beside each.
- **Bimodality, descriptively only:** a launch is labelled **slow-mode** when its warm median is
  more than 2× the lowest per-launch median for that candidate and mode. The label describes a
  distribution and gates nothing. Whether the UI-head control slowed in the same launches is
  reported as a co-occurrence, **not a cause**. **No cause is claimed** unless an experiment
  isolates one.
- Machine state recorded at start and end: Windows power scheme and AC/battery status.
- **No performance threshold exists in QG-03, and none is created.** Figures are compared with
  documented numbers (constitution §7, M7.1/M8.1) as context only.

Firefox p50 figures come from the cell launches (§4) and are reported with their `n`.

## 8. Privacy and output semantics — checked, not assumed

- Output: every graph output float32; no STRING tensor; boxes carry only `x, y, w, h, score`
  (M8.1's `plaintextCheck`).
- No recognition model in the extension or on disk in the harness. No OCR API is called.
- The instrumented network log must show no foreign origin except the loopback collector.
- No raw image is reported: results carry hashes, statistics and geometry only.

## 9. The QG-03 verdict, per candidate, independently

**PASS** — items 1, 2, 3, 4, 5, 6 and 7 of §1 hold (item 8 not triggered).
**FAIL** — a required measurement ran and failed: a WASM column not `ACCEPT`, a coexistence or
teardown criterion failed, or a required cell's values are missing although it ran.
**BLOCKED** — a required cell or measurement could not be run on W1. Never counted as a pass.

Outcome A/B/C is recorded as the owner's brief defines it. **No ranking and no composite score is
computed, and no candidate is selected.**
