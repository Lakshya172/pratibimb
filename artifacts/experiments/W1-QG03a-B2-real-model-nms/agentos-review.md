---
id: W1-QG03a-B2-agentos-review
experiment: W1-QG03a-B2-real-model-nms
date: 2026-09-12
---

# QG-03a-B2 — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author.
> **Not independent human review** and not presented as one.

## `pratibimb-architect` — CONDITIONAL_PASS

**Is the B acceptance criterion justified?**
- The evidence supports **reusing** the pre-registered detector criterion, applied at
  **measured** backend noise per machine × browser × backend cell. It is met 20/20 here.
- The QG-03a proposal (a grounding-based criterion for iid noise) turns out to be aimed at the
  wrong noise model: iid noise is shown not to represent backend noise.
- No new number is invented.
- Formal adoption is **ARCHITECT APPROVAL REQUIRED** (QG-03a-B1).
- No architecture change and no ADR are needed for B2 itself.

## `browser-engineer` — PASS, with the context stated

**Were backend differences measured at the correct production boundary?** Yes, the ORT
output tensor that `decodeHeadOutput` consumes.
- It was produced with the production pin (`installVerifiedOrtRuntime`, JSEP wasm
  `db816fad…`), `createPinnedInferenceSession` and production options, on hash-identical
  input.
- The backend was **observed**: 180 GPU submits on each WebGPU cell, 0 on each WASM cell.
  Chrome's adapter is `amd/rdna-3`; Firefox's adapterInfo is empty.
- **Limit:** this was a page, not the extension. The extension cell is QG-03a-B3.

## `ml-engineer` — PASS; the detector stays UNADOPTED

**Does the exact model show meaningful NMS instability?** Not at real backend noise on this
machine: 0 swaps and 0 true failures.
- The instability is real under tie-breaking perturbations. Its trigger set is the model's
  1,402 exact score ties, reproduced by every backend.
- The margin is 2× on a non-UI stress page and 50× on real UI.
- No retrain, no threshold change and no adoption.

## `performance-engineer` — PASS

**What is the actual runtime cost?** Warm inference medians are:

| cell | warm inference median |
|---|---|
| Chrome WebGPU | 9.8 ms |
| Firefox WASM | 33 ms |
| Chrome WASM | 47.6 ms |
| Firefox WebGPU (headful) | 100 ms |

- Session creation takes 154–2,007 ms, and WebGPU's first inference includes a 0.8–2.9 s
  shader compile.
- Decode + NMS takes about 5 ms in-page (19.7 ms on the first Chrome WASM pass) and 6.7 ms
  median in Node.
- **The chosen approach, no NMS change, costs nothing.** The diagnostic perturbation overhead
  is harness-only and is not a production cost.

## `evaluation-qa-engineer` — PASS

**Is it reproducible and protected against prior harness errors?**
- The model identity is re-verified by every harness.
- Every fixture is verified against its committed hash.
- Every raw dump is verified against its logged hash, and the analysis refuses on mismatch.
- The input tensor is proven identical across cells.
- The backend is proven by submits, not labels.
- Float32 absorption is **measured** (1e-9 and 1e-8 are 400/400 rounded away) instead of
  being reported as "stable": that was the historical control's error.
- Swap and failure are separated, the historical error in the other direction.
- My own tie-saturation hypothesis ("scores at 1.0") was **tested and refuted** (0 scores at
  1.0) and is recorded as such.
- The guard is `qg03aB2Evidence.test.ts`.

## `privacy-security-engineer` — PASS; veto not engaged

- Loopback only, with throwaway profiles.
- No product network path; ADR-0001, the CSP, `connect-src`, the ORT pin, B-02 and QG-04 are
  untouched.
- The fixtures are synthetic pages; there is no PII.
- The model is gitignored and was never committed.
