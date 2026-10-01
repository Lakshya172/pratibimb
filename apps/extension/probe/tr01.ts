/**
 * M10.4 — TR-01 PROBE. TEST BUILDS ONLY (`TR01_PROBE=1`); `probe/tr01-absent.ts` in a product build.
 *
 * Drives the REAL detector host and the REAL worker from the offscreen document, one step per
 * message, for `tests/browser/extension/run-tr01-worker.mjs`. It never captures a tab and never
 * sends anything anywhere: the frames it is handed come from the harness, as RGBA, and what it
 * returns is outcomes, timings and memory readings.
 *
 * MEMORY, by M8.2's method (see `probe/tr01-instrument.ts`): the worker's linear memory is read from
 * the worker's own instrument; the offscreen realm's is read from the same wrapper, installed here at
 * import time — before this realm creates any ORT session — so the UI head's memory is visible too.
 * The combined local perception workload is the sum of the two realms' linear memory.
 *
 * M10.5 adds `mask`. It:
 *   1. observes the tab (`visualRegions`);
 *   2. takes ONE real frame through the existing evidence capture route (`CAPTURE_FRAME` in an
 *      `M3_WORKER_FRAME=1` build — no gesture);
 *   3. runs TR-01 on the FULL frame;
 *   4. sanitizes the frame with the product's `reportFromFullFrame` + `sanitizeFrame`.
 *
 * The probe decodes the evidence frame itself; the product's single decoder stays
 * `perception-realm.ts`. It keeps a copy of the raw frame ONLY to verify the mask. The product path
 * keeps none.
 */
import { decodeDataUrl, geometryFrom, type CaptureGeometry } from "@pratibimb/perception";
import { observePage } from "@pratibimb/extension-transport";
import { MASK_FILL, redactionMask, type VisualRegion } from "@pratibimb/privacy";

import { createPinnedInferenceSession, bootstrapOrtRealm, resolvePackagedAsset } from "../entrypoints/ortRuntime";
import { createTr01Host, spawnTr01Worker, type Tr01Host, type Tr01Outcome, type WorkerLike } from "../host-lib/tr01-host";
import { chromeRelay } from "../host-lib/transport-chrome";
import { reportFromFullFrame, sanitizeFrame } from "../host-lib/visual-redaction";

// ── the offscreen realm's own WASM memory, tracked from here on ─────────────────────────────────
const offscreenMemories: WebAssembly.Memory[] = [];
{
  const NativeMemory = WebAssembly.Memory;
  function Tracked(this: unknown, descriptor: WebAssembly.MemoryDescriptor): WebAssembly.Memory {
    const m = new NativeMemory(descriptor);
    offscreenMemories.push(m);
    return m;
  }
  Tracked.prototype = NativeMemory.prototype;
  Object.defineProperty(WebAssembly, "Memory", { value: Tracked, writable: true, configurable: true });
}
const offscreenWasmBytes = (): number | null =>
  offscreenMemories.length === 0 ? null : offscreenMemories.reduce((s, m) => s + m.buffer.byteLength, 0);

// ── an instrumented spawn: the host sees an ordinary worker; the probe can also ask the instrument ──
let current: Worker | null = null;
/**
 * M10.6 — THE PASS TIMELINE: stage names from the realm's seam, and what crossed to and from the
 * worker, each with this realm's clock. Names, sizes and times only: never a pixel or a box.
 */
type Extra = { width?: number; height?: number; rgbaLength?: number; runId?: number };
let timeline: ({ at: number; event: string } & Extra)[] = [];
const mark = (event: string, extra: Extra = {}): void => {
  if (timeline.length < 200) timeline.push({ at: performance.now(), event, ...extra });
};
let instrumentWaiter: ((reply: unknown) => void) | null = null;

