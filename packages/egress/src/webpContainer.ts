/**
 * WHAT A FRAME PAYLOAD MAY BE, BYTE FOR BYTE — egress's own reading of a WebP container.
 *
 * Egress does not decode images. It reads the RIFF container (`RIFF <size> WEBP`, then chunks), and
 * admits exactly the shape a still frame needs:
 *   - an optional `VP8X` header first, with none of the ICC, EXIF, XMP or animation flags set;
 *   - an optional `ALPH` chunk;
 *   - exactly one image chunk, `VP8 ` (lossy) or `VP8L` (lossless);
 *   - nothing else. `EXIF`, `XMP `, `ICCP`, `ANIM`, `ANMF` and unknown chunks are refused: a metadata
 *     chunk is a place text could travel, and a frame has no use for one.
 * The RIFF size must account for every byte, and every chunk must lie inside it. The image
 * dimensions are read from the bitstream header and, when present, must agree with `VP8X`'s canvas.
 *
 * Pure, synchronous, platform-neutral.
 */
export type WebpInspection =
  | { readonly ok: true; readonly width: number; readonly height: number; readonly chunks: readonly string[]; readonly codec: "VP8" | "VP8L" }
  | { readonly ok: false; readonly reason: string };

const fourcc = (b: Uint8Array, at: number): string => String.fromCharCode(b[at] as number, b[at + 1] as number, b[at + 2] as number, b[at + 3] as number);
const u32 = (b: Uint8Array, at: number): number => ((b[at] as number) | ((b[at + 1] as number) << 8) | ((b[at + 2] as number) << 16) | ((b[at + 3] as number) << 24)) >>> 0;
const u24 = (b: Uint8Array, at: number): number => (b[at] as number) | ((b[at + 1] as number) << 8) | ((b[at + 2] as number) << 16);

const VP8X_FORBIDDEN_FLAGS = 0x20 /* ICC */ | 0x08 /* EXIF */ | 0x04 /* XMP */ | 0x02; /* animation */

export function inspectWebp(bytes: Uint8Array): WebpInspection {
  const no = (reason: string): WebpInspection => ({ ok: false, reason });
  if (bytes.length < 20) return no("shorter than any WebP");
  if (fourcc(bytes, 0) !== "RIFF" || fourcc(bytes, 8) !== "WEBP") return no("no RIFF/WEBP signature");
  if (u32(bytes, 4) + 8 !== bytes.length) return no("the RIFF size does not account for the payload");

  const chunks: string[] = [];
  let canvas: { w: number; h: number } | null = null;
  let image: { w: number; h: number; codec: "VP8" | "VP8L" } | null = null;
  let at = 12;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) return no("a truncated chunk header");
    const id = fourcc(bytes, at);
    const size = u32(bytes, at + 4);
    const body = at + 8;
    const end = body + size + (size & 1);
    if (body + size > bytes.length || end > bytes.length) return no(`chunk ${JSON.stringify(id)} runs past the payload`);
    chunks.push(id);
    if (id === "VP8X") {
      if (chunks.length !== 1) return no("VP8X is not the first chunk");
      if (size < 10) return no("a short VP8X chunk");
      if (((bytes[body] as number) & VP8X_FORBIDDEN_FLAGS) !== 0) return no("VP8X declares ICC, EXIF, XMP or animation");
      canvas = { w: u24(bytes, body + 4) + 1, h: u24(bytes, body + 7) + 1 };
    } else if (id === "ALPH") {
      // an alpha plane: admitted, carries no metadata
    } else if (id === "VP8 ") {
      if (image) return no("more than one image chunk");
      if (size < 10 || bytes[body + 3] !== 0x9d || bytes[body + 4] !== 0x01 || bytes[body + 5] !== 0x2a) return no("a VP8 chunk without the key-frame start code");
      image = { w: ((bytes[body + 6] as number) | ((bytes[body + 7] as number) << 8)) & 0x3fff, h: ((bytes[body + 8] as number) | ((bytes[body + 9] as number) << 8)) & 0x3fff, codec: "VP8" };
    } else if (id === "VP8L") {
      if (image) return no("more than one image chunk");
      if (size < 5 || bytes[body] !== 0x2f) return no("a VP8L chunk without its signature");
      const bits = u32(bytes, body + 1);
      image = { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1, codec: "VP8L" };
    } else {
      return no(`chunk ${JSON.stringify(id)} is not admitted in a frame payload`);
    }
    at = end;
  }
  if (!image) return no("no image chunk");
  if (canvas && (canvas.w !== image.w || canvas.h !== image.h)) return no("the VP8X canvas and the bitstream disagree on size");
  return { ok: true, width: image.w, height: image.h, chunks, codec: image.codec };
}
