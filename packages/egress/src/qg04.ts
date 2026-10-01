/**
 * M12 — QG-04 ENFORCEMENT: the whole-body attestation, the production sender's gates, and the server's
 * request check. ADR-0012 (owner decisions approved in M12). PRODUCTION FRAME EGRESS IS IMPOSSIBLE
 * here, by construction, for three independent reasons:
 *
 *   1. The only states this code can attest are `STRUCTURE_ONLY` and `MASK_VERIFIED`. A frame body
 *      needs `VERIFIED`, and no constructor of `VERIFIED` exists anywhere (ADR-0012 B2).
 *   2. `PRODUCTION_HANDOFF_CONFIG.origin` is `null` (B1), and the authentication type has a single
 *      state, `NOT_CONFIGURED` (B6).
 *   3. The sender has NO TRANSPORT. Past every gate it answers `PRODUCTION_TRANSPORT_ABSENT`. There is
 *      no `fetch` in this file, and `networkBoundary.test.ts` keeps it that way.
 *
 * ATTESTATION binds the EXACT body: its SHA-256 and size, the manifest's and the frame's SHA-256, the
 * frame's dimensions, the request and session ids, the verification state, the runtime identity and
 * the protocol version. It is built ONLY from a verified handoff (+ a MASK_VERIFIED frame) through
 * `buildManifestV12` and `buildHandoffBody`, so no caller supplies the manifest or the state.
 * Membership in a module-private registry IS the attestation. It is single-use. The sender re-hashes
 * and re-parses the body immediately before its last gate.
 *
 * The test-only loopback path (`sendMaskVerifiedFrame`) is separate and unchanged.
 */
import { buildManifestV12, isMaskVerifiedFrame, isVerifiedHandoff, sha256HexOfBytes, type MaskVerifiedFrame, type VerifiedHandoff } from "@pratibimb/privacy";

import { buildHandoffBody, parseHandoffBody } from "./handoffContract.js";
import { inspectWebp } from "./webpContainer.js";

export const QG04_PROTOCOL = "pratibimb-qg04/1" as const;

/**
 * The states this module can attest. `VERIFIED` is deliberately absent: frame egress needs it, and
 * only a future verifier could produce it (ADR-0012 §3, B2).
 */
export type AttestedState = "STRUCTURE_ONLY" | "MASK_VERIFIED";
/** The state a frame body needs before it may leave. Nothing here can attest it. */
export const FRAME_EGRESS_STATE = "VERIFIED" as const;

export interface RuntimeIdentity {
  readonly tr01ModelSha256: string | null;
  readonly ortWasmSha256: string | null;
}

export interface HandoffAttestation {
  readonly protocol: typeof QG04_PROTOCOL;
  readonly manifestVersion: "1.2";
  readonly contentType: string;
  readonly bodySha256: string;
  readonly bodyBytes: number;
  readonly manifestSha256: string;
  readonly frameSha256: string | null;
  readonly width: number;
  readonly height: number;
  readonly requestId: string;
  readonly sessionId: string;
  readonly state: AttestedState;
  readonly runtime: RuntimeIdentity;
}

/** Attestations this module produced, and the ones already spent. */
const ATTESTED = new WeakMap<object, Uint8Array>();
const SPENT = new WeakSet<object>();
export const isHandoffAttestation = (candidate: unknown): candidate is HandoffAttestation => typeof candidate === "object" && candidate !== null && ATTESTED.has(candidate);

export type AttestRefusal = "HANDOFF_NOT_VERIFIED" | "FRAME_NOT_MASK_VERIFIED" | "FRAME_HASH_MISMATCH" | "FRAME_NOT_A_STILL_WEBP" | "FRAME_SIZE_MISMATCH" | "OVERSIZED_FRAME" | "MANIFEST_NOT_BUILT" | "BODY_NOT_BUILT";

/**
 * Attest the exact body for a verified handoff, with the MASK_VERIFIED frame it describes, or without
 * one (structure-only). The manifest is built here, never passed in.
 */
