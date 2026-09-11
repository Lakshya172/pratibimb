---
id: W1-QG03a-agentos-review
experiment: W1-QG03a-t1-production-robustness
date: 2026-09-11
---

# QG-03a — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author.
> **Not a transcript of independent agents** and not presented as one. The repository has no
> live reviewer agents. Every finding below cites a file, a test or a measurement.

## `pratibimb-architect` — L1, recommends; the human decides

**Status: `CONDITIONAL_PASS`.**

**Does the robustness criterion fit the dossier and architecture?**
- **A:** yes. Bitwise identity is exactly what the preprocessing contract defines, and its
  §3 already names the trained artifact's pipeline as the authority.
- **B:** **no criterion exists that fits.** The dossier specifies none. The pre-registered
  2.0 CSS px bound belongs to conformance, not noise, and hard NMS cannot satisfy it.
  Choosing a criterion is an architecture decision. It is **raised, not taken** (QG-03a-B1).

| Output | Finding |
|---|---|
| `constitution_impact` | None. |
| `adr_required` | **No** for the A fix: it aligns the implementation with the existing authority. **Possibly yes** for any future NMS change (B3), because it would change every detection. |
| `scope_impact` | None. No QG-03a item moves into v1, and nothing is adopted. |

## `browser-engineer` — L2, blocking on the coordinate contract and execution context

**Status: `PASS`.**

**Is the production rasterisation and coordinate path actually deterministic?** Yes, now,
and measured:
- 40/40 fixtures are bitwise in Chrome 153 and Firefox 155 after the fix, with native PNG
  decode bitwise on all 40.
- Before the fix, the **same** 6 sizes failed identically in both engines and in Node. So the
  defect was deterministic arithmetic, not engine variance.
- All 36 DPR × zoom geometries were accepted, with a round trip at most 3.4e-13 CSS px.
- Zoom is never applied as a multiplier.

**Limits:** page context, not an extension context. Linux is not run.

## `ml-engineer` — L2, blocking on model adoption

**Status: `PASS` — nothing is adopted.**

**Does inference noise materially affect detector usefulness?**
- **Not established.** The mechanism is real: a survivor swap happens at any representable
  near-tie. In constructed scenes it never cost recall or moved the click point off the
  element.
- The real artifact's magnitude (47 px, workstation 1) cannot be measured here, and the
  artifact must not be regenerated. That is why B is OPEN and not closed either way.

**The label/raster mismatch** is metric-neutral at IoU 0.5 in the worst case. No retrain is
justified on its own.

**Unchanged:** threshold 0.55, the held-out split, the registry, and the detector's
UNADOPTED status.

## `performance-engineer` — L2, blocking on latency and resource claims

**Status: `PASS` — cost measured before any recommendation.**

- **The fix costs nothing measurable:** Node medians of 14.5, 21.0 and 38.0 ms at 1264×800,
  1920×1080 and 2560×1600, against 15.4, 23.1 and 39.2 ms before. That difference is run
  noise, since the change is one branch per call.
- **Figures are labelled by runtime.** Browser single runs are in `metrics.json`, and Node
  and browser figures are never mixed.
- **The dossier's 18 ms is labelled projected.** Preprocessing exceeds it at larger frames,
  so QG-03b-3 stays open.
- **No NMS change is recommended** without a model-backed measurement of both accuracy and
  cost.

## `evaluation-qa-engineer` — L2, blocking on any reported metric

**Status: `PASS`.**

**Are the experiments reproducible and protected?**
- **Reproducible.** Every number in `metrics.json` is copied from `logs/` by
  `aggregate-qg03a.mjs`. The Pillow reference proves itself by reproducing 13/13 committed
  QG-03b digests.
- **Regression-guarded.** `qg03aRobustness.test.ts` pins:
  - the exact-half table;
  - all 16 training sizes;
  - a half-even property sweep (asserting it actually hits ties);
  - the current NMS behaviour, as *characterisation*, so a mitigation must change it
    deliberately;
  - the evidence file's statuses against its own numbers.
- **The harness can fail.** The "before" run failed on exactly the predicted sizes.
- **Two defects in my own instruments were caught before publication, and are recorded:**
  1. A "kept set changed" metric that is trivially true in float64. It was replaced by
     survivor-swap detection above the coordinate-noise bound.
  2. The evaluator's empty-split refusal. It is satisfied with a placeholder, never with the
     consumed test split.
- **The historical control's two artefacts** (float32 absorption; swap-as-displacement) are
  documented, not silently corrected.

## `privacy-security-engineer` — L1, standing veto on the trust boundary

**Status: `PASS` — veto not engaged.**

- **No egress path.** The browser runs used a loopback-only server with a throwaway profile,
  and nothing left the machine.
- **Nothing security-relevant changed:** ADR-0001, the CSP, `connect-src`, the ORT pin,
  B-02, QG-04, T2, D3 and D4 are all untouched.
- The production change is arithmetic inside the local raster.
- No PII: the fixtures are procedural.

## Summary

| Reviewer | Status | Note |
|---|---|---|
| `pratibimb-architect` | CONDITIONAL_PASS | B needs a criterion decision (QG-03a-B1) |
| `browser-engineer` | PASS | page context, Windows |
| `ml-engineer` | PASS | nothing adopted; B magnitude needs the artifact |
| `performance-engineer` | PASS | fix cost negligible; 18 ms budget still exceeded at large frames |
| `evaluation-qa-engineer` | PASS | reproducible, guarded, instrument defects recorded |
| `privacy-security-engineer` | PASS | no boundary touched |
