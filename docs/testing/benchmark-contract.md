# Benchmark and Measurement Contract — PratiBimb

> **FROZEN.** Source: dossier v4.0 sections 10, 11 and 14.
> **This contract defines what every later implementation must produce.**
> An implementation that does not emit these measurements is incomplete, regardless of
> whether it works.

---

## Rule 0 — the reporting rule

> **Report measured, not aspirational.**

- Every figure is labelled **`projected`** (a budget from the dossier) or **`measured`**
  (produced by the harness on named hardware).
- **No figure moves from `projected` to `measured` without an artifact under
  `artifacts/benchmarks/` naming the machine, OS, browser, browser version, backend and date.**
- Zero residual leakage is an **objective**. It belongs on the title slide only once the
  harness has demonstrated it across the full evaluation set.
- An unbacked "0.00%" or "1.1 s" is the kind of claim a panel will spend the entire
  question period dismantling — and they will be right to.

---

## Rule 1 — reporting shape

- **p50 and p95** for end-to-end **and every stage**.
- **Peak — not mean —** for heap, GPU memory and CPU share. Peak is what determines
  whether the extension stays usable on a judging machine.
- **Cold start and warm start reported as separate figures.**
- **Every table labelled with the backend and the hardware.** Server hardware must be
  stated whenever the latency table is shown.

---

## Rule 2 — the five scored metrics plus one

| Scored metric | Reported figure | Evidence source |
|---|---|---|
| **Visual context — 25%** | Element mAP@0.5, element recall, grounding accuracy. **Reported twice: on clean frames and on redacted frames.** | ScreenSpot-v2 web subset plus **300 self-labelled Indian government and banking screens**, including scanned-document pages where the DOM is empty |
| **PII detection — 20%** | Per-class precision, recall and F1. **Target recall ≥ 0.98.** Precision reported separately on the decoy set. | **500 synthetic and 200 real-layout screens** with ground-truth boxes, plus the adversarial and false-positive sets |
| **Redaction — 20%** | Measured residual leakage; over-redaction area ratio; block rate | Verifier logs, value-aware check results, and the **independent server-side tripwire** |
| **Client resources — 20%** | Peak heap, peak GPU memory, CPU share, weights on disk, **tier firing distribution**, cold vs warm start | Browser memory API and Chrome tracing over a ten-step task |
| **Latency — 15%** | Stage-wise p50 and p95, cache hit rate, **network-free step count**, per backend | `performance.measure` marks rendered as a waterfall in the ledger |
| **Task success after privacy** *(not in the rubric)* | Task completion rate with redaction on, **measured against the same runs as the privacy metrics** | Playwright assertions on final form state |

> **A PII recall of 100% alongside a task success rate of zero is a failed project.**
> The entire claim of this submission is that privacy does not destroy usefulness, so both
> numbers belong on the same slide, measured on the same runs.
> **The ablation that makes the point is a two-row table: grounding accuracy and task
> success, with redaction off and on.**

---

## Rule 3 — the model feasibility criteria

**Each cell of `agentos/registry/feasibility-matrix.md` records four things:**

1. **Does the session load?**
2. **p50 latency on a fixed fixture.**
3. **Peak heap.**
4. **Output correctness against a known-good reference.**

**Gating rules — FROZEN:**

- **No model enters the build until its row is complete** across all four browser/backend
  combinations.
- **A model that fails the WASM columns is not shipped, whatever it does on WebGPU** —
  the judging machine is more likely to be the WASM one.
- Twenty cells, **filled in week one and re-run in continuous integration thereafter**.

> The table is also the answer to a likely question about cross-browser parity:
> **we do not assert it, we publish it.**

---

## Rule 4 — evaluation data sets

**Generation method (week one, highest leverage available):** render HTML templates — a
bank statement, a PAN card view, an e-KYC page, a profile, an application form, a
scanned-document viewer — populated with generated Indian identifiers, then screenshot
them through Playwright. **Ground-truth boxes come free, because you positioned the
elements.** Thousands of perfectly labelled samples in an afternoon. The same generator
produces the decoy set by swapping identifier generators for lookalike generators.