export async function attestHandoffBody(input: { readonly handoff: VerifiedHandoff; readonly frame: MaskVerifiedFrame | null; readonly masksFrom?: MaskVerifiedFrame | null; readonly runtime: RuntimeIdentity }): Promise<{ readonly ok: true; readonly attestation: HandoffAttestation } | { readonly ok: false; readonly code: AttestRefusal; readonly detail: string }> {
  const no = (code: AttestRefusal, detail: string) => ({ ok: false as const, code, detail });
  if (!isVerifiedHandoff(input.handoff)) return no("HANDOFF_NOT_VERIFIED", "the handoff was not produced by the privacy verifier");
  const frame = input.frame;
  let frameBytes: Uint8Array | null = null;
  if (frame !== null) {
    if (!isMaskVerifiedFrame(frame)) return no("FRAME_NOT_MASK_VERIFIED", "the frame was not attested by the mask check");
    frameBytes = frame.bytes.slice();
    if ((await sha256HexOfBytes(frameBytes)) !== frame.sha256) return no("FRAME_HASH_MISMATCH", "the frame's bytes changed after the mask check");
    if (frameBytes.length > frame.width * frame.height * 4) return no("OVERSIZED_FRAME", "the WebP is larger than the pixels it encodes");
    const w = inspectWebp(frameBytes);
    if (!w.ok) return no("FRAME_NOT_A_STILL_WEBP", w.reason);
    if (w.width !== frame.width || w.height !== frame.height) return no("FRAME_SIZE_MISMATCH", "the bitstream and the attestation disagree on size");
  }
  const built = buildManifestV12({ handoff: input.handoff, frame, masksFrom: input.masksFrom ?? null });
  if (!built.ok) return no("MANIFEST_NOT_BUILT", `${built.code}: ${built.detail}`);
  if (frame && (built.manifest.capture.w !== frame.width || built.manifest.capture.h !== frame.height)) return no("FRAME_SIZE_MISMATCH", "the manifest's capture is not the frame's size");
  const body = await buildHandoffBody(built.manifest, frameBytes);
  if (!body.ok) return no("BODY_NOT_BUILT", body.code);
  const copy = body.handoff.body.slice();
  const attestation: HandoffAttestation = Object.freeze({
    protocol: QG04_PROTOCOL,
    manifestVersion: "1.2",
    contentType: body.handoff.contentType,
    bodySha256: body.handoff.sha256,
    bodyBytes: copy.length,
    manifestSha256: body.handoff.manifestSha256,
    frameSha256: body.handoff.frameSha256,
    width: built.manifest.capture.w,
    height: built.manifest.capture.h,
    requestId: built.manifest.request.id,
    sessionId: built.manifest.request.session,
    state: frame ? "MASK_VERIFIED" : "STRUCTURE_ONLY",
    runtime: Object.freeze({ ...input.runtime }),
  });
  ATTESTED.set(attestation, copy);
  return { ok: true, attestation };
}

/** The attested body's bytes — a copy; the registry's own copy is what the sender re-checks. */
export const attestedBody = (attestation: HandoffAttestation): Uint8Array | null => ATTESTED.get(attestation)?.slice() ?? null;

// ── production configuration (ADR-0012 §7, §10) ─────────────────────────────────────────────

/** Authentication has ONE state until an owner decision defines a scheme (B6). No secret exists. */
export type HandoffAuthentication = { readonly state: "NOT_CONFIGURED" };
export interface ProductionHandoffConfig {
  /** The configured production server origin, or `null`. */
  readonly origin: string | null;
  readonly authentication: HandoffAuthentication;
}
/** THE production configuration. No origin (B1), no authentication (B6). */
export const PRODUCTION_HANDOFF_CONFIG: ProductionHandoffConfig = Object.freeze({ origin: null, authentication: Object.freeze({ state: "NOT_CONFIGURED" as const }) });

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

// ── the production sender ──────────────────────────────────────────────────────────────────

export type ProductionSendRefusal =
  | "NOT_ATTESTED"
  | "ATTESTATION_SPENT"
  | "RUN_IDENTITY_MISMATCH"
  | "STATE_NOT_ADMISSIBLE"
  | "BODY_HASH_MISMATCH"
  | "PAYLOAD_INVALID"
  | "CONFIGURATION_MISSING"
  | "CONFIGURATION_INVALID"
  | "DESTINATION_NOT_CONFIGURED_ORIGIN"
  | "AUTHENTICATION_NOT_CONFIGURED"
  | "PRODUCTION_TRANSPORT_ABSENT";
export interface ProductionSendOutcome {
  readonly sent: false;
  readonly stage: "ATTESTATION" | "IDENTITY" | "STATE" | "INTEGRITY" | "CONFIGURATION" | "DESTINATION" | "AUTHENTICATION" | "TRANSPORT";
  readonly cause: ProductionSendRefusal;
  readonly detail: string;
}

/**
 * The single production handoff sender. Every outcome is a refusal today; the order is the policy:
 * attestation (registry, single use) → run identity → state (a frame needs VERIFIED) → integrity
 * (re-hash and re-parse the exact body) → configuration (origin) → destination → authentication →
 * transport (absent). Nothing past a refusal runs, and there is no `fetch` to reach.
 */
