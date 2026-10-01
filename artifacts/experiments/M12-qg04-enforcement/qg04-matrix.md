# QG-04 implementation matrix — after M12

This supersedes, as a status record only, the M11 matrix
([`../M11-production-frame-handoff/qg04-matrix.md`](../M11-production-frame-handoff/qg04-matrix.md)).
That matrix is kept unchanged as the M11 record. The rows and status key are M11's.

**Status key:**

- **MET** — implemented and evidenced.
- **PARTIAL** — part implemented.
- **NOT MET** — nothing implemented.
- **BLOCKED** — cannot proceed without an owner, configuration or ADR decision.

| # | requirement (QG-04) | after M12 | evidence | status | still blocked by |
|---|---|---|---|---|---|
| 1 | Lint rule fails the build on network primitives outside the egress module | A repository-wide source gate: every primitive in product source sits on an exact-count allowlist (egress authority, packaged-resource reads, pinned loaders, test-build-only probes); a new call fails. `CSP_PROBE`/`E4_EMIT` moved behind `#egress-evidence-probe`. | `networkBoundary.test.ts` (mutation-checked); interception phase A: absent from the product bundle and answered `UNKNOWN_KIND` | **MET** | — |
| 2 | CSP restricts `connect-src` to the configured server origin | Unchanged: `connect-src 'self' http://127.0.0.1:8995`, ADR-0001. No production origin is configured, and M12 invented none. **F-M12-1:** the policy does not restrict `img-src` or `frame-src`, so code injected into the offscreen document reached a foreign origin through `<img>` and `<iframe>`. | interception phase A: 0 `connect-src` arrivals, 2 non-`connect-src` arrivals | **BLOCKED** | B1; F-M12-1 needs a CSP ADR |
| 3 | Payload built once: frame + serialized manifest, one multipart body | `buildHandoffBody`: manifest v1.2, canonical, then a WebP part; deterministic; or one part for structure-only | `qg04.test.ts` 1–6; phase B (a real MASK_VERIFIED body, 8429 B, parses with its frame part) | **MET** (contract and builder; no production server) | B4 for the server's schema |
| 4 | Body hashed; egress accepts only a buffer whose hash equals the attested one | `attestHandoffBody` makes a whole-body attestation (frozen, registered, single-use); `sendProductionHandoff` re-hashes and re-parses before anything else can happen | `qg04.test.ts` 7–11; phase B (forged attestations → `NOT_ATTESTED`) | **MET** | — |
| 5 | Nothing mutated between hash and send | A private body copy, `attestedBody()` returns a copy, re-hash on send | `qg04.test.ts` 9 | **MET** | — |
| 6 | Interception asserts zero outbound requests for every fail-closed row | A browser interception suite: CDP Network on the offscreen document and worker, plus the sink and a foreign origin, in product and evidence builds. Each refused state, forgery, raw frame, malformed payload and fallback: 0 requests. The one permitted test send: 1. | `logs/w1-cft-qg04-interception.json` | **MET** for the frame path built so far; production transport does not exist | — |
| 7 | Verification against the decoded WebP bytes transmitted | unchanged (M10.7/M10.8) | — | **MET** (steps 1–2) | — |
| 8 | Second pass differs in scope and threshold | unchanged; DETECTOR_VERIFIED stays test-only and non-egress (owner decision M12-2) | — | **PARTIAL** | B2 |
| 9 | Value-aware residual check | unchanged (structure only) | — | **PARTIAL** | B2 |
| 10 | Vault memory-only | unchanged | — | **MET** | — |
| 11 | No component logs secret plaintext | unchanged; `validateQg04Request` (an isolated server parser) never reads a value | — | **PARTIAL** | B4 |
| S | Blocked → structure-only, manifest without image, user told | `planHandoff` handles every frame problem (BLOCK, REFUSED, raw, tampered, stale, wrong run, inadmissible state, unadmitted verdict): STRUCTURE_ONLY with an `IMAGE_WITHHELD` notice and a reason, and no image byte | `qg04Fallback.test.ts`; phase B (five fallbacks, 0 image bytes) | **MET** (decision and body; no UI wiring yet) | — |

## The production send itself

Its gates, in order, each refusing before any I/O:

1. `NOT_ATTESTED`
2. `ATTESTATION_SPENT`
3. `RUN_IDENTITY_MISMATCH`
4. `STATE_NOT_ADMISSIBLE` (a frame needs VERIFIED)
5. `BODY_HASH_MISMATCH` / `PAYLOAD_INVALID`
6. `CONFIGURATION_MISSING` (origin `null`)
7. `CONFIGURATION_INVALID`
8. `DESTINATION_NOT_CONFIGURED_ORIGIN`
9. `AUTHENTICATION_NOT_CONFIGURED`
10. `PRODUCTION_TRANSPORT_ABSENT` (the module contains no network code)

## Gate verdict: QG-04 UNSIGNED

- Item 2 is blocked (B1, F-M12-1).
- Items 8, 9 and 11 are partial (B2, B4).
- B5 (J7) is open: stream RE-1 G4 failed in two of four windows.

No frame may leave the client in production.
