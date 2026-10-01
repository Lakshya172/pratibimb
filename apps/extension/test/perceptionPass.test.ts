/**
 * M10.6 — the PRODUCT perception pass (`createPerceptionRealm`), end to end in Node.
 *
 * Only the browser's primitives are faked — `getUserMedia`, `ImageCapture`, `OffscreenCanvas`, an
 * `ImageBitmap`, the UI head's ORT session and the TR-01 host — and each fake records what was done to
 * it. The pass itself is the shipped code: capture on the gesture route → UI head → TR-01 on the full
 * frame → reportFromFullFrame → sanitizeFrame, in place → the realm keeps the sanitized frame only.
 *
 * The frame is the frozen M10.5 fixture (`support/maskFixture*`), so the expected masked areas are the
 * hand-computed ones: 9,276 pixels with the detector working, 35,700 on any detector failure.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildElementGraph, frameId, type ViewportMeasurement } from "@pratibimb/perception";
import { MASK_FILL, isMaskVerifiedFrame, type VisualRegion } from "@pratibimb/privacy";

import { inspectWebp } from "@pratibimb/egress";

import { createPerceptionRealm, stripWebpColourProfile, type PerceptionRealm, type PerceptionRealmDeps, type WebpCodec } from "../host-lib/perception-realm";
import type { Tr01Frame, Tr01Outcome } from "../host-lib/tr01-host";
import { createTr01WorkerCore } from "../host-lib/tr01-worker-core";
import { generateFrame, HEIGHT, WIDTH } from "./support/maskFixture";

const EXPECTED = JSON.parse(readFileSync(new URL("./support/maskFixture.expected.json", import.meta.url), "utf8"));
const REGIONS: VisualRegion[] = EXPECTED.regions.map((r: VisualRegion) => ({ id: r.id, rect: r.rect }));
const DETECTIONS = EXPECTED.detections.map(({ x, y, w, h, score }: { x: number; y: number; w: number; h: number; score: number }) => ({ x, y, w, h, score }));

const measurement = (dpr = 1, w = WIDTH, h = HEIGHT): ViewportMeasurement => ({
  dpr,
  zoom: 1,
  viewportCssWidth: w,
  viewportCssHeight: h,
  scrollX: 0,
  scrollY: 0,
  origin: "http://127.0.0.1:8975",
});
const graphFor = (m: ViewportMeasurement) =>
  buildElementGraph(
    [],
    { dpr: m.dpr, zoom: 1, viewportCss: { w: m.viewportCssWidth, h: m.viewportCssHeight }, captureSize: { w: m.viewportCssWidth, h: m.viewportCssHeight }, scroll: { x: 0, y: 0 }, origin: m.origin },
    frameId("pass-test")
  );

const isFill = (rgba: Uint8ClampedArray, i: number) =>
  rgba[i * 4] === MASK_FILL.r && rgba[i * 4 + 1] === MASK_FILL.g && rgba[i * 4 + 2] === MASK_FILL.b && rgba[i * 4 + 3] === MASK_FILL.a;
const changed = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++;
  return n;
};
const sha = (b: Uint8ClampedArray) => createHash("sha256").update(b).digest("hex");

// ───────────────────────────── the faked browser ─────────────────────────────

let log: string[];
let streamFrame: { width: number; height: number; rgba: Uint8ClampedArray };
let lastBitmap: { width: number; height: number; closed: boolean } | null;
let trackStopped: boolean;
/** What TR-01 was handed on each call: dimensions and a digest of the pixels AT CALL TIME. */
let tr01Inputs: { width: number; height: number; sha: string; sameBufferAsRealm: boolean }[];

