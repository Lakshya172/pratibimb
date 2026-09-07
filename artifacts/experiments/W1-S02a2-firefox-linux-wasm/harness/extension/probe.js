/**
 * S-02a-2 — the WASM path in a Firefox MV3 event page on Linux.
 *
 * SCOPE, stated up front so it is not mistaken for something else:
 *
 *   This measures the WASM SUBSTRATE -- is WebAssembly present, is SIMD available, are
 *   threads (SharedArrayBuffer) available, and what does a fixed integer kernel cost --
 *   in the exact execution context PratiBimb would use.
 *
 *   It is NOT S-03. No ONNX Runtime Web, no Transformers.js, no model. A working WASM
 *   substrate does not imply ORT Web initialises, and nothing here may be read that way.
 *
 * The kernel is DELIBERATELY the same workload as the WebGPU probe -- out[i] = in[i]*2+1
 * over 262,144 i32 -- so the two are directly comparable on one machine, one browser, one
 * session. That comparison is the point: the dossier publishes two latency budgets, and
 * the Firefox-on-Linux WebGPU path is off by default.
 *
 * Kernels are compiled from kernel.wat / kernel-simd.wat with wabt and embedded as base64
 * so the probe runs in any context without a fetch. The WAT source is committed alongside.
 *
 * Throwaway spike code. No product code.
 */
const B64_SCALAR = "AGFzbQEAAAABBQFgAX8AAwIBAAUDAQBABw0CA21lbQIAA3J1bgAACj0BOwEDfyAAQQRsIQMCQANAIAEgAE8NASABQQRsIQIgAyACaiACKAIAQQJsQQFqNgIAIAFBAWohAQwACwsL";
const B64_SIMD   = "AGFzbQEAAAABBQFgAX8AAwIBAAUDAQBABw0CA21lbQIAA3J1bgAACkcBRQEDfyAAQQRsIQMCQANAIAEgAE8NASABQQRsIQIgAyACaiAC/QAEAEEC/RH9tQFBAf0R/a4B/QsEACABQQRqIQEMAAsLCw==";

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

globalThis.runWasmProbe = async function runWasmProbe(contextName) {
  const N = 262144;
  const out = {
    context: contextName,
    probe: "wasm",
    startedAt: new Date().toISOString(),
    userAgent: (globalThis.navigator && navigator.userAgent) || null,
    globalKind: typeof window !== "undefined" ? "window"
              : typeof WorkerGlobalScope !== "undefined" ? "worker" : "unknown",
    features: {},
    scalar: null,
    simd: null,
    error: null,
  };

  try {
    // ---- substrate feature detection ------------------------------------------------
    out.features.webAssembly = typeof WebAssembly === "object";
    if (!out.features.webAssembly) {
      out.conclusion = "WebAssembly ABSENT in this context";
      return out;
    }
    out.features.sharedArrayBuffer = typeof SharedArrayBuffer === "function";
    out.features.crossOriginIsolated = typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : null;
    out.features.atomics = typeof Atomics === "object";
    out.features.hardwareConcurrency = (globalThis.navigator && navigator.hardwareConcurrency) || null;
    out.features.bigInt64Array = typeof BigInt64Array === "function";

    // SIMD is detected by whether the v128 module VALIDATES, not by a version string.
    try {
      out.features.simd = WebAssembly.validate(b64ToBytes(B64_SIMD));
    } catch (e) {
      out.features.simd = false;
    }

    // Threads in practice need SharedArrayBuffer, which needs cross-origin isolation.
    out.features.threadsUsable = Boolean(out.features.sharedArrayBuffer && out.features.atomics);

    // ---- the benchmark ---------------------------------------------------------------
    const input = new Int32Array(N);
    for (let i = 0; i < N; i++) input[i] = i % 1024;

    async function benchmark(b64, label) {
      const bytes = b64ToBytes(b64);
      const t0 = performance.now();
      const module = await WebAssembly.compile(bytes);
      const compileMs = Math.round((performance.now() - t0) * 10) / 10;

      const t1 = performance.now();
      const instance = await WebAssembly.instantiate(module, {});
      const instantiateMs = Math.round((performance.now() - t1) * 10) / 10;

      const mem = instance.exports.mem;
      const run = instance.exports.run;
      const heap = new Int32Array(mem.buffer);
      heap.set(input, 0);

      const dispatch = () => {
        const t = performance.now();
        run(N);
        return Math.round((performance.now() - t) * 10) / 10;
      };

      const coldMs = dispatch();
      const result = heap.subarray(N, N * 2);

      let mismatches = 0, firstMismatch = null;
      for (let i = 0; i < N; i++) {
        const expected = input[i] * 2 + 1;
        if (result[i] !== expected) {
          mismatches++;
          if (firstMismatch === null) firstMismatch = { i, expected, got: result[i] };
        }
      }

      const warm = [];
      for (let k = 0; k < 10; k++) warm.push(dispatch());
      warm.sort((a, b) => a - b);

      return {
        label, elements: N,
        outputCorrect: mismatches === 0, mismatches, firstMismatch,
        compileMs, instantiateMs, coldDispatchMs: coldMs,
        warmDispatchMs: { count: warm.length, p50: warm[Math.floor(warm.length / 2)], min: warm[0], max: warm[warm.length - 1] },
      };
    }

    out.scalar = await benchmark(B64_SCALAR, "scalar");

    if (out.features.simd) {
      try { out.simd = await benchmark(B64_SIMD, "simd-i32x4"); }
      catch (e) { out.simd = { label: "simd-i32x4", error: String(e).slice(0, 200) }; }
    }

    out.conclusion = out.scalar.outputCorrect
      ? "WASM available and correct in this context"
      : "WASM ran but output INCORRECT";
  } catch (e) {
    // Firefox's e.stack omits the message, and the message is the whole point here.
    out.error = {
      name: e && e.name ? String(e.name) : null,
      message: e && e.message ? String(e.message).slice(0, 400) : String(e).slice(0, 400),
      stack: e && e.stack ? String(e.stack).slice(0, 300) : null,
    };
    out.conclusion = "threw: " + (e && e.message ? String(e.message).slice(0, 200) : String(e).slice(0, 200));
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
