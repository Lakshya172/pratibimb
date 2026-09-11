---
id: W1-QG03b2a-agentos-review
workstream: QG-03b-2a — real Chromium captureVisibleTab JPEG conformance
date: 2026-09-11
branch: feature/qg03b2a-chromium-jpeg-capture
---

# QG-03b-2a — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author.
> **Not a transcript of independent agents** and not presented as one.

---

## `pratibimb-architect` — L1

**Status: `PASS`.**

### Scoping

**PASS.** The brief asked whether real Chromium JPEG follows the assumptions QG-03b-2
validated with Pillow-encoded files. Inspecting the adapter *first* — before building
anything — turned up the fact that shapes the whole report: **the shipped adapter requests
PNG explicitly, and the API's default when `format` is omitted is JPEG.** So the JPEG branch
is reachable through the declared type but is not the path production takes today. That is
said plainly in the report rather than left for a reader to infer from a passing test.

### Contract discipline

**PASS.** No new architecture document. The experiment's findings live in the experiment
directory; the one durable claim — that the adapter's format argument is load-bearing — is
enforced by a test against `capture.ts`, not by prose.

### Boundaries

**PASS.** Entirely T1. No T2, no D3/D4, no server, no new dependency. The reference decoder
is Pillow, already present; the encoder under test is the browser's own and nothing was added
to make the two agree.

### Registry

**PASS.** No QG-03 cell verdict changed. Firefox WebGPU headless stays **REJECT**; Firefox
Linux stays **UNKNOWN**; `model-registry.md` untouched; the detector remains unadopted.

### One judgement worth recording

The gate could have been called ACCEPT: the capture path is bitwise-exact everywhere and the
single failing number is provably downstream of it. It is **CONDITIONAL** instead, because
the pre-registered criterion named detector output as primary and that bound was exceeded.
Reclassifying upward because the cause turned out to be benign is the same move as loosening
a tolerance to obtain a pass.

---

## `browser-engineer` — L2

**Status: `PASS`.**

### Does this actually exercise `captureVisibleTab`?

**YES, and it is enforced three ways rather than asserted once.**

1. The capture extension calls `chrome.tabs.captureVisibleTab` and **nothing else**. It
   contains no canvas, no `toDataURL`, no `toBlob`, no `createImageBitmap`, no image library.
2. Before any capture it asserts the binding stringifies as
   `function captureVisibleTab() { [native code] }` — a JS stand-in cannot produce that
   without also replacing `Function.prototype.toString`, which would itself be visible.
3. A permanent test greps the harness source (comments stripped) for encoder APIs and fails
   if one appears, and asserts the native-binding check is still called.

This mattered. A canvas `toDataURL("image/jpeg")` would have produced a real browser JPEG
from a *different component with a different configuration*, and every number in the report
would have looked equally convincing while answering nothing that was asked.

### Browser-specific behaviour, recorded rather than smoothed

- **`captureVisibleTab` ignores CDP device-metrics emulation.** A page told it was 1023×641
  captured at 1264×805 — the real window content area. Playwright's `setViewportSize` *is*
  that override, so using it would have produced ten fixtures at one identical size while the
  manifest claimed ten different ones. The runner resizes the real window and verifies what
  it achieved; all ten targets hit exactly.
- **Host permission scoped to the capture origin is insufficient** in Chromium 151 —
  `<all_urls>` or `activeTab` is required. Measured, quoted, and recorded as the reason for
  the harness's permission deviation.
- **`{format:"webp"}` is rejected at schema validation.** Stronger evidence than QG-03b-2's
  inference from the type declaration.
- **`quality` is ignored for PNG** and honoured for JPEG.
- **Headless and headful encode byte-identically** — a finding, and one that could have gone
  the other way given the different compositor path. They are still reported as separate
  cells and never averaged.

### Backend identity

**PASS.** `GPUQueue.submit` is counted during inference. WASM cells: 0. WebGPU cells: 120.
The aggregator **refuses to emit** a cell whose label was not observed. ORT falls back
silently, and QG-03 published a mislabelled cell once already.

---

## `ml-engineer` — L2

**Status: `PASS`.**

### No retraining, no model change

**PASS.** No architecture, threshold, training-data or registry change. The frozen 0.55
threshold is used as-is. The one criterion failure was investigated to attribution and
explicitly recorded as **not justifying** a retrain.

### The attribution

**PASS, and the first hypothesis was wrong.** The tidy story — "the 300-detection cap is the
mechanism" — was killed by its own control: `controls` emits 147 boxes, nowhere near the cap,
and is equally unstable under a 1e-07 perturbation. The mechanism is NMS ordering generally;
saturation aggravates it. The dead hypothesis is kept in the artifact and guarded by a test,
because an explanation that was believed once will be believed again.

### The control had a bug, and it showed

