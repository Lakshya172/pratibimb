/**
 * M11 — THE PRODUCTION FRAME-HANDOFF CONTRACT (ADR-0012, PROPOSED). Pure. No network, no product caller.
 *
 * This module makes ADR-0012 testable before anything can be sent:
 *
 *   - `buildHandoffBody` / `parseHandoffBody`: the proposed QG-04 body — ONE deterministic
 *     `multipart/form-data` body, `manifest` then `frame`, or `manifest` alone in structure-only mode.
 *     The client builds it; the parser is the server's half of the contract.
 *   - `checkManifest`: the proposed v1.2 manifest, with only the fields ADR-0012 §6 allows and
 *     nothing that could carry text, pixels or markup.
 *   - `decideHandoff`: every way a frame can fail. The answer is STRUCTURE_ONLY (the manifest, no
 *     image) or STOP (nothing at all), and NEVER a frame today:
 *       - the switch's only value is `DISABLED`;
 *       - the only admissible verification state is `VERIFIED`;
 *       - nothing in this repository can mint an admitted verdict (ADR-0012 B2).
 *
 * WHAT THIS IS NOT: an egress path. It returns bytes and decisions; `@pratibimb/egress`'s senders own
 * the socket. Enabling frame egress needs the blockers in ADR-0012 §13 resolved, and a change here
 * that a test watches.
 */
import { canonicalManifestJson, isMaskVerifiedFrame, parseManifestV12, scanForVaultValuesAsync, sha256HexOfBytes, type AsyncLiteralOracle } from "@pratibimb/privacy";

import { inspectWebp } from "./webpContainer.js";

export const HANDOFF_CONTRACT = "ADR-0012/proposed-1";

/** Production frame egress. Its ONLY value is DISABLED (ADR-0012 §11, §13). */
export type FrameEgressSwitch = "DISABLED";
export interface HandoffConfig {
  readonly frameEgress: FrameEgressSwitch;
  /** The configured production server origin, or `null` — and today it is `null` (B1). */
  readonly productionOrigin: string | null;
}

/** The verification states of ADR-0012 §3. Only the last is admissible for frame egress. */
export type VerificationState = "MASKED_LOCAL" | "MASK_VERIFIED" | "DETECTOR_VERIFIED" | "VERIFIED";
export const ADMISSIBLE_FRAME_STATE: VerificationState = "VERIFIED";

/**
 * Verdicts a production verifier ADMITTED. Membership is the admission, as for handoffs and frames.
 * Nothing in this repository adds to it: no verifier can return `VERIFIED` for a frame (ADR-0012 B2).
 */
const ADMITTED = new WeakSet<object>();
export const isAdmittedFrameVerdict = (candidate: unknown): boolean => typeof candidate === "object" && candidate !== null && ADMITTED.has(candidate);

// ── the manifest (v1.2, PROPOSED) ─────────────────────────────────────────────────────────────

export type ManifestRefusal = "MISSING_GOAL" | "MALFORMED_MANIFEST" | "PLAINTEXT_IN_MANIFEST";
export type ManifestCheck = { readonly ok: true } | { readonly ok: false; readonly code: ManifestRefusal; readonly detail: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The v1.2 manifest check. M12: this is `@pratibimb/privacy`'s strict parser (owner-approved v1.2),
 * no longer M11's allow-list, so the payload, the decision and the server parser share one definition.
 */
export function checkManifest(manifest: unknown): ManifestCheck {
  const parsed = parseManifestV12(manifest);
  return parsed.ok ? { ok: true } : { ok: false, code: parsed.code, detail: `${parsed.path}: ${parsed.detail}` };
}

/** Canonical JSON: object keys sorted at every depth, no insignificant whitespace. */
export function canonicalJson(v: unknown): string {
  const norm = (x: unknown): unknown => (Array.isArray(x) ? x.map(norm) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, norm(x[k])])) : x);
  return JSON.stringify(norm(v));
}

// ── the body (ADR-0012 §4) ────────────────────────────────────────────────────────────────────

export interface HandoffBody {
  readonly contentType: string;
  readonly boundary: string;
  readonly body: Uint8Array;
  readonly sha256: string;
  readonly manifestSha256: string;
  readonly frameSha256: string | null;
  readonly parts: readonly ("manifest" | "frame")[];
}

const enc = new TextEncoder();
const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};
const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};

