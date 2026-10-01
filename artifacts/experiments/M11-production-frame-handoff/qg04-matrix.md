# QG-04 implementation matrix — frame handoff (M11)

Requirements are QG-04's eleven checklist items (`agentos/gates/README.md`), in its own order, plus
the structure-only rule from the frozen verifier (`security-invariants.md`). Invariant E's four
enforcement mechanisms (dossier p.7) are QG-04 items 1, 2, 4 and 6. Nothing here is a requirement the
sources do not state.

**Status key:**

- **MET** — implemented and evidenced.
- **PARTIAL** — part implemented.
- **NOT MET** — nothing implemented.
- **BLOCKED** — cannot proceed without an owner, configuration or ADR decision.

| # | requirement (QG-04) | current product state | required change | security implication | test | status | blocker |
|---|---|---|---|---|---|---|---|
| 1 | Lint rule fails the build on `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` outside the egress module | no lint config; per-module source scans only (reasoner, TR-01 worker, redaction, frame code); **4 `fetch` calls in the product offscreen document** (2 evidence POSTs: `CSP_PROBE`, `E4_EMIT`; 2 packaged-asset reads) | a repository-wide gate (lint rule or a build-failing source scan); evidence POSTs moved behind build-time evidence aliases, as `#tr01-probe` is; packaged-asset reads either routed through a non-network loader or explicitly exempted by an ADR | a second outbound path exists today in product code, reachable only from the service worker | repository-wide scan test over every bundled entry | **NOT MET** | F2 |
| 2 | CSP restricts `connect-src` to the configured server origin | `connect-src 'self' http://127.0.0.1:8995` (loopback collector); `buildExtensionPagesCsp` builds the policy for one origin | configure the production server origin; build the policy for it | without it, a frame has nowhere permitted to go, which is correct today | `csp.test.ts` (exists, for the builder) + a manifest assertion for the configured origin | **BLOCKED** | F1 (no production origin) |
| 3 | Payload constructed once: WebP frame + serialized manifest, one multipart body | structure only: one JSON chat body; frames sent alone (test-only, M10.7) | one builder, one body: `manifest` + `frame` parts (layout proposed in ADR-0012) | two requests would be two artifacts, with no single hash | M11 contract tests (builder determinism, part order, boundary) | **NOT MET** (contract proposed and tested, not wired) | F4 (manifest cannot carry visual masks), F6 (no server schema) |
| 4 | Body hashed; verification against it; egress accepts only a buffer whose hash equals the verifier's signed hash | handoff: digest of the JSON at send; frame: hash pin over the WebP only (M10.7) | attest the BODY hash; egress re-hashes the body before sending | a frame-only hash leaves the manifest part unpinned | M11: mutation of either part → refusal | **PARTIAL** | F3, F5 |
| 5 | Nothing re-encoded, re-serialized or mutated between hash and send | met for the JSON (one string) and for the frame (private copy + re-hash) | the same for the body | — | M10.7 tamper tests; M11 body-mutation tests | **PARTIAL** | — |
| 6 | Playwright interception asserts zero outbound requests for every fail-closed matrix row | rows run in Node; M10.7/M10.8 assert zero sink arrivals for REFUSED and refused attempts on loopback | an interception suite per matrix row, frame path included | the claim "zero requests" needs the browser's own count | extension-level interception per row | **NOT MET** | F9 |
| 7 | Verification runs against the decoded WebP bytes actually transmitted | MET for MASK_VERIFIED (decode-back in the realm) and DETECTOR_VERIFIED (decode of the received bytes) | none for steps 1–2 | — | M10.7, M10.8 | **MET** (steps 1–2) | — |
| 8 | The second verification pass differs in scope and threshold | DETECTOR_VERIFIED re-read is full-frame at 1920 / box 0.3, against the product's 960 / 0.6 — test-only | a production second pass (the frozen one is OCR) | without it, a detector miss has no backstop | M10.8 | **PARTIAL** (test-only, not the frozen pass) | F3, F8 |
| 9 | The value-aware residual check runs and never logs the value | runs for the structure JSON (`verifyHandoff` step 6, egress leak scan); NOT for frames (no recovered text) | OCR, or an owner decision that frames carry no vault values by another route | a value rendered in pixels can only be caught by reading pixels | `handoff.test.ts` (structure); frames: none possible | **PARTIAL** (structure only) | F3 |
| 10 | Vault memory-only; destroyed on session end, tab change, before origin change | implemented (privacy package, INV-04..06) | none for M11 | — | existing vault tests | **MET** (outside M11's scope; unchanged) | — |
| 11 | No component logs secret plaintext — verifier, ledger and the server tripwire | client side: tests exist; the server tripwire does not exist | server tripwire, metadata-only | — | server-side tests (no server) | **PARTIAL** | F6 |
| S | Blocked requests fall back to structure-only mode — manifest without image — and the user is told | structure-only is today's only behaviour; there is no frame decision and no user notice | a decision step: frame admissible → frame body; otherwise structure-only with a reason shown; never an image in the fallback | a fallback that carried any image would bypass the verifier | M11 decision tests: every frame refusal → STRUCTURE_ONLY or STOP, never FRAME | **PARTIAL** (decision tested, not wired) | F7 |

**Gate verdict: QG-04 UNSIGNED.**

- Items 1, 2, 3 and 6 are not met.
- Items 2 and 3 are blocked on owner or configuration decisions.
- No frame may leave the client in production until every row is MET.
