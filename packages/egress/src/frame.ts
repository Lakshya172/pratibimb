/**
 * M10.7 — A MASKED FRAME LEAVES THROUGH THE SAME CHOKE POINT, OR NOT AT ALL.
 *
 * `guard.ts` sends one verified JSON string. This sends one MASK-VERIFIED WebP frame, under the same
 * discipline (QG-04): the payload is fixed once, hashed, checked against the hash its attestation
 * signed, and exactly those bytes go on the wire. The order is fixed and every step can refuse:
 *
 *   1. MASK-VERIFIED   asked of `isMaskVerifiedFrame`, never of a field. Raw RGBA, a sanitized frame
 *                      that was never encoded, an ImageBitmap, an encoded-but-unchecked WebP, any
 *                      object built elsewhere: refused here, before anything else is looked at.
 *   2. DESTINATION     loopback only (`isLoopback`), as for every other payload in this phase.
 *   3. THE BYTES       copied once into a buffer nothing else holds; the copy is what is hashed,
 *                      inspected and sent.
 *   4. HASH PIN        that copy's SHA-256 must equal the attested one. A byte changed after
 *                      attestation is a refusal, not a send.
 *   5. CONTAINER       `inspectWebp`: a still WebP with no metadata chunk, of the attested size.
 *   6. SEND            `image/webp`, the bytes, and the digest as a header the peer may check.
 *
 * THIS IS NOT A GENERAL EGRESS PRIMITIVE. It accepts nothing but an attested frame and sends nowhere
 * but loopback. No caller in the product build calls it; the M10.7 evidence harness does, to a
 * test-only sink. Production frame egress is a later, separate decision.
 *
 * Nothing recorded carries the bytes: a record names the request, the destination, the digest, the
 * size and what the peer claimed.
 */
import { isMaskVerifiedFrame, sha256HexOfBytes, type MaskVerifiedFrame } from "@pratibimb/privacy";

import { DEFAULT_EGRESS_TIMEOUT_MS, isLoopback, type PeerReceipt } from "./guard.js";
import { inspectWebp } from "./webpContainer.js";

export const FRAME_SHA_HEADER = "x-pratibimb-payload-sha256";
const PEER_SHA_HEADER = "x-pratibimb-received-sha256";
const PEER_BYTES_HEADER = "x-pratibimb-received-bytes";

export type FrameEgressRefusalCause =
  | "FRAME_NOT_MASK_VERIFIED"
  | "DESTINATION_NOT_LOOPBACK"
  | "PAYLOAD_HASH_MISMATCH"
  | "NOT_A_STILL_WEBP"
  | "TRANSPORT_FAILED"
  | "TRANSPORT_TIMEOUT";

export interface FrameEgressRefusal {
  readonly requestId: string;
  readonly sessionId: string;
  readonly at: number;
  readonly destination: string;
  readonly stage: "VERIFY" | "DESTINATION" | "HASH" | "CONTAINER" | "TRANSPORT";
  readonly cause: FrameEgressRefusalCause;
  readonly detail: string;
}

export interface FrameEgressRecord {
  readonly requestId: string;
  readonly sessionId: string;
  readonly at: number;
  readonly destination: string;
  readonly transport: "LOOPBACK_HTTP";
  readonly contentType: "image/webp";
  /** Always MASK_VERIFIED: nothing else reaches this record. Steps 3–6 of the frozen verifier did not run. */
  readonly status: "MASK_VERIFIED";
  readonly payloadSha256: string;
  readonly payloadBytes: number;
  readonly width: number;
  readonly height: number;
  readonly chunks: readonly string[];
  readonly responseStatus: number;
  readonly peerReceipt?: PeerReceipt;
  readonly elapsedMs: number;
}

export type FrameEgressOutcome =
  | { readonly sent: true; readonly record: FrameEgressRecord }
  | { readonly sent: false; readonly refusal: FrameEgressRefusal };

export interface FrameEgressRequest {
  readonly frame: MaskVerifiedFrame;
  readonly destination: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export async function sendMaskVerifiedFrame(request: FrameEgressRequest): Promise<FrameEgressOutcome> {
  const clock = request.now ?? (() => Date.now());
  const startedAt = clock();
  const base = { requestId: request.requestId, sessionId: request.sessionId, destination: request.destination };
  const refuse = (stage: FrameEgressRefusal["stage"], cause: FrameEgressRefusalCause, detail: string): FrameEgressOutcome => ({
    sent: false,
    refusal: { ...base, at: clock(), stage, cause, detail },
  });

  // ── 1. mask-verified, by registry membership ──────────────────────────────────────────────
  if (!isMaskVerifiedFrame(request.frame)) {
    return refuse("VERIFY", "FRAME_NOT_MASK_VERIFIED", "the payload is not a frame the mask check attested.");
  }
  const frame = request.frame;

  // ── 2. loopback only ──────────────────────────────────────────────────────────────────────
  if (!isLoopback(request.destination)) {
    return refuse("DESTINATION", "DESTINATION_NOT_LOOPBACK", "this phase sends frames only to a service on this machine.");
  }

  // ── 3. the exact bytes, fixed once, in a buffer nothing else holds ────────────────────────
  const payload = frame.bytes.slice();

  // ── 4. the hash the attestation signed ────────────────────────────────────────────────────
  const payloadSha256 = await sha256HexOfBytes(payload);
  if (payloadSha256 !== frame.sha256) {
    return refuse("HASH", "PAYLOAD_HASH_MISMATCH", "the bytes no longer hash to what was attested.");
  }

  // ── 5. a still WebP of the attested size, with no metadata ────────────────────────────────
  const container = inspectWebp(payload);
  if (!container.ok) return refuse("CONTAINER", "NOT_A_STILL_WEBP", container.reason);
  if (container.width !== frame.width || container.height !== frame.height) {
    return refuse("CONTAINER", "NOT_A_STILL_WEBP", `the bitstream is ${container.width}x${container.height}, the attestation ${frame.width}x${frame.height}`);
  }

  // ── 6. send exactly them ──────────────────────────────────────────────────────────────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_EGRESS_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(request.destination, {
      method: "POST",
      headers: { "content-type": "image/webp", [FRAME_SHA_HEADER]: payloadSha256 },
      body: payload as unknown as BodyInit,
      signal: controller.signal,
    });
    await response.arrayBuffer();
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return refuse("TRANSPORT", timedOut ? "TRANSPORT_TIMEOUT" : "TRANSPORT_FAILED", timedOut ? "the sink did not answer in time." : "the request could not be completed.");
  } finally {
    clearTimeout(timer);
  }

  const claimedSha = response.headers.get(PEER_SHA_HEADER);
  const claimedBytes = response.headers.get(PEER_BYTES_HEADER);
  const parsedBytes = claimedBytes === null ? null : Number.parseInt(claimedBytes, 10);
  const peerReceipt: PeerReceipt | null =
    claimedSha === null && claimedBytes === null
      ? null
      : { sha256: claimedSha, bytes: parsedBytes !== null && Number.isFinite(parsedBytes) ? parsedBytes : null, agrees: claimedSha === null ? null : claimedSha === payloadSha256 };

  return {
    sent: true,
    record: {
      ...base,
      at: clock(),
      transport: "LOOPBACK_HTTP",
      contentType: "image/webp",
      status: "MASK_VERIFIED",
      payloadSha256,
      payloadBytes: payload.length,
      width: container.width,
      height: container.height,
      chunks: container.chunks,
      responseStatus: response.status,
      ...(peerReceipt ? { peerReceipt } : {}),
      elapsedMs: clock() - startedAt,
    },
  };
}
