---
id: ADR-0012
title: "Production frame handoff: the QG-04 artifact, its admissible verification state, the single egress authority and the structure-only fallback"
version: 1.0
status: PARTIALLY APPROVED (M12, §16) — §14 items 1, 3, 4/B6 (unconfigured) and 5 decided by the owner; items 2 (B2) and 6 (B5) open; production frame egress BLOCKED (§13)
owner: pratibimb-architect
proposed_by: pratibimb-architect
created: 2026-10-01
modified: 2026-10-01 (M12 §16)
supersedes: none
amends_on_approval: "docs/architecture/manifest-schema.md (v1.1 → v1.2, §6) — APPLIED in M12"
related_gates: QG-04 (UNSIGNED), QG-03 (any verifier model)
related_invariants: INV-01, INV-02, INV-03, INV-11, INV-21, INV-22, INV-23, INV-24 — none weakened
evidence: artifacts/experiments/M11-production-frame-handoff/ (review, QG-04 matrix); artifacts/experiments/M12-qg04-enforcement/ (enforcement, interception, stream RE-1); M10 (artifacts/experiments/M10-visual-redaction-integration/)
---

# ADR-0012 — Production frame handoff

> **STATUS: PROPOSED.** Nothing here enables a frame to leave the client, and the product is
> unchanged. The decision makes the contract explicit and testable. It is effective only on the
> owner's decisions in §14. **Production frame egress is BLOCKED** until every blocker in §13 is
> resolved and QG-04 is signed.

## 1. Context

M10 closed the local chain on the real gesture route: capture → TR-01 → fail-closed plan → in-place
mask → sanitized WebP (MASK_VERIFIED) → a test-only loopback sink, with an independent test-only
re-read (DETECTOR_VERIFIED). The dossier's product sends more than that: *"sanitized context only —
WebP frame + redaction manifest + user goal"*. Under Invariant E, that happens only when *"the
verifier has returned verified === true for a byte artifact whose hash equals the hash of the buffer
being transmitted"*, and that artifact is *"the encoded WebP frame and the serialized manifest,
assembled into the exact multipart body that will go on the wire"*.

The M11 review (`artifacts/experiments/M11-production-frame-handoff/README.md`) found eleven gaps
between today and that requirement (F1–F11). This ADR records the contract the gaps are measured
against.

## 2. Decision — five representations, never one "frame"

| representation | what it is | where it may exist | type / owner |
|---|---|---|---|
| **RAW FRAME** | the captured `ImageBitmap` and its RGBA before the fill | the perception realm only, until the fill. The bitmap closes at read | `perception-realm.ts` (local) |
| **SANITIZED RGBA** | the same buffer after the opaque fill, in place | the perception realm only (the kept frame) | `SanitizedFrame` |
| **SANITIZED WEBP** | q62 still WebP of the sanitized RGBA, colour profile stripped, no metadata chunks | the perception realm; then only inside an attested artifact | `browserWebpCodec` |
| **ATTESTED FRAME ARTIFACT** | the WebP plus a registry-held verdict on its decoded bytes | client memory | `MaskVerifiedFrame` today (MASK_VERIFIED, frame hash only) |
| **QG-04 WIRE PAYLOAD** | ONE multipart body: the serialized manifest + the attested WebP, hashed as a whole, attested as a whole | the egress module, then the wire | proposed `HandoffBody` (§4); not implemented for sending |

A function that accepts one of these never accepts another by structural accident. M10 already
enforces this for the first four. The fifth binds the whole body (§5).

## 3. Decision — verification states, and which one may leave

| state | meaning | produced by | admissible for QG-04 frame egress |
|---|---|---|---|
| `MASKED_LOCAL` | the fill ran in place on the kept frame | `sanitizeFrame` | **no** |
| `MASK_VERIFIED` | steps 1–2: the mask survives encode + decode | `attestMaskedFrame` (product code, M10.7) | **no** |
| `DETECTOR_VERIFIED` | a differential full-frame text-REGION re-read finds no text in a visual-only region | test-only verifier (M10.8); 362 MiB WASM, about 1.7 s per frame | **no** |
| `VERIFIED` | the frozen verifier, steps 1–6, including the OCR re-read, D2/D3 re-detection and the vault value check, with `verified === true` (Invariant E) | **nothing today** | **yes — the only admissible state** |

**Decision:**

- QG-04 frame egress admits `VERIFIED` only. The word is reserved for the frozen verifier's verdict,
  and nothing in the repository produces it today (F3).
- `MASK_VERIFIED` and `DETECTOR_VERIFIED` stay distinct, are recorded as such, and never satisfy the
  frame-egress check.
