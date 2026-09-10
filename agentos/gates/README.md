# Quality Gates — PratiBimb

> A gate is a **binary checkpoint**. All items ✅ or the gate is `FAIL`.
> There is no "mostly passed". There is no conditional pass on a security gate.

| Gate | Name | When | Owner |
|---|---|---|---|
| **QG-01** | Capability spike complete | Before any dependent implementation starts | `ml-engineer` / `browser-engineer` |
| **QG-02** | Coordinate contract | **Before the executor is written** | `browser-engineer` |
| **QG-03** | Model feasibility | Before any model enters the build | `ml-engineer` |
| **QG-04** | Egress invariant | Before any code can make a network call | `privacy-security-engineer` |
| **QG-05** | Evaluation harness | **Week two.** Before any metric is quoted anywhere. | `evaluation-qa-engineer` / `performance-engineer` |
| **QG-06** | Release | Before any build is used for rehearsal or judging | `integration-release-engineer` |

---

## QG-01 — Capability spike complete

- [ ] The question is stated, and the decision it unblocks is named.
- [ ] The environment is recorded: machine, OS, browser + version, backend, runtime library version, date.
- [ ] Raw output is captured verbatim in `artifacts/experiments/`.
- [ ] The verdict is one of `FACT` or `still UNKNOWN` — never "probably works".
- [ ] `agentos/registry/feasibility-matrix.md` or `docs/architecture/constitution.md` section 9 is updated.
- [ ] Spike code is deleted or clearly quarantined.
- [ ] If the result invalidates a dossier assumption, an ADR exists.

## QG-02 — Coordinate contract

**This gate is passed before the action executor is written.**

- [x] CSS viewport pixels is the only space in any manifest or action plan.
- [x] Conversion happens at the edge of every component, and each conversion is unit tested.
- [x] The CI fixture renders at **DPR 1.0, 1.5, 2.0** and **100%, 125% zoom**.
- [x] The same logical element resolves to the **same CSS-pixel box in all six configurations**.
- [x] `capture` block records `dpr`, `zoom`, `scale_to_css`, `scroll`, `origin` — always, even when a value is 1.0.
- [x] Off-screen elements are reported `visible: false, offscreen: true`, in document space, with no pixel evidence.
- [ ] An off-screen element is never actioned without a preceding scroll. **CONDITIONAL —
      perception discharges its half (it emits no actionable coordinate for an off-screen
      element), but the executor half has no executor to bind. Re-verified when it lands.**

> **Status 2026-09-10: criteria 1–6 PASS on Chromium, criterion 7 CONDITIONAL.**
> Measured across six configurations — `devicePixelRatio` 1.0→2.5, frame 1024×640→2560×1600,
> the same element at `[400,260,300,32]` in all six. Evidence and the full criterion table:
> `artifacts/gates/QG-02/`. **Chromium AND Firefox both 6/6, 0 findings** — identical CSS
> boxes on both engines. Firefox is not runnable on the Windows workstation (Playwright's
> browser CDN returns HTTP 400 there) and its cell is produced in CI, run `34485366327`.
> The Firefox cell caught a quirks-mode fixture defect Chromium passed straight through.

## QG-03 — Model feasibility

- [ ] The exact repository **and revision hash** are pinned in `agentos/registry/model-registry.md`.
- [ ] The licence has been read **from the pinned revision**, with URL and date recorded.
- [ ] All four feasibility cells are filled: Chrome WebGPU, Chrome WASM, Firefox WebGPU, Firefox WASM (Linux).
- [ ] Each cell records **all four** values: session loads, p50 on the fixed fixture, peak heap, correctness vs known-good reference.
- [ ] **The WASM columns pass.** A model that fails them is not shipped whatever it does on WebGPU.
- [ ] Coexistence with the other resident sessions is verified, and teardown reclaims memory.
- [ ] A benchmark artifact exists under `artifacts/benchmarks/`.
- [ ] An ADR exists if a pinned default or a fallback ranking changed.

## QG-04 — Egress invariant

**No code may make a network call until this gate passes.**

- [ ] The lint rule fails the build on `fetch`, `XMLHttpRequest`, `sendBeacon` or `WebSocket` outside the egress module.
- [ ] The manifest CSP restricts `connect-src` to the configured server origin.
- [ ] The payload is constructed **once**, as a single immutable artifact — the encoded WebP frame and the serialized manifest, assembled into the exact multipart body that goes on the wire.
- [ ] That artifact is hashed; verification runs **against it**; the egress module accepts a buffer only when its hash equals the hash the verifier signed.
- [ ] Nothing is re-encoded, re-serialized or mutated between those two moments.
- [ ] The Playwright interception suite asserts **zero outbound requests** for **every row** of the fail-closed test matrix (detector failures, pipeline failures, boundary failures).
- [ ] Verification runs against the **decoded WebP bytes that will actually be transmitted**, not the pre-encode canvas.
- [ ] The second verification pass **differs from the first in scope and threshold**.
- [ ] The value-aware residual check runs, and **never logs the value**.
- [ ] The vault touches no persistent storage, and is destroyed on session end, tab change, and unconditionally before an origin change commits.
- [ ] No component logs secret plaintext — verified for the verifier, the ledger, **and the server tripwire**.

## QG-05 — Evaluation harness

**Week two. Before any metric is quoted anywhere.**

- [ ] The harness reports all five scored metrics **plus task success after privacy**.
- [ ] Every figure is labelled `measured` or `projected`. No figure is unlabelled.
- [ ] Visual context is reported **twice**: on clean frames and on redacted frames.
- [ ] PII detection reports per-class precision, recall and F1, with **precision on the decoy set reported separately**.
- [ ] The synthetic generator produces ground-truth boxes, and the decoy generator exists.
- [ ] The adversarial, false-positive and disagreement sets exist and run.
- [ ] Every disagreement-set row verifies that **union and fail-closed behaviour hold**.
- [ ] p50 **and** p95 for end-to-end and every stage; **peak** (not mean) for heap, GPU, CPU.
- [ ] Cold start and warm start reported separately.
- [ ] Every table labelled with backend and hardware — **including server hardware** on the latency table.
- [ ] The two-row ablation exists: grounding accuracy and task success, redaction off and on.

## QG-06 — Release

See `agentos/workflows/release.md`. All of QG-01..QG-05 pass on the candidate commit, plus:

- [ ] Chrome MV3 and Firefox MV3 builds from the one codebase.
- [ ] A separate WASM-only build, benchmarked.
- [ ] A Firefox build tested **on Linux**, with the backend indicator visible.
- [ ] All four Invariant-E enforcement mechanisms **active in CI**, none `allow-failure`.
- [ ] Every dependency and model revision pinned; reproducibility manifest recorded.
- [ ] No demonstration sequence depends on a value surviving an origin change.
- [ ] All four demonstration sequences rehearsed ten times.
- [ ] The travel checklist is complete.
