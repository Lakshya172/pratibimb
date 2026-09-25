# M7 — visual text: the inventory, the criteria, and the floor

> **FOLLOWED UP BY [`M7.1`](M7.1-ppocrv5-det-validation.md), 2026-09-25.** The owner approved option A;
> the pinned detector was reconstructed and validated. **WASM correctness on realistic input: PASS
> (4.23e-06).** **Text-region quality: FAIL** on pre-registered localisation (IoU 0.427 / 0.365).
> **`PP-OCRv5_mobile_det` is `REJECTED FOR V1`.** This record describes M7 and is left as written.

> **W1, 2026-09-25.** The evidence-first opening of the visual-text workstream.
>
> **Nothing was downloaded. No model was adopted. No threshold was moved.** The one candidate in the
> repository is still **BLOCKED**, and this milestone establishes *why it cannot even be re-measured
> on W1 today*, what a candidate would have to prove, and — measured rather than assumed — what the
> shipped detector can currently do about text the DOM cannot describe.
>
> **The answer to the milestone's question is: not yet, and here is the number.**

- **Cell:** Chromium 1243 (`chrome-win64`), headed · degraded build (`M3_WORKER_FRAME=1`), because a
  frame is needed and no harness can produce the human invocation `activeTab` requires
- **Criteria:** [`docs/perception/text-region-acceptance.md`](../../../docs/perception/text-region-acceptance.md)
  — **pre-registered and committed before this screen was written**
- **Harness:** `tests/browser/extension/run-text-region-eval.mjs`
- **Log:** [`logs/w1-text-region-screen.json`](logs/w1-text-region-screen.json)
- **Predecessors:** [`M5 text-region audit`](../M5-gesture-loop/text-region-audit.md) ·
  [`M4 OCR audit`](../M4-gesture-text-perception/ocr-audit.md) ·
  [`W1-S04a-1`](../W1-S04a1-four-model-residency/README.md)

## Hypothesis

That the visual-text question could be advanced by **evidence rather than by integration**: that an
inventory, a pre-registered criterion and a measured floor would say more about whether PratiBimb
can protect visually rendered secrets than adopting the only available model would.

**What would falsify it:** a second legitimate candidate found in the tree; a criterion that could
only be written after seeing a result; a floor measurement that turned out to depend on a threshold
chosen afterwards.

## Environment

| | |
|---|---|
| Detector present on W1 | `pratibimb-t1-ui-head` @ `ba6d9e93695b`, weights sha256 `ba6d9e93695b…`, 302 960 B |
| Detector classes | button · link · textbox · checkbox · radio · select · tab · icon — **no text class** |
| OCR artifacts on W1 | **none.** `artifacts/models/` contains `t1-ui-head` and nothing else |
| Python toolchain | `onnxruntime` 1.20.1 ✅ · `numpy` ✅ · `PIL` ✅ · **`paddle2onnx` MISSING** · **`paddle` MISSING** |
| Network | reachable; HuggingFace answers for the pinned revision |
| Fixture | `tests/browser/extension/fixture/visual.html`, extended with text ground truth |

## Expected result

1. The tree contains no text-region candidate beyond the one already recorded.
2. Criteria can be written from frozen rules plus stated choices, before any result.
3. The shipped detector cannot localise the canvas identifier — and the screen will say by how much.

## Part D — the candidate inventory

Searched the whole tree for every name the capability could hide under: `EAST`, `DBNet`, `CRAFT`,
`TextSnake`, `PSENet`, `FCENet`, `scene text`, `text detection`, `text region`, `character region`,
`docTR`, `PaddleOCR`, `tesseract`, `easyocr`, `mmocr`.

**Every hit is prose** — the search terms echoed back from M4's and M5's own audits, plus one
architectural note that PP-OCRv5 det is *"DBNet-style segmentation"*. There is no second candidate,
no unlisted artifact, and no `TextRegion` producer anywhere in `packages/`, `apps/` or
`artifacts/models/`. **The inventory is unchanged since M5.**

### The one candidate, and the one that passes but is the wrong shape

| | **PP-OCRv5_mobile_det** | **PP-OCRv5_mobile_rec** |
|---|---|---|
| Role | text **detection** — regions, no characters | text **recognition** — characters |
| Revision | `0d63e78e2b680928f6b1747d76a08db6e645efb7` | `682f20538d8c086cb2128e5cfac775e6c4904e85` |
| Licence | **Apache-2.0**, re-verified at the pinned revision on 2026-09-25 via the HF revision API | **Apache-2.0**, verified 2026-09-09 |
| Artifact | 4.60 MB ONNX, **produced by `paddle2onnx` conversion** | 16.56 MB ONNX, same conversion route |
| sha256 | `5f353dec11fcfc7c6dc35e066eff2a047b584d9d1ed61b3deb8c0d31e164705b` | `e0c89a163abe16e1d6b2bda5b29dc09703037f437de302f571da10e4070152d6` |
| Runtime | ORT Web, dynamic shapes, 502 nodes | ORT Web |
| Output | sigmoid probability map → **geometry only, no plaintext** | **character sequences** |
| **WASM correctness** | ❌ **4.12e-02** vs the frozen 2e-02 | ✅ **5.51e-06** |
| WebGPU | ✅ 4.96e-03 | ✅ |
| Load / inference (W1) | 474 ms / **234 ms** | — |
| Memory | heap 23.1 MB, solo peak 69.2 MB, **+7.1 MB** marginal beside the UI head | — |
| Present on W1 | **No** | **No** |
| **Verdict** | **BLOCKED** — fails the frozen WASM criterion | **ARCHITECTURALLY REJECTED** — see below |

