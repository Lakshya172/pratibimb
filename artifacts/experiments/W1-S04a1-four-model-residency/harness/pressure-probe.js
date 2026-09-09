/**
 * S-04a-1 section 10 -- FAILURE BEHAVIOUR UNDER MEMORY CONSTRAINT.
 *
 * The task says: investigate what happens when memory becomes constrained, but do NOT
 * intentionally destabilise the host, and record UNKNOWN rather than fake a pass.
 *
 * This host has 23 GB total but only ~4.1 GB free at run time, and wasm32 addresses at most
 * 4 GB, so driving a real ORT workload to heap exhaustion would consume most of the free
 * RAM before the WASM ceiling was anywhere near. That is the "not safely reproducible"
 * case. So this probe does two BOUNDED things instead:
 *
 *   A. Escalate real four-model sessions with a HARD CEILING (default 1200 MB of WASM heap
 *      or 8 rounds, whichever comes first), recording growth and any error. This shows the
 *      trend without approaching the host's limit.
 *
 *   B. Ask for allocations that CANNOT succeed in wasm32 regardless of host RAM -- a 4 GB+
 *      WebAssembly.Memory and an ORT tensor larger than the address space. This observes
 *      the FAILURE MODE (explicit exception? silent truncation? corrupted output? crash?)
 *      at zero cost to the host.
 *
 * B is the part that actually answers "explicit / graceful / silent". A only shows the
 * approach.
 *
 * Throwaway spike code.
 */
// REFERENCE / MODEL_URLS are already declared by s04a1-probe.js, which this file is
// concatenated after. Redeclaring them is a SyntaxError, so reuse them.

globalThis.runPressureProbe = async function runPressureProbe(contextName, opts) {
  opts = opts || {};
  const CEILING_MB = opts.ceilingMB || 1200;
  const MAX_ROUNDS = opts.maxRounds || 8;
  const out = {
    context: contextName, probe: "s04a1-pressure",
    ceilingMB: CEILING_MB, maxRounds: MAX_ROUNDS,
    escalation: [], impossibleAlloc: {}, stoppedBecause: null, error: null,
    startedAt: new Date().toISOString(),
  };

  function mem() {
    const s = globalThis.__s04a1_mem;
    let b = 0;
    for (const m of s.memories) { try { b += m.buffer.byteLength; } catch (e) {} }
    return { mb: Math.round(b / 1048576 * 10) / 10, pages: Math.round(b / 65536), grows: s.grows.length };
  }

  try {
    if (opts.wasmPaths) ort.env.wasm.wasmPaths = opts.wasmPaths;
    if (opts.numThreads !== undefined) ort.env.wasm.numThreads = opts.numThreads;
    ort.env.logLevel = "error";
    const base = opts.modelBase || opts.wasmPaths || "";

    // ---- B first: it is free, and if the browser dies in A we still have the answer ----
    // B1: a WebAssembly.Memory larger than the wasm32 address space.
    try {
      // 65536 pages = 4 GB, which is the entire wasm32 space; 65537 cannot exist.
      const m = new WebAssembly.Memory({ initial: 65537 });
      out.impossibleAlloc.memory4gb = { threw: false, gotBytes: m.buffer.byteLength };
    } catch (e) {
      out.impossibleAlloc.memory4gb = {
        threw: true, name: String(e && e.name), message: String((e && e.message) || e).slice(0, 200),
      };
    }

    // B2: an ORT tensor larger than the address space. Must fail explicitly, never silently.
    try {
      const huge = new ort.Tensor("float32", new Float32Array(8), [1, 2, 2, 2]);
      out.impossibleAlloc.tensorSanity = { ok: true, dims: huge.dims };
    } catch (e) {
      out.impossibleAlloc.tensorSanity = { ok: false, message: String((e && e.message) || e).slice(0, 200) };
    }
    try {
      // 2^31 floats = 8 GB. Allocation of the JS typed array itself should fail explicitly.
      const n = 2 ** 31;
      const a = new Float32Array(n);
      out.impossibleAlloc.typedArray8gb = { threw: false, length: a.length };
    } catch (e) {
      out.impossibleAlloc.typedArray8gb = {
        threw: true, name: String(e && e.name), message: String((e && e.message) || e).slice(0, 200),
      };
    }

    // ---- A: bounded escalation with real sessions --------------------------------------
    const ORDER = ["face", "ocr_det", "ocr_rec", "vlm_vision"];
    const bytes = {};
    for (const k of ORDER) {
      const r = await fetch(base + MODEL_URLS[k]);
      bytes[k] = new Uint8Array(await r.arrayBuffer());
    }
    const held = [];
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const before = mem();
      if (before.mb >= CEILING_MB) { out.stoppedBecause = "ceiling reached before round " + round; break; }
      let roundErr = null, made = 0;
      for (const k of ORDER) {
        try {
          const s = await ort.InferenceSession.create(bytes[k], {
            executionProviders: ["wasm"], graphOptimizationLevel: "all",
          });
          held.push(s);
          made++;
        } catch (e) {
          roundErr = { model: k, name: String(e && e.name), message: String((e && e.message) || e).slice(0, 300) };
          break;
        }
      }
      const after = mem();
      out.escalation.push({ round, made, before, after, error: roundErr, liveSessions: held.length });
      if (roundErr) { out.stoppedBecause = "session creation threw in round " + round; break; }
      if (after.mb >= CEILING_MB) { out.stoppedBecause = "ceiling " + CEILING_MB + " MB reached"; break; }
    }
    if (!out.stoppedBecause) out.stoppedBecause = "max rounds reached without failure";

    // release everything we held
    for (const s of held) { try { if (s.release) await s.release(); } catch (e) {} }
    out.afterRelease = mem();
  } catch (e) {
    out.error = { name: String(e && e.name), message: String((e && e.message) || e).slice(0, 300) };
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
