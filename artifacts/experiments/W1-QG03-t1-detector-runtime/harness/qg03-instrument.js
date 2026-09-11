/**
 * QG-03 instrumentation. MUST load before ONNX Runtime Web, in every context.
 *
 * Three independent observers, none of which asks the thing being measured to describe
 * itself. That distinction has already earned its keep twice in this project: ORT's own
 * report about which .wasm it loaded was not evidence (S-02a-2a-3 used an arrival log
 * instead), and a "no network" claim based on configuration was not evidence either
 * (S-02a-2a-4 used ground-truth arrivals).
 *
 *   1. WASM MEMORY   WebAssembly.Memory's constructor and grow() are wrapped, so heap size
 *                    is READ from the buffer rather than inferred from a total. Recorded
 *                    separately from the JS heap, always — S-04 measured the JS heap
 *                    falling 25.9 -> 10.8 MB in a single step purely from GC timing, so
 *                    conflating them would let GC noise masquerade as model footprint.
 *
 *   2. NETWORK       fetch, XHR, WebSocket, EventSource and importScripts are wrapped and
 *                    every URL is logged with its origin classified against the extension's
 *                    own. "No runtime model download" is a claim about arrivals, not about
 *                    intent, and this is the only way to state it as a measurement.
 *
 *   3. GPU           GPUQueue.submit and GPUDevice.createComputePipeline are counted. This
 *                    is how a WebGPU cell is distinguished from a WebGPU cell that quietly
 *                    fell back to WASM. ORT reporting "webgpu" is configuration, not
 *                    execution; a submit count of zero during inference means the GPU did
 *                    no work, whatever the configuration said.
 *
 * Throwaway spike code. Never shipped.
 */
