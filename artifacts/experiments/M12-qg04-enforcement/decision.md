# M12 — decision record

**Verdict:**

- **QG-04 enforcement infrastructure: BUILT AND VERIFIED.**
- **Production frame egress: IMPOSSIBLE**, by three independent locks. **QG-04: UNSIGNED.**
- **J7 / B5: OPEN.** **B7: OPEN** (F-M12-1).

## Owner decisions applied (M12 brief, 2026-10-01)

| # | decision | applied as |
|---|---|---|
| 1 | The taxonomy RAW_FRAME / SANITIZED_RGBA / SANITIZED_WEBP / ATTESTED_FRAME_ARTIFACT / QG04_WIRE_PAYLOAD; never interchangeable | Distinct types. Only `attestHandoffBody` makes a wire payload, and only from a verified handoff and an untampered MaskVerifiedFrame. |
| 2 | Only VERIFIED may authorize frame egress; MASKED_LOCAL, MASK_VERIFIED, DETECTOR_VERIFIED, BLOCKED and REFUSED never do | `FRAME_EGRESS_STATE = "VERIFIED"`; the attested states are STRUCTURE_ONLY and MASK_VERIFIED; there is **no VERIFIED constructor**. DETECTOR_VERIFIED is not promoted, and Invariant E is unchanged. |
| 3 | Manifest v1.2 approved | `packages/privacy/src/manifestV12.ts`, with a strict parser and canonical serializer; `docs/architecture/manifest-schema.md` amended |
| 4 | Multipart: manifest (JSON), then frame (WebP), plus body hash and request-id | `buildHandoffBody` and `validateQg04Request` |
| 5 | Production origin UNCONFIGURED | `PRODUCTION_HANDOFF_CONFIG.origin = null` → `CONFIGURATION_MISSING`. No loopback, IP or placeholder is used as production config. |
| 6 | Authentication undefined | `authentication: {state: "NOT_CONFIGURED"}`, the only state the type allows → `AUTHENTICATION_NOT_CONFIGURED`. No credential and no key. |
| 7 | The M10/M11 loopback stays test-only | `sendMaskVerifiedFrame` is reachable only from test-build probes. The product imports only `sendVerified` (structure JSON). |

## Findings

- **F-M12-1 (B7):** ADR-0001's CSP restricts `connect-src`, `script-src` and `object-src` only.
  - Code injected into the offscreen document reached an independent foreign origin through `<img>`
    and `<iframe>`, and could POST to the pinned loopback.
  - No product code does so (static gate, bundle scan).
  - It bounds what code running in the realm can do, and it is the open part of B7.
  - **Needs an ADR** amending the approved CSP (e.g. `default-src 'none'` with the needed sources).
    It also needs a decision on whether a product build should pin the test collector `127.0.0.1:8995`
    at all.
- **F-M12-2 (B5/J7):** on real gesture-stream frames at device scales 1, 1.25, 1.5 and 2:
  - RE-1 G1–G3 pass on all six held-out images, with **0 / 1224** sensitive glyphs exposed.
  - **G4 fails at 1.25 (H4) and 1.5 (H3).** Three captures of the same displayed image gave different
    boxes, though the detection count was stable.
  - The product route is CSS-capped (scaleToCss 1 at every scale). The device-to-CSS downscale changes
    the boxes by up to 3.017 px between scales and against M8.1's screenshot boxes.
  - Formal run 1 did not record how far the later passes moved. The harness now records it for a
    run 2.
  - **The existing criteria are not met; J7 is not closed.**

## Blockers after M12

| # | before | after M12 |
|---|---|---|
| B1 | no production origin | **OPEN** (by owner decision 5) |
| B2 | no verifier returns VERIFIED | **OPEN** |
| B3 | manifest v1.1 cannot carry visual masks | **RESOLVED:** v1.2 approved and applied |
| B4 | no server | **OPEN.** An isolated request parser exists (`validateQg04Request`); there is no server. |
| B5 | J7 open | **OPEN:** G4 failed on stream frames (F-M12-2) |
| B6 | authentication undefined | **OPEN** (by owner decision 6) |
| B7 | no network gate and no interception suite | **PARTIAL:** the source gate and interception suite are MET; **F-M12-1 open** |

## Next owner decisions

1. **F-M12-1:** amend ADR-0001's CSP to close non-`connect-src` channels, and decide whether the
   product build pins the test collector origin.
2. **F-M12-2 / J7:** either authorize a stream RE-1 run 2, which now records per-pass movement, to
   characterise the non-determinism; or rule what evidence would close J7 given a CSS-capped route
   (ADR-0012 §14.6).
3. **B2:** a verifier that can return VERIFIED (an OCRProvider under QG-03), which remains the gating
   decision for any frame egress.
