---
id: T1-detector-fusion-agentos-review
workstream: T1 UIElementDetector + DOM/vision fusion
date: 2026-09-10
branch: feature/t1-detector-head-and-fusion
---

# T1 detector + fusion — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author.
> **Not a transcript of independent agents** and not presented as one.

---

## `pratibimb-architect` — L1

**Status: `PASS`, with one correction raised against the brief.**

**RAISED — the workstream was labelled D3/D4, and that label is already taken.** The dossier
defines D1–D4 as the four **PII redaction channels** (D3 semantic NER, D4 visual: faces,
signatures, ID cards, QR) feeding the fail-closed union and the redaction manifest — whose
schema serializes `"detectors": ["D1","D2"]`. Those are **T2**, which is explicitly on hold.

The work actually described — DOM graph + screenshot → visual detector → fusion →
`PerceptionState` — is the **T1 `UIElementDetector`**, the week-3 *"own detector head starts
here regardless"* path. It was built as described and named for what it is. Naming it `D4`
would have collided with a frozen manifest field and corrupted the project's vocabulary at
exactly the point where the redaction tier is about to need it.

**No ADR required.** Everything implemented follows an existing frozen contract:
constitution §7 (IoU > 0.5 fusion, DOM and vision fused not alternatives), §8 (the detector
role and its ranked options), and the coordinate contract. The letterbox space is an
addition *beneath* the canonical space, not a change to it.

**Scope held.** No T2, no vault, no server, no executor, no UI.

---

## `ml-engineer` — L2, blocking on model adoption (QG-03)

**Status: `PASS`. No model adopted, and the registry is unchanged.**

| Obligation | Finding |
|---|---|
| No model accepted on documentation | **Honoured.** No weights exist, so nothing was accepted. |
| Per-cell status authoritative | **PASS.** Option A stays licence-excluded; SmolVLM untouched; PP-OCRv5 untouched and not used to inflate detector coverage. |
| Registry not silently changed | **PASS.** Zero edits to `model-registry.md`. |
| No runtime model downloads | **PASS**, asserted structurally — a test fails on any model URL in the package. |

**RAISED — the tensor contract is a commitment, and it was chosen to preserve optionality.**
It matches option A's (YOLO-family, 640 square, anchor-free `[1, 4+C, A]`) so that if the
`icon_detect_v3` licence question is ever resolved **in writing**, A becomes a weights swap
rather than a rewrite of perception orchestration. Building B against a bespoke contract
would have burned that option for no benefit.

**RAISED — this is not benchmark-complete and must not be described as working.** The
prescribed metric is element mAP@0.5, element recall and grounding accuracy over
ScreenSpot-v2 plus 300 self-labelled screens, on clean and redacted frames. That is QG-05.
Neither the harness nor the labelled data exists.

**RAISED — the thresholds are provisional and are marked so in code.** `score: 0.25` and
`nmsIou: 0.5` come from no project evidence. The NMS IoU is pinned to the frozen fusion
threshold deliberately: if NMS merged more aggressively than fusion matches, the head would
suppress a box fusion would have paired with a DOM node, and that element would silently
become DOM-only.

**QG-03 unaffected. No model entered the build.**

---

## `browser-engineer` — L2, owns QG-02

**Status: `PASS`. QG-02 unchanged.**

| Obligation | Finding |
|---|---|
| CSS viewport pixels remain canonical | **PASS.** The letterbox space sits beneath it; the chain is model → capture → CSS, both hops explicit, and capture → CSS is still owned solely by `coordinates.ts`. |
| Existing conversion reused, not reimplemented | **PASS.** `letterbox.ts` handles only model ⇄ capture. |
| The six-configuration invariant survives the new space | **PASS.** Re-tested with the tensor space in the middle: the same element resolves to the same CSS box at all six DPR/zoom settings. |
| Criterion 7 not falsely passed | **PASS.** Still CONDITIONAL; no executor exists. |

**RAISED — the padding offset is the highest-risk arithmetic added by this work.** At
1024×640 into a 640 square the vertical padding is 120 model px; omitting the un-pad puts
every box ~190 CSS px too low. It does not crash and looks unremarkable in a log. A test
asserts the *wrong* value specifically, not merely the right one. Unpadding after unscaling
rather than before is a second, quieter variant of the same bug and is also tested.