/** Build the exact body. Deterministic: the same manifest and frame give the same bytes. */
export async function buildHandoffBody(manifest: unknown, frame: Uint8Array | null): Promise<{ readonly ok: true; readonly handoff: HandoffBody } | { readonly ok: false; readonly code: "BOUNDARY_COLLISION" | "NOT_SERIALIZABLE" | ManifestRefusal }> {
  // Only a manifest that parses as v1.2 is ever serialized, and always canonically.
  const parsed = parseManifestV12(manifest);
  if (!parsed.ok) return { ok: false, code: parsed.code };
  const json = canonicalManifestJson(parsed.manifest);
  const manifestBytes = enc.encode(json);
  const manifestSha256 = await sha256HexOfBytes(manifestBytes);
  const boundary = `pratibimb-${manifestSha256.slice(0, 32)}`;
  if (json.includes(boundary) || (frame && latin1(frame).includes(boundary))) return { ok: false, code: "BOUNDARY_COLLISION" };
  const chunks: Uint8Array[] = [enc.encode(`--${boundary}\r\ncontent-disposition: form-data; name="manifest"\r\ncontent-type: application/json; charset=utf-8\r\n\r\n`), manifestBytes, enc.encode("\r\n")];
  if (frame) chunks.push(enc.encode(`--${boundary}\r\ncontent-disposition: form-data; name="frame"; filename="frame.webp"\r\ncontent-type: image/webp\r\n\r\n`), frame, enc.encode("\r\n"));
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const body = concat(chunks);
  return {
    ok: true,
    handoff: Object.freeze({
      contentType: `multipart/form-data; boundary=${boundary}`,
      boundary,
      body,
      sha256: await sha256HexOfBytes(body),
      manifestSha256,
      frameSha256: frame ? await sha256HexOfBytes(frame) : null,
      parts: (frame ? ["manifest", "frame"] : ["manifest"]) as readonly ("manifest" | "frame")[],
    }),
  };
}

/** The hash pin: does this buffer still hash to what was attested? (Egress re-hashes before sending.) */
export const bodyMatchesPin = async (body: Uint8Array, pinnedSha256: string): Promise<boolean> => (await sha256HexOfBytes(body)) === pinnedSha256;

/**
 * The SERVER's half: parse a body exactly, or refuse it. Exactly `manifest` (+ `frame`), in that
 * order, with exactly those headers. The frame is a still WebP of the manifest's capture size; a
 * frame is present exactly when `capture.format` is `webp`.
 */
export function parseHandoffBody(body: Uint8Array, contentType: string): { readonly ok: true; readonly manifest: unknown; readonly frame: Uint8Array | null } | { readonly ok: false; readonly reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  const m = /^multipart\/form-data; boundary=(pratibimb-[0-9a-f]{32})$/.exec(contentType);
  if (!m) return no("content type is not the contract's multipart");
  const boundary = m[1] as string;
  const text = latin1(body);
  const head = (name: string, extra: string, type: string) => `--${boundary}\r\ncontent-disposition: form-data; name="${name}"${extra}\r\ncontent-type: ${type}\r\n\r\n`;
  const mh = head("manifest", "", "application/json; charset=utf-8");
  if (!text.startsWith(mh)) return no("the first part is not the manifest");
  const afterManifest = text.indexOf(`\r\n--${boundary}`, mh.length);
  if (afterManifest < 0) return no("the manifest part is not terminated");
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.subarray(mh.length, afterManifest)));
  } catch {
    return no("the manifest is not JSON");
  }
  const rest = text.slice(afterManifest + 2);
  let frame: Uint8Array | null = null;
  if (rest === `--${boundary}--\r\n`) frame = null;
  else {
    const fh = head("frame", '; filename="frame.webp"', "image/webp");
    if (!rest.startsWith(fh)) return no("the second part is not the frame");
    const start = afterManifest + 2 + fh.length;
    const end = text.length - `\r\n--${boundary}--\r\n`.length;
    if (end < start || !text.endsWith(`\r\n--${boundary}--\r\n`) || text.slice(start, end).includes(`--${boundary}`)) return no("the body has a part after the frame, or is not terminated");
    frame = body.slice(start, end);
  }
  const check = checkManifest(manifest);
  if (!check.ok) return no(`manifest: ${check.code}`);
  const capture = (manifest as { capture: { w: number; h: number; format: string } }).capture;
  if ((capture.format === "webp") !== (frame !== null)) return no("capture.format does not match the presence of a frame");
  if (frame) {
    const w = inspectWebp(frame);
    if (!w.ok) return no(`frame: ${w.reason}`);
    if (w.width !== capture.w || w.height !== capture.h) return no("the frame is not the manifest's capture size");
  }
  return { ok: true, manifest, frame };
}

// ── the decision (ADR-0012 §8) ────────────────────────────────────────────────────────────────

export type FrameRefusal =
  | "NO_SANITIZED_ARTIFACT"
  | "FRAME_NOT_ATTESTED"
  | "EMPTY_FRAME"
  | "OVERSIZED_FRAME"
  | "FRAME_HASH_MISMATCH"
  | "FRAME_NOT_A_STILL_WEBP"
  | "FRAME_SIZE_MISMATCH"
  | "NO_VERDICT"
  | "VERIFIER_BLOCK"
  | "STATE_NOT_ADMISSIBLE"
  | "STALE_ATTESTATION"
  | "WRONG_RUN_IDENTITY"
  | "VERDICT_NOT_ADMITTED"
  | "FRAME_EGRESS_DISABLED";
export type StopCause = "NO_CONFIGURED_PRODUCTION_ORIGIN" | "INVALID_DESTINATION" | "DESTINATION_NOT_CONFIGURED_ORIGIN" | ManifestRefusal | "BODY_NOT_BUILT" | "DUPLICATE_SEND";

