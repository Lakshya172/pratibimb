---
id: S-05-perception-agentos-review
workstream: S-05 / QG-02 — perception tier
date: 2026-09-10
branch: feat/s05-perception-foundation
---

# S-05 perception substrate — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author.
> **Not a transcript of independent agents** and not presented as one.

Scope: the perception substrate and the QG-02 gate. No reasoning, executor, vault, ledger
or server code exists, so obligations attaching to those are **untouched, not satisfied**.

---

## `browser-engineer` — L2, **owns QG-02**

**Status: `PASS` on criteria 1–6, criterion 7 CONDITIONAL.**

| Obligation | Finding |
|---|---|
| CSS viewport pixels canonical, conversion at every edge | **PASS.** All four spaces convert only in `coordinates.ts`, and the spaces are branded, so a device-pixel value cannot be passed where CSS pixels are expected. |
| The six-configuration fixture | **PASS on Chromium.** DPR observed 1.0→2.5, frame 1024×640→2560×1600, `#phone` = `[400,260,300,32]` in all six. |
| `capture` block complete, always | **PASS**, and proven on real data: the gate refused a geometry missing `zoom` on its first browser run. |
| Off-screen reported with no pixel evidence | **PASS.** Enforced by the absence of a field, not by a check. |
| Never actioned without a preceding scroll | **CONDITIONAL.** Perception emits no actionable coordinate; the executor half has no executor to bind. |
| Browser divergence not inferred | **PASS.** Firefox is NOT RUN here and is recorded as such. |

**RAISED — `devicePixelRatio` folds zoom in, and this is the highest-risk arithmetic in the
tier.** `dpr * zoom` is the natural-looking implementation, is wrong by exactly the zoom
factor, and is invisible at 100% zoom — which is every development machine. A unit test
asserts the double-counted value specifically rather than only asserting the correct one.

**NOT BLOCKING.**

---

## `privacy-security-engineer` — L1, standing veto

**Status: `CONDITIONAL_PASS`. The veto is NOT waived, and no waiver was sought.**

### `invariants_checked`

| Invariant | Test | Finding |
|---|---|---|
| G5 rule 1 — model output cannot reach a compilation path | `g5Structural.test.ts` | **PASS.** No `WebAssembly.compile`, `new Function` or `eval` anywhere in the package; the only thing detector output can become is a bounded rectangle. |
| G5 rules 2 & 3 — no outbound network | `g5Structural.test.ts` | **PASS.** No `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` or `EventSource`. QG-04 is UNSIGNED, so the correct amount of network code here is none, and there is none. |
| G5 rule 4 — raw observations do not become payloads | `g5Structural.test.ts`, `perceptionState.test.ts` | **PASS.** `SanitizedHandoff` has no pixel-bearing field, so the "just send the frame for debugging" shortcut does not compile. |
| G5 rule 5 — no insecure fallback | `detector.test.ts` | **PASS.** No fallback chain in the registry; `EXCLUDED` is a distinct state from `UNAVAILABLE`. |
| INV — no secret plaintext logged | review | **PASS.** Nothing logs page-derived content. The element graph reads accessible names only — a control's label — and never value attributes or arbitrary inner text. |

### `evidence`

- `packages/perception/src/perceptionState.ts` — `readonly verified: false`. The egress guard
  refuses to transmit unless `verified === true`, so until a verifier exists the only
  constructible value is the un-sendable one. Fail-closed by type, not by default.
- `packages/perception/src/perceptionState.ts` — there is deliberately **no** function
  producing a complete `SanitizedHandoff`. Writing one would invent the redaction contract
  ahead of the tier that owns it.
- `packages/perception/src/detector.ts` — `validateDetections` refuses NaN, Infinity,
  non-positive extents, out-of-range scores, missing labels, and boxes outside the frame
  the detector was handed.
- `packages/perception/src/observation.ts` — the `OFFSCREEN` variant carries no `frameId`
  and no viewport box.

### `residual_leakage`

**NOT MEASURED, and still not measurable.** No redaction engine, vault or egress module
exists. Recorded so the absence is not later read as a measured zero.

### `findings`

- **MAJOR — the accessible name is page-derived text and reaches `PerceptionState` unredacted.**
  This is correct for now: it is structural UI text, the server must have it to plan "fill
  the phone field", and it never leaves the perception boundary because there is no handoff
  constructor. **It becomes a live PII surface the moment T2 is written** — an accessible
  name can contain a value (`aria-label="Aadhaar 1234 5678 9012"`). Flagged now so the
  sanitize tier inherits it as a requirement rather than discovering it.