**RAISED — Firefox is CI-only on this workstation**, as for QG-02. Recorded, not inferred.

---

## `privacy-security-engineer` — L1, standing veto

**Status: `CONDITIONAL_PASS`. Veto not waived; none sought.**

### `invariants_checked`

| Check | Finding |
|---|---|
| G5 rules 1–3: no network, no compilation | **PASS.** The G5 source scan covers the new modules automatically and still passes: no `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, `WebAssembly.compile`, `new Function` or `eval` anywhere in `packages/perception`. |
| G5 rule 4: observations do not become payloads | **PASS.** `SanitizedHandoff` still has no pixel-bearing field and there is still no constructor for one. |
| G5 rule 5: no insecure fallback | **PASS.** A detector without weights refuses; it does not degrade to an unvalidated path. No fallback chain exists. |
| No new runtime authority | **PASS.** The head takes `infer` and `preprocess` as injected functions. This package never imports ORT. The ADR-0001 pinned session stays the only route to WebAssembly. |
| No model URLs | **PASS**, asserted by test. |

### `findings`

- **MAJOR, carried forward and now pinned by test — the accessible-name hazard.**
  `aria-label="Aadhaar 1234 5678 9012"` can sit in a local `PerceptionState` today. That is
  safe **only** because nothing can construct a handoff. `t2Boundary.test.ts` now asserts
  the name is preserved **unmasked**, that no handoff constructor exists, that `verified` is
  typed as the literal `false`, and that these modules have no network capability.

  **Redacting inside perception was explicitly not done.** It would create a second,
  undocumented redaction path that the real sanitize tier — which owns D1–D4, the
  fail-closed union and the manifest token format — would later have to discover and
  reconcile. A partial mask would be worse than none: it looks handled, so nobody checks.

- **MINOR — model identity is now part of provenance.** Without it, swapping weights
  silently rewrites the meaning of every stored observation. A box from an untrained head
  must stay distinguishable from one produced by a benchmarked model.

### `residual_leakage`

**NOT MEASURED, and still not measurable.** No redaction engine, vault or egress module
exists.

### `next_action`

**QG-04 remains UNSIGNED. B-02 remains OPEN.** T2 remains the correct owner of the name
hazard.

---

## `performance-engineer` — L2

**Status: `PASS`, with everything deferred honestly.**

| Obligation | Finding |
|---|---|
| No number quoted without measurement | **PASS.** No latency or memory figure is claimed, because there are no weights to run. |
| Detector workload benchmarked | **NOT DONE, and not possible yet.** Recorded rather than estimated. |
| Fusion cost | **Not benchmarked.** Matching is O(nodes × detections); the head caps detections at 300 per frame so a degenerate model cannot flood fusion. That cap is a guard, not a measurement. |

**RAISED — the 300-detection cap and both thresholds are provisional.** They bound worst-case
behaviour; they are not tuned values and no performance claim rests on them.

---

## `evaluation-qa-engineer` — L2

**Status: `PASS`.**

234 perception tests, 270 across the workspace. Weighted toward refusals: malformed tensors,
wrong channel counts, non-finite values, scores above 1, padding-only detections, stale
frames, unsupported backends, absent weights.

**Observation — the end-to-end gate asserts the typed state, not screenshots.** A screenshot
comparison would confirm the page rendered and say nothing about whether provenance survived
fusion, which is the only property this layer exists to provide.

**Observation — the fixture is built around what makes fusion hard**, not around what makes
it pass: three repeated cards, two visually similar buttons, a checkbox nested inside its own
clickable label, a control straddling the fold, a dynamic region, and an off-screen target.

**RAISED — determinism is asserted twice**, in unit tests and again on real browser data,
because a fusion that reordered under hash-map iteration would make every downstream test
flaky for reasons nobody could reproduce.

**RAISED — the detector half has no quality evidence at all**, and this review does not treat
"the contract is tested" as "the detector works". Those are different claims.