function instrumentedSpawn(): WorkerLike {
  const real = spawnTr01Worker() as unknown as Worker;
  current = real;
  const proxy: WorkerLike = {
    postMessage: (message, transfer) => {
      const m = message as { type?: unknown; width?: unknown; height?: unknown; runId?: unknown; rgba?: { length?: unknown } };
      if (m?.type === "TR01_DETECT") mark("worker:detect-posted", { width: Number(m.width), height: Number(m.height), rgbaLength: Number(m.rgba?.length), runId: Number(m.runId) });
      real.postMessage(message, transfer);
    },
    terminate: () => {
      real.terminate();
      if (current === real) current = null;
    },
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
  real.onmessage = (event: MessageEvent) => {
    if ((event.data as { type?: unknown })?.type === "TR01_INSTRUMENT") {
      instrumentWaiter?.(event.data);
      instrumentWaiter = null;
      return;
    }
    mark(`worker:reply:${String((event.data as { type?: unknown })?.type)}`);
    proxy.onmessage?.({ data: event.data });
  };
  real.onerror = (event) => proxy.onerror?.(event);
  real.onmessageerror = (event) => proxy.onmessageerror?.(event);
  return proxy;
}

function readWorkerInstrument(): Promise<unknown> {
  const w = current;
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    instrumentWaiter = resolve;
    w.postMessage({ type: "TR01_INSTRUMENT" });
    setTimeout(() => {
      if (instrumentWaiter === resolve) {
        instrumentWaiter = null;
        resolve(null);
      }
    }, 2_000);
  });
}

let host: Tr01Host | null = null;
/** The last real frame and detections, kept for the mask-only latency benchmark. Test build only. */
let lastMask: {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  geometry: CaptureGeometry;
  regions: VisualRegion[];
  outcome: Tr01Outcome;
} | null = null;

const b64 = (bytes: Uint8ClampedArray): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Pixel checks in the probe, for every cell (the harness re-checks DPR 1 from the raw buffers). */
function verifyMask(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number, rects: readonly { x: number; y: number; w: number; h: number }[]) {
  const masked = new Uint8Array(width * height);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) masked[y * width + x] = 1;
  let covered = 0;
  let notCovered = 0;
  let accidental = 0;
  let changed = 0;
  let maskedPixels = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const same = before[o] === after[o] && before[o + 1] === after[o + 1] && before[o + 2] === after[o + 2] && before[o + 3] === after[o + 3];
    if (!same) changed++;
    if (masked[i]) {
      maskedPixels++;
      const fill = after[o] === MASK_FILL.r && after[o + 1] === MASK_FILL.g && after[o + 2] === MASK_FILL.b && after[o + 3] === MASK_FILL.a;
      if (fill) covered++;
      else notCovered++;
    } else if (!same) accidental++;
  }
  return { maskedPixels, covered, notCovered, accidental, changed, unchanged: width * height - changed };
}

/** One frame through the existing evidence route. Refuses unless the build carries it. */
async function captureRgba(tabId: number) {
  const ticket = (await chrome.runtime.sendMessage({ kind: "CAPTURE_FRAME", tabId })) as { ok: boolean; route?: string; dataUrl?: string; refused?: string };
  if (!ticket?.ok || ticket.route !== "WORKER_FRAME" || typeof ticket.dataUrl !== "string") {
    throw new Error(`no evidence frame (${ticket?.refused ?? ticket?.route ?? "no ticket"}); build with M3_WORKER_FRAME=1`);
  }
  const decoded = decodeDataUrl(ticket.dataUrl);
  const bitmap = await createImageBitmap(new Blob([decoded.bytes as unknown as BlobPart], { type: "image/png" }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, rgba: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
  } finally {
    bitmap.close();
  }
}
/** Frames the harness handed over once, reused by name so a warm run does not re-send megabytes. */
const frames = new Map<string, { width: number; height: number; rgba: Uint8ClampedArray }>();
let uiHead: { run: () => Promise<number> } | null = null;

function decodeFrame(frame: { width: number; height: number; rgbaB64: string }) {
  const bin = atob(frame.rgbaB64);
  const rgba = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) rgba[i] = bin.charCodeAt(i);
  return { width: frame.width, height: frame.height, rgba };
}

