---
id: ADR-0001
title: "WebAssembly CSP directive and the connect-src provenance pin"
version: 1.0
status: PROPOSED — awaiting human architect approval
owner: pratibimb-architect
proposed_by: browser-engineer · ml-engineer · privacy-security-engineer
created: 2026-09-10
modified: 2026-09-10  # rev 2: S-02a-2a-3 measured; §7.3 reopened and rewritten
supersedes: none
related_issues: ["#17 (P0, CSP blocks WASM)", "#5 (Invariant E mechanism 2)"]
related_blockers: ["B-02"]
related_invariants: ["INV-01", "INV-02", "INV-03", "INV-15", "INV-16", "Invariant E"]
related_gates: ["QG-04"]
---

# ADR-0001 — the WebAssembly CSP directive and the `connect-src` provenance pin

> **STATUS: PROPOSED. NOT APPROVED. NOT IMPLEMENTED.**
> No manifest, CSP, egress policy or security-critical runtime behaviour has been changed.
> This ADR is a decision *package*: evidence, options, consequences and gates, assembled so
> a human architect can decide. **The decision itself is a §26 boundary and is not taken here.**

---

## 1 · Context

PratiBimb's entire perception tier is WebAssembly — ONNX Runtime Web and Transformers.js.
**At default MV3 settings, neither Chrome nor Firefox will compile WebAssembly in an
extension context**, so at stock settings the perception tier has **no execution path on any
browser**. That is an availability problem, not a performance one, and it is issue **#17
(P0)**.

Four experiments now bound the decision. All are merged evidence; none is inference.

| Experiment | What it established |
|---|---|
| **S-02a-2** / **S-02a-2b** | Default MV3 CSP blocks WebAssembly on **both** Chrome and Firefox, on Linux and native Windows, headful and headless |
| **S-02a-2b-1** | `'wasm-eval'` and `'unsafe-eval'` make the Chrome extension **fail to load at all**. `'wasm-unsafe-eval'` is the **only** token Chrome MV3 accepts |
| **S-02a-2a-1** | `'wasm-unsafe-eval'` enables WebAssembly **only** — it does not widen `eval`, `new Function` or string-`setTimeout`. It places **no restriction on WASM provenance**: network-origin bytes compile as freely as packaged ones |
| **S-02a-2a-4** *(new)* | A pinned `connect-src` **blocks foreign-origin WASM at the network layer, before the wire** — 0 arrivals at an independently instrumented foreign origin, 36/36 |
| **S-02a-2a-2** | **Firefox** reaches the same security conclusion by a **different failure mode** — 24/24 |
| **S-02a-2a-3** *(new)* | The ORT Web `.wasm` **can be hash-pinned with a provable byte-for-byte binding** to what executes, on **both Chromium and Firefox** — **CONDITIONAL** on three architecture constraints |

## 2 · What `'wasm-unsafe-eval'` permits — measured

Chromium 151 · Edge 152 · Firefox 155.0.1 · three Chromium MV3 contexts + two Firefox MV3
contexts · **60 context-observations, unanimous**.

| Capability | Default CSP | With `'wasm-unsafe-eval'` |
|---|---|---|
| `WebAssembly.compile` / `instantiate` | **blocked** | **ALLOWED** |
| `eval("…")` | blocked | **blocked** |
| `new Function("…")` | blocked | **blocked** |
| `setTimeout("<string>")` | blocked | **blocked** |

> **It unlocks WebAssembly compilation and nothing else.** No JavaScript execution sink is
> widened, on either engine, in any tested context.

**Consequence for the frozen invariants:** adopting `'wasm-unsafe-eval'` does **not** breach
**INV-15** (no arbitrary JavaScript execution) or **INV-16** (no `eval`). This is measured,
not argued.

**There is no narrower option.** `'wasm-eval'` is strictly narrower in principle, and on
Chrome it stops the extension loading; on Firefox it loads but is inert. The choice is
binary: **declare `'wasm-unsafe-eval'`, or have no perception tier.**

## 3 · What `'wasm-unsafe-eval'` does NOT protect

This section exists because it is the part most likely to be assumed rather than checked.

1. **It does not bound provenance.** With the directive declared and `connect-src`
   unrestricted, WASM fetched from an arbitrary origin **compiles, instantiates and runs**
   (`add(2,3)=5`), via both `WebAssembly.compile` and `instantiateStreaming`.
2. **It does not bound content.** The directive says nothing about *which* module.
3. **It does not fail loudly on Firefox.** A wrong or withdrawn token leaves the extension
   **loading normally with WebAssembly silently absent** (§5).
4. **It does not distinguish first-party from dependency-supplied WASM.** Any code running
   in an extension context inherits the capability. *(Unresolved — §8.)*

## 4 · What `connect-src` actually enforces — measured

