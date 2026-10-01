# M11 — production frame handoff: architecture review (in progress)

> **Status: REVIEW. Nothing here enables frame egress.** M11 decides and documents the production
> frame-handoff contract before any real remote frame egress exists. The proposed decision is
> [ADR-0012](../../../docs/adr/ADR-0012-production-frame-handoff.md) (PROPOSED). The QG-04 status
> is in [`qg04-matrix.md`](qg04-matrix.md). **Production frame egress is BLOCKED** (findings F1–F11
> below).

## Hypothesis

The architecture M10 closed can admit a production frame handoff — sanitized WebP + redaction
manifest + user goal, as QG-04 defines it — without bypassing the privacy boundary:

- through the single egress module;
- bound by one hash to the exact bytes sent;
- with a structure-only fallback that never carries an image.

This review tests that against the authoritative sources, and names what is missing.

## Environment

- **Source tree:** repository at `aaf9e88` (M10 closed), on W1. Read only; no code was executed for
  this review except the regression runs recorded under Actual result.
- **Sources read:**
  - the dossier v4.0 (`docs/dossier/PratiBimb-Engineering-Dossier-v4.0.txt`: Invariant E, "One
    payload, one hash", Fig. 4, Fig. 7, the fail-closed matrix, the threat table);
  - `docs/security/security-invariants.md` (INV-01..INV-25, the frozen verifier, the fail-closed
    matrix) and `docs/security/threat-model.md`;
  - `agentos/gates/README.md` (QG-04) and `docs/architecture/manifest-schema.md` (v1.1);
  - `docs/architecture/constitution.md`;
  - ADR-0001 (`connect-src` pin), ADR-0009 (gesture capture), ADR-0011 (text-region contract);
  - the M10 `decision.md` closeout;
  - code: `packages/egress` (`guard.ts`, `frame.ts`), `packages/privacy` (`handoff.ts`,
    `maskedArtifact.ts`, `ledger.ts`), `packages/reasoner` (`contract.ts`, `localModel.ts`,
    `fallback.ts`), `packages/security/src/csp.ts`, `apps/extension` (`wxt.config.ts`, offscreen
    `main.ts`, `extension-run.ts`, `remote-privacy-boundary.ts`).

## Expected result

- An exact extraction of what the repository and dossier REQUIRE of a frame handoff, with no schema
  invented from memory.
- A trace of today's egress path, with who owns each step.
- The point where a sanitized frame could join without a second route out.
- The list of what blocks production frame egress.

## Actual result

### 1. The authoritative requirements, verbatim where it matters

- **Invariant E** (dossier p.7): *"No outbound network request originates from the extension unless
  it was issued by the egress module, and the egress module issues no request unless the verifier has
  returned verified === true for a byte artifact whose hash equals the hash of the buffer being
  transmitted."* It is enforced four ways: a lint rule, a Playwright interception test, CSP
  `connect-src` to the configured server origin, and the hash pin.
- **One payload, one hash** (dossier p.7; QG-04 item 3): *"the encoded WebP frame and the serialized
  manifest, assembled into the exact multipart body that will go on the wire. That artifact is hashed.
  Verification runs against it. The egress module accepts a buffer only when its hash equals the hash
  the verifier signed."*
- **The wire** (dossier Fig. 4; constitution): *"sanitized context only — WebP frame + redaction
  manifest + user goal"*. The goal is a manifest field (`manifest-schema.md` v1.1: `goal`, "the
  user's stated goal, never page-derived text"), and so is `verified` ("the egress guard refuses to
  transmit unless this is `true` and the payload hash matches the pin").
- **The frozen verifier** (`security-invariants.md`): mask → encode q62 + decode back → full-frame
  OCR re-read → D2/D3 re-detect → vault value check → decide (12 px re-dilation, 3 failures → BLOCK).
  *"Blocked requests fall back to structure-only mode — manifest without image — and the user is
  told."*
- **The fail-closed matrix:** *"The assertion in every case is identical: zero outbound requests."*
- **QG-04:** 11 checklist items, all unchecked. *"No code may make a network call until this gate
  passes."* Status per item: `qg04-matrix.md`.
- **Invariants:**
  - INV-01: single egress module;
  - INV-02 and INV-03: the exact byte artifact, no mutation between hash and send;
  - INV-21: no plaintext in logs;
  - INV-22: verification is fail-closed;
  - INV-23: detector failure is a positive.
- **The schema's source of truth is the server's** (`manifest-schema.md` rule 2): *"The TypeScript
  types are generated from the same Pydantic models the server validates against."*
- **What is NOT defined anywhere in the repository or the dossier:**
  - the multipart part names, their order, the boundary, and the per-part content types;
  - the server's URL path and its response schema for a frame request;
  - how a visual-only mask, which has no PII class, appears in `redactions[]`;
  - a production server origin.

### 2. Today's egress path, end to end

```
user goal (side panel) ─► RUN_TASK (service worker carries the request) ─► offscreen document
  └─ orchestrator: OBSERVE (content script, geometry + names) ─► perception summary (no pixels)
     ─► @pratibimb/privacy sanitize ─► HandoffDraft ─► verifyHandoff (7 fail-closed checks incl. the
        value-aware scan) ─► VerifiedHandoff  (registry membership, no pixel-bearing field)
     ─► @pratibimb/reasoner localModelReasoner: body = chat-completions JSON
        { goal, fields, buttons, references } built ONLY from the VerifiedHandoff
     ─► @pratibimb/egress sendVerified: verified → loopback → declared tokens → vault scan →
        digest → fetch  (one JSON string)
     ─► a local model on 127.0.0.1 (DEFAULT_MODEL_ENDPOINT …:8977), or the in-process deterministic
        planner when no endpoint is given (no network at all)
```

| question | answer today |
|---|---|
| who owns egress | `@pratibimb/egress`: `sendVerified` for the structure JSON. `sendMaskVerifiedFrame` exists for frames but has no product caller (M10.7) |
| who serializes the goal | `localModelReasoner` puts `goal` into the chat body. The v1.1 manifest's `goal` field exists in `HandoffBody` |
| who owns the manifest | `@pratibimb/privacy` (`HandoffDraft` → `VerifiedHandoff`). Its `capture` block has no `format` / `q`, because no image is sent |
| who owns attestation | handoffs: `verifyHandoff` (WeakSet). Frames: `attestMaskedFrame` (WeakSet, MASK_VERIFIED, frame bytes only) |
| what the service worker sees | the RUN_TASK request and replies, never pixels (M10.6/M10.7/M10.8 audits). Capture handles only |
| what the reasoner receives | goal, element ids/roles/accessible names, which fields are empty, reference tokens with class and shape hints. **No image** |
| what leaves the browser | in product builds: that JSON body to the configured loopback endpoint, or nothing. CSP `connect-src 'self' http://127.0.0.1:8995` |

**Where a frame could join without a second route out:**

- **The join point:** the frame would ride in the same request as the verified manifest, assembled by
  one builder, hashed once and handed to `@pratibimb/egress`.
- **Who builds it:** the perception realm owns the frame; `@pratibimb/privacy` owns the manifest and
  the verdict; `@pratibimb/egress` owns the socket.
- **What must not happen:**
  - a second fetch site, which is why `sendMaskVerifiedFrame` cannot simply be called next to
    `sendVerified`: two requests are two artifacts, and QG-04 requires one;
  - an attestation that covers only part of the body.

### 3. Boundary map (production handoff, as the sources require it)

| boundary | allowed | prohibited | responsible | verified at | on failure |
|---|---|---|---|---|---|
| CAPTURE | a gesture-granted tab frame, in the offscreen document | any capture without a grant; pixels in the service worker | capture authority + perception realm (ADR-0009) | grant + ticket checks | no frame (refusal code) |
| LOCAL PERCEPTION | raw RGBA, briefly, in the realm; the TR-01 worker's scrubbed copy | raw pixels anywhere else; OCR text | perception realm | M10.6 audits | REFUSED (no frame) or masked whole (INV-23) |
| MASK | opaque fill in place; the raw bitmap closed | blur, pixelation, a kept raw copy | `sanitizeFrame` / `fillOpaque` | M10.5 digests | REFUSED → nothing kept |
| SANITIZED WEBP | q62 still WebP, pixels only, no metadata chunks | ICC/EXIF/XMP, animation | realm codec (`stripWebpColourProfile`) | `attestMaskedFrame` (decoded mask) | no artifact |
| ATTESTATION | a registry-held verdict binding the exact BODY hash | flags, self-asserted verdicts, a frame-only hash for a multi-part body | `@pratibimb/privacy` | registry membership + hash pin | no send |
| EGRESS | one request, one body, to the configured server origin | any other fetch site, origin or retry-without-verification | `@pratibimb/egress` | QG-04 items 1–5 | zero outbound requests; structure-only only where allowed |
| SERVER | the body; schema-validated, tripwire-scanned | plaintext in logs (INV-21); a best-effort parse (INV-11) | server (does not exist) | Pydantic + tripwire | reject the request |

### 4. Findings — what blocks production frame egress

| # | finding | evidence |
|---|---|---|
| **F1** | **No configured production origin.** CSP pins `connect-src 'self' http://127.0.0.1:8995` (the loopback collector); `buildExtensionPagesCsp` takes one origin and none is configured for production | `wxt.config.ts` `HOST_COLLECTOR_ORIGIN`; ADR-0001 §7.2 |
| **F2** | **QG-04 item 1 is not met.** There is no lint rule, and the product offscreen document calls `fetch` outside the egress module: two evidence-experiment POSTs (`CSP_PROBE` line 194, `E4_EMIT` line 223) and two packaged-asset reads (lines 39, 114). Per-module source scans exist (reasoner, worker), but no repository-wide gate | `apps/extension/host/offscreen/main.ts` |
| **F3** | **`verified === true` cannot honestly be produced for a frame.** Frozen verifier steps 3–5 need an `OCRProvider`, and none is admissible (ADR-0011). M10's MASK_VERIFIED covers steps 1–2; DETECTOR_VERIFIED is a test-only substitute for 3–4, needs 362 MiB WASM and about 1.7 s, and is not the frozen verifier | M10 `decision.md`; M10.8 |
| **F4** | **The v1.1 manifest cannot represent visual-only masks.** Every `redactions[]` entry needs a PII `class` and `tier`; `detectors` admits D1/D2 only. An unread visual region has no class. Changing this bumps `manifest_version` (an ADR-level change). The `capture` block has no `format`/`q` today | `manifest-schema.md`; `handoff.ts` |
| **F5** | **The attestation binds the frame, not the body.** `MaskVerifiedFrame.sha256` covers the WebP only; QG-04 binds verification to the multipart body | `maskedArtifact.ts`; QG-04 item 4 |
| **F6** | **No server exists.** Neither FastAPI nor Pydantic models nor a tripwire. The manifest's declared source of truth (the server's models) does not exist | repository |
| **F7** | **BLOCK → structure-only is not built for frames.** But structure-only IS today's only product behaviour, so the fallback exists as a path; what is missing is the decision step and the user notice | `localModel.ts`; dossier p.15 |
| **F8** | **M9 J7 is open** (stream-route re-screening; M10.6 finding). For canvas/image text, *"detector coverage is the entire safety story"*. Without the OCR re-read, nothing behind the detector catches a miss. So J7 is a prerequisite for frames, by the sources' own reasoning | `docs/perception/redaction-evaluation.md` §2; M9 `decision.md` J7 |
| **F9** | **The fail-closed matrix has not been run for frame egress** ("zero outbound requests" per row, Playwright interception) | QG-04 item 6 |
| **F10** | **No duplicate-send protection** for frames | `frame.ts` |
| **F11** | **The semantic label is not composited** after the fill (frozen rule: fill, then label). The token appears only in the manifest | `security-invariants.md`; M10.5 |

### 5. Regression of the M10 loopback mechanism (Part T)

Recorded in `decision.md` once run; the historical M10 logs are not rewritten.

## Conclusion

Production frame egress cannot be enabled now. F1, F3, F4, F6 and F8 are owner or configuration
decisions; F2, F5, F9, F10 and F11 are implementation work behind those decisions. The contract can
still be written, and its fail-closed decision logic tested, without sending a frame anywhere: ADR-0012
and the M11 contract tests do exactly that.

## Reproducibility

Every claim above names its source file. The fetch inventory is reproducible with:

```
grep -rn "fetch(" apps/extension/host apps/extension/host-lib apps/extension/entrypoints packages/*/src --include=*.ts
```
