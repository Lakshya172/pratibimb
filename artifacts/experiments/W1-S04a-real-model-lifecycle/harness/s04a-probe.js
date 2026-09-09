/**
 * S-04a — the same lifecycle question as S-04, but with a REAL model large enough to
 * force WebAssembly.Memory.grow().
 *
 * S-04 found three sessions sharing one flat 16 MB arena and no leak. Its stated limit was
 * that a 174-byte two-op fixture never forced a grow(), so the memory-risk regime the
 * dossier actually worries about was untested. This probe exists to reach that regime.
 *
 * Model: YuNet face detector, 232,589 bytes, opset 11, 106 nodes, 53 Conv, input
 * [1,3,640,640] -- 4.7 MB per input tensor, twelve outputs, 134,400 output floats.
 *
 * INSTRUMENTATION: both the WebAssembly.Memory CONSTRUCTOR and Memory.prototype.grow are
 * wrapped, so growth events are recorded with pages before and after, not merely inferred
 * from a size difference.
 *
 * Correctness is checked against native ONNX Runtime on CPU (the canonical reference),
 * compared per-output on count/min/max/sum and four sampled indices, with a relative
 * tolerance -- float bit-equality across native ORT and ORT Web is not guaranteed.
 *
 * Throwaway spike code. No product code.
 */
const MODEL_B64 = "__MODEL_B64__";
const REFERENCE = __REFERENCE_JSON__;
const RTOL = 2e-3;

// ---- memory instrumentation, installed before ORT allocates anything ------------------
(function install() {
  if (globalThis.__s04a_mem) return;
  const state = { memories: [], grows: [] };
  globalThis.__s04a_mem = state;

  const NativeMemory = WebAssembly.Memory;
  const nativeGrow = NativeMemory.prototype.grow;

  // Record every grow(): which instance, pages requested, pages before and after.
  try {
    NativeMemory.prototype.grow = function (delta) {
      const beforePages = this.buffer.byteLength / 65536;
      const r = nativeGrow.call(this, delta);
      const afterPages = this.buffer.byteLength / 65536;
      state.grows.push({
        delta, beforePages, afterPages,
        beforeMB: Math.round(beforePages * 65536 / 1048576 * 10) / 10,
        afterMB: Math.round(afterPages * 65536 / 1048576 * 10) / 10,
        at: Math.round(performance.now()),
      });
      return r;
    };
  } catch (e) { state.growHookError = String(e).slice(0, 200); }

  function Tracked(desc) {
    const m = new NativeMemory(desc);
    state.memories.push(m);
    return m;
  }
  Tracked.prototype = NativeMemory.prototype;
  try {
    Object.defineProperty(WebAssembly, "Memory", { value: Tracked, writable: true, configurable: true });
  } catch (e) { state.ctorHookError = String(e).slice(0, 200); }
})();

function memState() {
  const s = globalThis.__s04a_mem;
  let bytes = 0;
  for (const m of s.memories) { try { bytes += m.buffer.byteLength; } catch (e) {} }
  return {
    instances: s.memories.length,
    bytes,
    mb: Math.round(bytes / 1048576 * 10) / 10,
    pages: Math.round(bytes / 65536),
    growCount: s.grows.length,
  };
}
function jsHeap() {
  try {
    if (globalThis.performance && performance.memory) {
      return { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 };
    }
  } catch (e) {}
  return null;
}
function snap(label) { return { label, wasm: memState(), js: jsHeap(), at: Math.round(performance.now()) }; }

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function makeInput() {
  const n = 1 * 3 * 640 * 640;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = ((i * 37) % 255) / 255;
  return a;
}

function close(a, b) {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / scale <= RTOL;
}

