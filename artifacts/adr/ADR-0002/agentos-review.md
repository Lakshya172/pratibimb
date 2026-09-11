---
id: ADR-0002-agentos-review
adr: ADR-0002
date: 2026-09-11
branch: feature/qg03b2c-capture-format-policy
base: 0aad4f00973b3ab56ae7c1fd9187e3feaa6f73e7
---

# ADR-0002 / QG-03b-2c — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author.
> **Not a transcript of independent agents** and not presented as one. The repository has no
> live reviewer agents and no automated reviewer artifacts. Each role is its written
> contract, and every finding below cites the file, test or measurement it rests on.
>
> The brief named "performance-reviewer" and "qa-reviewer". The contracts that exist are
> **`performance-engineer`** and **`evaluation-qa-engineer`**, and those are applied here.

Scope: the T1 capture-format policy only. That covers `packages/perception/src/capture.ts`,
`packages/perception/src/index.ts`, the new `packages/perception/test/capturePolicy.test.ts`,
ADR-0002, and the matrix, contract and state notes that record it.

---

## `pratibimb-architect` — L1, recommends; the human decides

**Status: `CONDITIONAL_PASS`.** The condition is human approval of ADR-0002.

| Output | Finding |
|---|---|
| `constitution_impact` | **None now.** §5 names the capture mechanism, not its encoding. The dossier mandates no capture encoding (verified against the extracted text: PNG and JPEG are never mentioned; WebP appears only as the T2 egress frame). On approval, §5's capture row gains "PNG, explicit (ADR-0002)" per amendment step 6. It is **not** edited in this PR. |
| `adr_required` | **Yes, and written:** ADR-0002, `PROPOSED`. It is not approved here; no agent approves its own ADR. |
| `scope_impact` | **Scope shrinks.** One production capture format instead of two, and one robustness dimension (compression) leaves QG-03a's T1 scope. Nothing moves into v1. |

**Is PNG-only an appropriate explicit product policy?** Yes. It states what production
already did (E1), removes an unstated dependency on a browser default (E2), and is reversible
by a single revert (§12).

**Does it distort the architecture?** No. The frozen interfaces are unchanged:
`UIElementDetector` is still "screenshot in, boxes out". The narrowed `CaptureFrame.format`
is an internal perception type, not a §3 frozen interface. The T1/T2 boundary is made
**more** explicit (ADR §9), including the `manifest.capture.format: "webp"` naming hazard.

**Must-refuse check:** no frozen contract changed without an ADR; no dependency added;
justified by measurement, not preference; no AgentOS in runtime; no scope growth.

---

## `browser-engineer` — L2, blocking on execution context (owns capture)

**Status: `PASS`.**

| Question | Finding | Evidence |
|---|---|---|
| Does `captureVisibleTab({format:"png"})` establish an explicit production format? | **Yes.** The adapter makes exactly one call, deep-equal to `{format:"png"}`. It has no omitted format and no `quality`. | `capturePolicy.test.ts` › "calls captureVisibleTab exactly once…" |
| What happens when the format is omitted? | **Chromium returns JPEG**, byte-identical to `{format:"jpeg"}`. It does not raise and does not fall back to lossless. **Measured on Chromium 151, workstation 1.** Not re-measured on workstation 2; no new browser run was needed for a policy decision. | W1-QG03b-2a `metrics.json` → `capture.apiSurface.omitted` |
| Is omission distinguishable from the policy in tests? | **Yes.** The modelled default returns JPEG, and the adapter against the same model yields PNG. Mutation **M2** (omit the format) fails 6 tests. | `capturePolicy.test.ts`; `artifacts/adr/ADR-0002/README.md` |
| Are metadata and MIME semantics consistent? | **Now enforced.** `decodeDataUrl` refuses a MIME label the bytes' signature contradicts (PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`). The frame's `format`, bytes, size-probe input and geometry are asserted to agree. | M3 fails 3 tests |
| Rate limits or "free capture" assumed? | **No.** Throttle classification and `minCaptureIntervalMs` are untouched, and no retry was added. | `captureThrottle.test.ts` unchanged, passing |

**Recorded limitation:** Firefox's own `captureVisibleTab` output has never been measured, in
either format (ADR E11). PNG-only halves that open matrix without closing it.

---

## `ml-engineer` — L2, blocking on model adoption (QG-03)

**Status: `PASS` — this is not an adoption decision, and none is made.**

**What does the JPEG sensitivity mean for the current T1 detector?** It is measured
(W1-QG03b-2): on Pillow-encoded fixtures the detector keeps 96–98% of detections at JPEG q95
and only 91–92% at q62. The model was trained with `augmentation: "none"`. A JPEG capture path
would therefore carry a known, unmitigated accuracy cost. Detection retention at Chromium's
own default (q90) was not separately reported in the evidence read for this review, and no
number is invented for it.

**Does PNG remove a meaningful source of variation?** Yes. It removes lossy compression, with
decoded differences up to max abs 104–142 against the PNG capture of the same paint.

**What PNG does not do**, stated so it is not over-read:
- It does **not** fix NMS ordering sensitivity (QG-03a-4). The QG-03b-2a outlier arose on a
  **bitwise-identical tensor** and moved with the execution provider, not the input.
