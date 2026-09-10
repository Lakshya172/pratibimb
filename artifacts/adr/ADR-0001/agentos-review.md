---
id: ADR-0001-agentos-review
adr: ADR-0001
date: 2026-09-10
branch: feature/adr-0001-wasm-csp-and-pin
---

# ADR-0001 implementation — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author.
> **Not a transcript of independent agents** and not presented as one.

Scope: the implementation of ADR-0001 only. No perception, redaction, vault, ledger or
egress code exists yet, so obligations that attach to those remain **untouched, not
satisfied** — recorded as such below rather than silently omitted.

---

## `privacy-security-engineer` — L1, standing veto on the trust boundary

**Status: `CONDITIONAL_PASS`.** This is the G6 sign-off on the manifest/CSP diff, and it is
conditional in the same way the ADR was: the veto is **not** waived for anything beyond it.

### `invariants_checked`

| Invariant | Test that exercised it | Finding |
|---|---|---|
| INV-15 / INV-16 (no `eval`, no `new Function`, no string-`setTimeout`) | `tests/browser/gates/gate-probe.js`, G3, both browsers, every context | **PASS.** The probe asserts the string did not EXECUTE, not that the call threw. A CSP violation does not throw, and asserting on the throw previously reported a blocked sink as allowed. |
| INV-01 / INV-02 / INV-03 (client-side trust boundary) | `packages/security/src/csp.ts:62-64` | **PASS by construction.** `script-src 'self' 'wasm-unsafe-eval'`, `object-src 'self'`, `connect-src 'self' <origin>`. There is no permissive mode in the builder and no flag to widen it. |
| Invariant E (egress) | `tests/browser/gates/run-gates.mjs`, G2, arrival-logged origins; B-02 guard re-run | **PASS for the code that exists.** Foreign-origin GETs = 0 on both browsers, taken from an independent arrival log rather than the page's self-report. |

### `evidence`

- `packages/security/src/csp.ts:47,52,57,75` — fails closed on an absent origin, a wildcard,
  a path, a trailing slash, a scheme-only or a bare-host value. Rejection, never coercion.
- `packages/security/src/ortRuntimePin.ts:173,180` — `HASH_MISMATCH` is raised **before** ORT
  is touched. Verified by test: on mismatch `ort.env.wasm.wasmBinary` is still `undefined`
  and `InferenceSession.create` was never called.
- `packages/security/src/ortRuntimePin.ts:185` — the buffer handed to ORT is the **same
  object** that was hashed. The test asserts identity (`toBe`), not equality. This is the
  "no re-encode, re-serialize or mutation between hashing and use" rule applied to WASM bytes.
- `packages/security/src/ortRuntimePin.ts:189` — `wasmPaths` carries the packaged glue only,
  with **no `wasm` key**, so there is no second path by which unverified bytes could arrive.
- `packages/security/src/ortRuntimePin.ts:127-132,226` — the realm is marked as used **before**
  the `await`, so a session that throws still blocks a later install.
- `packages/security/src/ortRuntimePin.ts:145` — an absent `crypto.subtle` is
  `DIGEST_UNAVAILABLE`, a refusal. Verification is never skipped because it is unavailable.

### `residual_leakage`

**NOT MEASURED, and not measurable yet.** There is no redaction engine, no vault and no
egress module, so there is nothing whose residual leakage could be measured. Recorded
explicitly so the absence is not later mistaken for a measured zero.

### `findings`

- **MAJOR — accepted, documented, not eliminated (C-3).** The Emscripten glue is loaded by a
  dynamic `import()`, which MV3 governs through `script-src`, not `connect-src`. It cannot be
  intercepted and hashed before execution. Packaging is the only control. Recorded in
  `docs/security/wasm-runtime-provenance.md` §2. **The glue hash in the generated pin is a
  build-time drift check and must never be described as a runtime pin.**
- **MINOR — the pin is bundle-specific (C-2).** It is not a universal ORT pin. Guarded by
  `npm run pin:check`, which breaks the build on drift and tells the reader to re-run the
  experiment rather than re-hash and carry on.
- **MINOR — structural typing of ORT could have voided the pin silently.** Found and closed
  during this implementation: an upstream rename of `wasmBinary` would not have produced a
  type error, and ORT would have fallen back to fetching over the network while the pin
  reported success. Now gated in `scripts/generate-ort-pin.mjs` and confirmed by negative
  control (renaming the declaration in the installed types fails the gate; restoring it
  passes).

### Standing assertions — re-checked

1. *Zero outbound requests under every row of the fail-closed matrix* — **the matrix does not
   exist yet.** G2 is a narrower claim: a foreign-origin WASM fetch is blocked. Not a
   substitute, and not counted as one.
