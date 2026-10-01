/**
 * THE MASKED-FRAME ARTIFACT — what the perception realm may hand to egress, and the proof it may.
 *
 * `docs/security/security-invariants.md`, the frozen verifier sequence:
 *
 *   1 Apply masks   opaque fill, then semantic label
 *   2 Encode        WebP q62, then decode the bytes back
 *   3 Re-read       full-frame OCR, LOW threshold, HIGHER resolution
 *   4 Re-detect     D2 and D3 over recovered text
 *   5 Value check   exact + fuzzy match against vault contents
 *   6 Decide        Clean -> verified = true …
 *
 * and the supporting rule: "Verification runs against the encoded WebP bytes that will actually be
 * transmitted, decoded back — not the pre-encode canvas."
 *
 * THIS MODULE IS STEPS 1–2 AND NOTHING MORE. It checks that the mask the plan applied is still a
 * mask in the DECODED bytes, and that nothing else about those bytes is unexpected. Steps 3–6 need
 * OCR and the vault and are not implemented. So what it mints is called MASK-VERIFIED, never
 * "verified": the name must not claim the frozen verifier ran.
 *
 * HOW A FRAME BECOMES MASK-VERIFIED. Only `attestMaskedFrame` can make one, and only when:
 *   - the bytes are non-empty and carry the WebP container signature (fail closed if "WebP encode
 *     returns empty" — a row of the fail-closed matrix);
 *   - the decoded frame has the sanitized frame's dimensions;
 *   - inside every mask rectangle, inset by the frozen 4 px dilation (so: the detected box the mask
 *     was dilated from), no decoded channel exceeds `WEBP_MASK_TOLERANCE` above the fill.
 * The digest is computed HERE, over a private copy of the bytes, and the attested object is
 * registered in a module-private `WeakSet` exactly as `isVerifiedHandoff` does. Egress asks
 * `isMaskVerifiedFrame`, never a field, and re-hashes before it sends.
 *
 * Pixels and geometry only: no browser encoding API (the realm encodes and decodes), no network, no
 * model, no text. The manifest it builds carries ids, rectangles, counts, hashes and status — never
 * page text, never pixels.
 */
import { MASK_FILL, assertRgbaFrame, type PixelRect, type RgbaFrame } from "./pixelRedaction.js";
import { REDACTION_UNION } from "./redactionGeometry.js";

/** The dossier's egress encoding: WebP at quality 62 (`manifest-schema.md`, `security-invariants.md`). */
export const WEBP_QUALITY = 0.62;

/**
 * The largest decoded deviation from the fill tolerated inside a mask, in 8-bit levels.
 *
 * AN ENGINEERING PARAMETER of this check, set by measurement, not taken from the dossier. On W1 /
 * Chrome for Testing, q62 decoded the M10.5 fixture's mask interiors (inset 4 px) to at most 1 level
 * and the fixture's ink rectangles to at most 1, against a white page background of 255 that an
 * unmasked line of text would show. Mask EDGES bleed further (21 measured) and are reported, not
 * gated, because the inset — the frozen dilation — is the margin the geometry already added.
 */
export const WEBP_MASK_TOLERANCE = 8;

/** The inset that turns a mask rectangle back into the box it was dilated from. */
export const MASK_INTERIOR_INSET_PX = REDACTION_UNION.dilationPx;

/** What a mask looked like after the round trip. */
export interface DecodedMaskRect {
  readonly rect: PixelRect;
  /** Largest channel value inside the inset interior; the gate. `null` if the inset is empty. */
  readonly interiorMax: number | null;
  /** Largest channel value anywhere in the rectangle, edges included; reported only. */
  readonly edgeMax: number;
}

export interface DecodedMaskCheck {
  readonly held: boolean;
  readonly dimensionsMatch: boolean;
  readonly tolerance: number;
  readonly insetPx: number;
  readonly rects: readonly DecodedMaskRect[];
  /** Outside every mask: how far the decoded frame moved from the sanitized one. Reported only. */
  readonly outside: { readonly pixels: number; readonly maxAbs: number; readonly meanAbs: number; readonly psnrDb: number | null };
}

const clipToFrame = (r: PixelRect, width: number, height: number): PixelRect | null => {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.w);
  const y1 = Math.min(height, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

/** The largest of R, G, B's distance from the fill over a rectangle (alpha is checked separately). */
function maxDeviation(frame: RgbaFrame, r: PixelRect): number {
  let max = 0;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const o = (y * frame.width + x) * 4;
      const rgba = frame.rgba;
      max = Math.max(max, Math.abs((rgba[o] as number) - MASK_FILL.r), Math.abs((rgba[o + 1] as number) - MASK_FILL.g), Math.abs((rgba[o + 2] as number) - MASK_FILL.b), Math.abs((rgba[o + 3] as number) - MASK_FILL.a));
    }
  return max;
}