async function step(msg: Record<string, unknown>): Promise<unknown> {
  switch (msg["op"]) {
    case "create": {
      host?.dispose();
      host = createTr01Host({ spawn: instrumentedSpawn });
      return { status: host.status() };
    }
    case "prepare": {
      if (!host) return { error: "no host" };
      const t0 = performance.now();
      const ready = await host.prepare();
      return { ready, ms: performance.now() - t0, status: host.status() };
    }
    case "frame": {
      frames.set(String(msg["name"]), decodeFrame(msg["frame"] as { width: number; height: number; rgbaB64: string }));
      return { frames: frames.size };
    }
    case "detect": {
      if (!host) return { error: "no host" };
      const frame = frames.get(String(msg["name"]));
      if (!frame) return { error: `no frame ${String(msg["name"])}` };
      const deadlineMs = typeof msg["deadlineMs"] === "number" ? msg["deadlineMs"] : undefined;
      const t0 = performance.now();
      const outcome = await host.detect(frame, deadlineMs === undefined ? {} : { deadlineMs });
      return { outcome, wallMs: performance.now() - t0, status: host.status() };
    }
    case "dispose": {
      host?.dispose();
      return { status: host?.status() ?? null };
    }
    case "mask": {
      const tabId = Number(msg["tabId"]);
      const frameId = Number(msg["frameId"] ?? 0);
      const observed = await observePage(chromeRelay, { tabId, frameId });
      const captured = await captureRgba(tabId);
      const geometry = geometryFrom(
        {
          dpr: observed.viewport.dpr,
          zoom: 1,
          viewportCssWidth: observed.viewport.w,
          viewportCssHeight: observed.viewport.h,
          scrollX: observed.viewport.scrollX,
          scrollY: observed.viewport.scrollY,
          origin: observed.binding.document.origin,
        },
        captured.width,
        captured.height
      );
      host ??= createTr01Host({ spawn: instrumentedSpawn });
      const deadlineMs = typeof msg["deadlineMs"] === "number" ? msg["deadlineMs"] : undefined;
      const outcome = await host.detect(captured, deadlineMs === undefined ? {} : { deadlineMs });
      let regions: VisualRegion[] = observed.visualRegions.map((r) => ({ id: r.id, rect: r.rect }));
      // A fault injected INSIDE the realm (the transport would already have refused it on the wire).
      const first = regions[0];
      if (msg["corrupt"] === "nan-rect" && first) regions = [{ id: first.id, rect: { ...first.rect, w: NaN } }, ...regions.slice(1)];
      if (msg["corrupt"] === "duplicate-id" && first) regions = [...regions, { id: first.id, rect: first.rect }];

      const before = captured.rgba.slice(); // TEST ONLY: the product keeps no raw copy
      const t0 = performance.now();
      const report = reportFromFullFrame(outcome, geometry, regions);
      const mappingMs = performance.now() - t0;
      const result = sanitizeFrame({ frame: captured, geometry, regions, report });
      if (!msg["corrupt"] && outcome.ok) lastMask = { rgba: before.slice(), width: captured.width, height: captured.height, geometry, regions, outcome };

      let allFill = true;
      for (let i = 0; i < captured.rgba.length; i += 4) {
        if (captured.rgba[i] !== 0 || captured.rgba[i + 1] !== 0 || captured.rgba[i + 2] !== 0 || captured.rgba[i + 3] !== 255) {
          allFill = false;
          break;
        }
      }
      const rects = result.outcome === "SANITIZED" ? result.regions.flatMap((r) => r.pixelRects) : [];
      return {
        regions: observed.visualRegions,
        viewport: observed.viewport,
        geometry,
        capture: { width: captured.width, height: captured.height, rgbaBytes: captured.rgba.byteLength },
        outcome: outcome.ok ? { ok: true, detections: outcome.detections, ms: outcome.ms } : outcome,
        report: { status: (report as { status: string }).status, findings: "findings" in report ? report.findings.length : null },
        result:
          result.outcome === "SANITIZED"
            ? { outcome: "SANITIZED", failClosed: result.failClosed, reason: result.reason, regions: result.regions, pixelWrites: result.pixelWrites, ms: { mapping: mappingMs, ...result.ms } }
            : { outcome: "REFUSED", code: result.code, detail: result.detail, frameWiped: result.frameWiped, bufferIsAllFill: allFill },
        verification: result.outcome === "SANITIZED" ? verifyMask(before, captured.rgba, captured.width, captured.height, rects) : null,
        // The fixture's own ink and control rectangles (CSS), checked in capture pixels: every pixel
        // wholly inside an ink rectangle must be the fill; every pixel of a control must be unchanged.
        truthCheck: (() => {
          const s = captured.width / observed.viewport.w;
          const inside = (r: { x: number; y: number; w: number; h: number }) => ({
            x0: Math.max(0, Math.ceil(r.x * s)),
            y0: Math.max(0, Math.ceil(r.y * s)),
            x1: Math.min(captured.width, Math.floor((r.x + r.w) * s)),
            y1: Math.min(captured.height, Math.floor((r.y + r.h) * s)),
          });
          const isFill = (i: number) => captured.rgba[i] === 0 && captured.rgba[i + 1] === 0 && captured.rgba[i + 2] === 0 && captured.rgba[i + 3] === 255;
          const ink = ((msg["inkRects"] as { x: number; y: number; w: number; h: number }[] | undefined) ?? []).map((r) => {
            const b = inside(r);
            let pixels = 0;
            let uncovered = 0;
            for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++, pixels++) if (!isFill((y * captured.width + x) * 4)) uncovered++;
            return { pixels, uncovered };
          });
          const control = ((msg["controlRects"] as { x: number; y: number; w: number; h: number }[] | undefined) ?? []).map((r) => {
            const b = inside(r);
            let pixels = 0;
            let changed = 0;
            for (let y = b.y0; y < b.y1; y++)
              for (let x = b.x0; x < b.x1; x++, pixels++) {
                const o = (y * captured.width + x) * 4;
                if (before[o] !== captured.rgba[o] || before[o + 1] !== captured.rgba[o + 1] || before[o + 2] !== captured.rgba[o + 2] || before[o + 3] !== captured.rgba[o + 3]) changed++;
              }
            return { pixels, changed };
          });
          return { ink, control };
        })(),
        pixels: msg["returnPixels"] === true ? { before: b64(before), after: result.outcome === "SANITIZED" ? b64(captured.rgba) : null } : null,
      };
    }
    case "re1-frame": {
      // M10.6 RE-1 product check: a stored held-out frame through the PRODUCT host and the PRODUCT
      // redaction path, at the held-out capture's own geometry (1280×720, DPR 1).
      const stored = frames.get(String(msg["name"]));
      if (!stored) return { error: `no frame ${String(msg["name"])}` };
      const region = msg["region"] as { x: number; y: number; w: number; h: number };
      host ??= createTr01Host({ spawn: instrumentedSpawn });
      const outcome = await host.detect(stored);
      const geometry: CaptureGeometry = {
        dpr: 1,
        zoom: 1,
        viewportCss: { w: stored.width, h: stored.height },
        captureSize: { w: stored.width, h: stored.height },
        scroll: { x: 0, y: 0 },
        origin: "http://127.0.0.1:8975",
      };
      const regions: VisualRegion[] = [{ id: "canvas:0", rect: region }];
      const frame = { width: stored.width, height: stored.height, rgba: stored.rgba.slice() };
      const result = sanitizeFrame({ frame, geometry, regions, report: reportFromFullFrame(outcome, geometry, regions) });
      return {
        outcome: outcome.ok ? { ok: true, detections: outcome.detections } : outcome,
        result: result.outcome === "SANITIZED" ? { outcome: "SANITIZED", failClosed: result.failClosed, cssMask: result.regions[0]?.cssMask ?? [], pixelRects: result.regions[0]?.pixelRects ?? [] } : result,
      };
    }
    case "mask-bench": {
      const last = lastMask;
      if (!last) return { error: "no frame: run mask first" };
      const n = Number(msg["n"] ?? 50);
      // "failClosed" replays the same frame as if the detector had timed out: every region filled
      // whole — the largest fill this frame can need.
      const outcome: Tr01Outcome = msg["mode"] === "failClosed" ? { ok: false, runId: 0, code: "DETECTOR_TIMEOUT", detail: "bench" } : last.outcome;
      const t = { mapping: [] as number[], plan: [] as number[], geometry: [] as number[], pixelMapping: [] as number[], fill: [] as number[], total: [] as number[], pixelWrites: [] as number[] };
      for (let i = 0; i < n; i++) {
        const frame = { width: last.width, height: last.height, rgba: last.rgba.slice() }; // untimed copy
        const t0 = performance.now();
        const report = reportFromFullFrame(outcome, last.geometry, last.regions);
        const t1 = performance.now();
        const result = sanitizeFrame({ frame, geometry: last.geometry, regions: last.regions, report });
        const t2 = performance.now();
        if (result.outcome !== "SANITIZED") return { error: "the bench frame was refused" };
        // The canonical geometry alone, over the same CSS boxes: a breakdown, not a product step.
        const boxes = "findings" in report ? report.findings.filter((f) => f.kind === "UNREAD_REGION" && f.regionId === last.regions[0]?.id).map((f) => f.box) : [];
        const g0 = performance.now();
        for (const r of last.regions) redactionMask(boxes, r.rect);
        const g1 = performance.now();
        t.mapping.push(t1 - t0);
        t.plan.push(result.ms.plan);
        t.geometry.push(g1 - g0);
        t.pixelMapping.push(result.ms.pixelMapping);
        t.fill.push(result.ms.fill);
        t.total.push(t2 - t0);
        t.pixelWrites.push(result.pixelWrites);
      }
      return { n, ms: t };
    }
    case "instrument":
      return { worker: await readWorkerInstrument(), offscreenWasmBytes: offscreenWasmBytes(), offscreenMemories: offscreenMemories.length };
    case "uihead": {
      // The existing UI head, in THIS realm, through the same pinned path `ensurePerception` uses.
      if (!uiHead) {
        const ort = (globalThis as unknown as { ort?: { Tensor: new (t: string, d: Float32Array, dims: number[]) => unknown } }).ort;
        if (!ort) return { error: "ort global missing" };
        await bootstrapOrtRealm("offscreen", ort as never);
        const bytes = new Uint8Array(await (await fetch(resolvePackagedAsset("t1-ui-head.onnx"))).arrayBuffer());
        const session = (await createPinnedInferenceSession(ort as never, bytes, { executionProviders: ["wasm"] })) as {
          inputNames: string[];
          run: (feeds: Record<string, unknown>) => Promise<unknown>;
        };
        uiHead = {
          run: async () => {
            const t0 = performance.now();
            await session.run({ [session.inputNames[0]!]: new ort.Tensor("float32", new Float32Array(3 * 640 * 640), [1, 3, 640, 640]) });
            return performance.now() - t0;
          },
        };
      }
      const ms = await uiHead.run();
      return { ms, offscreenWasmBytes: offscreenWasmBytes() };
    }
    default:
      return { error: `unknown op ${String(msg["op"])}` };
  }
}

