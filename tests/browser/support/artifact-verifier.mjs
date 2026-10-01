/**
 * M10.8 — THE SANITIZED-ARTIFACT VERIFIER. Test-only, and independent of the code that masked.
 *
 * The frozen verifier sequence (`docs/security/security-invariants.md`):
 *   1 Apply masks · 2 Encode WebP q62, decode back · 3 Re-read · 4 Re-detect · 5 Value check ·
 *   6 Decide: Clean → verified; Survivor → dilate the offending region by 12 px, repeat; 3 failures → BLOCK
 *
 * Steps 1–2 are the producer's (M10.7's MASK_VERIFIED attestation). This module is 3–6, run on what
 * a SINK RECEIVED, as the owner decided for M10.8:
 *
 *   IDENTITY   the received bytes must hash to the attested digest, and be a still WebP of the attested
 *              size. A mutated payload, or a valid payload paired with another artifact's attestation
 *              (a stale or replaced artifact), is BLOCKED here, before anything is decoded.
 *   3 RE-READ  NOT OCR: no OCRProvider is admissible (ADR-0011). TR-01, the admitted text-REGION
 *              detector, run full-frame over the DECODED artifact with the verifier's DIFFERENTIAL
 *              configuration (higher resolution, lower box threshold; `verifier-runtime.mjs`).
 *   4 SURVIVORS  replaces "D2/D3 over recovered text", which has no input without OCR. A survivor is
 *              any re-detected text region that intersects a visual-only region. The product masks every
 *              text region in those regions (visual-only-text policy), so after masking none should be
 *              there. No ground truth is used: the regions are the observation's.
 *   5 VALUE CHECK  NOT RUN: it compares recovered text with vault values, and nothing is recovered.
 *   6 DECIDE   no survivor → PASS (status DETECTOR_VERIFIED, never "verified"). Survivors → each is
 *              dilated by 12 px, clipped to its region, filled on a VERIFIER COPY, re-encoded, decoded and
 *              re-read; up to 3 rounds. The ORIGINAL artifact is then BLOCKED either way. The reason
 *              says whether 12 px cleared it, or whether survivors persisted after 3 rounds (the frozen
 *              BLOCK). The 12 px geometry never reaches the product.
 *   A verifier that cannot run — a detector failure, a decode failure — BLOCKS (INV-22: fail closed).
 *
 * Output: verdict, reasons, counts, region ids, rectangles, hashes, timings. Never text, never pixels.
 */
import { createHash } from "node:crypto";

import { readWebpRiff } from "./webp-riff.mjs";

