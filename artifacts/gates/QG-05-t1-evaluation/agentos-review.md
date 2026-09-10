---
id: QG-05-t1-evaluation-agentos-review
workstream: QG-05 T1 visual-context evaluation harness
date: 2026-09-10
branch: feature/qg05-t1-evaluation-harness
---

# QG-05 T1 evaluation harness — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author.
> **Not a transcript of independent agents** and not presented as one.

---

## `evaluation-qa-engineer` — L2, **owns QG-05**

**Status: `CONDITIONAL_PASS` on infrastructure. The gate as a whole is NOT passed.**

| Obligation | Finding |
|---|---|
| The harness reports all five scored metrics plus task success | **NOT MET, and cannot be.** One of six is implemented. The other five need T2, the server or the executor. |
| Every figure labelled `measured` or `projected` | **PASS**, enforced in the TYPE. A `Figure` cannot be constructed without its status, so the reporting layer — where such conventions get dropped — cannot drop it. |
| Visual context reported twice, clean and redacted | **HALF.** Clean frames only. Redacted frames need T2. |
| Synthetic generator produces ground-truth boxes | **PASS.** |
| Decoy generator exists | **NOT MET.** Decoys are a PII-precision instrument and belong to T2. |
| Adversarial / false-positive / disagreement sets | **NOT MET.** Same reason. |

**RAISED — the most valuable single result is the 10 px shift.** Recall falls to 0.70 from a
ten-pixel error, because IoU is *(w−dx)/(w+dx)*: a 16 px checkbox scores 0.23 while a 130 px
button scores 0.86. **The metric is size-sensitive, and small controls will dominate any
future detector's failures.** That is a fact about the task worth knowing before a model
exists, and it is the kind of thing that would otherwise be discovered by a mysterious
plateau three weeks into training.

**RAISED — the evaluator was built before the detector on purpose.** A metric invented after
seeing a model's output is a metric chosen to flatter it.

**Observation.** The baselines are named for what they are. `BASELINE-perfect-passthrough
(NOT A DETECTOR)` is deliberately awkward: a number carrying that string cannot be quoted as
model accuracy by accident.

---

## `ml-engineer` — L2, blocking on model adoption (QG-03)

**Status: `PASS`. No model adopted; the registry is untouched.**

| Obligation | Finding |
|---|---|
| Registry not changed | **PASS.** Zero edits. Building an evaluator is not grounds to register a model. |
| No runtime model downloads | **PASS**, asserted by source scan — no model URL, no HuggingFace host. |
| Metrics are the prescribed ones | **PASS.** Element mAP@0.5, element recall, grounding accuracy. |
| The AP convention is recorded | **PASS.** All-point interpolated (COCO), not 11-point VOC. Both are called "mAP@0.5" in the wild and they differ by a few points, so the choice is written down rather than left implicit. |

**RAISED — the shortcut deliberately not taken.** Precision-and-recall at a single threshold
is much easier and much weaker: it cannot distinguish a detector that ranks true positives
highly from one that emits them in arbitrary order, which is the entire purpose of a
confidence score. A test asserts a well-ranked prediction set outscores a badly-ranked one
with *identical boxes*.

**RAISED — synthetic performance is not real-world performance**, and the type system carries
that distinction: every synthetic sample is stamped `provenance.kind === "SYNTHETIC"`. The
dossier's evidence source is ScreenSpot-v2 plus 300 self-labelled Indian government and
banking screens. Until those exist, no accuracy claim about a detector is possible from this
harness — only claims about the harness.

**RAISED — the detector adoption bar is now written down** in the gate README: licence,
source, revision, artifact hash, size, architecture and tensor-contract compatibility,
preprocessing and postprocessing, browser/backend feasibility per QG-03, reproducibility,
then evaluation on the held-out split with thresholds from dev.

---

## `browser-engineer` — L2

**Status: `PASS`. QG-02 unaffected.**