2. *`verified === true` and hash equality on every send* — **untouched.** There is no send path.
3. *Vault destroyed on session end, tab change, and before an origin change commits* —
   **untouched.** There is no vault.
4. *Unknown token → abort; literal at a redacted field → abort* — **untouched.** There is no
   action pipeline.
5. *No secret plaintext in any log* — **PASS trivially.** Nothing added here logs anything
   derived from page content; the pin logs hashes of a shipped binary.

### `next_action`

The veto stands for QG-04 and for every subsequent workstream. **QG-04 remains UNSIGNED.**

---

## `browser-engineer` — L2, blocking on execution context

**Status: `PASS`.**

| Obligation | Finding |
|---|---|
| CSP correctness per browser | **Honoured.** `'wasm-unsafe-eval'` is the only token Chrome MV3 accepts. W1-S02a-2a-2 measured that `'wasm-eval'` and `'unsafe-eval'` stop Chrome loading entirely while Firefox loads and is silently inert — which is precisely why G1 asserts the capability at runtime instead of trusting the manifest. |
| The Firefox false-green trap | **Honoured and enforced twice.** `assertWasmCompilationAllowed` uses `WebAssembly.compile()`; a unit test asserts `validate` is never called, and the browser probe shadows `validate` in every context to prove it at runtime as well. |
| Contexts are the ones the constitution names | **PASS.** Chromium 3 contexts, Firefox 2. Firefox MV3 has no offscreen document — a real platform difference, recorded as such and not as missing coverage. |
| Worker-safe asset resolution | **PASS.** `new URL(file, self.location.href)`. `chrome.runtime.getURL` is undefined in dedicated workers, a defect already paid for once during the S-02a spikes. |
| Browser/platform divergence not inferred | **PASS.** Every run is Windows. **Firefox on Linux stays UNKNOWN** and nothing in this PR promotes it. |

**NOT BLOCKING.**

---

## `ml-engineer` — L2, blocking on model adoption (QG-03)

**Status: `PASS`, with its ADR-0001 conditions carried forward intact.**

| Obligation | Finding |
|---|---|
| C-2 carried into the registry: the pinned artifact recorded **per bundle**, not per package version | **Honoured.** `ORT_PIN` records package, version, bundle name + hash, artifact name + hash, and glue name + hash. The bundle is what selects the artifact, so the bundle is what the pin is keyed to. |
| Must refuse adopting anything on the strength of documentation | **Honoured.** The bundle→artifact mapping is cited to the W1-S02a-2a-3 measurement, and the generator's own header states that it CANNOT statically prove that mapping. |
| S-02a-2a-3a (multi-threaded ORT) uncovered | **Still uncovered, and now fenced.** The bootstrap pins `numThreads = 1` and `proxy = false`, so the runtime cannot silently take a path no experiment has observed. |
| No model may reach `ADOPTED` | **Untouched.** No model is loaded by this PR. |

**NOT BLOCKING for this PR. QG-03 unaffected.**

---

## `pratibimb-architect` — L1

**Status: `PASS`.**

Scope discipline held: this PR implements ADR-0001 and nothing else. No perception,
redaction, vault, ledger or egress code was added under cover of the security work.

Two deviations, both recorded rather than absorbed:

1. **pnpm → npm.** A toolchain choice, not an architecture change. The frozen stack names
   WXT, Vite and TypeScript; the package manager is not frozen. Forced by repeated fetch
   timeouts on the 28 MB ORT tarball.
2. **A CommonJS boundary over `artifacts/experiments/`.** Required because the new root
   `"type": "module"` reclassified the archived harnesses and broke the B-02 regression guard
   outright. The harnesses were deliberately not modernised — their recorded results are only
   reproducible while the code that produced them stays byte-stable.

---

## `evaluation-qa-engineer` — L2

**Status: `PASS`, with one standing observation.**

Every test in the ORT pin suite asserts a **refusal**. That is the correct shape for this
component: the guard's entire value is in what it declines to do, and a suite that only
proved the happy path would stay green while the guard sat inert.

**Observation.** Three unit tests failed on first run and **all three were test-side defects**,
not product defects — a stub returning `{instance, module}` where
`WebAssembly.instantiate(Module)` resolves to an `Instance`; a test passing `subtle: undefined`
and therefore hitting the intended global fallback; and a test asserting `ALREADY_INSTALLED`
where production deliberately raises the stronger `LATE_INSTALL` first. Recorded because "the
test was wrong" is the most common way a real finding gets discarded, and the distinction was
argued explicitly each time rather than by adjusting until the suite went green.