beforeEach(() => {
  log = [];
  lastBitmap = null;
  trackStopped = false;
  tr01Inputs = [];
  streamFrame = generateFrame(EXPECTED);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => {
        log.push("getUserMedia");
        return { getVideoTracks: () => [{ stop: () => void (trackStopped = true) }] };
      },
    },
  });
  vi.stubGlobal(
    "ImageCapture",
    class {
      async grabFrame() {
        log.push("grabFrame");
        const bitmap = {
          width: streamFrame.width,
          height: streamFrame.height,
          closed: false,
          close() {
            log.push("bitmap.close");
            bitmap.closed = true;
            bitmap.width = 0;
            bitmap.height = 0;
          },
        };
        lastBitmap = bitmap;
        return bitmap;
      }
    }
  );
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return { drawImage: () => undefined, getImageData: () => ({ data: streamFrame.rgba }) };
      }
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

/** A UI head session with no detections, which records when it runs. */
const uiHead = {
  inputNames: ["images"],
  outputNames: ["output0"],
  async run() {
    log.push("uihead:start");
    await new Promise((r) => setTimeout(r, 5));
    log.push("uihead:end");
    return { output0: { data: new Float32Array(12 * 10), dims: [1, 12, 10] } };
  },
};

function textRegions(outcome: (frame: Tr01Frame) => Tr01Outcome) {
  return {
    async detect(frame: Tr01Frame, options?: { deadlineMs?: number }) {
      log.push(`tr01${options?.deadlineMs ? `:deadline=${options.deadlineMs}` : ""}`);
      tr01Inputs.push({ width: frame.width, height: frame.height, sha: sha(frame.rgba), sameBufferAsRealm: frame.rgba === streamFrame.rgba });
      return outcome(frame);
    },
  };
}
const ok = (detections = DETECTIONS): Tr01Outcome => ({ ok: true, runId: 1, detections, ms: { preprocess: 1, infer: 1, postprocess: 1, total: 3 } });
const failed = (code: Extract<Tr01Outcome, { ok: false }>["code"]): Tr01Outcome => ({ ok: false, runId: 1, code, detail: "fake" });

function realm(over: Partial<PerceptionRealmDeps> = {}): PerceptionRealm {
  return createPerceptionRealm({
    requestCapture: async () => {
      log.push("requestCapture");
      return { ok: true, route: "GESTURE_STREAM", handle: "opaque-handle" };
    },
    session: uiHead as never,
    ort: { Tensor: class {} } as never,
    modelId: "pratibimb-t1-ui-head",
    revision: "ba6d9e93695b",
    acceptedBackends: ["wasm"],
    textRegions: textRegions(() => ok()),
    ...over,
  });
}
const perceive = (r: PerceptionRealm, regions: readonly VisualRegion[] = REGIONS, m = measurement(), options = {}) => r.perceive(graphFor(m), m, regions, options);

// ───────────────────────────── ordering and input ─────────────────────────────

describe("the pass runs in M9's order, sequentially", () => {
  it("capture → UI head (to completion) → TR-01 → mask", async () => {
    const r = realm();
    const summary = await perceive(r);
    expect(summary.ran).toBe(true);
    expect(log).toEqual(["requestCapture", "getUserMedia", "grabFrame", "bitmap.close", "uihead:start", "uihead:end", "tr01"]);
    expect(summary.redaction.outcome).toBe("SANITIZED");
  });

  it("the stage seam is told each stage in order, interleaved with the real work, and cannot break a pass", async () => {
    const r = realm({
      onStage: (s) => log.push(`stage:${s}`),
      onMaskPlanned: () => log.push("maskPlanned"),
    });
    const summary = await perceive(r);
    expect(log).toEqual([
      "requestCapture", "getUserMedia", "grabFrame", "bitmap.close",
      "stage:frame", "stage:uihead:start", "uihead:start", "uihead:end", "stage:uihead:end",
      "stage:tr01:start", "tr01", "stage:tr01:end", "stage:findings", "maskPlanned", "stage:mask:end",
    ]);
    const throwing = await perceive(realm({ onStage: () => { throw new Error("observer bug"); } }));
    expect(throwing.redaction).toEqual({ ...summary.redaction, ms: throwing.redaction.ms });
  });

  it("TR-01 receives the FULL captured frame, raw, at call time — no crop, no resize", async () => {
    const raw = sha(streamFrame.rgba);
    await perceive(realm());
    expect(tr01Inputs).toEqual([{ width: WIDTH, height: HEIGHT, sha: raw, sameBufferAsRealm: true }]);
  });

  it("a tightened detector deadline is passed through to the host", async () => {
    await perceive(realm(), REGIONS, measurement(), { detectorDeadlineMs: 50 });
    expect(log).toContain("tr01:deadline=50");
  });

  it("the visual regions are REQUIRED at compile time", async () => {
    const r = realm();
    const m = measurement();
    // @ts-expect-error — a pass without the observation's regions does not type-check
    await r.perceive(graphFor(m), m, { collect: true }).catch(() => undefined);
    expect(true).toBe(true);
  });
});