/**
 * Does the mask survive the round trip? Pure.
 *
 * `sanitized` is the frame that was encoded, `decoded` what its bytes decode to, `pixelRects` the
 * mask the plan applied. Fails closed: a dimension mismatch, or an interior over tolerance, is
 * `held: false`; a rectangle whose inset is empty is gated on its whole area instead.
 */
export function checkDecodedMask(input: { readonly sanitized: RgbaFrame; readonly decoded: RgbaFrame; readonly pixelRects: readonly PixelRect[] }): DecodedMaskCheck {
  const { sanitized, decoded } = input;
  assertRgbaFrame(sanitized);
  assertRgbaFrame(decoded);
  const dimensionsMatch = sanitized.width === decoded.width && sanitized.height === decoded.height;
  const empty = { pixels: 0, maxAbs: 0, meanAbs: 0, psnrDb: null };
  if (!dimensionsMatch) return { held: false, dimensionsMatch, tolerance: WEBP_MASK_TOLERANCE, insetPx: MASK_INTERIOR_INSET_PX, rects: [], outside: empty };

  const { width, height } = decoded;
  const inMask = new Uint8Array(width * height);
  const rects: DecodedMaskRect[] = [];
  let held = true;
  for (const raw of input.pixelRects) {
    const r = clipToFrame(raw, width, height);
    if (!r) continue;
    for (let y = r.y; y < r.y + r.h; y++) inMask.fill(1, y * width + r.x, y * width + r.x + r.w);
    const inset = clipToFrame({ x: r.x + MASK_INTERIOR_INSET_PX, y: r.y + MASK_INTERIOR_INSET_PX, w: r.w - 2 * MASK_INTERIOR_INSET_PX, h: r.h - 2 * MASK_INTERIOR_INSET_PX }, width, height);
    const edgeMax = maxDeviation(decoded, r);
    const interiorMax = inset ? maxDeviation(decoded, inset) : null;
    if ((interiorMax ?? edgeMax) > WEBP_MASK_TOLERANCE) held = false;
    rects.push({ rect: r, interiorMax, edgeMax });
  }

  let pixels = 0;
  let maxAbs = 0;
  let sumAbs = 0;
  let sumSq = 0;
  for (let p = 0; p < width * height; p++) {
    if (inMask[p]) continue;
    pixels++;
    const o = p * 4;
    for (let k = 0; k < 3; k++) {
      const e = Math.abs((decoded.rgba[o + k] as number) - (sanitized.rgba[o + k] as number));
      maxAbs = Math.max(maxAbs, e);
      sumAbs += e;
      sumSq += e * e;
    }
  }
  const n = pixels * 3;
  const mse = n === 0 ? 0 : sumSq / n;
  return {
    held,
    dimensionsMatch,
    tolerance: WEBP_MASK_TOLERANCE,
    insetPx: MASK_INTERIOR_INSET_PX,
    rects,
    outside: { pixels, maxAbs, meanAbs: n === 0 ? 0 : sumAbs / n, psnrDb: mse === 0 ? null : 10 * Math.log10((255 * 255) / mse) },
  };
}

/** `RIFF····WEBP`: the container signature. Anything else is not a WebP, whatever it is labelled. */
export const hasWebpSignature = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 &&
  bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
  bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;

export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The local verification metadata that travels WITH the artifact, never instead of checking it. */
export interface MaskedFrameManifest {
  readonly kind: "PRATIBIMB_MASKED_FRAME";
  readonly version: 1;
  /** Steps 1–2 of the frozen verifier. Never "verified": steps 3–6 did not run. */
  readonly status: "MASK_VERIFIED";
  readonly notRun: readonly string[];
  readonly frameId: string;
  readonly width: number;
  readonly height: number;
  readonly contentType: "image/webp";
  readonly quality: number;
  readonly scaleToCss: number;
  readonly failClosed: boolean;
  readonly reason: string | null;
  readonly regions: readonly { readonly regionId: string; readonly pixelRects: readonly PixelRect[] }[];
  readonly counts: { readonly regions: number; readonly maskRects: number; readonly maskRectAreaPx: number };
  readonly sanitizedRgbaSha256: string;
  readonly decodedRgbaSha256: string;
  readonly webpSha256: string;
  readonly webpBytes: number;
  readonly check: { readonly tolerance: number; readonly insetPx: number; readonly worstInterior: number | null; readonly worstEdge: number | null; readonly outside: DecodedMaskCheck["outside"] };
}

/** A frame `attestMaskedFrame` produced. Only membership in its registry makes it one. */
export interface MaskVerifiedFrame {
  readonly contentType: "image/webp";
  readonly width: number;
  readonly height: number;
  /** A private copy of the attested bytes. Egress re-hashes it before sending, so a mutation is caught. */
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly manifest: MaskedFrameManifest;
}