### Adversarial recall set
tiny and rotated text · partial occlusion · text in image, canvas and SVG · dark mode and
low contrast · dynamic popups mid-capture · PII split across DOM nodes · overlapping
detection regions · PDF-rendered text · identifiers adjacent to controls

### False-positive decoy set
12-digit order numbers · PAN-shaped SKU codes · GSTIN-shaped invoice refs · tracking IDs
and AWB numbers · test card numbers failing Luhn · reference numbers with valid state
prefixes · dates that parse as DOB but are not

### Disagreement set
D1 says field, D2 says no · D3 fires where D2 is silent · one detector times out · one
detector crashes · DOM and vision boxes disagree beyond IoU threshold
— **each verifies that union and fail-closed behaviour hold**

---

## Rule 5 — the projected budgets (dossier §10)

**Every number below is a projected budget. None is a measured result, and none appears
on a slide until the harness produces it.**

Projected p50, mid-range laptop:

| Stage | WebGPU | WASM/SIMD | Fires every step? |
|---|---|---|---|
| Capture + downscale | 18 ms | 18 ms | on change only |
| Change gate | <1 ms | <1 ms | yes |
| DOM extraction | 12 ms | 12 ms | yes |
| UI element detection | 35 ms | 140 ms | on change only |
| Face detection | 8 ms | 22 ms | on change only |
| Selective OCR | 90 ms | 260 ms | pre-egress only |
| PII detection | 45 ms | 120 ms | pre-egress only |
| Redact + composite | 12 ms | 12 ms | pre-egress only |
| Verify (differential + value-aware) | 40 ms | 95 ms | pre-egress only |
| Encode + network | 60 ms | 60 ms | pre-egress only |
| Server reasoning (Qwen3-VL-4B) | 620 ms | 620 ms | pre-egress only |
| Freshness check + execute | 25 ms | 25 ms | yes |
| **Full pipeline step** | **~965 ms** | **~1,385 ms** | |
| **Cached step** — no vision, no network | **~38 ms** | **~38 ms** | |
| **Local-decision step** — vision, no network | **~98 ms** | **~235 ms** | |

Server reasoning is **64%** of the WebGPU budget and **45%** of the WASM budget.
Privacy — redaction plus verification — is **52 ms of 965** and **107 ms of 1,385**:
**between five and eight percent**.

> Worth saying out loud when the panel asks what privacy costs: redaction and verification
> together are single-digit percentages of wall-clock time. The dominant term is remote
> inference — which is exactly the term the caching and local-decision strategies are
> designed to avoid paying.

### Where the time is won back

- **Skipping the server entirely.** When the fused element graph contains a `textbox`
  whose autocomplete token or accessible name maps unambiguously to a class the vault
  holds, **the client fills it directly** — no manifest, no encode, no 620 ms round trip.
  This produces **the single most quotable number in the submission: steps completed with
  no network request at all, out of ten.** It is also the cleanest answer to the brief's
  requirement that a local model read the screen and decide on that basis.
- **Screen-state cache.** Updated per element rather than rebuilt. On a form-filling task
  this covers **50–60%** of captures.
- **Region-of-interest re-analysis.** MutationObserver names the dirty subtree, so OCR and
  PII detection re-run on that node alone.
- **Warm start.** ONNX sessions compiled at extension startup. Cold-start cost is measured
  and reported separately, but never paid during a demo.
- **Selective OCR.** Zero to two regions instead of a full viewport — except in the
  verification pass, where full coverage is the point.

---

## Rule 6 — the known landmine (budget a day)

> Multiple ONNX Runtime Web sessions **share one WebAssembly heap**, and disposing a
> session **does not reliably return its linear memory**. Teams have hit hard aborts
> loading a third model sequentially inside an extension offscreen document.

Mitigations, all four:
1. Prefer the **WebGPU execution provider** so allocations live GPU-side.
2. **Isolate the optional local VLM in its own worker** so tearing down the worker
   reclaims the entire heap.
3. **Never load it concurrently with the sanitisation tier.**
4. **Set the WASM thread count explicitly** rather than letting it default.