// ───────────────────────────── the masks ─────────────────────────────

describe("the sanitized frame", () => {
  it("detector success: exactly the hand-computed mask, applied IN PLACE, and only that frame is kept", async () => {
    const before = streamFrame.rgba.slice();
    const r = realm();
    const summary = await perceive(r, REGIONS, measurement(), { collect: true });
    const kept = r.sanitizedFrame()!;
    expect(kept.rgba).toBe(streamFrame.rgba); // the same buffer: no second, raw copy exists in the realm
    expect(changed(before, kept.rgba)).toBe(EXPECTED.expected.detectorOk.changedPixels);
    for (const s of EXPECTED.sensitiveInk as { rect: { x: number; y: number; w: number; h: number } }[])
      for (let y = s.rect.y; y < s.rect.y + s.rect.h; y++) for (let x = s.rect.x; x < s.rect.x + s.rect.w; x++) expect(isFill(kept.rgba, y * WIDTH + x)).toBe(true);
    expect(summary.redaction).toMatchObject({ outcome: "SANITIZED", failClosed: false, frameKept: true, rawBitmapClosed: true, regions: 3, maskRects: 4, pixelWrites: 9276 });
    expect(summary.redaction.detector).toEqual({ modelId: "PP-OCRv4_mobile_det", ran: true, code: null, detections: 6 });
    expect(summary.redaction.detail?.masks.map((m) => [m.regionId, m.cssMask])).toEqual(
      Object.entries(EXPECTED.expected.detectorOk.cssMask).map(([k, v]) => [k, v])
    );
  });

  it("an empty successful detection masks nothing, and the frame is kept", async () => {
    const before = streamFrame.rgba.slice();
    const r = realm({ textRegions: textRegions(() => ok([])) });
    const summary = await perceive(r);
    expect(summary.redaction).toMatchObject({ outcome: "SANITIZED", failClosed: false, maskRects: 0, pixelWrites: 0, frameKept: true });
    expect(changed(before, r.sanitizedFrame()!.rgba)).toBe(0);
  });

  it.each([
    ["detector error", () => realm({ textRegions: textRegions(() => failed("DETECTOR_ERROR")) }), "ERROR"],
    ["detector timeout", () => realm({ textRegions: textRegions(() => failed("DETECTOR_TIMEOUT")) }), "TIMEOUT"],
    ["malformed output", () => realm({ textRegions: textRegions(() => failed("MODEL_OUTPUT_MALFORMED")) }), "MALFORMED"],
    ["detector unavailable", () => realm({ textRegions: textRegions(() => failed("DETECTOR_UNAVAILABLE")) }), "UNAVAILABLE"],
    ["no detector at all", () => realm({ textRegions: null }), "UNAVAILABLE"],
  ])("%s → every visual region masked whole, and the sanitized frame continues", async (_n, make, reason) => {
    const before = streamFrame.rgba.slice();
    const r = make();
    const summary = await perceive(r);
    expect(summary.redaction).toMatchObject({ outcome: "SANITIZED", failClosed: true, reason, frameKept: true });
    expect(changed(before, r.sanitizedFrame()!.rgba)).toBe(EXPECTED.expected.failClosed.changedPixels);
  });

  it("the stream frame's own dimensions set the scale: a 2× stream is masked in capture pixels", async () => {
    // A stream twice the CSS size: the detector boxes arrive in capture pixels (×2).
    const big = { width: WIDTH * 2, height: HEIGHT * 2, rgba: new Uint8ClampedArray(WIDTH * HEIGHT * 16).fill(200) };
    streamFrame = big;
    const doubled = DETECTIONS.map((d: { x: number; y: number; w: number; h: number; score: number }) => ({ x: d.x * 2, y: d.y * 2, w: d.w * 2, h: d.h * 2, score: d.score }));
    const r = realm({ textRegions: textRegions(() => ok(doubled)) });
    const summary = await perceive(r, REGIONS, measurement(2), { collect: true });
    expect(summary.capture).toMatchObject({ w: WIDTH * 2, h: HEIGHT * 2, dpr: 2, scaleToCss: 0.5 });
    // The CSS masks are the hand-computed ones; the pixel rects are exactly twice them (integers ×2).
    const masks = summary.redaction.detail!.masks;
    for (const m of masks) {
      expect(m.cssMask).toEqual(EXPECTED.expected.detectorOk.cssMask[m.regionId]);
      expect(m.pixelRects).toEqual(
        EXPECTED.expected.detectorOk.pixelRects[m.regionId].map((p: { x: number; y: number; w: number; h: number }) => ({ x: p.x * 2, y: p.y * 2, w: p.w * 2, h: p.h * 2 }))
      );
    }
    expect(summary.redaction.pixelWrites).toBe(EXPECTED.expected.detectorOk.changedPixels * 4);
  });
});