**S-02a-2a-4.** Two loopback origins serving **byte-identical** WASM; `host_permissions`
lists **both** in every variant, so any difference is attributable to `connect-src` alone.
Each origin keeps its **own arrival log**, and the foreign log is authoritative.

| | `ext-pinned` | `ext-unpinned` *(positive control)* |
|---|---|---|
| Network retrieval | **BLOCKED** — `TypeError: Failed to fetch` | resolved |
| **Foreign origin arrivals** | **0** — Chromium **and** Edge, every run | **18** each |
| WASM compilation | *never attempted* | allowed |
| Instantiation | *never attempted* | `add(2,3)=5` |
| Cross-check | **`CONSISTENT_BLOCKED`** | `CONSISTENT_ALLOWED` |

> **`connect-src` blocks foreign-origin WASM at the network retrieval layer, before the
> request reaches the wire.** The bytes never leave the machine.

The positive control matters: **18 arrivals** in the unpinned variant proves the observer
works, so **0** under pinning is a measured absence rather than a blind spot. The harness
also enumerates and asserts against the `FALSE_GREEN` case — probe reports blocked while the
far end received the request. It did not occur.

## 5 · What hash pinning enforces — and the trap

In the unpinned control, the foreign bytes were byte-identical, so:

```
foreign digest = f61fd62f…88ba = PINNED_SHA256    ->    digestMatchesPin: TRUE
```

> **The SHA-256 pin ACCEPTED bytes served from the foreign origin.**

It had to. **A content hash cannot express provenance.**

| Control | Enforces | Layer | Blind to |
|---|---|---|---|
| **`connect-src`** | **where** bytes may come from | network, **pre-wire** | what the bytes contain |
| **SHA-256 pin** | **what** the bytes are | application, **post-retrieval** | where they came from |

**Neither substitutes for the other, and both are required.** `connect-src` alone accepts
*any* bytes from the pinned origin. The pin alone accepts *the right* bytes from *any*
origin. **A reviewer who believes hash-pinning bounds provenance would be wrong**, which is
precisely why this is stated rather than implied.

Note also that the hash pin is an **application-level** control: it is code we must write
and keep on the path, not a browser guarantee. It is not INV-02/INV-03 — those pin the
*egress payload*. This would be a second, analogous pin over *WASM bytes*.

## 6 · Chrome vs Firefox — same conclusion, different failure mode

| Token | Chrome MV3 | Firefox MV3 155.0.1 |
|---|---|---|
| *(default)* | loads · WASM blocked | loads · WASM blocked |
| **`'wasm-unsafe-eval'`** | loads · **WASM allowed** · JS sinks blocked | loads · **WASM allowed** · JS sinks blocked |
| `'wasm-eval'` | **DOES NOT LOAD** | **loads** · WASM **still blocked** |
| `'unsafe-eval'` | **DOES NOT LOAD** | **loads** · WASM **still blocked** · `eval` **still blocked** |

**Security conclusion: identical. One policy serves both browsers.**

**Operational conclusion: they fail differently, and Firefox fails silently.** A
misconfiguration that kills the Chrome extension outright leaves Firefox running with no
perception tier and no load error.

**A second cross-browser asymmetry, from S-02a-2a-3:** Firefox MV3 **preflights** an
extension `fetch` carrying a custom header to a host in `host_permissions`; Chromium does
not. Harmless in itself, but any security test that attributes requests by header alone
will miscount those preflights — in S-02a-2a-3 that briefly made Firefox look as though it
broke the WASM pin. **Attribute by method as well as header.**

**Compounding trap:** `WebAssembly.validate()` **succeeds in every Firefox variant,
including the default**, because validation does not compile to machine code. **A startup
capability check that calls `validate` would report WebAssembly as available when
compilation is blocked.**

## 7 · Decision — proposed, for human approval

### 7.1 Should the project adopt `'wasm-unsafe-eval'`?

**Proposed: YES.** It is the only token that enables WebAssembly on either engine; without
it there is no perception tier and no submission. It is measurably narrow — WebAssembly
only — so **INV-15 and INV-16 are preserved**.

### 7.2 Should `connect-src` be pinned, and where?

**Proposed: YES — pinned in the same `extension_pages` policy, to the configured server
origin (and `'self'`), with no wildcard.** Measured to block foreign-origin WASM before the
wire, and it is already **Invariant E enforcement mechanism (3)**. Its dual role is now
evidence-backed rather than assumed.

Proposed directive, **for review — not applied anywhere**:

```
script-src 'self' 'wasm-unsafe-eval';
object-src 'self';
connect-src 'self' <configured server origin>
```

### 7.3 Should WASM bytes be hash-pinned?