export const REDILATION_PX = 12;
export const MAX_ROUNDS = 3;
export const NOT_RUN = Object.freeze({
  ocrReRead: "no admissible OCRProvider (ADR-0011): step 3 is a text-REGION re-read, not a reading",
  d2d3OverRecoveredText: "no recovered text exists to run D2/D3 over",
  vaultValueCheck: "no recovered text exists to compare with vault values",
});

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const clip = (r, to) => {
  const x0 = Math.max(r.x, to.x), y0 = Math.max(r.y, to.y);
  const x1 = Math.min(r.x + r.w, to.x + to.w), y1 = Math.min(r.y + r.h, to.y + to.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};
/** CSS rect → capture pixels, rounded OUTWARD, clipped to the frame. */
const toPx = (r, s, W, H) => clip({ x: Math.floor(r.x / s), y: Math.floor(r.y / s), w: Math.ceil((r.x + r.w) / s) - Math.floor(r.x / s), h: Math.ceil((r.y + r.h) / s) - Math.floor(r.y / s) }, { x: 0, y: 0, w: W, h: H });

/** Survivors: re-detected boxes intersecting a visual-only region. Pure. */
export function survivorsOf(boxes, regionsPx) {
  const out = [];
  for (const b of boxes) {
    const hit = regionsPx.filter((r) => intersects(b, r.px)).map((r) => r.id);
    if (hit.length) out.push({ box: { x: b.x, y: b.y, w: b.w, h: b.h }, score: b.score, regions: hit });
  }
  return out;
}

/** The 12 px re-dilation of a survivor, clipped to each region it touches, in whole pixels. Pure. */
export function redilate(survivor, regionsPx) {
  const d = { x: Math.floor(survivor.box.x - REDILATION_PX), y: Math.floor(survivor.box.y - REDILATION_PX), w: 0, h: 0 };
  d.w = Math.ceil(survivor.box.x + survivor.box.w + REDILATION_PX) - d.x;
  d.h = Math.ceil(survivor.box.y + survivor.box.h + REDILATION_PX) - d.y;
  return regionsPx.filter((r) => survivor.regions.includes(r.id)).map((r) => clip(d, r.px)).filter(Boolean);
}

/**
 * Verify one received artifact.
 * @param {object} input
 * @param {Uint8Array|Buffer} input.bytes            what the sink received
 * @param {{sha256: string, width: number, height: number}} input.attestation  what was attested
 * @param {{id: string, rect: {x:number,y:number,w:number,h:number}}[]} input.visualRegions  CSS px
 * @param {number} input.scaleToCss
 * @param {(bytes: Uint8Array|Buffer) => Promise<{width:number,height:number,rgba:Uint8Array|Buffer}>} input.decode
 * @param {(frame: object) => Promise<{boxes: object[], ms: object}>} input.reRead   the differential TR-01 pass
 * @param {(frame: object) => Promise<Uint8Array|Buffer>} input.encode              WebP q62, for re-dilation rounds
 */
export async function verifyArtifact(input) {
  const t0 = performance.now();
  const ms = { identity: 0, decode: 0, reRead: [], survivors: 0, redilation: 0, total: 0 };
  const result = (verdict, extra) => ({ verdict, status: verdict === "PASS" ? "DETECTOR_VERIFIED" : "BLOCKED", notRun: NOT_RUN, ...extra, ms: { ...ms, total: performance.now() - t0 } });

  // ── identity: the bytes are the attested bytes, and a still WebP of the attested size ──
  const ti = performance.now();
  const receivedSha256 = sha256(input.bytes);
  const riff = readWebpRiff(input.bytes);
  ms.identity = performance.now() - ti;
  const identity = { receivedSha256, attestedSha256: input.attestation?.sha256 ?? null };
  if (!input.attestation || receivedSha256 !== input.attestation.sha256) return result("BLOCK", { reason: "IDENTITY_MISMATCH", identity });
  if (!riff.ok || riff.width !== input.attestation.width || riff.height !== input.attestation.height) return result("BLOCK", { reason: "NOT_THE_ATTESTED_STILL_WEBP", identity });

  // ── decode, by the verifier's own decoder ──
  const td = performance.now();
  let frame;
  try {
    frame = await input.decode(input.bytes);
  } catch {
    ms.decode = performance.now() - td;
    return result("BLOCK", { reason: "DECODE_FAILED", identity });
  }
  ms.decode = performance.now() - td;
  if (frame.width !== input.attestation.width || frame.height !== input.attestation.height) return result("BLOCK", { reason: "DECODED_SIZE_MISMATCH", identity });
  identity.decodedSha256 = sha256(frame.rgba);

  const regionsPx = input.visualRegions.map((r) => ({ id: r.id, px: toPx(r.rect, input.scaleToCss, frame.width, frame.height) })).filter((r) => r.px);
  const rounds = [];
  let current = frame;
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    let read;
    try {
      read = await input.reRead(current);
    } catch {
      return result("BLOCK", { reason: "RE_READ_FAILED", identity, rounds });
    }
    ms.reRead.push(read.ms?.total ?? null);
    const ts = performance.now();
    const survivors = survivorsOf(read.boxes, regionsPx);
    ms.survivors += performance.now() - ts;
    rounds.push({ round, detections: read.boxes.length, outsideRegions: read.boxes.length - survivors.length, survivors, runtimeWasmBytes: read.wasmBytes ?? null });
    if (survivors.length === 0) {
      if (round === 0) return result("PASS", { reason: null, identity, regions: regionsPx.map((r) => r.id), rounds });
      return result("BLOCK", { reason: `SURVIVORS_CLEARED_ONLY_BY_${REDILATION_PX}PX_REDILATION`, clearedAtRound: round, identity, rounds });
    }
    if (round === MAX_ROUNDS) break;
    // ── 6: 12 px re-dilation on a VERIFIER COPY; re-encode, decode, re-read ──
    const tr = performance.now();
    const copy = { width: current.width, height: current.height, rgba: Uint8Array.from(current.rgba) };
    const fills = survivors.flatMap((s) => redilate(s, regionsPx));
    for (const f of fills) for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) copy.rgba.set([0, 0, 0, 255], (y * copy.width + x) * 4);
    rounds[rounds.length - 1].redilatedFills = fills;
    try {
      current = await input.decode(await input.encode(copy));
    } catch {
      return result("BLOCK", { reason: "DECODE_FAILED", identity, rounds });
    }
    ms.redilation += performance.now() - tr;
  }
  return result("BLOCK", { reason: `SURVIVORS_PERSIST_AFTER_${MAX_ROUNDS}_ROUNDS`, identity, rounds });
}

/** A handoff may proceed only on PASS. Anything else — BLOCK, an error, nothing — does not. */
export const mayHandOff = (verdict) => verdict?.verdict === "PASS" && verdict.status === "DETECTOR_VERIFIED";
