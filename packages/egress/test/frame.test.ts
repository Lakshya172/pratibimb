/**
 * M10.7 — a masked frame leaves through the egress choke point only when it was attested, only to
 * loopback, and only as the exact bytes the attestation hashed. A real loopback server records every
 * arrival, so "refused" means "nothing arrived", not "a function returned false".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { WEBP_QUALITY, attestMaskedFrame, type MaskVerifiedFrame, type RgbaFrame } from "@pratibimb/privacy";

import { FRAME_SHA_HEADER, inspectWebp, sendMaskVerifiedFrame } from "../src/index.js";

const W = 40;
const H = 30;
function frame(): RgbaFrame {
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 8; y < 22; y++) for (let x = 10; x < 30; x++) rgba.set([0, 0, 0, 255], (y * W + x) * 4);
  return { width: W, height: H, rgba };
}
const ascii = (s: string) => [...new TextEncoder().encode(s)];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
/** A RIFF container from chunks: [fourcc, payload][]. */
function riff(chunks: [string, number[]][]): Uint8Array {
  const body = [...ascii("WEBP")];
  for (const [id, data] of chunks) body.push(...ascii(id), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : []));
  return Uint8Array.from([...ascii("RIFF"), ...le32(body.length), ...body]);
}
const vp8l = (w: number, h: number) => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return [0x2f, ...le32(bits), 0, 0, 0];
};
const vp8 = (w: number, h: number) => [0, 0, 0, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, h & 0xff, (h >> 8) & 0x3f];
const vp8x = (flags: number, w: number, h: number) => [flags, 0, 0, 0, (w - 1) & 0xff, ((w - 1) >> 8) & 0xff, 0, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, 0];

async function attested(bytes = riff([["VP8L", vp8l(W, H)]])): Promise<MaskVerifiedFrame> {
  const out = await attestMaskedFrame({ bytes, sanitized: frame(), decoded: frame(), regions: [{ regionId: "canvas:0", pixelRects: [{ x: 10, y: 8, w: 20, h: 14 }] }], frameId: "f", scaleToCss: 1, failClosed: false, reason: null, quality: WEBP_QUALITY });
  if (!out.ok) throw new Error(out.code);
  return out.frame;
}