**Proposed: YES — and S-02a-2a-3 has now measured it. The sub-decision is REOPENED and
rewritten, because the answer is CONDITIONAL rather than a clean yes.**

**What was proven** (`artifacts/experiments/W1-S02a2a3-ort-wasm-hash-pin/`, ORT Web
**1.29.0**, **Chromium 151 and Firefox 155.0.1**, 3 runs each, unanimous — the binding
holds identically on both):

> **EXACT BYTES HASHED == EXACT BYTES EXECUTED.** Demonstrated, not asserted.

PratiBimb fetches the artifact, hashes it with `crypto.subtle.digest`, compares it to the
pin, and only then hands the verified buffer to ORT via `ort.env.wasm.wasmBinary`. The
binding rests on three independent observations, not on ORT's documentation:

| Observation | Result |
|---|---|
| The `.wasm` is **not packaged** in the extension | ORT has nowhere else to obtain bytes |
| ORT's own fetches in the pinned scenarios | **ZERO** (independent arrival log, not a self-report) |
| **Tampered bytes handed to ORT** | Session **FAILS** with `CompileError: WebAssembly.instantiate()` |

The tamper control is what closes it: had ORT ignored our buffer, corrupt bytes could not
have caused a compile error. Scenarios s4/s5 produce arrivals on demand, proving the
observer works.

**Three constraints make this CONDITIONAL. They are requirements, not caveats:**

| # | Constraint | If violated |
|---|---|---|
| **C-1** | `wasmBinary` **must be set before the first session in each JS realm.** ORT caches its module per realm. | That realm is **unpinned for its entire lifetime** |
| **C-2** | The pin is **bundle- and artifact-specific.** `ort.all.min.js` loads `ort-wasm-simd-threaded.jsep.wasm` (`db816fad…`), **not** `ort-wasm-simd-threaded.wasm` (`ec8580a9…`). | A bundle change **silently pins a file the runtime never loads** — the check passes and verifies nothing |
| **C-3** | The pin covers the **`.wasm` only.** The `.mjs` glue is loaded by dynamic `import()`, which MV3 governs through **`script-src`, not `connect-src`**, so it **must be packaged**. | Glue provenance rests on packaging alone — **it is not hash-pinned, and must not be described as if it were** |

**Also measured, and relevant to §7.4:** ORT does **not** fall back silently. A missing
artifact fails after three retries (`fellBackSilently: false`), and a second session reuses
the pinned module without re-fetching.

### 7.4 Should WASM be packaged rather than fetched?

**Proposed: YES.** Packaging removes the retrieval step entirely and makes `connect-src` a
second line rather than the only one. S-03 already found ORT Web runs with runtime and model
both packaged, and **S-02a-2a-3 makes it partly mandatory rather than merely preferable**:
the `.mjs` glue is loaded by dynamic `import()` under `script-src 'self'`, so it can only
come from the extension package (C-3). Packaging is therefore the *only* available
provenance control for the glue.

## 8 · Invariants — how each is preserved

| Invariant | Effect | Basis |
|---|---|---|
| **INV-15** no arbitrary JS | **Preserved** | 60/60 observations: the directive widens no JS sink |
| **INV-16** no `eval` | **Preserved** | `eval` blocked under the directive on both engines |
| **INV-01** single egress module | **Unaffected** | No egress path changes |
| **INV-02 / INV-03** payload hash pin | **Unaffected** | The proposed WASM pin is a *separate* control; the egress payload pin is untouched |
| **Invariant E, mechanism (3)** `connect-src` | **Strengthened, and now measured** | S-02a-2a-4 |
| **Invariant E, mechanism (2)** Playwright interception | **NOT addressed. Still broken.** | Issue #5 / B-02 — untouched by this ADR |

**This ADR does not resolve B-02 and does not sign QG-04.**

## 9 · Remaining assumptions and unknowns

Stated so approval is informed rather than implied.

| # | Unknown | Effect if wrong |
|---|---|---|
| ~~S-02a-2a-3~~ | ~~Does ORT Web expose its `.wasm` URL so a pin can precede instantiation?~~ | **ANSWERED — CONDITIONAL.** See §7.3. Binding proven; C-1..C-3 apply |
| **S-02a-2a-3a** | Does the binding hold with `numThreads > 1`, where ORT spawns its own workers that may fetch further assets? | The threaded WASM performance path |
| **S-02a-2a-3b** | Does the **WebGPU** execution provider touch resources beyond the jsep artifact? | Pinning the WebGPU path |
| **S-02a-2a-3c** | Can the `.mjs` glue's integrity be assured beyond packaging (build-time hash, SRI)? | Completeness of runtime provenance |
| ~~S-02a-2a-3d~~ | ~~Does the `wasmBinary` binding hold in Firefox MV3?~~ | **ANSWERED — YES.** Identical to Chromium, 3 runs, both Firefox MV3 contexts |
| **S-02a-2a-4a** | Does the result hold for a **cross-host / https** origin, not two loopback ports? | The provenance claim narrows to same-host |
| **S-02a-2a-4b** | Does `connect-src` bound WASM provenance on **Firefox**? | §7.2 would be Chromium-only |
| **S-02a-2a-4c** | Can a **redirect** from the allowed origin reach foreign bytes past the pin? | A hole in mechanism (3) |
| **S-02a-2a-2a** | Firefox on **Linux** — the likely judging configuration | Untested on the most probable target |
| **#17 open** | Can extension **dependencies** introduce untrusted WASM? | Any dependency inherits the capability |
| **#17 open** | Can **model output** reach a WASM compilation path? | **It must not.** Currently unverified |