**The repository's only wasm-passing text model is the one the architecture forbids.** `ocr_rec`
emits characters, and the preferred path — `PIXELS → REGION → REDACT` — exists precisely so that
plaintext never has to cross from the pixel realm to the vault realm. Adopting it would rebuild the
M2 realm-boundary problem in order to protect against it. That is an architectural rejection, made
independently of its excellent correctness number.

### **New finding: the blocked candidate cannot be re-measured on W1 today**

M5 recorded the next step as *"re-run the S-04a-1 criterion for `ocr_det` under realistic input"* and
treated it as a measurement anyone could take. It is not, on this machine.

The pinned HuggingFace revision was queried directly. Its file list is:

```
.gitattributes · README.md · config.json · inference.json · inference.pdiparams · inference.yml
```

**There is no ONNX file at the pinned revision.** The artifact S-04a-1 measured was produced locally
by `paddle2onnx` from those Paddle inference files, and it was not retained — the weights are
git-ignored and absent. Reproducing it requires installing **`paddle2onnx` and `paddle`**, neither of
which is present, both of which are substantial, and adding either is a **dependency decision under
`AGENTS.md` §4.6** rather than a step in a measurement.

So the blocker is now one level deeper than M5 recorded it, and it is named precisely:

> **S-04a-1a cannot be run on W1 until an owner decides whether `paddle2onnx` may be installed** —
> or until the conversion output is obtained some other way whose provenance can be pinned.

Substituting a pre-converted ONNX from a third-party repository would be a **different artifact**
with different provenance, i.e. a new candidate requiring its own licence verification and its own
QG-03 row. It is recorded here as an option, not taken.

### What would still be worth measuring, and why the number may move

**INFERENCE, labelled as such.** S-04a-1's own analysis says the 4.12e-02 comes from a *saturated*
output: the synthetic input contains no text, every value is ~1e-6, the pre-sigmoid logits sit near
−14.4, and the 4.12% is the exponential amplifying a **0.29% logit difference** (web −14.4669 vs
native −14.4248). On an input that actually contains text the output would not be saturated, so the
relative error would very plausibly fall. That is exactly why S-04a-1a was filed **p1**.

**It remains an inference.** No measurement has been taken, the criterion is unchanged, and the
candidate stays **BLOCKED** until one is.

## Part F/G — the criteria and the fixture

Criteria pre-registered in
[`docs/perception/text-region-acceptance.md`](../../../docs/perception/text-region-acceptance.md) and
committed **before** this screen was written. Two are quoted from frozen rules (the S-04a-1 WASM
bound; the constitution's IoU > 0.5) and two are chosen with their reasons stated (95% containment;
a 3× flood bound). **No latency threshold was set**, because the only number available to set one
from is the candidate's own 234 ms.

The fixture gained ground truth for the text **inside** the canvas. `visualOnly` was the whole
canvas, which collapses *"did it find the text?"* into *"did it find the canvas?"* — a question any
flooding detector passes by accident. Four regions, **two sensitive and two not**, measured by the
code that drew them (`measureText`, `actualBoundingBoxAscent/Descent`) and converted to viewport
space through the canvas's own scale. Nothing is estimated from font metrics.

The addition is **additive**: `targets`, `visualOnly` and `empty` are untouched, and the M3.1
evaluation reproduces identically afterwards — 6400 anchors → 63, `reference` IoU 0.621,
`privacy-link` 0.646, 20 detections inside the canvas at best IoU 0.066, `lede` 9, `status` 1.

## Actual result — the floor, measured

**VERDICT: SCREEN NOT PASSED.** Two readings, because one would be unfair.

### Strict — only detections whose class is a text class

| region | chars | best IoU | union coverage | localised | covered |
|---|---|---|---|---|---|
| `identifier` | 14 | **0** | **0** | no | no |
| `holder-name` | 12 | **0** | **0** | no | no |

**The set is empty by construction.** The UI head has no text class: its labels on this page are
`button`, `link`, `tab`, `textbox` — and `textbox` is an input control, not rendered characters.
Treating it as one would be the harness inventing a capability the model does not claim.

### Generous — every one of the 63 detections treated as a text candidate

