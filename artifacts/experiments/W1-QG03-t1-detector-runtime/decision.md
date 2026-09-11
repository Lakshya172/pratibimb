---
id: W1-QG03-decision
spike: QG-03 (S-03c)
verdict: CONDITIONAL
date: 2026-09-11
decided_by: ml-engineer + browser-engineer + performance-reviewer + privacy-security-engineer + evaluation-qa-engineer
---

# QG-03 decision — CONDITIONAL

## Verdict

**CONDITIONAL.** The T1 detector artifact **executes correctly and deterministically** in
seven of eight browser/backend/display cells, comfortably inside the dossier's latency
budget — **and it is still not adoptable**, because the preprocessing a browser can actually
perform in production changes 16–34% of its detections.

| Question | Answer |
|---|---|
| Does the session load? | **YES** — 3/3, every cell except Firefox WebGPU headless |
| Is the output numerically correct against the Python reference? | **YES** — ~100× inside the pre-registered criterion |
| Is repeated inference deterministic? | **YES** — bitwise, every cell |
| Does the shipped postprocessing and coordinate chain agree? | **YES** — 0 label mismatches, 1.1e-03 px |
| Within the lightweight budget? | **YES** on 3 of 4 backends; Firefox WebGPU is 2.9× over |
| Any runtime model download or foreign egress? | **NO** — 0 foreign arrivals, model never fetched |
| **Does it work when the BROWSER does the preprocessing?** | **NO — 16% to 34% of detections are lost** |

## The finding that decides it

Every correctness number above was obtained by handing the browser a tensor that Python had
already letterboxed. That isolates ORT's arithmetic, which is what it was for. It is not
what production does: `captureVisibleTab` returns a **PNG**, and the browser must letterbox
it with canvas resampling.

Made to do that, the best available configuration reproduces **84% / 74%** of the reference
detections on Chromium and **78% / 68%** on Firefox. Two compounding causes:

1. **Canvas resampling is not PIL BILINEAR**, and the browsers do not agree with each other
   either — Chromium honours `imageSmoothingQuality`, Firefox ignores it entirely (its low
   and high figures are bit-identical).
2. **The project has two letterboxes that disagree.** `computeLetterbox()` places content at
   a fractional offset; `tools/detector/data.py` pastes a rounded bitmap at an integer one.
   106.67 against 106 on a 960×640 capture — the model's training pixels are sub-pixel
   offset from the coordinate frame its labels live in.

The model was trained with `augmentation: "none"`, on exactly one resampler's output.

> **INFERENCE, stated as such:** this is an input-distribution robustness failure. It is not
> an ORT defect — ORT agrees to 5.6e-06 — and it is **not a capacity failure**, so it is not
> answered by a larger model.

## What this decision does

- ✅ **Fills the `UI element detector` row** of `agentos/registry/feasibility-matrix.md`, for
  **Windows only**, with all four dossier-required fields per cell.
- ✅ **Closes S-03c** — a real detector has now been measured, so latency figures for this
  model may be quoted with their cell labels attached.
- ✅ **Records `REJECT` for Firefox WebGPU headless** at release defaults. `dom.webgpu.enabled`
  was deliberately not touched; S-02a's rule makes a preference-gated result CONDITIONAL at
  best, never ACCEPT.
- ✅ **Confirms ADR-0001 works under a real workload** — the pin installed in every cell, the
  only network arrival anywhere was the pinned artifact, and the shipped
  `@pratibimb/security` module was used rather than a harness copy.

## What this decision does NOT do

- ❌ **Satisfy QG-03.** One row of twenty. The other four model rows are untouched and remain
  `UNKNOWN`.
- ❌ **Adopt the detector.** `agentos/registry/model-registry.md` is **unchanged**. Adoption
  items 9, 10, 12 and 13 are now met for the Windows cells; items **11 and 14 (acceptable
  metrics, usable grounding) are not**, and QG-03a is now a new blocker.
- ❌ **Set `acceptedBackends` on any shipped detector.** `createUiElementDetector` is still
  constructed with `null` in the product path and still reports `MODEL_ASSET_UNAVAILABLE`.
  The DOM-only floor (option C) remains the admissible configuration.
- ❌ **Say anything about Firefox on Linux.** Still `UNKNOWN`.
- ❌ **Validate the dossier's latency budget.** A 61,468-parameter model being fast is not
  evidence about a detector worth shipping. It does establish that **latency is not the
  constraint on this model**, which is worth knowing before anyone optimises it.
- ❌ **Change ADR-0001, QG-04, B-02, or QG-02 criterion 7.** All unchanged.

## Recommendation

1. **Do not grow the model.** The dev failure taxonomy and this result agree: at the
   incumbent operating point 70% of false positives overlap nothing at all (threshold
   policy), and the browser gap is resampling robustness. Neither is a capacity problem.
2. **QG-03b first — reconcile the two letterboxes.** It is a correctness question with a
   right answer, it is cheap, and every later measurement inherits it.
3. **Then QG-03a — retrain with resampler augmentation.** That invalidates the frozen
   regression baseline by design, so it needs its own change and its own re-freeze.
4. **Treat Firefox WebGPU headless as the CI cell.** It is the one that fails, and CI is
   headless. Either the WebGPU path is exercised headful in CI or it is not exercised at all,
   and the second option should be stated rather than discovered.
5. **Do not quote a single "browser latency" number.** Eight cells, four distinct answers,
   and a 9× spread between the fastest and slowest working cell.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| QG-03a | Resampler-robustness: augment training across resamplers | **p1** | **detector adoption** |
| QG-03b | Reconcile `computeLetterbox` (fractional) with `data.py` (integer) | **p1** | coordinate contract, QG-03a |
| QG-03d | Firefox WebGPU headless has no adapter at release defaults | **p1** | CI coverage of the WebGPU path |
| QG-03c | Firefox WebGPU 8.6× slower than Chromium WebGPU, same graph and machine | p2 | backend guidance |
| QG-03e | `release()` returned no memory in any cell; behaviour at four models | p2 | Rule 6 landmine |
| QG-03f | Chromium selects the integrated GPU (= S-01a) | p3 | WebGPU figure labelling |

## Registry effect

- `agentos/registry/feasibility-matrix.md` — **EDITED.** The `UI element detector` row is
  filled for the Windows cells, and the S-03c follow-up is marked answered.
- `agentos/registry/model-registry.md` — **UNCHANGED.** The detector is not adopted.
- `docs/security/security-invariants.md`, `docs/architecture/constitution.md`,
  `artifacts/adr/ADR-0001/` — **UNCHANGED.**
- `agentos/blockers.md` — **UNCHANGED** here; QG-03a/b/d are recorded in the matrix.

> This project has twice had a `decision.md` assert a registry effect that was never made.
> The matrix edit in this PR is the only registry change, and it is visible in the diff.