// ───────────────────────────── REFUSED, and the frame's lifetime ─────────────────────────────

describe("REFUSED is terminal, and no raw frame outlives the pass", () => {
  it.each([
    ["a NaN region", [{ id: "canvas:0", rect: { x: NaN, y: 0, w: 10, h: 10 } }]],
    ["duplicate region ids", [...REGIONS, { id: "canvas:0", rect: { x: 1, y: 1, w: 1, h: 1 } }]],
  ])("%s → REFUSED: no sanitized frame, and the buffer overwritten", async (_n, regions) => {
    const r = realm();
    const summary = await perceive(r, regions as VisualRegion[]);
    expect(summary.redaction).toMatchObject({ outcome: "REFUSED", frameKept: false, failClosed: null });
    expect(summary.redaction.refusal?.code).toBe("REGION_INVALID");
    expect(r.sanitizedFrame()).toBeNull();
    for (let i = 0; i < WIDTH * HEIGHT; i++) if (!isFill(streamFrame.rgba, i)) throw new Error(`pixel ${i} survived REFUSED`);
  });

  it("the ImageBitmap is closed and the track stopped before the pass returns", async () => {
    const summary = await perceive(realm());
    expect(lastBitmap?.closed).toBe(true);
    expect(trackStopped).toBe(true);
    expect(summary.redaction.rawBitmapClosed).toBe(true);
  });

  it("a later pass that fails drops the earlier sanitized frame: an old frame never stands in", async () => {
    let refuseCapture = false;
    const r = realm({
      requestCapture: async () => (refuseCapture ? { ok: false, refused: "NO_ACTIVE_TAB_GRANT", detail: "gone" } : { ok: true, route: "GESTURE_STREAM", handle: "h" }),
    });
    await perceive(r);
    expect(r.sanitizedFrame()).not.toBeNull();
    refuseCapture = true;
    const summary = await perceive(r);
    expect(summary.ran).toBe(false);
    expect(summary.redaction.outcome).toBe("NOT_RUN");
    expect(r.sanitizedFrame()).toBeNull();
  });

  it("a frame whose geometry cannot be trusted is overwritten and not kept", async () => {
    // A stream frame with a different aspect ratio: the coordinate guard refuses it.
    streamFrame = { width: WIDTH, height: HEIGHT * 2, rgba: new Uint8ClampedArray(WIDTH * HEIGHT * 8).fill(200) };
    const r = realm();
    const summary = await perceive(r);
    expect(summary.refusal?.code).toBe("CAPTURE_DIMENSION_MISMATCH");
    expect(r.sanitizedFrame()).toBeNull();
    for (let i = 0; i < WIDTH * HEIGHT * 2; i++) if (!isFill(streamFrame.rgba, i)) throw new Error(`pixel ${i} survived`);
  });

  it("the summary carries no pixels, even with its geometry collected", async () => {
    const summary = await perceive(realm(), REGIONS, measurement(), { collect: true });
    const text = JSON.stringify(summary);
    expect(text).not.toMatch(/iVBORw0KGgo|data:image|[A-Za-z0-9+/]{200,}/);
    expect(JSON.stringify(summary.redaction)).not.toMatch(/rgba|pixels"|bitmap/);
  });
});

describe("the TR-01 worker scrubs the pixels it was lent (M10.6)", () => {
  it("after a DETECT, the buffer it received is zeroed — whatever the outcome", async () => {
    for (const infer of [
      async (_t: Float32Array, d: readonly [1, 3, number, number]) => ({ data: new Float32Array(d[2] * d[3]), dims: [1, 1, d[2], d[3]] }),
      async () => Promise.reject(new Error("wasm trap")),
    ]) {
      const posted: unknown[] = [];
      const core = createTr01WorkerCore({
        installRuntime: async () => {},
        loadModel: async () => ({ bytes: new Uint8Array(1), sha256: "a".repeat(64) }),
        createSession: async () => ({ infer }),
        post: (m) => posted.push(m),
        now: () => 0,
      });
      await core.handle({ type: "TR01_INIT", protocol: 1 });
      const rgba = new Uint8ClampedArray(64 * 32 * 4).fill(173);
      await core.handle({ type: "TR01_DETECT", protocol: 1, runId: 1, width: 64, height: 32, rgba });
      expect(rgba.every((v) => v === 0)).toBe(true);
      expect(posted).toHaveLength(2);
    }
  });
});

// ───────────────────────────── M10.7: the sanitized WebP artifact ─────────────────────────────

/** RIFF/WEBP with a VP8L header of the frame's size: the container a fake codec "encodes". */
function webpOf(w: number, h: number): Uint8Array {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  const chunk = [0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff, 0, 0, 0];
  const body = [...new TextEncoder().encode("WEBPVP8L"), chunk.length, 0, 0, 0, ...chunk];
  return Uint8Array.from([...new TextEncoder().encode("RIFF"), body.length & 0xff, (body.length >>> 8) & 0xff, 0, 0, ...body]);
}

/** A lossless fake codec: decode returns exactly what was encoded, unless told otherwise. */
function fakeCodec(over: { contentType?: string; bytes?: Uint8Array; decode?: (encoded: Uint8ClampedArray, w: number, h: number) => { width: number; height: number; rgba: Uint8ClampedArray }; failDecode?: boolean } = {}) {
  const calls: { sha: string; sameBufferAsKept: boolean; quality: number }[] = [];
  let encoded: { rgba: Uint8ClampedArray; w: number; h: number } | null = null;
  const codec: WebpCodec = {
    async encode(frame, quality) {
      calls.push({ sha: sha(frame.rgba as Uint8ClampedArray), sameBufferAsKept: frame.rgba === streamFrame.rgba, quality });
      encoded = { rgba: (frame.rgba as Uint8ClampedArray).slice(), w: frame.width, h: frame.height };
      return { bytes: over.bytes ?? webpOf(frame.width, frame.height), contentType: over.contentType ?? "image/webp" };
    },
    async decode() {
      if (over.failDecode) throw new Error("decoder trap");
      const e = encoded!;
      return over.decode ? over.decode(e.rgba, e.w, e.h) : { width: e.w, height: e.h, rgba: e.rgba.slice() };
    },
  };
  return { codec, calls };
}

describe("M10.7: only the kept SANITIZED frame can be encoded, and only a surviving mask is attested", () => {
  it("valid masked frame → WebP q62 of the sanitized buffer → MASK-VERIFIED artifact; never the raw pixels", async () => {
    const rawSha = sha(streamFrame.rgba);
    const { codec, calls } = fakeCodec();
    const r = realm({ codec });
    const summary = await perceive(r, REGIONS, measurement(), { collect: true });
    const out = await r.encodeSanitized();
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ sameBufferAsKept: true, quality: 0.62 });
    expect(calls[0]?.sha).not.toBe(rawSha);
    expect(calls[0]?.sha).toBe(sha(r.sanitizedFrame()!.rgba));
    expect(isMaskVerifiedFrame(out.frame)).toBe(true);
    expect(out.frame.manifest).toMatchObject({ status: "MASK_VERIFIED", failClosed: false, width: WIDTH, height: HEIGHT, counts: { regions: 3, maskRects: 4 } });
    expect(out.frame.manifest.regions.map((g) => [g.regionId, g.pixelRects])).toEqual(summary.redaction.detail!.masks.map((m) => [m.regionId, m.pixelRects]));
    expect(out.frame.manifest.sanitizedRgbaSha256).not.toBe(rawSha);
  });

  it.each([
    ["detector error", "DETECTOR_ERROR"],
    ["detector timeout", "DETECTOR_TIMEOUT"],
    ["malformed detector output", "MODEL_OUTPUT_MALFORMED"],
  ] as const)("%s → regions masked whole → a masked WebP may continue", async (_n, code) => {
    const { codec } = fakeCodec();
    const r = realm({ codec, textRegions: textRegions(() => failed(code)) });
    await perceive(r);
    const out = await r.encodeSanitized();
    expect(out).toMatchObject({ ok: true, frame: { manifest: { failClosed: true, counts: { regions: 3, maskRects: 3 } } } });
  });

  it("empty successful detection → nothing masked → the WebP is allowed (the empty mask was observed, not assumed)", async () => {
    const { codec } = fakeCodec();
    const r = realm({ codec, textRegions: textRegions(() => ok([])) });
    await perceive(r);
    expect(await r.encodeSanitized()).toMatchObject({ ok: true, frame: { manifest: { failClosed: false, counts: { maskRects: 0 } } } });
  });

  it("REFUSED → no frame → no WebP: the codec is never called", async () => {
    const { codec, calls } = fakeCodec();
    const r = realm({ codec });
    await perceive(r, [{ id: "canvas:0", rect: { x: NaN, y: 0, w: 10, h: 10 } }]);
    expect(await r.encodeSanitized()).toMatchObject({ ok: false, code: "NO_SANITIZED_FRAME" });
    expect(calls).toHaveLength(0);
  });

  it("no pass yet, or a later pass that failed → no WebP", async () => {
    const { codec, calls } = fakeCodec();
    let refuse = false;
    const r = realm({ codec, requestCapture: async () => (refuse ? { ok: false, refused: "NO_ACTIVE_TAB_GRANT", detail: "gone" } : { ok: true, route: "GESTURE_STREAM", handle: "h" }) });
    expect(await r.encodeSanitized()).toMatchObject({ ok: false, code: "NO_SANITIZED_FRAME" });
    await perceive(r);
    refuse = true;
    await perceive(r);
    expect(await r.encodeSanitized()).toMatchObject({ ok: false, code: "NO_SANITIZED_FRAME" });
    expect(calls).toHaveLength(0);
  });

  it("encodeSanitized takes no frame: the raw one cannot be handed to it", () => {
    // @ts-expect-error — there is no parameter to pass a frame through.
    void realm().encodeSanitized(streamFrame);
    expect(realm().encodeSanitized.length).toBe(0);
  });

  it.each([
    ["no codec", { codec: null }, "CODEC_UNAVAILABLE"],
    ["a browser that answered with PNG", { codec: fakeCodec({ contentType: "image/png" }).codec }, "ENCODED_AS_OTHER_TYPE"],
    ["an empty encode", { codec: fakeCodec({ bytes: new Uint8Array(0) }).codec }, "ENCODE_EMPTY"],
    ["bytes that are not WebP", { codec: fakeCodec({ bytes: new TextEncoder().encode("\x89PNG\r\n\x1a\n0000") }).codec }, "NOT_WEBP"],
    ["a decoder that fails", { codec: fakeCodec({ failDecode: true }).codec }, "DECODE_FAILED"],
    ["a decode of another size", { codec: fakeCodec({ decode: (e, w, h) => ({ width: w, height: h - 1, rgba: e.slice(0, w * (h - 1) * 4) }) }).codec }, "DIMENSION_MISMATCH"],
    ["a decode in which the mask did not survive", { codec: fakeCodec({ decode: (_e, w, h) => ({ width: w, height: h, rgba: new Uint8ClampedArray(w * h * 4).fill(255) }) }).codec }, "MASK_NOT_PRESERVED"],
  ] as const)("%s → refused, nothing attested", async (_n, deps, code) => {
    const r = realm(deps as Partial<PerceptionRealmDeps>);
    await perceive(r);
    const out = await r.encodeSanitized();
    expect(out).toMatchObject({ ok: false, code });
  });

  it("the artifact's manifest carries no text and no pixels", async () => {
    const r = realm({ codec: fakeCodec().codec });
    await perceive(r);
    const out = await r.encodeSanitized();
    if (!out.ok) throw new Error(out.code);
    const text = JSON.stringify(out.frame.manifest);
    expect(text).not.toMatch(/SYNTH|[A-Za-z0-9+/]{200,}|data:image/);
    expect(JSON.stringify({ ms: out.ms, memory: out.memory })).not.toMatch(/[A-Za-z0-9+/]{200,}/);
  });
});