let server: Server;
let url = "";
const arrivals: { contentType: string | undefined; bytes: Buffer; declared: string | undefined }[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => {
      const bytes = Buffer.concat(parts);
      arrivals.push({ contentType: req.headers["content-type"], bytes, declared: req.headers[FRAME_SHA_HEADER] as string | undefined });
      res.writeHead(200, { "x-pratibimb-received-sha256": createHash("sha256").update(bytes).digest("hex"), "x-pratibimb-received-bytes": String(bytes.length) });
      res.end("ok");
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/m10/frame`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => {
  arrivals.length = 0;
});
const send = (f: unknown, destination = url) => sendMaskVerifiedFrame({ frame: f as MaskVerifiedFrame, destination, requestId: "r", sessionId: "s" });

describe("only an attested frame leaves, as exactly the attested bytes", () => {
  it("sends image/webp, the attested bytes, and the digest; the peer's receipt agrees", async () => {
    const f = await attested();
    const out = await send(f);
    expect(out.sent).toBe(true);
    if (!out.sent) return;
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]?.contentType).toBe("image/webp");
    expect(Buffer.compare(arrivals[0]!.bytes, Buffer.from(f.bytes))).toBe(0);
    expect(arrivals[0]?.declared).toBe(f.sha256);
    expect(out.record).toMatchObject({ status: "MASK_VERIFIED", payloadSha256: f.sha256, payloadBytes: f.bytes.length, width: W, height: H, chunks: ["VP8L"], peerReceipt: { agrees: true } });
    expect(JSON.stringify(out.record)).not.toContain("bytes\":{");
  });

  it.each([
    ["raw RGBA shaped like an artifact", () => ({ contentType: "image/webp", width: W, height: H, bytes: new Uint8Array(W * H * 4), sha256: "x", manifest: {} })],
    ["the sanitized RGBA frame itself", () => frame()],
    ["an unattested WebP", () => ({ contentType: "image/webp", width: W, height: H, bytes: riff([["VP8L", vp8l(W, H)]]), sha256: "x", manifest: { status: "MASK_VERIFIED" } })],
    ["empty bytes", () => ({ contentType: "image/webp", width: W, height: H, bytes: new Uint8Array(0), sha256: "", manifest: {} })],
    ["a copy of an attested frame", async () => ({ ...(await attested()) })],
    ["null", () => null],
  ])("refuses %s at VERIFY, and nothing arrives", async (_name, make) => {
    const out = await send(await make());
    expect(out).toMatchObject({ sent: false, refusal: { stage: "VERIFY", cause: "FRAME_NOT_MASK_VERIFIED" } });
    expect(arrivals).toHaveLength(0);
  });

  it("refuses a destination that is not this machine, before touching the bytes", async () => {
    for (const d of ["http://example.com/m10/frame", "http://10.0.0.1/x", "file:///tmp/x", "not a url"]) {
      expect(await send(await attested(), d)).toMatchObject({ sent: false, refusal: { stage: "DESTINATION", cause: "DESTINATION_NOT_LOOPBACK" } });
    }
    expect(arrivals).toHaveLength(0);
  });

  it("refuses an attested frame whose bytes changed after attestation (the hash pin)", async () => {
    const f = await attested();
    const b = f.bytes as Uint8Array;
    b[b.length - 1] = (b[b.length - 1] as number) ^ 0xff;
    expect(await send(f)).toMatchObject({ sent: false, refusal: { stage: "HASH", cause: "PAYLOAD_HASH_MISMATCH" } });
    expect(arrivals).toHaveLength(0);
  });

  it("refuses attested bytes that are not a still WebP of the attested size", async () => {
    const exif = await attested(riff([["VP8X", vp8x(0x08, W, H)], ["VP8L", vp8l(W, H)], ["EXIF", [1, 2, 3, 4]]]));
    expect(await send(exif)).toMatchObject({ sent: false, refusal: { stage: "CONTAINER", cause: "NOT_A_STILL_WEBP" } });
    const wrongSize = await attested(riff([["VP8L", vp8l(W + 1, H)]]));
    expect(await send(wrongSize)).toMatchObject({ sent: false, refusal: { stage: "CONTAINER" } });
    expect(arrivals).toHaveLength(0);
  });

  it("a transport failure is reported, not hidden", async () => {
    const out = await send(await attested(), "http://127.0.0.1:1/m10/frame");
    expect(out).toMatchObject({ sent: false, refusal: { stage: "TRANSPORT", cause: "TRANSPORT_FAILED" } });
  });
});

describe("inspectWebp admits a still frame and nothing else", () => {
  it("reads VP8, VP8L and VP8X+VP8 sizes", () => {
    expect(inspectWebp(riff([["VP8 ", vp8(1280, 720)]]))).toMatchObject({ ok: true, width: 1280, height: 720, codec: "VP8" });
    expect(inspectWebp(riff([["VP8L", vp8l(W, H)]]))).toMatchObject({ ok: true, width: W, height: H, codec: "VP8L" });
    expect(inspectWebp(riff([["VP8X", vp8x(0x10, 1280, 720)], ["ALPH", [0, 1]], ["VP8 ", vp8(1280, 720)]]))).toMatchObject({ ok: true, chunks: ["VP8X", "ALPH", "VP8 "] });
  });

  it.each([
    ["metadata chunk", riff([["VP8 ", vp8(8, 8)], ["XMP ", [1, 2]]])],
    ["ICC flag", riff([["VP8X", vp8x(0x20, 8, 8)], ["VP8 ", vp8(8, 8)]])],
    ["animation", riff([["VP8X", vp8x(0x02, 8, 8)], ["ANIM", [0, 0, 0, 0, 0, 0]]])],
    ["two images", riff([["VP8 ", vp8(8, 8)], ["VP8 ", vp8(8, 8)]])],
    ["canvas disagreeing with the bitstream", riff([["VP8X", vp8x(0, 9, 8)], ["VP8 ", vp8(8, 8)]])],
    ["no image", riff([["ALPH", [0, 1]]])],
    ["a PNG", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(20).fill(0)])],
    ["a wrong RIFF size", (() => { const b = riff([["VP8 ", vp8(8, 8)]]); b[4] = (b[4] as number) + 2; return b; })()],
    ["a truncated chunk", riff([["VP8 ", vp8(8, 8)]]).slice(0, 24)],
  ])("refuses %s", (_name, bytes) => {
    expect(inspectWebp(bytes).ok).toBe(false);
  });
});

describe("the choke point stays the only network caller", () => {
  it("frame.ts has exactly one fetch, inside the try, after the hash pin and the container check", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/frame.ts", import.meta.url)), "utf8");
    expect(source.match(/\bfetch\(/g)).toHaveLength(1);
    expect(source.indexOf("PAYLOAD_HASH_MISMATCH\", \"the bytes")).toBeLessThan(source.indexOf("await fetch("));
    expect(source.indexOf("inspectWebp(payload)")).toBeLessThan(source.indexOf("await fetch("));
    expect(source.indexOf("isMaskVerifiedFrame(request.frame)")).toBeLessThan(source.indexOf("isLoopback(request.destination)"));
    expect(source).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket/);
  });
});
