/**
 * M10.4 — TR-01 WORKER INSTRUMENT. TEST BUILDS ONLY (`TR01_PROBE=1`); never in a product bundle.
 *
 * The method is M8.2's (`m82-instrument.js`, from W1-QG03), so the numbers are comparable:
 *
 *   WASM MEMORY  `WebAssembly.Memory`'s constructor and `grow()` are wrapped, and the linear memory
 *                is READ from each tracked memory's `buffer.byteLength`. Linear memory never
 *                shrinks, so the current size is also the peak. It is NOT process RSS and NOT the JS
 *                heap, and it is never reported as either.
 *   NETWORK      `fetch` and `importScripts` arrivals are logged with their origin, classified
 *                against this worker's own origin. "No network" is then a count of foreign
 *                arrivals, not an intention.
 *
 * It answers one message, `{ type: "TR01_INSTRUMENT" }`, which the product worker never receives.
 */
const memories: WebAssembly.Memory[] = [];
const arrivals: { kind: string; origin: string; foreign: boolean }[] = [];
let installed = false;

export function installInstrument(): void {
  if (installed) return;
  installed = true;
  const scope = globalThis as unknown as {
    fetch: typeof fetch;
    importScripts?: (...urls: string[]) => void;
    location: { href: string };
  };
  const self = new URL(scope.location.href).origin;
  const note = (kind: string, url: string): void => {
    let origin = "unparseable";
    try {
      origin = new URL(url, scope.location.href).origin;
    } catch {
      /* an unparseable URL is itself worth reporting */
    }
    arrivals.push({ kind, origin, foreign: origin !== self });
  };

  const NativeMemory = WebAssembly.Memory;
  function Tracked(this: unknown, descriptor: WebAssembly.MemoryDescriptor): WebAssembly.Memory {
    const m = new NativeMemory(descriptor);
    memories.push(m);
    return m;
  }
  Tracked.prototype = NativeMemory.prototype;
  Object.defineProperty(WebAssembly, "Memory", { value: Tracked, writable: true, configurable: true });

  const nativeFetch = scope.fetch;
  scope.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    note("fetch", typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return nativeFetch.call(globalThis, input, init);
  }) as typeof fetch;
  const nativeImport = scope.importScripts;
  if (nativeImport) {
    scope.importScripts = (...urls: string[]) => {
      for (const u of urls) note("importScripts", u);
      nativeImport.apply(globalThis, urls);
    };
  }
}

/**
 * M10.6 — THE SHAPE of every message the worker received: its keys, and each value's TYPE (a string
 * is recorded as the word "string", never its content; a typed array as its constructor and length).
 * The boundary audit asks this rather than trusting the protocol's parser to have been the only way in.
 */
const received: { type: unknown; shape: Record<string, string> }[] = [];
const shapeOf = (v: unknown): string =>
  v === null ? "null" : ArrayBuffer.isView(v) ? `${v.constructor.name}(${(v as Uint8Array).length})` : Array.isArray(v) ? `array(${v.length})` : typeof v;

export function serveInstrument(message: unknown, post: (reply: unknown) => void): boolean {
  if (typeof message !== "object" || message === null || (message as { type?: unknown }).type !== "TR01_INSTRUMENT") {
    if (typeof message === "object" && message !== null && received.length < 500) {
      const m = message as Record<string, unknown>;
      received.push({ type: typeof m["type"] === "string" ? m["type"] : shapeOf(m["type"]), shape: Object.fromEntries(Object.keys(m).sort().map((k) => [k, shapeOf(m[k])])) });
    }
    return false;
  }
  post({
    type: "TR01_INSTRUMENT",
    wasmMemories: memories.length,
    wasmBytes: memories.length === 0 ? null : memories.reduce((sum, m) => sum + m.buffer.byteLength, 0),
    arrivals: arrivals.length,
    foreignArrivals: arrivals.filter((a) => a.foreign).length,
    arrivalOrigins: [...new Set(arrivals.map((a) => a.origin))],
    received,
  });
  return true;
}