## 10 · Consequences

**Positive:** the perception tier becomes executable at all; provenance is bounded by a
measured control; one policy covers both browsers.

**Negative / accepted cost:** the extension declares a capability beyond browser defaults;
any code in an extension context inherits it; the policy lives in the same file as the
egress pin, so a careless edit touches both; and on Firefox a mistake is silent.

## 11 · Rollback

| Step | Action |
|---|---|
| Revert the manifest change | `git revert <sha>` — the directive is one manifest line |
| Recover a known-good state | `git checkout v0.2.0-spikes` |
| Effect of rollback | Perception tier stops working. **Fail-closed, not degraded:** with no WASM the tier must refuse to run, never fall back to an unverified path |
| Detection | The startup assertion in §12 must fail loudly when the directive is absent — **especially on Firefox, where the browser will not** |

## 12 · Required verification gates BEFORE any manifest change

**All must pass. This is the gate the ADR's approval is conditioned on.**

- [ ] **G1** — Manifest CSP asserted at **runtime startup**, in every context, using
      **`WebAssembly.compile`, never `validate`** (§6 trap). Failure is fail-closed.
- [ ] **G2** — Automated test: `connect-src` blocks a foreign-origin WASM fetch, asserted
      against an **independent arrival log**, not the page's self-report (B-02 discipline).
- [ ] **G3** — Automated test: `eval`, `new Function` and string-`setTimeout` remain blocked
      with the directive declared — a regression guard on INV-15/INV-16, checking the
      string **executed**, not that the call threw.
- [ ] **G4** — ~~S-02a-2a-3 answered~~ **DONE (CONDITIONAL).** §7.3 reopened and rewritten. G4 is replaced by G4a–G4c, which enforce its three constraints:
- [ ] **G4a (C-1)** — a **runtime guard** that fails closed if an ORT session is created in a
      JS realm where `wasmBinary` was not set first. "Set it before the first session" is an
      ordering convention, and ordering conventions decay; this must be asserted, not documented.
- [ ] **G4b (C-2)** — a **build-time check** deriving the expected artifact filename **and**
      SHA-256 from the shipped ORT bundle, so changing the bundle **breaks the build** rather
      than silently voiding the pin.
- [ ] **G4c (C-3)** — the `.mjs` glue is packaged, and the residual risk that it is **not**
      hash-pinned is recorded explicitly in the security documentation.
- [ ] **G5** — Evidence that no model output can reach a WASM compilation path.
- [ ] **G6** — `privacy-security-engineer` sign-off on the final manifest diff.
- [ ] **G7** — Human architect approval recorded here.

**G2 and G3 are regression guards, not one-off checks: they belong in the permanent suite.**

## 13 · Alternatives considered

| Option | Why not |
|---|---|
| Declare `'wasm-eval'` (narrower) | **Measured impossible.** Chrome refuses to load; Firefox loads but it is inert |
| Declare nothing; no WASM | No perception tier, and the dossier's brief requires a local vision model |
| Run inference outside the extension | Breaks the trust boundary — inference must stay client-side |
| Rely on hash-pinning alone for provenance | **Measured wrong.** §5: the pin accepted foreign-origin bytes |
| Rely on `connect-src` alone for integrity | Accepts *any* bytes from the pinned origin |

## 14 · Approval

| Role | Position |
|---|---|
| `browser-engineer` | **PASS** — evidence sound; contexts are the ones the constitution names |
| `ml-engineer` | **PASS.** The §7.3 condition is discharged by S-02a-2a-3 (CONDITIONAL). Conditions carried forward: the model registry must record the pinned artifact **per bundle**, not per package version (C-2), and S-02a-2a-3a (threads) remains uncovered |
| `privacy-security-engineer` | **PASS on the evidence; standing veto NOT waived.** Requires G1–G3 and G6 before any manifest change |
| `pratibimb-architect` | Prepared; recommends adoption subject to §12 |
| **Human architect** | ☐ **PENDING — this ADR is not approved** |