(function install() {
  if (globalThis.__qg03) return;

  const state = {
    wasmMemories: [],
    wasmGrows: [],
    network: [],
    gpu: { submits: 0, computePipelines: 0, devices: 0, adapterInfo: null, requestedOptions: null, hookError: null },
    hookErrors: [],
  };
  globalThis.__qg03 = state;

  // ---- 1. WebAssembly memory ---------------------------------------------------------
  try {
    const NativeMemory = WebAssembly.Memory;
    const nativeGrow = NativeMemory.prototype.grow;
    NativeMemory.prototype.grow = function (delta) {
      const beforePages = this.buffer.byteLength / 65536;
      const r = nativeGrow.call(this, delta);
      state.wasmGrows.push({
        delta,
        beforePages,
        afterPages: this.buffer.byteLength / 65536,
        at: Math.round(performance.now()),
      });
      return r;
    };
    function Tracked(desc) {
      const m = new NativeMemory(desc);
      state.wasmMemories.push(m);
      return m;
    }
    Tracked.prototype = NativeMemory.prototype;
    Object.defineProperty(WebAssembly, "Memory", { value: Tracked, writable: true, configurable: true });
  } catch (e) {
    state.hookErrors.push("wasm-memory: " + String(e).slice(0, 200));
  }

  // ---- 2. network arrivals -----------------------------------------------------------
  // The extension's own origin is derived from location, not from a browser API, because
  // chrome.runtime.getURL is undefined inside a dedicated worker (measured, S-02a-2a-1).
  const selfOrigin = (function () {
    try {
      return new URL(globalThis.location.href).origin;
    } catch (e) {
      return "unknown";
    }
  })();
  state.selfOrigin = selfOrigin;

  function note(kind, url) {
    let origin = "unparseable";
    try {
      origin = new URL(String(url), globalThis.location ? globalThis.location.href : undefined).origin;
    } catch (e) {
      /* keep "unparseable" — an unparseable URL is itself worth reporting */
    }
    state.network.push({
      kind,
      url: String(url).slice(0, 220),
      origin,
      foreign: origin !== selfOrigin,
      at: Math.round(performance.now()),
    });
  }

  try {
    const nativeFetch = globalThis.fetch;
    if (typeof nativeFetch === "function") {
      globalThis.fetch = function (input, init) {
        note("fetch", typeof input === "string" ? input : (input && input.url) || String(input));
        return nativeFetch.call(this, input, init);
      };
    }
  } catch (e) {
    state.hookErrors.push("fetch: " + String(e).slice(0, 200));
  }

  try {
    if (typeof XMLHttpRequest === "function") {
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        note("xhr", url);
        return open.apply(this, arguments);
      };
    }
  } catch (e) {
    state.hookErrors.push("xhr: " + String(e).slice(0, 200));
  }

  try {
    if (typeof WebSocket === "function") {
      const NativeWS = WebSocket;
      const WrappedWS = function (url, protocols) {
        note("websocket", url);
        return new NativeWS(url, protocols);
      };
      WrappedWS.prototype = NativeWS.prototype;
      globalThis.WebSocket = WrappedWS;
    }
  } catch (e) {
    state.hookErrors.push("websocket: " + String(e).slice(0, 200));
  }

  try {
    if (typeof EventSource === "function") {
      const NativeES = EventSource;
      const WrappedES = function (url, cfg) {
        note("eventsource", url);
        return new NativeES(url, cfg);
      };
      WrappedES.prototype = NativeES.prototype;
      globalThis.EventSource = WrappedES;
    }
  } catch (e) {
    state.hookErrors.push("eventsource: " + String(e).slice(0, 200));
  }

  try {
    if (typeof importScripts === "function") {
      const nativeImport = importScripts;
      globalThis.importScripts = function () {
        for (const u of arguments) note("importScripts", u);
        return nativeImport.apply(this, arguments);
      };
    }
  } catch (e) {
    state.hookErrors.push("importScripts: " + String(e).slice(0, 200));
  }

  // ---- 3. GPU execution ---------------------------------------------------------------
  // Counting submits is the discriminator. A "webgpu" session that never submits is a
  // configuration, not an execution — and accepting it would put a false ACCEPT in a
  // matrix whose whole purpose is to say what was actually observed.
  try {
    if (typeof GPUQueue === "function") {
      const submit = GPUQueue.prototype.submit;
      GPUQueue.prototype.submit = function (buffers) {
        state.gpu.submits += 1;
        return submit.call(this, buffers);
      };
    } else {
      state.gpu.hookError = "GPUQueue is not a constructor in this context";
    }
    if (typeof GPUDevice === "function") {
      const ccp = GPUDevice.prototype.createComputePipeline;
      GPUDevice.prototype.createComputePipeline = function (desc) {
        state.gpu.computePipelines += 1;
        return ccp.call(this, desc);
      };
    }
    if (globalThis.navigator && navigator.gpu && typeof navigator.gpu.requestAdapter === "function") {
      const ra = navigator.gpu.requestAdapter.bind(navigator.gpu);
      navigator.gpu.requestAdapter = async function (o) {
        const a = await ra(o);
        if (a) {
          state.gpu.devices += 1;
          // WHICH adapter, where the browser will say. This machine has two GPUs, and a
          // latency figure that does not name the one that produced it is not attributable.
          // Firefox returns an EMPTY adapterInfo (S-02), so a Firefox figure can only ever
          // be labelled "adapter unidentified" — recorded as such rather than left blank.
          try {
            const info = a.info || a.adapterInfo || null;
            state.gpu.adapterInfo = info
              ? {
                  vendor: info.vendor ?? null,
                  architecture: info.architecture ?? null,
                  device: info.device ?? null,
                  description: info.description ?? null,
                  isFallbackAdapter: a.isFallbackAdapter ?? null,
                  identified: !!(info.vendor || info.description || info.architecture),
                }
              : { identified: false, note: "adapter exposes no info object" };
            state.gpu.requestedOptions = o || null;
          } catch (e) {
            state.gpu.adapterInfo = { identified: false, error: String(e).slice(0, 150) };
          }
        }
        return a;
      };
    }
  } catch (e) {
    state.gpu.hookError = String(e).slice(0, 200);
  }

  globalThis.__qg03_snapshot = function (label) {
    let bytes = 0;
    for (const m of state.wasmMemories) {
      try {
        bytes += m.buffer.byteLength;
      } catch (e) {
        /* a detached buffer is not a measurement failure; it is zero live bytes */
      }
    }
    let js = null;
    try {
      if (globalThis.performance && performance.memory) {
        js = {
          usedMB: Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10,
          totalMB: Math.round((performance.memory.totalJSHeapSize / 1048576) * 10) / 10,
        };
      }
    } catch (e) {
      /* performance.memory is Chromium-only; absence is recorded as null, never as zero */
    }
    return {
      label,
      wasm: {
        instances: state.wasmMemories.length,
        bytes,
        mb: Math.round((bytes / 1048576) * 10) / 10,
        pages: Math.round(bytes / 65536),
        growCount: state.wasmGrows.length,
      },
      js,
      gpu: { submits: state.gpu.submits, computePipelines: state.gpu.computePipelines },
      networkArrivals: state.network.length,
      at: Math.round(performance.now()),
    };
  };
})();
