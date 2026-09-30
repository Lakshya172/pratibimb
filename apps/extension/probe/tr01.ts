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
let instrumentWaiter: ((reply: unknown) => void) | null = null;

function instrumentedSpawn(): WorkerLike {
  const real = spawnTr01Worker() as unknown as Worker;
  current = real;
  const proxy: WorkerLike = {
    postMessage: (message, transfer) => real.postMessage(message, transfer),
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
export function serveTr01Probe(message: unknown, sender: { tab?: unknown }, sendResponse: (reply: unknown) => void): boolean {
  const msg = message as Record<string, unknown> | null;
  if (msg?.["kind"] !== "TR01_PROBE") return false;
  if (sender.tab) {
    sendResponse({ refused: "TR01_PROBE_ONLY_FROM_SERVICE_WORKER" });
    return true;
  }
  void step(msg).then(sendResponse, (e: unknown) => sendResponse({ error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }));
  return true;
}