export async function sendProductionHandoff(request: {
  readonly attestation: HandoffAttestation;
  readonly expected: { readonly requestId: string; readonly sessionId: string };
  readonly destination: string;
  readonly config: ProductionHandoffConfig;
}): Promise<ProductionSendOutcome> {
  const refuse = (stage: ProductionSendOutcome["stage"], cause: ProductionSendRefusal, detail: string): ProductionSendOutcome => ({ sent: false, stage, cause, detail });
  const a = request.attestation;
  const body = isHandoffAttestation(a) ? ATTESTED.get(a) : undefined;
  if (!body) return refuse("ATTESTATION", "NOT_ATTESTED", "not an attestation this module produced");
  if (SPENT.has(a)) return refuse("ATTESTATION", "ATTESTATION_SPENT", "an attestation is used once");
  SPENT.add(a);
  if (a.requestId !== request.expected.requestId || a.sessionId !== request.expected.sessionId) return refuse("IDENTITY", "RUN_IDENTITY_MISMATCH", "the attestation belongs to another run");
  if (a.frameSha256 !== null && (a.state as string) !== FRAME_EGRESS_STATE) return refuse("STATE", "STATE_NOT_ADMISSIBLE", `a frame needs ${FRAME_EGRESS_STATE}; this one is ${a.state}`);

  const exact = body.slice();
  if ((await sha256HexOfBytes(exact)) !== a.bodySha256 || exact.length !== a.bodyBytes) return refuse("INTEGRITY", "BODY_HASH_MISMATCH", "the body no longer hashes to its attestation");
  const parsed = parseHandoffBody(exact, a.contentType);
  if (!parsed.ok) return refuse("INTEGRITY", "PAYLOAD_INVALID", parsed.reason);
  const m = parsed.manifest as { request: { id: string; session: string } };
  if (m.request.id !== a.requestId || m.request.session !== a.sessionId) return refuse("INTEGRITY", "RUN_IDENTITY_MISMATCH", "the body's run identity is not the attestation's");

  if (request.config.origin === null) return refuse("CONFIGURATION", "CONFIGURATION_MISSING", "no production server origin is configured (ADR-0012 B1)");
  let origin: URL;
  try {
    origin = new URL(request.config.origin);
  } catch {
    return refuse("CONFIGURATION", "CONFIGURATION_INVALID", "the configured origin is not a URL");
  }
  if (origin.protocol !== "https:" || LOOPBACK.has(origin.hostname) || origin.origin !== request.config.origin) return refuse("CONFIGURATION", "CONFIGURATION_INVALID", "a production origin is an https origin that is not loopback");
  let destination: URL;
  try {
    destination = new URL(request.destination);
  } catch {
    return refuse("DESTINATION", "DESTINATION_NOT_CONFIGURED_ORIGIN", "the destination is not a URL");
  }
  if (destination.origin !== request.config.origin) return refuse("DESTINATION", "DESTINATION_NOT_CONFIGURED_ORIGIN", "the destination is not the configured origin");
  if ((request.config.authentication.state as string) !== "CONFIGURED") return refuse("AUTHENTICATION", "AUTHENTICATION_NOT_CONFIGURED", "no authentication is configured (ADR-0012 B6)");
  return refuse("TRANSPORT", "PRODUCTION_TRANSPORT_ABSENT", "there is no production transport until B1, B4 and B6 are resolved");
}

// ── the server's half: one request, checked exactly ─────────────────────────────────────────

/**
 * What a server must check before reading anything (ADR-0012 §10): the content type, the body hash
 * header against the bytes, the request-id header against the manifest, then the body's exact parts,
 * the v1.2 manifest, and the frame (a still WebP, the capture's size, no larger than its pixels).
 */
export async function validateQg04Request(request: { readonly contentType: string; readonly payloadSha256: string | null; readonly requestId: string | null; readonly body: Uint8Array }): Promise<{ readonly ok: true; readonly manifest: unknown; readonly frame: Uint8Array | null } | { readonly ok: false; readonly reason: string }> {
  if (request.body.length === 0) return { ok: false, reason: "empty body" };
  if (request.payloadSha256 === null || (await sha256HexOfBytes(request.body)) !== request.payloadSha256) return { ok: false, reason: "the body does not hash to its declared digest" };
  const parsed = parseHandoffBody(request.body, request.contentType);
  if (!parsed.ok) return parsed;
  const m = parsed.manifest as { request: { id: string }; capture: { w: number; h: number } };
  if (request.requestId === null || m.request.id !== request.requestId) return { ok: false, reason: "the request-id header is not the manifest's" };
  if (parsed.frame && parsed.frame.length > m.capture.w * m.capture.h * 4) return { ok: false, reason: "the frame is larger than the pixels it encodes" };
  return parsed;
}