/** Service worker only, like every other control-plane kind: a tab cannot drive the detector. */
// ── M10.6: the product pass, driven and verified without keeping a raw frame ────────────────────

type CssRect = { x: number; y: number; w: number; h: number };

/** What the offscreen document lends the probe: its own pass, its kept frame, its host's status. */
export interface Tr01ProbeContext {
  readonly perceiveTab: (
    tabId: number,
    frameId: number,
    extra?: { readonly adjustRegions?: (regions: readonly { id: string; rect: CssRect }[]) => readonly { id: string; rect: CssRect }[]; readonly detectorDeadlineMs?: number }
  ) => Promise<{ observed: { visualRegions: readonly unknown[]; viewport: unknown }; summary: { readonly redaction: unknown } }>;
  readonly sanitizedFrame: () => { width: number; height: number; rgba: Uint8ClampedArray } | null;
  readonly tr01Status: () => unknown;
}

/** Two independent 32-bit hashes and a count over a pixel selection. A digest, never the pixels. */
function digest(rgba: Uint8ClampedArray, width: number, height: number, include: (x: number, y: number) => boolean) {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  let n = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!include(x, y)) continue;
      n++;
      const o = (y * width + x) * 4;
      for (let k = 0; k < 4; k++) {
        const b = rgba[o + k] as number;
        fnv = Math.imul(fnv ^ b, 0x01000193) >>> 0;
        djb = (Math.imul(djb, 33) + b) >>> 0;
      }
    }
  return `${n}:${fnv.toString(16)}:${djb.toString(16)}`;
}

