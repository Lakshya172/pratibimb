# WebAssembly runtime provenance — ADR-0001 G4c and G5

> Companion to [`security-invariants.md`](security-invariants.md). Records what the
> ADR-0001 controls **do** enforce, and — more importantly — what they **do not**.
> Status: the controls below are **implemented**; ADR-0001 is **APPROVED** at the
> architectural level and its gates are recorded in the PR that introduced them.

---

## 1 · Two boundaries, and why neither substitutes for the other

| Control | Enforces | Layer | Measured blind spot |
|---|---|---|---|
| **`connect-src`** (`packages/security/src/csp.ts`) | **Provenance** — where bytes may come from | network, **pre-wire** | accepts **any** bytes from the pinned origin |
| **SHA-256 pin** (`packages/security/src/ortRuntimePin.ts`) | **Exact-byte identity** — what the bytes are | application, **post-retrieval** | **accepts byte-identical bytes from any origin** |

Both blind spots are measured, not assumed. In W1-S02a-2a-4's unpinned control the hash pin
**accepted** WebAssembly served from a foreign origin, because the bytes were identical —
a content hash cannot express provenance. In the same experiment `connect-src` blocked that
retrieval **before the request reached the wire**, with 0 arrivals at an independently
instrumented foreign origin.

**Both, or neither.** A reviewer who believes hash-pinning bounds provenance would be
wrong, and that misreading is the specific failure this section exists to prevent.

---

## 2 · G4c — the Emscripten glue is NOT hash-pinned. This is a residual risk.

ORT Web resolves its Emscripten JS glue (`ort-wasm-simd-threaded.jsep.mjs`) with a
**dynamic `import()`**. MV3 governs dynamic import through **`script-src`**, not
`connect-src`, so under `script-src 'self'` the glue can only come from the extension
package — and, critically, **it cannot be intercepted and hashed before it executes** the
way the `.wasm` artifact can.

| | `.wasm` artifact | `.mjs` glue |
|---|---|---|
| Loaded by | our own `fetch`, then handed to ORT as a buffer | ORT's dynamic `import()` |
| Governed by | `connect-src` | **`script-src`** |
| Can we hash it before execution? | **Yes** — and we do | **No** |
| Runtime control | **SHA-256 pin, enforced** | **packaging only** |
| Build-time control | hash recorded in `ORT_PIN.artifact` | hash recorded in `ORT_PIN.glue` |

`ORT_PIN.glue.sha256` exists for **build-time drift detection only**. `npm run pin:check`
fails if the glue changes, which forces a human to look. That is a real control, but it is
**not** a runtime pin and is not described as one anywhere in the codebase.

> **C-3 is mitigated, not eliminated.** The glue's provenance rests on it being packaged
> inside the signed extension bundle. If an attacker can alter the packaged extension,
> they have already defeated a larger boundary than this one.

**Open follow-up: S-02a-2a-3c** — whether integrity can be assured beyond packaging (a
build-time hash embedded in a loader, or an SRI-equivalent). Not closed.

---

## 3 · G5 — model output cannot reach a WebAssembly compilation path

**Requirement:** no output produced by a model may become executable WebAssembly.

This is a structural property of the code, not a runtime check, so the evidence is the
absence of a path rather than a test result. Three independent reasons:

**3.1 — There is exactly one entry point, and it takes no model-derived input.**

`installVerifiedOrtRuntime()` is the only function in the codebase that assigns
`ort.env.wasm.wasmBinary`. Its bytes come from **one** source: a `fetch` of
`ORT_PIN.artifact.name`, a constant baked in at build time by
`scripts/generate-ort-pin.mjs`. There is no parameter, no configuration key and no message
channel through which a caller — let alone a model — can supply alternative bytes.

**3.2 — The digest gate rejects anything that is not the pinned artifact.**

Even if bytes reached that path, they are hashed and compared against `ORT_PIN.artifact.
sha256` **before ORT is invoked**. Model output would have to be a SHA-256 preimage of the
pinned artifact. The failure is `HASH_MISMATCH`, and it throws.

**3.3 — The action grammar admits no compilation-capable action.**

`docs/architecture/action-schema.md` allows `click`, `type`, `scroll`, `select`, `wait`,
`zoom_request`, `confirm`, `done`. `execute_javascript`, `eval`, shell commands and
download-and-run are **not in the schema**, so the server's guided-decoding grammar cannot
express them (INV-15, INV-16). Measured support: across 60 context-observations,
`'wasm-unsafe-eval'` never widened `eval`, `new Function` or string-`setTimeout`
(W1-S02a-2a-1, W1-S02a-2a-2).

### Standing requirement for the perception and server workstreams

G5 is a property that must be **preserved**, and it is the kind that erodes quietly. Any
future change that lets a value cross the trust boundary into a `WebAssembly.*` call, a
`wasmBinary` assignment, or a dynamic `import()` re-opens it. Two rules follow:

1. `ort.env.wasm.wasmBinary` is assigned in **exactly one place**. A second assignment is a
   review failure regardless of how the bytes were obtained.
2. `ort.InferenceSession.create` is called in **exactly one place**
   (`createPinnedInferenceSession`). Direct calls bypass the C-1 realm guard.

---

## 4 · C-1 — the ordering constraint is enforced in code

ORT initialises its WebAssembly module **once per JS realm** and caches it. Installing a
verified `wasmBinary` after the first session in a realm is **silently ignored**, leaving
that realm unpinned for its lifetime.

"Install the pin first" is an ordering convention, and ordering conventions decay — so it
is asserted:

- `installVerifiedOrtRuntime()` throws `LATE_INSTALL` if the realm already created a session.
- `createPinnedInferenceSession()` throws `NOT_PINNED` if no pin is installed.
- The realm is marked as used **before** awaiting session creation, so a *failed* session
  still blocks a later install.

**Every realm that runs inference performs its own bootstrap.** This is a per-realm
property, not a per-extension one.

---

## 5 · What is still not covered

| # | Gap | Tracking |
|---|---|---|
| Threaded ORT (`numThreads > 1`) spawns workers that may fetch further assets | not covered; `numThreads = 1` is set explicitly | **S-02a-2a-3a** |
| The WebGPU execution provider may touch resources beyond the jsep artifact | not covered | **S-02a-2a-3b** |
| Glue integrity beyond packaging | not covered | **S-02a-2a-3c** |
| Firefox on **Linux** | `UNKNOWN` — not promoted by any result here | S-02a-1 |
| Invariant E mechanism **(2)** — Playwright cannot observe the MV3 offscreen document | **still broken; QG-04 unsigned** | **B-02**, issue #5 |

**Nothing in this document resolves B-02 or signs QG-04.**
