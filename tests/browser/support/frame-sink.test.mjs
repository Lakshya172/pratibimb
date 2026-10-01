import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SINK_PATH, judgeFrame, sha256, startFrameSink } from "./frame-sink.mjs";
import { readWebpRiff } from "./webp-riff.mjs";

const ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const ascii = (s) => [...Buffer.from(s, "latin1")];
const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const riff = (chunks) => {
  const body = [...ascii("WEBP")];
  for (const [id, data] of chunks) body.push(...ascii(id), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : []));
  return Buffer.from([...ascii("RIFF"), ...le32(body.length), ...body]);
};
const vp8 = (w, h) => [0, 0, 0, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, h & 0xff, (h >> 8) & 0x3f];
const vp8x = (flags, w, h) => [flags, 0, 0, 0, (w - 1) & 0xff, ((w - 1) >> 8) & 0xff, 0, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, 0];
const FRAME = riff([["VP8 ", vp8(64, 48)]]);

let sink;
beforeAll(async () => {
  sink = await startFrameSink({ port: 0 });
});
afterAll(() => sink.close());
beforeEach(() => sink.expect({ origin: ORIGIN, width: 64, height: 48 }));

const post = (body, headers = {}, path = SINK_PATH, method = "POST") =>
  fetch(sink.url.replace(SINK_PATH, path), { method, body: method === "GET" ? undefined : body, headers: { origin: ORIGIN, "content-type": "image/webp", "x-pratibimb-payload-sha256": sha256(body ?? Buffer.alloc(0)), ...headers } });

describe("the test-only sink", () => {
  it("binds loopback only", async () => {
    await expect(startFrameSink({ port: 0, host: "0.0.0.0" })).rejects.toThrow(/loopback only/);
    expect(new URL(sink.url).hostname).toBe("127.0.0.1");
  });

  it("accepts a still WebP of the expected size from the expected origin, unaltered, and says what it received", async () => {
    const r = await post(FRAME);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-pratibimb-received-sha256")).toBe(sha256(FRAME));
    const kept = sink.accepted().at(-1);
    expect(Buffer.compare(kept.bytes, FRAME)).toBe(0);
    expect(kept.sha256).toBe(sha256(FRAME));
    expect(sink.arrivals.at(-1)).toMatchObject({ accepted: true, reason: null, contentType: "image/webp", bytes: FRAME.length, origin: ORIGIN });
    expect(Object.keys(sink.arrivals.at(-1))).not.toContain("body");
  });

  it.each([
    ["raw RGBA", () => [Buffer.alloc(64 * 48 * 4, 7)], /not a WebP container/],
    ["a PNG", () => [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(24).fill(0)]), { "content-type": "image/webp" }], /not a WebP container/],
    ["a PNG labelled as such", () => [Buffer.from([0x89, 0x50, 0x4e, 0x47]), { "content-type": "image/png" }], /content-type/],
    ["plaintext", () => [Buffer.from("SYNTH-ID 0000 1111 2222"), { "content-type": "text/plain" }], /content-type/],
    ["an empty body", () => [Buffer.alloc(0)], /empty body/],
    ["another origin", () => [FRAME, { origin: "http://evil.example" }], /origin/],
    ["no origin", () => [FRAME, { origin: "" }], /origin/],
    ["the wrong path", () => [FRAME, {}, "/elsewhere"], /path/],
    ["a metadata chunk", () => [riff([["VP8X", vp8x(0x08, 64, 48)], ["VP8 ", vp8(64, 48)], ["EXIF", [1, 2]]])], /not admitted|metadata/],
    ["the wrong size", () => [riff([["VP8 ", vp8(65, 48)]])], /size/],
    ["a digest that does not match", () => [FRAME, { "x-pratibimb-payload-sha256": "0".repeat(64) }], /digest/],
  ])("rejects %s, records it, and keeps nothing", async (_name, make, why) => {
    const before = sink.accepted().length;
    const [body, headers, path] = make();
    const r = await post(body, headers, path);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(sink.arrivals.at(-1).accepted).toBe(false);
    expect(sink.arrivals.at(-1).reason).toMatch(why);
    expect(sink.accepted().length).toBe(before);
  });

  it("rejects a GET", async () => {
    const r = await post(undefined, {}, SINK_PATH, "GET");
    expect(r.status).toBe(405);
  });

  it("refuses everything until it is told which extension origin to expect", () => {
    expect(judgeFrame({ method: "POST", path: SINK_PATH, origin: ORIGIN, contentType: "image/webp", body: FRAME, declaredSha256: sha256(FRAME) }, { origin: null })).toMatch(/origin/);
  });

  it("reads the container with its own parser", () => {
    expect(readWebpRiff(FRAME)).toMatchObject({ ok: true, width: 64, height: 48, chunks: [{ id: "VP8 " }] });
    expect(readWebpRiff(Buffer.from("RIFF\x04\x00\x00\x00WAVE", "latin1"))).toMatchObject({ ok: false });
  });
});
