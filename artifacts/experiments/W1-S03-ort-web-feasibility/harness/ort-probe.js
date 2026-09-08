/**
 * S-03 — does an ONNX Runtime Web session actually initialise and RUN in the extension
 * contexts PratiBimb intends to use?
 *
 * This is the question S-01, S-02, S-02a-2 and S-02a-2b all explicitly refused to answer.
 * navigator.gpu returning an adapter is not ORT Web's WebGPU backend working, and
 * WebAssembly.compile() succeeding is not ORT Web's WASM backend working. A real session is
 * created, run, verified and torn down here, or nothing is claimed.
 *
 * The model is 174 bytes: y = x*2 + 1 over float32[1, 262144]. DELIBERATELY the same
 * arithmetic as the S-02a WebGPU kernel and the S-02a-2 WASM kernel, so all three paths are
 * comparable and all three verify against one CPU reference. It is embedded as base64, so
 * the probe performs NO fetch for the model.
 *
 * Throwaway spike code. No product code.
 */
const MODEL_B64 = "__MODEL_B64__";
const N = 262144;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

globalThis.runOrtProbe = async function runOrtProbe(contextName, opts) {
  opts = opts || {};
  const wantBackend = opts.backend || "wasm";
  const numThreads = opts.numThreads;

  const out = {
    context: contextName,
    probe: "ort-web",
    requestedBackend: wantBackend,
    requestedNumThreads: numThreads === undefined ? "default" : numThreads,
    startedAt: new Date().toISOString(),
    globalKind: typeof window !== "undefined" ? "window"
              : typeof WorkerGlobalScope !== "undefined" ? "worker" : "unknown",
    ortVersion: null,
    env: {},
    sessionCreated: false,
    ran: false,
    outputCorrect: null,
    mismatches: null,
    timings: {},
    memory: {},
    error: null,
  };

  try {
    if (typeof ort === "undefined") {
      out.conclusion = "ORT Web global not present in this context";
      return out;
    }
    out.ortVersion = ort.env && ort.env.versions ? ort.env.versions.common : (ort.version || "unknown");

    // Point ORT at the extension-packaged wasm. Without this it would try a CDN, which the
    // extension CSP connect-src forbids -- that is itself a finding, recorded in the README.
    if (opts.wasmPaths) ort.env.wasm.wasmPaths = opts.wasmPaths;
    if (numThreads !== undefined) ort.env.wasm.numThreads = numThreads;
    ort.env.logLevel = "error";

    out.env = {
      sharedArrayBuffer: typeof SharedArrayBuffer === "function",
      crossOriginIsolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : null,
      configuredNumThreads: ort.env.wasm.numThreads,
      wasmPaths: String(ort.env.wasm.wasmPaths || ""),
      hardwareConcurrency: (globalThis.navigator && navigator.hardwareConcurrency) || null,
    };

    const mem = () => {
      try {
        if (globalThis.performance && performance.memory) {
          return { usedJSHeapMB: Math.round(performance.memory.usedJSHeapSize / 1048576) };
        }
      } catch (e) {}
      return null;
    };
    out.memory.beforeSession = mem();

    // ---- session creation ------------------------------------------------------------
    const t0 = performance.now();
    const session = await ort.InferenceSession.create(b64ToBytes(MODEL_B64), {
      executionProviders: [wantBackend],
      graphOptimizationLevel: "all",
    });
    out.timings.sessionCreateMs = Math.round((performance.now() - t0) * 10) / 10;
    out.sessionCreated = true;
    out.memory.afterSession = mem();
    out.inputNames = session.inputNames;
    out.outputNames = session.outputNames;

    // ---- inference -------------------------------------------------------------------
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = i % 1024;
    const feeds = { x: new ort.Tensor("float32", input, [1, N]) };

    const t1 = performance.now();
    const first = await session.run(feeds);
    out.timings.coldRunMs = Math.round((performance.now() - t1) * 10) / 10;
    out.ran = true;

    const y = first[session.outputNames[0]].data;
    let mismatches = 0, firstMismatch = null;
    for (let i = 0; i < N; i++) {
      const expected = input[i] * 2 + 1;
      if (y[i] !== expected) {
        mismatches++;
        if (firstMismatch === null) firstMismatch = { i, expected, got: y[i] };
      }
    }
    out.mismatches = mismatches;
    out.outputCorrect = mismatches === 0;
    out.firstMismatch = firstMismatch;

    const warm = [];
    for (let k = 0; k < 10; k++) {
      const t = performance.now();
      await session.run(feeds);
      warm.push(Math.round((performance.now() - t) * 10) / 10);
    }
    warm.sort((a, b) => a - b);
    out.timings.warmRunMs = { count: warm.length, p50: warm[Math.floor(warm.length / 2)], min: warm[0], max: warm[warm.length - 1] };
    out.memory.afterRuns = mem();

    // ---- teardown --------------------------------------------------------------------
    const t2 = performance.now();
    if (typeof session.release === "function") await session.release();
    out.timings.releaseMs = Math.round((performance.now() - t2) * 10) / 10;
    out.released = true;
    out.memory.afterRelease = mem();

    out.conclusion = out.outputCorrect
      ? `ORT session created and ran correctly on ${wantBackend}`
      : `ORT session ran on ${wantBackend} but output INCORRECT`;
  } catch (e) {
    out.error = {
      name: e && e.name ? String(e.name) : null,
      message: e && e.message ? String(e.message).slice(0, 400) : String(e).slice(0, 400),
      stack: e && e.stack ? String(e.stack).slice(0, 300) : null,
    };
    out.conclusion = "threw: " + (e && e.message ? String(e.message).slice(0, 180) : String(e).slice(0, 180));
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