export type HandoffDecision =
  | { readonly mode: "STRUCTURE_ONLY"; readonly frameRefusal: FrameRefusal; readonly notice: "IMAGE_WITHHELD"; readonly handoff: HandoffBody }
  | { readonly mode: "STOP"; readonly cause: StopCause; readonly detail: string };

/** Bodies already sent, by digest. A body is sent at most once (ADR-0012 §5). */
export interface SentRegistry {
  has(sha256: string): boolean;
  mark(sha256: string): void;
}
export const createSentRegistry = (): SentRegistry => {
  const sent = new Set<string>();
  return { has: (s) => sent.has(s), mark: (s) => void sent.add(s) };
};

export interface HandoffInput {
  readonly config: HandoffConfig;
  readonly destination: string;
  /** The proposed v1.2 manifest, as it would describe a FRAME (`capture.format: "webp"`). */
  readonly manifest: unknown;
  /** Whatever the caller holds as "the frame" — an attested artifact or anything else. */
  readonly frame: unknown;
  /** Whatever the caller holds as the verifier's verdict. */
  readonly verdict: unknown;
  readonly vault?: AsyncLiteralOracle;
  readonly sent: SentRegistry;
}

async function whyNoFrame(input: HandoffInput): Promise<FrameRefusal> {
  const f = input.frame;
  if (f === null || f === undefined) return "NO_SANITIZED_ARTIFACT";
  if (!isMaskVerifiedFrame(f)) return "FRAME_NOT_ATTESTED";
  if (f.bytes.length === 0) return "EMPTY_FRAME";
  if (f.bytes.length > f.width * f.height * 4) return "OVERSIZED_FRAME";
  if ((await sha256HexOfBytes(f.bytes.slice())) !== f.sha256) return "FRAME_HASH_MISMATCH";
  const w = inspectWebp(f.bytes);
  if (!w.ok) return "FRAME_NOT_A_STILL_WEBP";
  const capture = (input.manifest as { capture: { w: number; h: number } }).capture;
  if (w.width !== capture.w || w.height !== capture.h || f.width !== capture.w || f.height !== capture.h) return "FRAME_SIZE_MISMATCH";
  const v = input.verdict as { verdict?: unknown; state?: unknown; frameSha256?: unknown; requestId?: unknown } | null | undefined;
  if (!isObj(v)) return "NO_VERDICT";
  if (v.verdict === "BLOCK") return "VERIFIER_BLOCK";
  if (v.state !== ADMISSIBLE_FRAME_STATE) return "STATE_NOT_ADMISSIBLE";
  if (v.frameSha256 !== f.sha256) return "STALE_ATTESTATION";
  if (v.requestId !== (input.manifest as { request: { id: string } }).request.id) return "WRONG_RUN_IDENTITY";
  if (!isAdmittedFrameVerdict(v)) return "VERDICT_NOT_ADMITTED";
  return "FRAME_EGRESS_DISABLED";
}

/**
 * Decide what may leave. Fail-closed in this order:
 *   1. destination and configuration → STOP;
 *   2. the manifest (goal, structure, content, vault values) → STOP;
 *   3. the frame → today ALWAYS a refusal, so the decision is STRUCTURE_ONLY: the manifest alone,
 *      `capture.format: "none"`, no image part, no image byte;
 *   4. a body already sent → STOP.
 */
export async function decideHandoff(input: HandoffInput): Promise<HandoffDecision> {
  const stop = (cause: StopCause, detail: string): HandoffDecision => ({ mode: "STOP", cause, detail });
  if (!input.config.productionOrigin) return stop("NO_CONFIGURED_PRODUCTION_ORIGIN", "no production server origin is configured (ADR-0012 B1)");
  let url: URL;
  try {
    url = new URL(input.destination);
  } catch {
    return stop("INVALID_DESTINATION", "the destination is not a URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return stop("INVALID_DESTINATION", "the destination is not http(s)");
  if (url.origin !== input.config.productionOrigin) return stop("DESTINATION_NOT_CONFIGURED_ORIGIN", "the destination is not the configured server origin");

  const check = checkManifest(input.manifest);
  if (!check.ok) return stop(check.code, check.detail);
  if (input.vault) {
    const leaked = await scanForVaultValuesAsync(canonicalJson(input.manifest), input.vault);
    if (leaked) return stop("PLAINTEXT_IN_MANIFEST", `a value of class ${leaked} is in the manifest`);
  }

  const frameRefusal = await whyNoFrame(input);
  const m = input.manifest as Record<string, unknown> & { capture: Record<string, unknown> };
  const { q: _q, ...capture } = m.capture;
  const structureOnly = { ...m, capture: { ...capture, format: "none" } };
  const built = await buildHandoffBody(structureOnly, null);
  if (!built.ok) return stop("BODY_NOT_BUILT", built.code);
  if (input.sent.has(built.handoff.sha256)) return stop("DUPLICATE_SEND", "this body was already sent");
  return { mode: "STRUCTURE_ONLY", frameRefusal, notice: "IMAGE_WITHHELD", handoff: built.handoff };
}