- Admitting a weaker state is a deviation from Invariant E. It needs its own ADR approved by the
  owner, and is not decided here.

**The two verifier directions, without a ranking:**

| | detector-based (M10.8, demonstrated) | OCR/value-aware (frozen steps 3–5) |
|---|---|---|
| matches the frozen verifier | no: it re-reads regions, not text, so D2/D3 and the vault check have no input | yes |
| evidence | 4 DPR × real gesture; blocks unmasked, mutated and stale artifacts | none in this repository; `PP-OCRv5_mobile_rec` screened (licence, WASM numerics) for a different role and rejected for that role |
| what it can miss | text the detector does not see: no backstop for a detector miss, which makes J7 decisive (F8) | text the recogniser cannot read; but a value-aware check starts from the vault, not the detector |
| resources | 362 MiB WASM at 1920; about 1.7 s per frame; over the 200 MB product budget | unmeasured |
| new model | no | yes, an `OCRProvider` adoption (QG-03, ADR, download) |
| plaintext risk | none: no text exists | text is recovered inside the verifier, and must never leave it (INV-21) |

**Neither is in the product, and the 362 MiB test verifier is not imported.** The production
verifier is BLOCKER B2 (§13).

## 4. Decision — the QG-04 payload (PROPOSED layout)

The sources fix the CONTENT: the WebP frame + the serialized manifest (with the goal inside it),
one multipart body, hashed once. They do not fix the LAYOUT, so this ADR proposes one:

```
POST <configured server origin><path: OWNER, §14>
content-type: multipart/form-data; boundary=pratibimb-<first 32 hex of the manifest part's SHA-256>
x-pratibimb-payload-sha256: <SHA-256 of the exact body bytes>
x-pratibimb-request-id: <request id, equal to manifest.request.id>

--<boundary>
content-disposition: form-data; name="manifest"
content-type: application/json; charset=utf-8

<manifest JSON, canonical: object keys sorted, no insignificant whitespace>
--<boundary>
content-disposition: form-data; name="frame"; filename="frame.webp"
content-type: image/webp

<the attested WebP bytes, unaltered>
--<boundary>--
```

- **Order:** `manifest`, then `frame`. No other part, and no other per-part header.
- **Line endings:** CRLF throughout, as RFC 7578 requires.
- **The boundary** is derived from content, so the body is deterministic. The builder refuses a
  boundary that occurs inside either part.
- **Structure-only (§8):** the same layout with the `manifest` part alone. It contains no image
  part and no image bytes.
- **Identity:** `request.id`, `request.session`, the manifest SHA-256, the frame SHA-256 and the
  body SHA-256 are all derivable from the body. The headers repeat two of them for routing, and
  the server checks them against the body (§10).
- **Size:** the frame part is bounded by the raw RGBA size of its own dimensions (w × h × 4). A WebP
  larger than the pixels it encodes is refused.
- **Errors:** a builder or check that cannot produce this exact body produces nothing. There is no
  partial body and no best-effort encoding.

## 5. Decision — attestation binds the BODY

- **What it binds:** the production attestation is a registry-held verdict over the body bytes, as
  `MaskVerifiedFrame` is today for the frame alone. It records:
  - the body, manifest and frame SHA-256;
  - the frame's size in bytes and its dimensions;
  - the request and session ids;
  - the verification state;
  - the TR-01 model and ORT WASM hashes, and `manifest_version` + contract version.