export type AttestRefusalCode = "ENCODE_EMPTY" | "NOT_WEBP" | "DIMENSION_MISMATCH" | "MASK_NOT_PRESERVED";
export type AttestOutcome =
  | { readonly ok: true; readonly frame: MaskVerifiedFrame; readonly check: DecodedMaskCheck }
  | { readonly ok: false; readonly code: AttestRefusalCode; readonly detail: string; readonly check: DecodedMaskCheck | null };

export interface AttestInput {
  readonly bytes: Uint8Array;
  /** The frame that was encoded: the SANITIZED frame, masked in place. */
  readonly sanitized: RgbaFrame;
  /** What `bytes` decode to, decoded by the realm that encoded them. */
  readonly decoded: RgbaFrame;
  readonly regions: readonly { readonly regionId: string; readonly pixelRects: readonly PixelRect[] }[];
  readonly frameId: string;
  readonly scaleToCss: number;
  readonly failClosed: boolean;
  readonly reason: string | null;
  readonly quality: number;
}

/** Frames this module attested. Membership IS the attestation. */
const ATTESTED = new WeakSet<object>();

/** `true` only for an object `attestMaskedFrame` produced. Egress asks this, never a field. */
export const isMaskVerifiedFrame = (candidate: unknown): candidate is MaskVerifiedFrame =>
  typeof candidate === "object" && candidate !== null && ATTESTED.has(candidate);

const NOT_RUN = Object.freeze(["full-frame OCR re-read (step 3)", "D2/D3 re-detection (step 4)", "vault value check (step 5)", "12 px re-dilation loop (step 6)"]);

export async function attestMaskedFrame(input: AttestInput): Promise<AttestOutcome> {
  const bytes = input.bytes.slice();
  if (bytes.length === 0) return { ok: false, code: "ENCODE_EMPTY", detail: "the encoder returned no bytes", check: null };
  if (!hasWebpSignature(bytes)) return { ok: false, code: "NOT_WEBP", detail: "the bytes do not carry the RIFF/WEBP signature", check: null };
  const pixelRects = input.regions.flatMap((r) => r.pixelRects);
  const check = checkDecodedMask({ sanitized: input.sanitized, decoded: input.decoded, pixelRects });
  if (!check.dimensionsMatch) {
    return { ok: false, code: "DIMENSION_MISMATCH", detail: `decoded ${input.decoded.width}x${input.decoded.height}, encoded ${input.sanitized.width}x${input.sanitized.height}`, check };
  }
  if (!check.held) return { ok: false, code: "MASK_NOT_PRESERVED", detail: `a mask interior decoded more than ${WEBP_MASK_TOLERANCE} levels from the fill`, check };

  const [webpSha256, sanitizedRgbaSha256, decodedRgbaSha256] = await Promise.all([
    sha256HexOfBytes(bytes),
    sha256HexOfBytes(input.sanitized.rgba as Uint8Array),
    sha256HexOfBytes(input.decoded.rgba as Uint8Array),
  ]);
  const interiors = check.rects.map((r) => r.interiorMax).filter((v): v is number => v !== null);
  const manifest: MaskedFrameManifest = Object.freeze({
    kind: "PRATIBIMB_MASKED_FRAME",
    version: 1,
    status: "MASK_VERIFIED",
    notRun: NOT_RUN,
    frameId: input.frameId,
    width: input.sanitized.width,
    height: input.sanitized.height,
    contentType: "image/webp",
    quality: input.quality,
    scaleToCss: input.scaleToCss,
    failClosed: input.failClosed,
    reason: input.reason,
    regions: input.regions.map((r) => ({ regionId: r.regionId, pixelRects: r.pixelRects.map(({ x, y, w, h }) => ({ x, y, w, h })) })),
    counts: {
      regions: input.regions.length,
      maskRects: pixelRects.length,
      maskRectAreaPx: check.rects.reduce((n, r) => n + r.rect.w * r.rect.h, 0),
    },
    sanitizedRgbaSha256,
    decodedRgbaSha256,
    webpSha256,
    webpBytes: bytes.length,
    check: {
      tolerance: check.tolerance,
      insetPx: check.insetPx,
      worstInterior: interiors.length === 0 ? null : Math.max(...interiors),
      worstEdge: check.rects.length === 0 ? null : Math.max(...check.rects.map((r) => r.edgeMax)),
      outside: check.outside,
    },
  });
  const frame: MaskVerifiedFrame = Object.freeze({ contentType: "image/webp", width: input.sanitized.width, height: input.sanitized.height, bytes, sha256: webpSha256, manifest });
  ATTESTED.add(frame);
  return { ok: true, frame, check };
}