/** Set by a `pass` before it runs: the fixture's control rectangles and the page's CSS width. */
let passControls: { rects: CssRect[]; cssWidth: number } = { rects: [], cssWidth: 1 };
/** Written by the pre-fill hook: the mask about to be applied, and digests of what must not change. */
type Planned = { rects: { x: number; y: number; w: number; h: number }[]; outside: string; controls: string[]; controlsInMask: number };
let planned: Planned | null = null;
/** Read through a function: the hook assigns `planned` from inside the pass, which flow analysis cannot see. */
const plannedNow = (): Planned | null => planned;

const pixelRectOf = (r: CssRect, s: number, width: number, height: number) => ({
  x0: Math.max(0, Math.ceil(r.x * s)),
  y0: Math.max(0, Math.ceil(r.y * s)),
  x1: Math.min(width, Math.floor((r.x + r.w) * s)),
  y1: Math.min(height, Math.floor((r.y + r.h) * s)),
});

/**
 * THE SEAM an evidence build hands the offscreen document: an instrumented worker spawn, and a
 * pre-fill hook that records the mask and DIGESTS of everything that must stay unchanged — so the
 * sanitized frame can be verified afterwards with no raw copy kept anywhere.
 */
export const tr01Seam = {
  spawn: instrumentedSpawn,
  onStage(stage: string) {
    mark(`stage:${stage}`);
  },
  onMaskPlanned(frame: { width: number; height: number; rgba: Uint8ClampedArray | Uint8Array }, rects: readonly { x: number; y: number; w: number; h: number }[]) {
    const rgba = frame.rgba as Uint8ClampedArray;
    const masked = new Uint8Array(frame.width * frame.height);
    for (const r of rects)
      for (let y = Math.max(0, r.y); y < Math.min(frame.height, r.y + r.h); y++)
        for (let x = Math.max(0, r.x); x < Math.min(frame.width, r.x + r.w); x++) masked[y * frame.width + x] = 1;
    const s = frame.width / passControls.cssWidth;
    let controlsInMask = 0;
    const controls = passControls.rects.map((c) => {
      const b = pixelRectOf(c, s, frame.width, frame.height);
      for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (masked[y * frame.width + x]) controlsInMask++;
      return digest(rgba, frame.width, frame.height, (x, y) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
    });
    mark("maskPlanned");
    planned = {
      rects: rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
      outside: digest(rgba, frame.width, frame.height, (x, y) => masked[y * frame.width + x] === 0),
      controls,
      controlsInMask,
    };
  },
};

// The offscreen realm's network arrivals, from here on (test build only).
const offscreenArrivals: { origin: string; foreign: boolean }[] = [];
{
  const self = new URL(globalThis.location.href).origin;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let origin = "unparseable";
    try {
      origin = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, globalThis.location.href).origin;
    } catch {
      /* recorded as unparseable */
    }
    offscreenArrivals.push({ origin, foreign: origin !== self });
    return nativeFetch.call(globalThis, input, init);
  }) as typeof fetch;
}