- **Who checks it:** egress checks registry membership, then re-hashes a private copy of the body,
  and sends that copy (M10.7's discipline, extended from the frame to the body).
- **One shot:** an attestation is spent on its first send. A second send of the same body is refused
  (F10).
- **What breaks it:** a frame attested for one request, presented with another request's manifest,
  is a mismatch, not a fallback. So is any mutation after attestation.

## 6. Decision — the manifest (v1.2, DRAFTED, not applied)

v1.1 cannot carry M10's visual-only masks (F4), because every `redactions[]` entry needs a PII class.
Proposed v1.2, ADR-level, applied only on approval:

- **`capture`:** gains the frozen example's `format: "webp"` and `q: 62` when a frame is present,
  and `format: "none"` in structure-only mode.
- **New `visual_masks[]`:** `{ region_id, kind, bbox, method: "opaque_fill", reason }`.
  - `region_id` is `canvas:N` or `img:N`, positional only.
  - `kind` is `canvas` or `img`.
  - `bbox` is in CSS px (INV-24).
  - `reason` is `DETECTED` or `FAIL_CLOSED` with its code.
  - No class, no token, no length, no text.
- **New `request`:** `{ id, session }`, the run identity.
- **Allowed content:** region ids, rectangles, counts, hashes, status codes, plus v1.1's existing
  fields: element ids, roles and accessible names (PUBLIC tier), and reference tokens with class and
  shape hints.
- **Prohibited:** OCR text, page text beyond v1.1's accessible names, vault values, image bytes, DOM
  markup, selectors, and URLs other than v1.1's `capture.origin`. `capture.origin` is required by the
  frozen v1.1 contract; removing it is a separate owner decision.

The value-aware scan runs over the serialized manifest part as it runs today over the JSON body.

## 7. Decision — one egress authority, one destination

- **One authority:** `@pratibimb/egress` remains the only module that performs network I/O.
  - Production frame transmission is one new function there, taking an attested body.
  - `sendMaskVerifiedFrame` stays test-only (frame alone, loopback only) and has no product caller.
  - No fetch in perception, the offscreen document, a worker or codec code.
- **The two evidence POSTs** in the product offscreen document (`CSP_PROBE`, `E4_EMIT`) move behind
  build-time evidence aliases before QG-04 can pass (F2).
- **Destinations:**
  - **production:** exactly one configured server origin, compared exactly (scheme, host, port), and
    pinned identically in CSP `connect-src` and in the egress configuration;
  - **test:** the 127.0.0.1 sink, in evidence builds only.
  - No destination is chosen by a page, a model or a message.
  - **No production origin is configured today: BLOCKED (B1).**

## 8. Decision — BLOCK and the structure-only fallback

**Every frame-path failure produces NO FRAME.** That covers:

- no sanitized artifact (including REFUSED);
- a missing, non-admissible or stale attestation;
- a hash or size mismatch;
- metadata in the WebP;
- an empty or oversized frame;
- a verifier BLOCK;
- frame egress disabled.

**What then:**

- **Structure-only applies only when the manifest itself is sound.**
  - **Sent:** the manifest part alone (`capture.format: "none"`), through the same egress authority,
    with the same verification of the manifest that structure-only uses today.
  - **Omitted:** every image byte.
  - **The reasoner is told** by the absence of the frame part and by `capture.format: "none"`.
  - **The user is told:** the ledger and side panel show "image withheld" and the reason code. The
    run continues on structure, with unchanged action authority.
- **STOP instead,** with no request at all, for:
  - a missing goal;
  - a malformed manifest, or plaintext in it;
  - no configured production origin, or a destination that is not it;
  - a duplicate send.
- **If structure-only itself is refused,** the run stops, and the existing fallback policy applies
  unchanged: a failed model may be answered by the in-process deterministic planner, which needs no
  network, and a misbehaving model stops the run.
- **Never:** a frame failure followed by a raw frame, an unverified frame, or a retry without
  verification.

## 9. Decision — the stream-geometry finding is a prerequisite

For canvas/image text, *"detector coverage is the entire safety story"*
(`docs/perception/redaction-evaluation.md` §2), until a re-read that reads text exists. M9's J7
(re-screening on the real capture path) is therefore a prerequisite for frame egress. The reason is
the sources' own argument that nothing behind the detector catches a miss, not intuition. It stays
BLOCKER B5 until J7 is closed on stream frames, or until an OCR/value-aware verifier provides the
backstop.

## 10. Decision — server contract (interface only; no server exists)

- **What the server receives:** the §4 body.
- **What it must check:**
  - exactly the two parts (or one, structure-only), in order, with those names and content types;
  - the body SHA-256 equals `x-pratibimb-payload-sha256`, and `request.id` equals
    `x-pratibimb-request-id`;
  - the manifest validates against the generated schema (Pydantic v2; INV-11: failure aborts);
  - the frame is a still WebP with no metadata chunk, sized to `capture.w × capture.h`;
  - the PII tripwire runs over the manifest and the frame, and logs class, request id, bbox and
    detector only (INV-21).
- **What it answers:** a plan in placeholders, which the client re-validates (INV-12).
- **Auth:** no API key or secret ever enters the extension source or bundle. If the server requires
  credentials, how the client presents them is an owner/configuration prerequisite (B6), not a
  repository change.

## 11. Rollback, observability, tests

- **Rollback:**
  - Frame egress ships off and stays off behind a build-time switch whose only value today is
    `DISABLED`. Turning it off again restores structure-only exactly, with no state to migrate.
  - M11's contract code has no product caller.
- **Observability:** the ledger records, per request:
  - the body, manifest and frame digests;
  - the frame's byte size;
  - the verification state;
  - the destination class (`PRODUCTION`/`TEST`);
  - the mode (`FRAME`/`STRUCTURE_ONLY`/`STOP`) and its reason code, and the response status.

  It never records bytes, text or values.
- **Tests:**
  - **M11:** contract tests in Node, covering the payload builder and parser, the body hash pin, and
    every fail-closed case → STRUCTURE_ONLY or STOP, never FRAME.
  - **Before enabling:** a Playwright interception suite per fail-closed row (QG-04 item 6), and a
    repository-wide network-call gate (item 1).
  - **Then:** a server schema suite, and a real-gesture E2E to the configured origin.

## 12. Resources

- **Today's product perception:** 157.5 MiB of WASM.
- **The M10 test verifier:** 362 MiB, and not in the product.
- **M11's contract code** adds no model and no runtime memory beyond the body itself: about 4.2–4.3 KB
  of WebP on the M10 fixture, plus the manifest.
- **A production verifier's budget** is undecided (B2).

## 13. Blockers to production frame egress

| # | blocker | needs |
|---|---|---|
| **B1** | no configured production server origin | owner/configuration |
| **B2** | no verifier can return `VERIFIED` for a frame (no admissible `OCRProvider`; DETECTOR_VERIFIED is test-only, 362 MiB) | owner: adopt an `OCRProvider` for the verifier role (QG-03 + ADR), or an ADR amending Invariant E |
| **B3** | manifest v1.1 cannot carry visual-only masks; no run identity in the manifest | owner approval of v1.2 (§6) |
| **B4** | no server, so no schema source of truth, no tripwire and no path | owner: server scope |
| **B5** | J7 open: stream-route detector coverage (M10.6) | measurement (J7) or B2's backstop |
| **B6** | server authentication undefined; no secret may enter the extension | owner/configuration |
| **B7** | QG-04 items 1 and 6: no repository-wide network gate (two evidence POSTs in the product offscreen document); no interception suite for the frame path | implementation, after B1–B4 |

## 14. Owner decisions required

1. Approve or amend the representation and state taxonomy (§2, §3), and that only `VERIFIED` may leave.
2. B2: adopt an `OCRProvider` for the verifier role, accept a weaker admissible state (Invariant E
   amendment), or keep frame egress blocked.
3. B3: approve manifest v1.2 (`visual_masks[]`, `request`, `capture.format`) or another
   representation.
4. B1/B4/B6: the production server origin, the server's scope and path, and its authentication model.
5. Approve the §4 multipart layout, or substitute the server's own.
6. B5: the evidence required to close J7 for frame egress.

## 15. What this ADR does not do

- It enables no frame egress.
- It adds no origin, permission, API key, model or OCR.
- It does not connect a reasoner or server.
- It does not put the M10 verifier in the product.
- It does not change capture, detection, masking, actions or the demo.

## 16. M12 — owner decisions and implementation record (2026-10-01)

The owner decided, in the M12 brief:

- §14.1 — the taxonomy is approved, and only `VERIFIED` may authorize frame egress. DETECTOR_VERIFIED
  is not promoted, and Invariant E is unchanged.
- §14.3 — manifest v1.2 is approved (applied to `docs/architecture/manifest-schema.md`).
- §14.5 — the §4 multipart layout is approved.
- §14.4 / B1 / B6 — the production origin stays **unconfigured** and authentication stays
  **undefined**. Neither is invented.
- The M10/M11 loopback stays test-only.

§14.2 (B2) and §14.6 (B5) are **not** decided.

M12 implemented the enforcement layer this ADR specifies, without enabling frame egress. The record is
[`artifacts/experiments/M12-qg04-enforcement/`](../../artifacts/experiments/M12-qg04-enforcement/README.md);
the QG-04 status is in its
[`qg04-matrix.md`](../../artifacts/experiments/M12-qg04-enforcement/qg04-matrix.md).

| § | blocker | after M12 |
|---|---|---|
| 13 | B1 | OPEN (owner: unconfigured) |
| 13 | B2 | OPEN |
| 13 | B3 | **RESOLVED** (v1.2 applied) |
| 13 | B4 | OPEN (an isolated request parser exists; no server) |
| 13 | B5 | OPEN. Stream RE-1 at four device scales: G1–G3 pass with 0 / 1224 exposed, but **G4 failed** at 1.25 and 1.5 (F-M12-2). |
| 13 | B6 | OPEN (owner: undefined) |
| 13 | B7 | PARTIAL. The repository network gate and the interception suite are MET. **F-M12-1:** the ADR-0001 CSP leaves `img-src` and `frame-src` open, which injected code used; closing it needs an ADR on the CSP. |

Production frame egress is impossible by three independent locks:

1. Nothing can attest VERIFIED.
2. The production configuration has no origin and no authentication.
3. The production sender contains no transport.