describe("M10.7: the encoder's payload carries pixels only — Chrome's colour profile is removed", () => {
  const ascii = (s: string) => [...new TextEncoder().encode(s)];
  const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  const riff = (chunks: [string, number[]][]) => {
    const body = [...ascii("WEBP")];
    for (const [id, data] of chunks) body.push(...ascii(id), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : []));
    return Uint8Array.from([...ascii("RIFF"), ...le32(body.length), ...body]);
  };
  const vp8 = [0, 0, 0, 0x9d, 0x01, 0x2a, 64, 0, 48, 0];
  const vp8x = (flags: number) => [flags, 0, 0, 0, 63, 0, 0, 47, 0, 0];
  const icc = Array.from({ length: 456 }, (_, i) => i & 0xff);

  it("drops ICCP, clears the ICC flag and fixes the RIFF size; egress then admits it", () => {
    const chrome = riff([["VP8X", vp8x(0x20)], ["ICCP", icc], ["VP8 ", vp8]]);
    expect(inspectWebp(chrome)).toMatchObject({ ok: false });
    const out = stripWebpColourProfile(chrome);
    expect(out.length).toBe(chrome.length - (8 + 456));
    expect(inspectWebp(out)).toEqual({ ok: true, width: 64, height: 48, chunks: ["VP8X", "VP8 "], codec: "VP8" });
    expect(out[20]! & 0x20).toBe(0);
  });

  it("leaves bytes without a profile, and anything it does not recognise, unchanged for egress to judge", () => {
    const plain = riff([["VP8X", vp8x(0)], ["VP8 ", vp8]]);
    expect(stripWebpColourProfile(plain)).toBe(plain);
    const exif = riff([["VP8X", vp8x(0x28)], ["ICCP", icc], ["VP8 ", vp8], ["EXIF", [1, 2]]]);
    expect(inspectWebp(stripWebpColourProfile(exif)).ok).toBe(false);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...new Array(40).fill(0)]);
    expect(stripWebpColourProfile(png)).toBe(png);
  });
});
