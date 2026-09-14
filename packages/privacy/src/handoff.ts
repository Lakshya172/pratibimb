/**
 * The verified handoff — the only representation that may leave the client, and the verifier that
 * decides whether it may.
 *
 * `SanitizedHandoff` in `@pratibimb/perception` types `verified` as `false` **and nothing else**,
 * with a comment saying the privacy verifier does not exist yet. This is that verifier. It does not
 * modify perception: `VerifiedHandoff` is built here, from perception's shape, by widening exactly
 * one field. The structural guarantee perception was built around — a handoff has no field of any
 * pixel-bearing type, so a frame cannot be attached by accident — is inherited rather than restated.
 *
 * WHY A FLAG IS NOT ENOUGH. `{ ...body, verified: true }` type-checks. If the egress path trusted
 * that field, every future caller would be one object literal away from sending an unverified
 * payload, which is the failure mode INV-22 exists to prevent ("verification is fail-closed; the
 * verifier can block a send, it is not advisory"). So verification is recognised by **membership in
 * a module-private `WeakSet`** of objects this function produced, exactly as the execution gate
 * recognises a permit (ADR-0008 §3). A forged literal carries the flag and fails the check.
 *
 * The same-realm limit applies here too, and is stated in `internal.ts`.
 *
 * WHAT THE VERIFIER ACTUALLY CHECKS, in order, all fail-closed:
 *   1. provenance   — this object came from `sanitize()`
 *   2. structure    — manifest v1.1 shape, every coordinate field present and finite
 *   3. identity     — request and session match the context asking for verification
 *   4. origin       — the capture origin, the context and the vault agree on the page
 *   5. tokens       — every reference parses, is tokenisable, is known to the vault, appears once
 *   6. leak         — no vault value survives anywhere in the serialized bytes, exact or normalised
 *   7. serializable — the object round-trips through JSON unchanged
 *
 * Step 6 is the one that matters most, and it is deliberately **value-aware**: it starts from the
 * secrets the vault holds rather than from a detector's opinion, so it catches a survival even when
 * the detector that should have masked it was wrong. It reports a class, never the value.
 */
import type { SanitizedElement, SanitizedHandoff } from "@pratibimb/perception";

import { TIER_OF, isTokenisable, type PiiClass, type Tier } from "./classes.js";
import { type Hint } from "./hints.js";
import { containsSecret } from "./normalise.js";
import { parseToken } from "./tokens.js";
import { type Vault } from "./vault.js";

/** One redaction span, as `docs/architecture/manifest-schema.md` §redactions defines it. */
export interface Redaction {
  readonly token: string;
  readonly class: PiiClass;
  readonly tier: Tier;
  readonly bbox?: readonly [number, number, number, number];
  /** How the value was removed. This prototype substitutes a reference; it renders no pixels. */
  readonly method: "token_reference" | "masked_no_token";
  /** Which channels fired: D1 is the field, D2 is pattern-plus-checksum. */
  readonly detectors: readonly ("D1" | "D2")[];
  readonly hint: Hint;
  /** The element the span belongs to, so a plan can target it by id. */
  readonly targetId: string;
}

export interface HandoffRequest {
  readonly requestId: string;
  readonly sessionId: string;
  readonly issuedAt: number;
}

/** Everything a handoff carries except the verdict on it. */
export interface HandoffBody extends Omit<SanitizedHandoff, "verified"> {
  /** The **user's** stated goal. Never page-derived text (manifest contract). */
  readonly goal: string;
  readonly redactions: readonly Redaction[];
  readonly request: HandoffRequest;
}

export type HandoffDraft = HandoffBody & { readonly verified: false };
export type VerifiedHandoff = HandoffBody & { readonly verified: true };

export type VerificationRefusalCause =
  | "NOT_FROM_SANITIZER"
  | "MALFORMED_STRUCTURE"
  | "REQUEST_IDENTITY_MISMATCH"
  | "SESSION_IDENTITY_MISMATCH"
  | "ORIGIN_MISMATCH"
  | "VAULT_DESTROYED"
  | "UNKNOWN_TOKEN"
  | "DUPLICATE_TOKEN"
  | "NON_TOKENISABLE_CLASS"
  | "VAULT_VALUE_IN_HANDOFF"
  | "NOT_SERIALIZABLE";

export type VerificationOutcome =
  | { readonly verified: true; readonly handoff: VerifiedHandoff }
  | {
      readonly verified: false;
      readonly cause: VerificationRefusalCause;
      /** The class that leaked, when one did. Never the value. */
      readonly leakedClass?: PiiClass;
    };

export interface VerificationContext {
  readonly sessionId: string;
  readonly requestId: string;
  readonly origin: string;
  readonly vault: Vault;
}

/** Drafts this package built. A handoff assembled anywhere else is not verifiable. */
const DRAFTS = new WeakSet<object>();
/** Handoffs this verifier approved. Membership IS the verification. */
const VERIFIED = new WeakSet<object>();

/** Called by `sanitize()` and nothing else. */
export const markDraft = <T extends object>(draft: T): T => {
  DRAFTS.add(draft);
  return draft;
};

/**
 * `true` only for an object this verifier produced.
 *
 * The egress path must ask this rather than reading `handoff.verified`, and the ledger does.
 */
export const isVerifiedHandoff = (candidate: unknown): candidate is VerifiedHandoff =>
  typeof candidate === "object" && candidate !== null && VERIFIED.has(candidate);