// ── the structure-only fallback (ADR-0012 §8) ──────────────────────────────────────────────

export type FrameWithheldReason =
  | "REFUSED"
  | "NO_SANITIZED_ARTIFACT"
  | "FRAME_NOT_MASK_VERIFIED"
  | "FRAME_HASH_MISMATCH"
  | "FRAME_SIZE_MISMATCH"
  | "NO_VERDICT"
  | "VERIFIER_BLOCK"
  | "STATE_NOT_ADMISSIBLE"
  | "STALE_VERDICT"
  | "WRONG_RUN_IDENTITY"
  | "VERDICT_NOT_ADMITTED";

export type HandoffPlan =
  | {
      readonly mode: "STRUCTURE_ONLY";
      /** Why the image was withheld — shown to the user, recorded in the ledger. */
      readonly notice: { readonly kind: "IMAGE_WITHHELD"; readonly reason: FrameWithheldReason };
      readonly attestation: HandoffAttestation;
    }
  | { readonly mode: "STOP"; readonly cause: "HANDOFF_NOT_VERIFIED" | AttestRefusal; readonly detail: string };

/** Verdicts a production frame verifier admitted. Nothing adds to it: none exists (ADR-0012 B2). */
const ADMITTED_VERDICTS = new WeakSet<object>();

async function whyWithheld(input: { readonly handoff: VerifiedHandoff; readonly frame: unknown; readonly verdict: unknown; readonly refused: boolean }): Promise<FrameWithheldReason> {
  if (input.refused) return "REFUSED";
  const f = input.frame;
  if (f === null || f === undefined) return "NO_SANITIZED_ARTIFACT";
  if (!isMaskVerifiedFrame(f)) return "FRAME_NOT_MASK_VERIFIED";
  if ((await sha256HexOfBytes(f.bytes.slice())) !== f.sha256) return "FRAME_HASH_MISMATCH";
  if (f.width !== input.handoff.capture.w || f.height !== input.handoff.capture.h) return "FRAME_SIZE_MISMATCH";
  const v = input.verdict as { verdict?: unknown; state?: unknown; frameSha256?: unknown; requestId?: unknown } | null | undefined;
  if (typeof v !== "object" || v === null) return "NO_VERDICT";
  if (v.verdict === "BLOCK") return "VERIFIER_BLOCK";
  if (v.state !== FRAME_EGRESS_STATE) return "STATE_NOT_ADMISSIBLE";
  if (v.frameSha256 !== f.sha256) return "STALE_VERDICT";
  if (v.requestId !== input.handoff.request.requestId) return "WRONG_RUN_IDENTITY";
  if (!ADMITTED_VERDICTS.has(v)) return "VERDICT_NOT_ADMITTED";
  // Unreachable today: nothing admits a verdict. Even then, this function builds no frame body.
  return "VERDICT_NOT_ADMITTED";
}

/**
 * Decide what the handoff is when a frame cannot go. TODAY THAT IS ALWAYS: a frame cannot go.
 *
 * - A verified handoff with any frame problem → STRUCTURE_ONLY: an attested body with
 *   `capture.format: "none"`, NO frame part and NO image byte, plus an `IMAGE_WITHHELD` notice
 *   naming the reason. When the candidate is a genuine MASK_VERIFIED frame, its masks are described
 *   in `visual_masks[]` (ids and CSS boxes only), so the reasoner knows what it is not seeing.
 * - A handoff the privacy verifier did not produce → STOP: nothing at all.
 * - REFUSED (an invalid visual region): no frame ever existed; structure-only, nothing about the frame.
 * Never a raw frame, never an unverified WebP.
 */
export async function planHandoff(input: { readonly handoff: VerifiedHandoff; readonly frame: unknown; readonly verdict: unknown; readonly refused?: boolean; readonly runtime: RuntimeIdentity }): Promise<HandoffPlan> {
  if (!isVerifiedHandoff(input.handoff)) return { mode: "STOP", cause: "HANDOFF_NOT_VERIFIED", detail: "the handoff was not produced by the privacy verifier" };
  const reason = await whyWithheld({ handoff: input.handoff, frame: input.frame, verdict: input.verdict, refused: input.refused === true });
  const masksFrom = !input.refused && isMaskVerifiedFrame(input.frame) && reason !== "FRAME_HASH_MISMATCH" ? input.frame : null;
  const attested = await attestHandoffBody({ handoff: input.handoff, frame: null, masksFrom, runtime: input.runtime });
  if (!attested.ok) return { mode: "STOP", cause: attested.code, detail: attested.detail };
  return { mode: "STRUCTURE_ONLY", notice: { kind: "IMAGE_WITHHELD", reason }, attestation: attested.attestation };
}