async function pass(msg: Record<string, unknown>, ctx: Tr01ProbeContext): Promise<unknown> {
  const tabId = Number(msg["tabId"]);
  const frameId = Number(msg["frameId"] ?? 0);
  passControls = { rects: (msg["controlRects"] as CssRect[] | undefined) ?? [], cssWidth: Number(msg["cssWidth"] ?? 1) };
  planned = null;
  timeline = [];
  const corrupt = msg["corrupt"];
  const adjustRegions =
    corrupt === "nan-rect"
      ? (rs: readonly { id: string; rect: CssRect }[]) => rs.map((r, i) => ({ id: r.id, rect: i === 0 ? { ...r.rect, w: NaN } : r.rect }))
      : corrupt === "duplicate-id"
        ? (rs: readonly { id: string; rect: CssRect }[]) => [...rs.map((r) => ({ id: r.id, rect: r.rect })), ...(rs[0] ? [{ id: rs[0].id, rect: rs[0].rect }] : [])]
        : undefined;
  const deadlineMs = typeof msg["deadlineMs"] === "number" ? msg["deadlineMs"] : undefined;
  const t0 = performance.now();
  const { observed, summary } = await ctx.perceiveTab(tabId, frameId, {
    ...(adjustRegions ? { adjustRegions } : {}),
    ...(deadlineMs === undefined ? {} : { detectorDeadlineMs: deadlineMs }),
  });
  const wallMs = performance.now() - t0;
  const frame = ctx.sanitizedFrame();

  let verification: unknown = null;
  const p = plannedNow();
  if (frame && p) {
    const masked = new Uint8Array(frame.width * frame.height);
    for (const r of p.rects) for (let y = Math.max(0, r.y); y < Math.min(frame.height, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(frame.width, r.x + r.w); x++) masked[y * frame.width + x] = 1;
    let maskPixels = 0;
    let notFill = 0;
    for (let i = 0; i < masked.length; i++) {
      if (!masked[i]) continue;
      maskPixels++;
      const o = i * 4;
      if (!(frame.rgba[o] === MASK_FILL.r && frame.rgba[o + 1] === MASK_FILL.g && frame.rgba[o + 2] === MASK_FILL.b && frame.rgba[o + 3] === MASK_FILL.a)) notFill++;
    }
    const s = frame.width / passControls.cssWidth;
    const ink = ((msg["inkRects"] as CssRect[] | undefined) ?? []).map((r) => {
      const b = pixelRectOf(r, s, frame.width, frame.height);
      let pixels = 0;
      let uncovered = 0;
      for (let y = b.y0; y < b.y1; y++)
        for (let x = b.x0; x < b.x1; x++, pixels++) {
          const o = (y * frame.width + x) * 4;
          if (!(frame.rgba[o] === 0 && frame.rgba[o + 1] === 0 && frame.rgba[o + 2] === 0 && frame.rgba[o + 3] === 255)) uncovered++;
        }
      return { pixels, uncovered };
    });
    const controlsAfter = passControls.rects.map((c) => {
      const b = pixelRectOf(c, s, frame.width, frame.height);
      return digest(frame.rgba, frame.width, frame.height, (x, y) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
    });
    verification = {
      maskPixels,
      maskPixelsNotFill: notFill,
      outsideMaskUnchanged: digest(frame.rgba, frame.width, frame.height, (x, y) => masked[y * frame.width + x] === 0) === p.outside,
      ink,
      controlsUnchanged: controlsAfter.every((d, i) => d === p.controls[i]),
      controlPixelsInsideMask: p.controlsInMask,
      rawCopyKeptByProbe: false,
    };
  }
  const summaryOut: Record<string, unknown> = { ...(summary as object) };
  delete (summaryOut as Record<string, unknown>)["elements"];
  delete (summaryOut as Record<string, unknown>)["sourceBySelector"];
  return {
    viewport: observed.viewport,
    visualRegions: observed.visualRegions,
    summary: summaryOut,
    frameHeld: frame !== null,
    frame: frame ? { width: frame.width, height: frame.height, rgbaBytes: frame.rgba.byteLength } : null,
    verification,
    tr01: ctx.tr01Status(),
    // Relative to the pass's start, in this realm's clock.
    timeline: timeline.map((e) => ({ ...e, at: e.at - t0 })),
    wallMs,
  };
}

export function serveTr01Probe(message: unknown, sender: { tab?: unknown }, sendResponse: (reply: unknown) => void, context?: Tr01ProbeContext): boolean {
  const msg = message as Record<string, unknown> | null;
  if (msg?.["kind"] !== "TR01_PROBE") return false;
  if (sender.tab) {
    sendResponse({ refused: "TR01_PROBE_ONLY_FROM_SERVICE_WORKER" });
    return true;
  }
  const run =
    msg["op"] === "pass"
      ? context
        ? pass(msg, context)
        : Promise.resolve({ error: "no offscreen context" })
      : msg["op"] === "product-state"
        ? // Preflight: the product host's state and whether a sanitized frame is held — no stale pass.
          Promise.resolve(context ? { tr01: context.tr01Status(), sanitizedFrameHeld: context.sanitizedFrame() !== null } : { error: "no offscreen context" })
      : msg["op"] === "offscreen-arrivals"
        ? Promise.resolve({ arrivals: offscreenArrivals.length, foreign: offscreenArrivals.filter((a) => a.foreign).length, origins: [...new Set(offscreenArrivals.map((a) => a.origin))] })
        : step(msg);
  void run.then(sendResponse, (e: unknown) => sendResponse({ error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }));
  return true;
}