const finite = (...values: readonly unknown[]): boolean =>
  values.every((value) => typeof value === "number" && Number.isFinite(value));

const structurallyValid = (draft: HandoffDraft): boolean => {
  if (draft.manifestVersion !== "1.1") return false;
  const capture = draft.capture;
  if (!capture || typeof capture.origin !== "string" || capture.origin === "") return false;
  if (!finite(capture.w, capture.h, capture.dpr, capture.zoom, capture.scale_to_css)) return false;
  if (!capture.scroll || !finite(capture.scroll.x, capture.scroll.y)) return false;
  if (!draft.capability || typeof draft.capability.backend !== "string") return false;
  if (!Array.isArray(draft.capability.tiers_fired)) return false;
  if (!Array.isArray(draft.elements)) return false;
  if (typeof draft.goal !== "string" || draft.goal.trim() === "") return false;
  if (!Array.isArray(draft.redactions)) return false;
  const request = draft.request;
  if (!request || typeof request.requestId !== "string" || typeof request.sessionId !== "string") return false;
  if (!finite(request.issuedAt)) return false;
  return draft.elements.every((element: SanitizedElement) => {
    if (typeof element.id !== "string" || typeof element.role !== "string") return false;
    if (typeof element.name !== "string") return false;
    if (element.bbox !== undefined && (!Array.isArray(element.bbox) || !finite(...element.bbox))) return false;
    return typeof element.visible === "boolean" && typeof element.offscreen === "boolean";
  });
};

/**
 * Verify a draft and produce the only object the egress path will accept.
 *
 * Fail-closed in every branch: there is exactly one statement that adds to `VERIFIED`, and it is
 * reached only after all seven checks have passed.
 */
export function verifyHandoff(draft: HandoffDraft, context: VerificationContext): VerificationOutcome {
  // 1 — provenance.
  if (typeof draft !== "object" || draft === null || !DRAFTS.has(draft)) {
    return { verified: false, cause: "NOT_FROM_SANITIZER" };
  }

  // 2 — structure.
  if (!structurallyValid(draft)) return { verified: false, cause: "MALFORMED_STRUCTURE" };

  // 3 — identity.
  if (draft.request.requestId !== context.requestId) return { verified: false, cause: "REQUEST_IDENTITY_MISMATCH" };
  if (draft.request.sessionId !== context.sessionId) return { verified: false, cause: "SESSION_IDENTITY_MISMATCH" };
  if (context.vault.sessionId !== context.sessionId) return { verified: false, cause: "SESSION_IDENTITY_MISMATCH" };

  // 4 — origin. The page, the context and the vault must be the same page.
  if (context.vault.isDestroyed) return { verified: false, cause: "VAULT_DESTROYED" };
  if (draft.capture.origin !== context.origin) return { verified: false, cause: "ORIGIN_MISMATCH" };
  if (context.vault.origin !== context.origin) return { verified: false, cause: "ORIGIN_MISMATCH" };

  // 5 — tokens.
  const seen = new Set<string>();
  for (const redaction of draft.redactions) {
    if (redaction.method === "masked_no_token") {
      // A CRITICAL span is masked and carries no reference. It must not claim one.
      if (redaction.token !== "") return { verified: false, cause: "NON_TOKENISABLE_CLASS" };
      continue;
    }
    const parsed = parseToken(redaction.token);
    if (!parsed) return { verified: false, cause: "UNKNOWN_TOKEN" };
    if (!isTokenisable(redaction.class) || parsed.piiClass !== redaction.class) {
      return { verified: false, cause: "NON_TOKENISABLE_CLASS" };
    }
    if (redaction.tier !== TIER_OF[redaction.class]) return { verified: false, cause: "NON_TOKENISABLE_CLASS" };
    if (seen.has(redaction.token)) return { verified: false, cause: "DUPLICATE_TOKEN" };
    seen.add(redaction.token);
    if (!context.vault.has(redaction.token)) return { verified: false, cause: "UNKNOWN_TOKEN" };
  }

  // 7 (checked before 6 so the leak scan runs over exactly the bytes that would be sent).
  let serialized: string;
  try {
    serialized = JSON.stringify(draft);
    if (typeof serialized !== "string") return { verified: false, cause: "NOT_SERIALIZABLE" };
    JSON.parse(serialized);
  } catch {
    return { verified: false, cause: "NOT_SERIALIZABLE" };
  }

  // 6 — the value-aware residual check.
  const leak = scanForVaultValues(serialized, context.vault);
  if (leak) return { verified: false, cause: "VAULT_VALUE_IN_HANDOFF", leakedClass: leak };

  const verified: VerifiedHandoff = Object.freeze({ ...(draft as HandoffBody), verified: true as const });
  VERIFIED.add(verified);
  return { verified: true, handoff: verified };
}

/**
 * Does any vault value survive in this text, exactly or normalised?
 *
 * Returns the class so a ledger can record *what kind* of thing leaked; the value itself is never
 * returned, logged or thrown (INV-21).
 */
export function scanForVaultValues(serialized: string, vault: Vault): PiiClass | null {
  const hit = vault.holdsLiteral(serialized);
  return hit.held ? hit.piiClass : null;
}

/** Convenience for callers that hold a verified handoff and want the bytes that would be sent. */
export const serializeHandoff = (handoff: VerifiedHandoff): string => JSON.stringify(handoff);

export { containsSecret };