The most favourable reading the current model can be given.

| region | chars | best IoU | union coverage | localised (≥0.5) | covered (≥0.95) |
|---|---|---|---|---|---|
| `identifier` | 14 | **0.423** | **1.000** | **no** | yes |
| `holder-name` | 12 | **0.142** | **0.707** | **no** | **no** |

| flood | value | bar |
|---|---|---|
| detections inside the canvas | 24 | — |
| predicted area inside canvas | **86 611 px²** | — |
| true text area | 7 373 px² | — |
| **ratio** | **11.75×** | ≤ 3× |
| widest single box | 0.066 of the canvas | < 0.9 |

**All three criteria fail, under the generous reading.** The identifier's 1.000 coverage is not a
success: it is the flood. Twenty-four boxes covering 11.75× the true text area will cover almost
anything, and the second sensitive string — `holder-name` — is still **29% uncovered** even so. A
redaction built on this would leave a third of a person's name showing.

### Criterion 6 — determinism · **PASS**

Two consecutive runs, same build, same machine: `detections`, `readings` and `groundTruth` all
**byte-identical**. Only wall-clock timings differ (total 273 ms and 247 ms).

### Criterion 7 — latency and memory, recorded as data

| stage | run 1 | run 2 |
|---|---|---|
| capture | 80 ms | 58 ms |
| decode | 27 ms | 26 ms |
| preprocess | 69 ms | 57 ms |
| **infer** | **95 ms** | **104 ms** |
| fuse | 2 ms | 2 ms |
| **total** | **273 ms** | **247 ms** |

Artifact 302 960 B. The candidate's 234 ms inference would roughly **double** a pass — recorded, and
not used as a criterion, for the reason the acceptance document gives.

## Parts E/H — the privacy architecture, designed and NOT YET VERIFIED

```
RAW PIXELS (offscreen realm, live ImageBitmap)
  → LOCAL TEXT-REGION DETECTOR       boxes + score. NO CHARACTERS AT ANY POINT.
  → LOCAL SENSITIVITY POLICY         which boxes must not leave
  → REDACTION REGION                 opaque fill, composited in the realm that holds the pixels
  → SANITIZED CONTEXT                what the reasoner is given
```

The seam already exists and is unchanged: `TextFinding` is `{ box, length, piiClass, ref }` with
**no field for characters**, and `perceiveText(null, …)` returns `TEXT_PERCEPTION_UNAVAILABLE`.

**Nothing of this is verified, because no producer exists.** What can be stated is structural: a
region detector needs no vault entry, produces no string, and crosses no realm boundary with
anything sensitive. The privacy test in Part H is **NOT YET VERIFIED** and will stay so until a
candidate can run.

**The canvas identifier remains neither read nor protected.** That was true at M4, at M5 and at M6,
and it is still true — now with a number attached to how far the shipped detector is from changing
it.

## Part I — the T1 UI detector: untouched

No threshold moved, no class filtered, no box dropped, no retraining. Its limitations are restated
rather than re-measured: UI-region semantics, no text class, no PII semantics, and a known flood
(QG-05: 3947 predictions for 202 ground-truth buttons). Improving it is a **separate** model-quality
workstream.

## Quality gates

| gate | result |
|---|---|
| `npm test` | **1459 passed** / 0 failed / 15 skipped, exit 0 |
| `npm run typecheck` | **0 errors**, exit 0 |
| `verify-repo.py` | PASS |
| `pin:check` | OK |
| extension build | green, all three configurations |
| M3.1 detector evaluation | **reproduces identically** after the fixture change |
| text-region screen | **NOT PASSED**, deterministic across two runs |

## Conclusion

| | |
|---|---|
| **ARCHITECTURAL INVARIANT** | region-detection over recognition; no plaintext crosses the pixel/vault boundary; the `TextFinding` seam has no character field |
| **EXPERIMENTALLY VERIFIED** | the floor — the shipped detector has no text class, and even counting every detection as text it localises neither sensitive string and floods at 11.75× |
| **CONDITIONAL / EXPERIMENTAL** | every number about the UI head, unchanged |
| **DEFERRED** | `PP-OCRv5_mobile_det` — BLOCKED by the frozen WASM criterion, and now also by a dependency decision |
| **REJECTED** | `PP-OCRv5_mobile_rec` for this role — architecturally, because it emits characters |
| **NOT YET VERIFIED** | the whole privacy path for visual text; no producer exists to run it |

**Not claimed:** production readiness, that any model was evaluated, that the criterion will be met,
or that visually rendered secrets are protected today. **They are not.**

## Reproducibility

```bash
M3_WORKER_FRAME=1 npm run build -w @pratibimb/extension
CHROME_PATH="<chromium 1243>" node tests/browser/extension/run-text-region-eval.mjs
CHROME_PATH="<chromium 1243>" node tests/browser/extension/run-detector-eval.mjs   # unchanged
```
