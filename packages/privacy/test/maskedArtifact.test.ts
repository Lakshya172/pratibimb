import { describe, expect, it } from "vitest";

import {
  MASK_INTERIOR_INSET_PX,
  WEBP_MASK_TOLERANCE,
  WEBP_QUALITY,
  attestMaskedFrame,
  checkDecodedMask,
  hasWebpSignature,
  isMaskVerifiedFrame,
  sha256HexOfBytes,
  type RgbaFrame,
} from "../src/index.js";

const W = 40;
const H = 30;
/** A white frame with one opaque black mask at (10, 8, 20×14) — what `fillOpaque` leaves. */
function sanitizedFrame(): RgbaFrame {
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 8; y < 22; y++) for (let x = 10; x < 30; x++) rgba.set([0, 0, 0, 255], (y * W + x) * 4);
  return { width: W, height: H, rgba };
}
const MASK = [{ x: 10, y: 8, w: 20, h: 14 }];
const REGIONS = [{ regionId: "canvas:0", pixelRects: MASK }];
/** RIFF/WEBP bytes with a VP8L header of the given size; a container, not a decodable image. */
function webpBytes(w = W, h = H): Uint8Array {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  const chunk = [0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff, 0, 0, 0];
  const body = [...new TextEncoder().encode("WEBP"), ...new TextEncoder().encode("VP8L"), chunk.length, 0, 0, 0, ...chunk];
  const riff = body.length;
  return Uint8Array.from([...new TextEncoder().encode("RIFF"), riff & 0xff, (riff >>> 8) & 0xff, 0, 0, ...body]);
}
const input = (over: Partial<Parameters<typeof attestMaskedFrame>[0]> = {}) => ({
  bytes: webpBytes(),
  sanitized: sanitizedFrame(),
  decoded: sanitizedFrame(),
  regions: REGIONS,
  frameId: "frame-1",
  scaleToCss: 1,
  failClosed: false,
  reason: null,
  quality: WEBP_QUALITY,
  ...over,
});

describe("the decoded-mask check (steps 1–2 of the frozen verifier)", () => {
  it("is gated on the interior, inset by the frozen 4 px dilation, and reports the edges", () => {
    expect(MASK_INTERIOR_INSET_PX).toBe(4);
    const decoded = sanitizedFrame();
    // Edge bleed of 21 levels on the mask's border row: reported, not a failure.
    for (let x = 10; x < 30; x++) decoded.rgba.set([21, 21, 21, 255], (8 * W + x) * 4);
    const check = checkDecodedMask({ sanitized: sanitizedFrame(), decoded, pixelRects: MASK });
    expect(check.held).toBe(true);
    expect(check.rects[0]).toEqual({ rect: MASK[0], interiorMax: 0, edgeMax: 21 });
  });

  it(`fails when any interior pixel decodes more than ${WEBP_MASK_TOLERANCE} levels from the fill`, () => {
    const decoded = sanitizedFrame();
    decoded.rgba.set([WEBP_MASK_TOLERANCE + 1, 0, 0, 255], (15 * W + 20) * 4);
    expect(checkDecodedMask({ sanitized: sanitizedFrame(), decoded, pixelRects: MASK }).held).toBe(false);
    decoded.rgba.set([WEBP_MASK_TOLERANCE, 0, 0, 255], (15 * W + 20) * 4);
    expect(checkDecodedMask({ sanitized: sanitizedFrame(), decoded, pixelRects: MASK }).held).toBe(true);
  });

  it("an unmasked decode — the text came back — fails; so does partial alpha", () => {
    const white = { width: W, height: H, rgba: new Uint8ClampedArray(W * H * 4).fill(255) };
    expect(checkDecodedMask({ sanitized: sanitizedFrame(), decoded: white, pixelRects: MASK }).held).toBe(false);
    const translucent = sanitizedFrame();
    translucent.rgba[(15 * W + 20) * 4 + 3] = 200;
    expect(checkDecodedMask({ sanitized: sanitizedFrame(), decoded: translucent, pixelRects: MASK }).held).toBe(false);
  });

  it("a rectangle too small to inset is gated on its whole area", () => {
    const tiny = [{ x: 10, y: 8, w: 6, h: 6 }];
    const decoded = sanitizedFrame();
    decoded.rgba.set([20, 20, 20, 255], (8 * W + 10) * 4);
    const check = checkDecodedMask({ sanitized: sanitizedFrame(), decoded, pixelRects: tiny });
    expect(check.rects[0]?.interiorMax).toBeNull();
    expect(check.held).toBe(false);
  });

  it("reports the outside error and a dimension mismatch fails closed", () => {
    const decoded = sanitizedFrame();
    decoded.rgba.set([250, 255, 255, 255], 0);
    const check = checkDecodedMask({ sanitized: sanitizedFrame(), decoded, pixelRects: MASK });
    expect(check.outside.maxAbs).toBe(5);
    expect(check.outside.pixels).toBe(W * H - 20 * 14);
    const other = { width: W, height: H - 1, rgba: new Uint8ClampedArray(W * (H - 1) * 4) };
    expect(checkDecodedMask({ sanitized: sanitizedFrame(), decoded: other, pixelRects: MASK })).toMatchObject({ held: false, dimensionsMatch: false });
  });
});

