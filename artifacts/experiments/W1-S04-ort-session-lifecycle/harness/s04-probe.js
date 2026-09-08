/**
 * S-04 — can three ORT Web sessions coexist in one WebAssembly heap, and does teardown
 * reclaim?  This is the dossier's named landmine ("budget a day").
 *
 * MEASUREMENT NOTE, stated before any number is produced:
 *
 *   A WebAssembly.Memory CANNOT SHRINK. The specification provides grow() and no inverse.
 *   So the WASM heap returning to baseline after destroy is NOT the success criterion and
 *   its failure to do so is NOT a leak. The real question is whether REPEATED create/infer/
 *   destroy cycles keep growing the heap, or whether it plateaus because ORT reuses the
 *   arena. That distinction is what this probe is built to see.
 *
 * WASM heap is measured DIRECTLY by wrapping WebAssembly.Memory before ORT loads and
 * summing the byteLength of every instance it constructs. That is more trustworthy than
 * performance.memory, which is coarse, JS-only, and unavailable in workers.
 *
 * Throwaway spike code. No product code.
 */
const MODEL_B64 = "__MODEL_B64__";
const N = 262144;

// ---- WASM heap instrumentation. MUST be installed before ORT is loaded. --------------
(function installMemoryTracker() {
  if (globalThis.__s04_memories) return;
  const memories = [];
  globalThis.__s04_memories = memories;
  const Native = WebAssembly.Memory;
  function TrackedMemory(desc) {
    const m = new Native(desc);
    memories.push(m);
    return m;
  }
  TrackedMemory.prototype = Native.prototype;
  try {
    Object.defineProperty(WebAssembly, "Memory", {
      value: TrackedMemory, writable: true, configurable: true,
    });
  } catch (e) { globalThis.__s04_trackerError = String(e).slice(0, 200); }
})();

function wasmHeap() {
  const mems = globalThis.__s04_memories || [];
  let total = 0;
  for (const m of mems) { try { total += m.buffer.byteLength; } catch (e) {} }
  return { instances: mems.length, bytes: total, mb: Math.round(total / 1048576 * 10) / 10 };
}

function jsHeap() {
  try {
    if (globalThis.performance && performance.memory) {
      return { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10,
               totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576 * 10) / 10 };
    }
  } catch (e) {}
  return null;
}

function snap(label) {
  return { label, wasm: wasmHeap(), js: jsHeap(), at: Math.round(performance.now()) };
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

globalThis.runS04Probe = async function runS04Probe(contextName, opts) {
  opts = opts || {};
  const backend = opts.backend || "wasm";
  const cycles = opts.cycles === undefined ? 5 : opts.cycles;

  const out = {
    context: contextName, probe: "s04-lifecycle",
    backend, cycles,
    requestedNumThreads: opts.numThreads === undefined ? "default" : opts.numThreads,
    startedAt: new Date().toISOString(),
    trackerError: globalThis.__s04_trackerError || null,
    snapshots: [], cycleSnapshots: [],
    correctness: [], errors: [], error: null,
  };

  const input = new Float32Array(N);
  for (let i = 0; i < N; i++) input[i] = i % 1024;
  const modelBytes = b64ToBytes(MODEL_B64);

  async function makeSession() {
    return ort.InferenceSession.create(modelBytes, {
      executionProviders: [backend], graphOptimizationLevel: "all",
    });
  }
  async function inferAndVerify(session, tag) {
    const feeds = { x: new ort.Tensor("float32", input, [1, N]) };
    const r = await session.run(feeds);
    const y = r[session.outputNames[0]].data;
    let mismatches = 0;
    for (let i = 0; i < N; i++) if (y[i] !== input[i] * 2 + 1) mismatches++;
    out.correctness.push({ tag, mismatches, correct: mismatches === 0 });
    return mismatches === 0;
  }

  try {
    if (typeof ort === "undefined") { out.conclusion = "ORT global absent"; return out; }
    out.ortVersion = (ort.env && ort.env.versions && ort.env.versions.common) || "unknown";
    if (opts.wasmPaths) ort.env.wasm.wasmPaths = opts.wasmPaths;
    if (opts.numThreads !== undefined) ort.env.wasm.numThreads = opts.numThreads;
    ort.env.logLevel = "error";
    out.env = {
      sharedArrayBuffer: typeof SharedArrayBuffer === "function",
      crossOriginIsolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : null,
      configuredNumThreads: ort.env.wasm.numThreads,
    };

    out.snapshots.push(snap("baseline"));

    // ---- PHASE 1: create up to three concurrent sessions, measuring after each --------
    const sessions = [];
    for (let i = 1; i <= 3; i++) {
      const t0 = performance.now();
      sessions.push(await makeSession());
      out.snapshots.push(Object.assign(snap(`after-create-${i}`),
        { createMs: Math.round((performance.now() - t0) * 10) / 10 }));
    }
    out.concurrentSessions = sessions.length;

    // every session must still produce correct output while all three are resident
    for (let i = 0; i < sessions.length; i++) await inferAndVerify(sessions[i], `concurrent-session-${i + 1}`);
    out.snapshots.push(snap("after-infer-all-3"));

    // ---- PHASE 2: destroy them one at a time, measuring after each -------------------
    for (let i = 1; i <= sessions.length; i++) {
      const s = sessions[i - 1];
      const t0 = performance.now();
      if (typeof s.release === "function") await s.release();
      out.snapshots.push(Object.assign(snap(`after-destroy-${i}`),
        { releaseMs: Math.round((performance.now() - t0) * 10) / 10 }));
    }

    // ---- PHASE 3: repeated create/infer/destroy cycles -------------------------------
    // The leak question lives here, not in phase 2.
    for (let c = 1; c <= cycles; c++) {
      const batch = [];
      for (let i = 0; i < 3; i++) batch.push(await makeSession());
      for (let i = 0; i < batch.length; i++) await inferAndVerify(batch[i], `cycle-${c}-session-${i + 1}`);
      for (const s of batch) if (typeof s.release === "function") await s.release();
      out.cycleSnapshots.push(snap(`after-cycle-${c}`));
    }

    out.allCorrect = out.correctness.every((c) => c.correct);
    out.conclusion = out.allCorrect
      ? `3 concurrent sessions on ${backend}; ${cycles} create/infer/destroy cycles; all output correct`
      : `sessions ran on ${backend} but some output was INCORRECT`;
  } catch (e) {
    out.error = {
      name: e && e.name ? String(e.name) : null,
      message: e && e.message ? String(e.message).slice(0, 400) : String(e).slice(0, 400),
    };
    out.conclusion = "threw: " + ((e && e.message) ? String(e.message).slice(0, 180) : String(e).slice(0, 180));
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