- **MINOR — the source scan is a tripwire, not a proof.** It greps for the specific,
  greppable ways each G5 rule gets broken in practice. QG-04 additionally requires a
  build-failing lint rule over the whole repository; **this test is not that**, and QG-04
  stays UNSIGNED.

### `next_action`

Veto stands. **QG-04 remains UNSIGNED. B-02 remains OPEN.**

---

## `ml-engineer` — L2, blocking on model adoption (QG-03)

**Status: `PASS`. No model was adopted, run, or downloaded.**

| Obligation | Finding |
|---|---|
| No model accepted on documentation | **Honoured.** Every backend claim in `detector.ts` cites the measured feasibility cell. |
| Per-cell status remains authoritative | **PASS.** YuNet ACCEPT (wasm + webgpu); PP-OCRv5 det admissible on **webgpu only**, since QG-03 states a model failing the wasm column is not shipped whatever it does on WebGPU; SmolVLM WebGPU REJECT. |
| Model assets local and pinned; no runtime downloads | **PASS**, asserted structurally — a test fails on any model URL in the package. |
| Registry unchanged unless measured | **PASS.** No registry status was altered. |

**RAISED — the `UIElementDetector` slot has NO admissible implementation, and this is a real
gap in the T1 tier the brief requires.** Option A (OmniParser `icon_detect`) is **AGPL-3.0**
and excluded; the `icon_detect_v3` re-exports declare no licence at all, so they inherit an
unresolved question rather than escaping it. Option B (our own head) starts week 3. Option C
— DOM-only, vision limited to faces and OCR — is the floor and is what the substrate
currently supports.

The registry is not changed to say otherwise. The code reports `DETECTOR_UNAVAILABLE`, which
is distinguishable from a detector returning zero boxes — that distinction is carried in
`fusion` as `NO_DETECTOR` versus `NOT_DETECTED`, because otherwise the DOM-only floor would
be indistinguishable from a working detector on an empty page.

**NOT BLOCKING for this PR. QG-03 unaffected — no model entered the build.**

---

## `performance-engineer` — L2

**Status: `PASS`, with the measurement deferred honestly.**

| Obligation | Finding |
|---|---|
| T0 stays sub-millisecond on the structural half | **PASS by construction.** `ChangeGate.evaluate` is synchronous, allocation-light and model-free. **Not yet benchmarked** — QG-05 is week two and no metric is quoted here. |
| No high-frequency full-frame polling | **PASS, enforced.** The full-frame hash is debounced like every other signal, and dynamic regions are capped by `maxDynamicRegions` rather than by intention. A test asserts the safety-net interval stays well above the debounce floor. |
| Capture cost bounded | **CONDITIONAL — S-05's own question is still open.** The real `captureVisibleTab` rate limit under `activeTab` is `UNKNOWN` in the feasibility matrix. The adapter reports throttling as a typed refusal and deliberately contains **no retry or backoff policy**, because that policy would be invented ahead of its measurement. |

**RAISED:** `DEFAULT_CHANGE_POLICY` and `DEFAULT_FRAME_TTL_MS` are provisional defaults, not
measured values. They are named exported constants with tests attached so tuning is one
edit. **No performance claim is made from them.**

---

## `evaluation-qa-engineer` — L2

**Status: `PASS`.**

142 perception tests, 178 across the workspace. The suite is weighted toward refusals —
malformed model output, ambiguous geometry, stale frames, unsupported backends, capture
dimension mismatch, unresolved provenance — because that is where this tier's value sits.

**Observation.** The QG-02 browser gate **failed on its first real run**, and the failure was
a genuine platform property rather than a harness defect: a page cannot read its own browser
zoom. That is the right kind of first result. A gate that passes immediately on first
execution usually has not been pointed at anything.

**RAISED — the browser matrix is one browser deep on this workstation.** Chromium 6/6;
Firefox not runnable here. The CI job covers both, so the Firefox cell exists only if CI
produces it. It is recorded as NOT RUN.

---

## `pratibimb-architect` — L1

**Status: `PASS`.**

Scope held. The product scope limit was observed: no reasoning integration, no executor, no
vault, no server API, no side-panel UX. The substrate is contracts and their tests.

**One judgement worth recording.** The substrate was committed as a single architectural
commit rather than split across the ten implementation steps. The modules are mutually
dependent through one barrel, and splitting them further would have produced intermediate
commits that do not typecheck — broken bisect points bought for cosmetic granularity. The
browser gate and this gate record are separate commits.

**No ADR is required for this work.** Everything implemented follows an existing frozen
contract — `coordinate-contract.md`, `manifest-schema.md` v1.1, constitution §7 and §8. No
deviation from the dossier was introduced, so there is nothing for an ADR to record.