globalThis.runS04aProbe = async function runS04aProbe(contextName, opts) {
  opts = opts || {};
  const backend = opts.backend || "wasm";
  const cycles = opts.cycles === undefined ? 5 : opts.cycles;
  const mode = opts.mode || "full";           // "growth-only" for the section-2 pre-check

  const out = {
    context: contextName, probe: "s04a-real-model", backend, cycles, mode,
    model: "face_detection_yunet_2023mar.onnx",
    modelBytes: b64ToBytes(MODEL_B64).length,
    requestedNumThreads: opts.numThreads === undefined ? "default" : opts.numThreads,
    startedAt: new Date().toISOString(),
    hookErrors: {
      ctor: (globalThis.__s04a_mem || {}).ctorHookError || null,
      grow: (globalThis.__s04a_mem || {}).growHookError || null,
    },
    snapshots: [], cycleSnapshots: [], growthEvents: [],
    correctness: [], error: null,
  };

  const modelBytes = b64ToBytes(MODEL_B64);
  const input = makeInput();

  async function makeSession() {
    return ort.InferenceSession.create(modelBytes, {
      executionProviders: [backend], graphOptimizationLevel: "all",
    });
  }

  async function inferAndVerify(session, tag) {
    const feeds = {};
    feeds[session.inputNames[0]] = new ort.Tensor("float32", input, [1, 3, 640, 640]);
    const res = await session.run(feeds);
    const report = { tag, outputs: {}, correct: true, worstRelErr: 0 };
    for (const name of session.outputNames) {
      const d = res[name].data;
      const ref = REFERENCE.outputs[name];
      if (!ref) { report.correct = false; report.outputs[name] = { error: "no reference" }; continue; }
      let mn = Infinity, mx = -Infinity, sum = 0;
      for (let i = 0; i < d.length; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
      const samples = ref.sampleIdx.map((i) => d[i]);
      const checks = [
        d.length === ref.count,
        close(mn, ref.min), close(mx, ref.max), close(sum, ref.sum),
        ...samples.map((v, k) => close(v, ref.sampleVals[k])),
      ];
      const ok = checks.every(Boolean);
      if (!ok) report.correct = false;
      const relErr = Math.abs(sum - ref.sum) / Math.max(1, Math.abs(ref.sum));
      if (relErr > report.worstRelErr) report.worstRelErr = relErr;
      report.outputs[name] = { count: d.length, expectedCount: ref.count, ok,
        min: mn, max: mx, sum, refSum: ref.sum, relErrSum: relErr };
    }
    out.correctness.push(report);
    return report.correct;
  }

  try {
    if (typeof ort === "undefined") { out.conclusion = "ORT global absent"; return out; }
    out.ortVersion = (ort.env && ort.env.versions && ort.env.versions.common) || "unknown";
    if (opts.wasmPaths) ort.env.wasm.wasmPaths = opts.wasmPaths;
    if (opts.numThreads !== undefined) ort.env.wasm.numThreads = opts.numThreads;
    ort.env.logLevel = "error";
    out.env = {
      sharedArrayBuffer: typeof SharedArrayBuffer === "function",
      configuredNumThreads: ort.env.wasm.numThreads,
    };

    out.snapshots.push(snap("baseline"));

    // ---- SECTION 2 PRE-CHECK: does ONE session actually force a grow()? -------------
    const s1 = await makeSession();
    out.snapshots.push(snap("after-create-1"));
    await inferAndVerify(s1, "growth-check-session-1");
    out.snapshots.push(snap("after-infer-1"));

    out.growthEvents = (globalThis.__s04a_mem.grows || []).slice();
    out.growObserved = out.growthEvents.length > 0;

    if (mode === "growth-only") {
      if (typeof s1.release === "function") await s1.release();
      out.snapshots.push(snap("after-destroy-1"));
      out.conclusion = out.growObserved
        ? `GROWTH REGIME REACHED: ${out.growthEvents.length} grow() call(s)`
        : "no grow() observed with one session - growth regime NOT reached";
      out.allCorrect = out.correctness.every((c) => c.correct);
      out.finishedAt = new Date().toISOString();
      return out;
    }

    // ---- full lifecycle: 2nd and 3rd session, then destroy, then repeated cycles ----
    const sessions = [s1];
    for (let i = 2; i <= 3; i++) {
      sessions.push(await makeSession());
      out.snapshots.push(snap(`after-create-${i}`));
    }
    for (let i = 0; i < sessions.length; i++) await inferAndVerify(sessions[i], `concurrent-session-${i + 1}`);
    out.snapshots.push(snap("after-infer-all-3"));

    for (let i = 1; i <= sessions.length; i++) {
      const s = sessions[i - 1];
      if (typeof s.release === "function") await s.release();
      out.snapshots.push(snap(`after-destroy-${i}`));
    }

    for (let c = 1; c <= cycles; c++) {
      const batch = [];
      for (let i = 0; i < 3; i++) batch.push(await makeSession());
      for (let i = 0; i < batch.length; i++) await inferAndVerify(batch[i], `cycle-${c}-session-${i + 1}`);
      for (const s of batch) if (typeof s.release === "function") await s.release();
      out.cycleSnapshots.push(snap(`after-cycle-${c}`));
    }

    out.growthEvents = (globalThis.__s04a_mem.grows || []).slice();
    out.growObserved = out.growthEvents.length > 0;
    out.allCorrect = out.correctness.every((c) => c.correct);
    out.conclusion = `${out.allCorrect ? "all output correct" : "OUTPUT INCORRECT"}; ` +
      `${out.growthEvents.length} grow() call(s); final ${memState().mb} MB`;
  } catch (e) {
    out.growthEvents = ((globalThis.__s04a_mem || {}).grows || []).slice();
    out.error = { name: e && e.name ? String(e.name) : null,
                  message: e && e.message ? String(e.message).slice(0, 400) : String(e).slice(0, 400) };
    out.conclusion = "threw: " + ((e && e.message) ? String(e.message).slice(0, 200) : String(e).slice(0, 200));
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