The first version clipped the whole output tensor to 1.0 — including channels 0..3, which are
distances to box edges, not probabilities. Every box collapsed and it reported a tidy
`0.0000 px` for all three fixtures. A control that cannot fail is decoration; the fix, and
why it matters, is in the script's own comments.

### Detector comparison

**PASS.** Browser detections are compared against Python detections **for the same encoded
file** — conformance — and separately against the PNG capture's detections — compression
sensitivity. The two are never added and the second never classifies anything. A test asserts
the separation survives.

---

## `performance-engineer` — L2

**Status: `CONDITIONAL_PASS`.**

### Capture cost is kept apart from preprocessing cost

**PASS.** They are measured in different processes, in different phases, and the aggregator
holds them in different blocks with an explicit note that they are never summed. The report
labels the real-browser capture wall time separately from the local decode benchmark, as the
brief required.

Measured (median across 20 calls per cell):

| | headful | headless |
|---|---|---|
| capture PNG | 37.0 ms | 37.7 ms |
| capture JPEG | 21.5 ms | 19.7 ms |
| decode PNG | 9.7 ms | — |
| decode JPEG | 9.8 ms | — |
| preprocess | 19.5–20.8 ms | — |

### The budget

**CONDITIONAL_PASS, unchanged and not this spike's to fix.** Decode + preprocess is ~29–31 ms
against the dossier's 18 ms, and capture adds 20–37 ms on top. The gap is QG-03b-3 and is
not re-litigated here.

### One number worth naming

JPEG capture is *faster to capture* than PNG (21.5 vs 37.0 ms) — the encoder does less work —
but produces **larger files on 9 of 10 fixtures** and decodes no faster. Whether that trade
is worth anything is the QG-03b-2c capture-policy question, not a performance verdict.

---

## `evaluation-qa-engineer` — L2

**Status: `PASS`.**

### The harness was shown to be capable of failing

**PASS — three negative controls, all fired, each naming its own guard.**

| control | broke | guard that fired |
|---|---|---|
| corrupted-bytes | one byte of a captured JPEG | in-browser SHA-256 → `UNKNOWN`, never `REJECT` |
| mislabelled-type | a PNG relabelled `image/jpeg` | magic bytes vs declared MIME |
| swapped-reference | one fixture's reference replaced with another's | decoded-pixel comparison, max abs 255 |

The third is the one that matters: the first two test integrity checks, only the third tests
the **measurement**. It used a same-dimension substitute deliberately, so the comparison could
not escape through a length mismatch.

### The permanent tests

**PASS.** 43 tests, none of which launch a browser, re-render a page, or re-capture anything.
The captured hashes are machine-bound and are treated as evidence, not as CI assertions — an
experimental stress test promoted to CI is a flaky CI test.

Two of the new tests were mutation-checked against the shipped source: changing the adapter's
format to `"jpeg"`, and deleting the format argument entirely, each fail the specific test
that owns them.

### A test that was passing while testing nothing

The native-binding assertion originally matched `/\[native code\]/` against the harness
source. It passed — on the **comment** explaining the rule, not the code, where the brackets
are regex-escaped. Caught by the comment-stripping fix, and now matched in its escaped form
with the reason written down.

---

## `privacy-security-engineer` — L1

**Status: `PASS`.**

### No new egress

**PASS.** The only network is the existing loopback collector on `127.0.0.1`, the same
mechanism QG-03, QG-03b and QG-03b-2 used, declared in the conformance extension's CSP via
the shipped `buildExtensionPagesCsp`. The reference dumps are same-origin extension reads.
Nothing leaves the machine.

### ADR-0001

**PASS.** Untouched. The conformance extension loads ORT through
`installVerifiedOrtRuntime` and `createPinnedInferenceSession` exactly as before; the
exact-byte pin and its hash are unchanged. No runtime model download, no arbitrary WASM,
no `eval`.

### Capture stays a local browser capability

**PASS.** The captured frames never leave the loopback boundary. The fixture pages are
synthetic and contain no real content, no PII, and no credentials — deliberately, because
screenshots are the highest-risk artifact this project produces and committing real ones
would be a durable mistake. 3.6 MB of captured bytes are committed as evidence; each was
reviewed for what it depicts.

### The permission deviation

**PASS, with it stated rather than buried.** The harness holds `<all_urls>`; production holds
`activeTab`, unchanged. The harness extension is throwaway, never shipped, and lives under
`artifacts/experiments/`. The deviation is recorded in the README, `environment.json` and the
report, with the measured Chromium error string that forced it.

### Invariants

**PASS.** G5 preserved. QG-04 remains **UNSIGNED**. B-02 remains **OPEN**. No T2 path, no
D3/D4. No secrets, no `.env`, no model weights committed — the ONNX artifact stays gitignored
and is referenced by hash.