- It does **not** make the detector good. Held-out figures stay as recorded: mAP@0.5 0.7955,
  recall 0.9229, grounding 0.0547 under the old rule. The threshold stays **0.55** under the
  frozen DEV rule max F1(recall, grounding). The held-out split was not touched.
- It does **not** adopt anything. `model-registry.md` is unchanged, and the detector is
  **UNADOPTED**.

---

## `performance-engineer` — L2, blocking on latency and resource claims

**Status: `CONDITIONAL_PASS`.** No new latency claim is made, and the one tradeoff is stated
against JPEG's favour.

| Obligation | Finding |
|---|---|
| **Acknowledge JPEG was faster** | **Yes, and prominently.** Median of 20 calls: **JPEG 21.5 ms vs PNG 37.0 ms headful, 19.7 vs 37.7 ms headless.** JPEG captures 15.5–18.0 ms faster. **Measured, workstation 1, Chromium 151 only.** |
| Is that enough benefit to justify a two-format matrix? | **Not on present evidence.** (1) Cadence is bounded by the browser quota at 500 ms safe spacing (W1-S05-rate), so encode time is not the throughput limiter. (2) At ~8 captures per task (constitution §7), the saving is ~124–144 ms per task: **INFERENCE, projected**, not measured end to end. (3) Neither format meets the dossier's **projected** 18 ms "capture + downscale" budget on capture alone, so JPEG narrows the QG-03b-3 gap without closing it. |
| Budget presented as measurement? | **No.** The 18 ms figure is labelled `projected` throughout. |
| Backend and hardware labelled? | **Yes.** Every figure names workstation 1 and Chromium 151. None is presented as a workstation-2 fact. |
| Memory | **Not measured.** INFERENCE: decoded RGBA is identical (W×H×4). The encoded buffer held in `CaptureFrame.pixels` was smaller for PNG on 9/10 fixtures (median 69,943 vs 140,516 B). |

**Condition:** if QG-03b-3 later shows capture encoding on the critical path of a published
budget, **on the target machines**, ADR-0002 §12 trigger 1 applies.

---

## `evaluation-qa-engineer` — L2, blocking on any reported metric

**Status: `PASS`.**

**Are the new tests enforcing policy rather than implementation comments?** Yes, and this was
**demonstrated, not asserted.** Each guard was broken on purpose and seen to fail. The source
was restored byte-identical afterwards (sha256 checked).

| Mutation | Guard that caught it |
|---|---|
| M1 — delete the PNG-only refusal | 1 test fails ("REFUSES a JPEG returned for a PNG request") |
| M2 — call the browser default (omit `format`) | 6 tests fail |
| M3 — delete the MIME/signature check | 3 tests fail |
| M4 — widen `CaptureFrame.format` back to png/jpeg/webp | `tsc` fails, `TS2578 Unused '@ts-expect-error'` ×2 |

The tests drive the **real** `createTabCaptureAdapter` and `decodeDataUrl`. The only stand-in
is the browser, and its semantics are the **measured** Chromium ones, not assumed ones.

**No metric is reported or changed.** Historical evidence tests (`captureFormatConformance`,
`realCaptureConformance`) are unmodified and passing. The 15 fixture-dependent preprocessing
skips are unchanged and were not converted to passes. No detector evaluation set was consumed.

**Noted, not changed:** a comment in the historical `realCaptureConformance.test.ts` still
says "WebP is in CaptureFrame.format". After this change that sentence is historical. Its
assertion (the decoder refuses WebP) still holds and passes. The file was deliberately left
untouched, per the instruction to preserve historical tests.

---

## `privacy-security-engineer` — L1, standing veto on the trust boundary

**Status: `PASS` — the veto is not engaged. The trust boundary is not touched.**

| Check | Finding |
|---|---|
| New network call or egress path | **None.** The diff adds no `fetch`, XHR, beacon or socket. Capture stays in the extension's local context. |
| ADR-0001 / CSP / `connect-src` / ORT hash pin | **Unchanged.** No file under `packages/security/` or `artifacts/adr/ADR-0001/` is in the diff. `pin:check` passes. |
| Egress verifier, payload hash, exact-byte semantics, vault, manifest | **Unchanged**, and none of them exists as code yet. `manifest-schema.md` and `security-invariants.md` still specify WebP q62 for T2. |
| B-02 / Invariant E / QG-04 | **Unchanged.** B-02 stays OPEN and QG-04 stays UNSIGNED. |
| Fail-closed direction | **Strengthened.** Three payloads previously **accepted** now **refuse**: a JPEG returned for a PNG request, a PNG-labelled payload with non-PNG bytes, and an empty PNG. No new acceptance path exists. |
| Secrets, PII | None. Test fixtures are a 1×1 PNG and a bare JFIF header. |

---

## Summary

| Reviewer | Status | Blocking |
|---|---|---|
| `pratibimb-architect` | **CONDITIONAL_PASS** | Human approval of ADR-0002 |
| `browser-engineer` | **PASS** | — (Firefox capture output unmeasured, recorded) |
| `ml-engineer` | **PASS** | — (not an adoption; detector UNADOPTED) |
| `performance-engineer` | **CONDITIONAL_PASS** | — (JPEG faster; reconsider under QG-03b-3 trigger) |
| `evaluation-qa-engineer` | **PASS** | — (guards shown to fail under mutation) |
| `privacy-security-engineer` | **PASS** | — (no boundary touched) |
