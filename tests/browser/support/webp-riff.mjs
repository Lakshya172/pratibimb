/**
 * M10.7 — THE SINK'S OWN READING OF A WEBP CONTAINER. Test-only.
 *
 * Deliberately NOT `packages/egress/src/webpContainer.ts`: the sink must not trust the sender's code
 * to tell it what the sender sent. This walks the RIFF structure with a DataView and reports what is
 * there; `frame-sink.mjs` decides what to accept. No decoding: pixel checks happen in a separate
 * browser page, never in the extension.
 */

/** @returns {{ ok: true, riffSize: number, chunks: {id: string, size: number}[], width: number|null, height: number|null, canvas: {w:number,h:number}|null, vp8xFlags: number|null } | { ok: false, reason: string }} */
export function readWebpRiff(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.byteLength < 12) return { ok: false, reason: "fewer than 12 bytes" };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== "RIFF") return { ok: false, reason: "not RIFF" };
  if (tag(8) !== "WEBP") return { ok: false, reason: "RIFF but not WEBP" };
  const riffSize = dv.getUint32(4, true);
  if (riffSize + 8 !== bytes.byteLength) return { ok: false, reason: `RIFF size ${riffSize} + 8 != ${bytes.byteLength}` };
  const chunks = [];
  let width = null;
  let height = null;
  let canvas = null;
  let vp8xFlags = null;
  for (let o = 12; o < bytes.byteLength; ) {
    if (o + 8 > bytes.byteLength) return { ok: false, reason: "truncated chunk header" };
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    const data = o + 8;
    if (data + size > bytes.byteLength) return { ok: false, reason: `chunk ${id} overruns` };
    chunks.push({ id, size });
    if (id === "VP8X" && size >= 10) {
      vp8xFlags = dv.getUint8(data);
      const w = dv.getUint8(data + 4) | (dv.getUint8(data + 5) << 8) | (dv.getUint8(data + 6) << 16);
      const h = dv.getUint8(data + 7) | (dv.getUint8(data + 8) << 8) | (dv.getUint8(data + 9) << 16);
      canvas = { w: w + 1, h: h + 1 };
    } else if (id === "VP8 " && size >= 10) {
      if (dv.getUint8(data + 3) === 0x9d && dv.getUint8(data + 4) === 0x01 && dv.getUint8(data + 5) === 0x2a) {
        width = dv.getUint16(data + 6, true) & 0x3fff;
        height = dv.getUint16(data + 8, true) & 0x3fff;
      }
    } else if (id === "VP8L" && size >= 5 && dv.getUint8(data) === 0x2f) {
      const v = dv.getUint32(data + 1, true);
      width = (v & 0x3fff) + 1;
      height = ((v >>> 14) & 0x3fff) + 1;
    }
    o = data + size + (size % 2);
  }
  return { ok: true, riffSize, chunks, width, height, canvas, vp8xFlags };
}