| Obligation | Finding |
|---|---|
| Canonical space unchanged | **PASS.** Ground truth is stored in CSS viewport pixels. A private dataset space would be a second coordinate model with an untested conversion at every comparison. |
| Existing primitives reused | **PASS.** No transform logic is duplicated; the evaluator imports `coordinates.ts` and `letterbox.ts`. |
| The six configurations re-tested | **PASS**, through the evaluator's own IoU. |
| Previously-found bugs stay guarded | **PASS.** Both the doubled-zoom error and the forgotten letterbox un-pad are now detectable *through the metric*: each drops IoU below 0.5 against correct ground truth. |
| Real browser labels | **PASS.** 12 annotations derived from the browser's own layout pass the same validator as synthetic ones. |

**RAISED — the DOCTYPE lesson holds.** The reused T1 fixture retains its `compatMode`
assertion; in quirks mode `documentElement.clientHeight` is not the viewport, and every
derived label would be wrong in a plausible-looking way.

---

## `privacy-security-engineer` — L1, standing veto

**Status: `PASS` for this change. Veto not waived; none sought.**

### Explicit confirmations requested by the brief

1. **No new egress path exists.** The evaluation package contains no `fetch`,
   `XMLHttpRequest`, `sendBeacon`, `WebSocket` or `EventSource`, and imports nothing from
   `node:http`, `node:https`, `axios` or `node-fetch`. Asserted by a source scan with a
   control test proving the scan actually finds files — a scan over an empty list passes
   every rule while proving nothing.
2. **Raw T1 data remains local.** The evaluator reads geometry and class labels. It never
   touches frame pixels, never constructs a `SanitizedHandoff` (asserted), and never sets
   `verified: true` (asserted).
3. **D3/D4 privacy work has NOT leaked into this implementation.** Asserted directly: no
   source file may contain `redact`, `GLiNER`, `Verhoeff`, `Luhn` or a `<PII:` token.
   Sanitizing inside the evaluator would create a second, undocumented redaction path that
   the real sanitize tier would later have to discover and reconcile.

### `findings`

- **MINOR — the harness derives labels from accessible names and geometry.** It stores class
  and box only, not names, so the accessible-name hazard does not widen. The T1
  `PerceptionState` still holds unredacted names, still cannot leave, and
  `t2Boundary.test.ts` still pins that open.

### `residual_leakage`

**NOT MEASURED, and still not measurable.** No redaction engine, vault or egress module.

### `next_action`

**QG-04 remains UNSIGNED. B-02 remains OPEN.** This work is not QG-04 and does not approach
it.

---

## `performance-engineer` — L2

**Status: `PASS`, with nothing claimed.**

No latency or memory figure is produced, because there is nothing to run. The evaluator's
own cost is O(predictions × ground truth) per class per sample and is not benchmarked;
that is honest rather than optimistic, and no performance claim rests on it.

**RAISED — the harness is the instrument that will eventually produce the latency and
resource tables**, and those tables have QG-05 requirements this slice does not touch: p50
**and** p95 for every stage, **peak** rather than mean for heap/GPU/CPU, cold and warm start
reported separately, and every table labelled with backend and hardware.

---

## `pratibimb-architect` — L1

**Status: `PASS`.**

**Terminology corrected once, globally.** The previous slice called T1 work "D3-equivalent"
and "D4-equivalent". Three genuine mislabels were fixed; every other D3/D4 reference in the
repository was audited and **left alone**, because each is a legitimate privacy reference —
the `privacy-security-engineer` contract, `security-invariants.md`, `action-schema.md`,
`benchmark-contract.md`, the AgentOS week plan, the git-workflow tag table and
`t2Boundary.test.ts`. Correcting a term is cheap; corrupting a frozen taxonomy on the eve of
the tier that depends on it is not.

**Process incident recorded.** The unauthorized force-push that moved the `v0.2.2` tag is
now in `docs/operations/git-workflow.md` §5.1 with what happened, what was and was not
affected, and why it was wrong despite a correct outcome. Moving a published tag is named
explicitly in the forbidden list, because "force-push" was evidently read as being about
branches. No compensating action was taken — reverting would require a second force-push.

**No ADR required.** Nothing deviates from the dossier; QG-05's metrics are implemented as
specified.

**Scope held.** No T2, no D3/D4, no server, no executor, no vault, no UI. The two-part gate
structure keeps "the evaluator works" from ever being read as "the detector works".
