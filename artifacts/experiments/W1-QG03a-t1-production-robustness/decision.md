# QG-03a — decision

**Classification: OPEN.** A = PASS (after one fix). B = OPEN. C = CONDITIONAL.

The three are separate questions, and none is averaged into another. The weakest decides
the gate.

## A — PASS, on the evidence, after fixing QG-03a-A1

| | |
|---|---|
| Defect | `rasterLetterbox` rounded exact-half extents UP (`Math.round`); training (`data.py`, Python `round()`) rounds them to EVEN |
| Reproduced | 6/40 fixtures, identically in Node, Chrome 153 and Firefox 155. First divergence: geometry. Up to 25.7% of tensor bytes differ |
| Minimised | a single arithmetic rule; `rasterLetterbox({w:1024,h:644})` → 403 rows, where training drew 402 |
| Root cause | a cross-language rounding difference that the contract §1 named but guarded only on fixture sizes |
| Acceptance | bitwise identity with the Pillow reference at every stage, in every runtime |
| Fix justified? | **Yes.** The authority is the trained artifact's pipeline (contract §3). The fix changes only exact-half sizes, which were measured to be wrong |
| Fix | `roundHalfEven` in `packages/perception/src/preprocess.ts` |
| Regression | `qg03aRobustness.test.ts`: the exact-half table, all 16 training sizes, and a half-even property sweep |
| Re-measured | **40/40 in Node, Chrome and Firefox**; 13/13 historical digests unchanged |

**Scope of the PASS:** Windows workstation 2, page context. Linux is UNKNOWN. The
extension-context cells remain QG-03b's (workstation 1). Performance is not part of this
verdict: preprocessing is still above the dossier's **projected** 18 ms at larger frames
(QG-03b-3).

## B — OPEN

- **Root cause:** hard greedy NMS is discontinuous at score near-ties, and at IoU, class and
  floor boundaries. Localised and reproduced minimally. In constructed and random geometry,
  the survivor's centre never left the displaced box.
- **Not decidable here.** The real-model magnitude (47 px on workstation 1) needs
  `t1-ui-head.onnx`, which is absent and must not be regenerated.
- **Criterion gap, for the architect.** The pre-registered 2.0 CSS px bound cannot be met by
  hard NMS under noise. A grounding-based criterion is proposed in the README, and **not
  adopted**.
- **No production change.** A continuous merge (DIAGNOSTIC ONLY) is ~100× more stable in
  synthetic scenes. Adopting anything like it changes every detection and needs
  re-evaluation with the model.

## C — CONDITIONAL

- The mismatch is reproduced (84/200) and bounded (≤ 0.681 model px). Worst-case mAP@0.5,
  recall and grounding are **unchanged (1.000)** on train and dev.
- **No retrain is justified on its own.** It stays debt, to bundle with the next training
  change, with the exact change already written in preprocessing-contract §6.

## Registry and gate effects

- `agentos/registry/model-registry.md`: **UNCHANGED.** The detector is UNADOPTED.
- `agentos/registry/feasibility-matrix.md`: one QG-03a row added.
- `docs/architecture/preprocessing-contract.md` §1: `round()` specified as half to even. This
  is a clarification consistent with §3's authority rule, not a new semantic.
- QG-03: **CONDITIONAL.** QG-04: **UNSIGNED.** B-02: **OPEN.** QG-05: **PARTIAL.**
- Threshold 0.55: **unchanged.** Held-out split: **not evaluated.**

## Follow-ups

| id | item | blocks |
|---|---|---|
| **QG-03a-B1** | architect decision on a noise-robustness criterion for decode/NMS | QG-03a |
| **QG-03a-B2** | measure B on the real artifact, on workstation 1 or with the artifact transferred by hash | QG-03a |
| **QG-03a-B3** | if B2 confirms material displacement: evaluate a continuous post-processing option with the model and the frozen evaluator | detector adoption |
| **QG-03a-C1** | relabel in raster geometry and retrain, bundled with the next training change | technical debt |
| **QG-03a-A2** | repeat A on Linux; Firefox Linux remains UNKNOWN | cross-platform claim |
