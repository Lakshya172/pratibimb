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
 */
import { createPinnedInferenceSession, bootstrapOrtRealm, resolvePackagedAsset } from "../entrypoints/ortRuntime";
import { createTr01Host, spawnTr01Worker, type Tr01Host, type WorkerLike } from "../host-lib/tr01-host";

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