describe("attestation: the only way to mint a MASK-VERIFIED frame", () => {
  it("attests a frame whose mask survived, hashing the bytes ITSELF over a private copy", async () => {
    const bytes = webpBytes();
    const out = await attestMaskedFrame(input({ bytes }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(isMaskVerifiedFrame(out.frame)).toBe(true);
    expect(out.frame.sha256).toBe(await sha256HexOfBytes(bytes));
    expect(out.frame.bytes).not.toBe(bytes);
    bytes[0] = 0; // the caller's buffer changing does not change what was attested
    expect(out.frame.bytes[0]).toBe(0x52);
    expect(out.frame.manifest).toMatchObject({ status: "MASK_VERIFIED", contentType: "image/webp", quality: 0.62, width: W, height: H, counts: { regions: 1, maskRects: 1, maskRectAreaPx: 280 } });
    expect(out.frame.manifest.notRun.length).toBe(4);
  });

  it("refuses empty bytes, non-WebP bytes, a size mismatch and a mask that did not survive", async () => {
    expect(await attestMaskedFrame(input({ bytes: new Uint8Array(0) }))).toMatchObject({ ok: false, code: "ENCODE_EMPTY" });
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]);
    expect(await attestMaskedFrame(input({ bytes: png }))).toMatchObject({ ok: false, code: "NOT_WEBP" });
    const short = { width: W, height: H - 1, rgba: new Uint8ClampedArray(W * (H - 1) * 4) };
    expect(await attestMaskedFrame(input({ decoded: short }))).toMatchObject({ ok: false, code: "DIMENSION_MISMATCH" });
    const white = { width: W, height: H, rgba: new Uint8ClampedArray(W * H * 4).fill(255) };
    expect(await attestMaskedFrame(input({ decoded: white }))).toMatchObject({ ok: false, code: "MASK_NOT_PRESERVED" });
  });

  it("an object with every field of an attested frame is still not one", async () => {
    const out = await attestMaskedFrame(input());
    if (!out.ok) throw new Error("expected ok");
    expect(isMaskVerifiedFrame({ ...out.frame })).toBe(false);
    expect(isMaskVerifiedFrame({ contentType: "image/webp", bytes: webpBytes(), sha256: out.frame.sha256, width: W, height: H, manifest: out.frame.manifest })).toBe(false);
    expect(isMaskVerifiedFrame(sanitizedFrame())).toBe(false);
    expect(isMaskVerifiedFrame(null)).toBe(false);
  });

  it("the manifest carries ids, rectangles, counts, hashes and status — no text, no pixels", async () => {
    const out = await attestMaskedFrame(input());
    if (!out.ok) throw new Error("expected ok");
    const text = JSON.stringify(out.frame.manifest);
    expect(text.length).toBeLessThan(2_000);
    for (const v of Object.values(out.frame.manifest)) expect(ArrayBuffer.isView(v)).toBe(false);
    expect(Object.keys(out.frame.manifest).sort()).toEqual(
      ["check", "contentType", "counts", "decodedRgbaSha256", "failClosed", "frameId", "height", "kind", "notRun", "quality", "reason", "regions", "sanitizedRgbaSha256", "scaleToCss", "status", "version", "webpBytes", "webpSha256", "width"].sort()
    );
  });

  it("the signature check is the container's, not a label's", () => {
    expect(hasWebpSignature(webpBytes())).toBe(true);
    expect(hasWebpSignature(new TextEncoder().encode("RIFF0000WAVE"))).toBe(false);
  });
});
