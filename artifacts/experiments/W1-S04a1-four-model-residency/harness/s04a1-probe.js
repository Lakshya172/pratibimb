/**
 * S-04a-1 -- FOUR DIFFERENT MODELS RESIDENT TOGETHER.
 *
 * S-04a reached the WASM growth regime but used THREE COPIES OF ONE MODEL. Three YuNet
 * sessions share weights and workspace shapes, so "sessions share the arena" could still
 * have been an artefact of them being identical. The dossier's actual risk is ~120 MB
 * across FOUR DIFFERENT models. This probe measures that.
 *
 * The four are genuinely different architectures, not four sizes of one:
 *   face        YuNet                 106 nodes, 53 Conv          CNN detector
 *   ocr_det     PP-OCRv5 mobile det   502 nodes, HardSwish        DBNet-style segmentation
 *   ocr_rec     PP-OCRv5 mobile rec   549 nodes, MatMul           CRNN sequence recognition
 *   vlm_vision  SmolVLM-256M encoder 1146 nodes, MatMulInteger    int8 SigLIP ViT
 *
 * Weights are NOT inlined -- ~116 MB of base64 is not viable. They are packaged as
 * extension resources and read through runtime.getURL(), which is a same-origin extension
 * read: no network, no host permission, nothing that could be confused with egress.
 *
 * MEASUREMENT: WebAssembly.Memory constructor AND Memory.prototype.grow are wrapped before
 * ORT loads, so growth is recorded with pages before/after rather than inferred. WASM memory
 * and JS heap are recorded SEPARATELY and never conflated.
 *
 * Throwaway spike code. No product code.
 */
const REFERENCE = __REFERENCE_JSON__;
const MODEL_URLS = __MODEL_URLS_JSON__;
// Correctness criterion, chosen from MEASURED conditioning rather than to make a run pass.
// A 1e-6 input perturbation measured natively moves individual outputs by up to 9.8%
// (ocr_det) and 10% of the raw sum (vlm_vision int8) -- those two models are strongly
// ill-conditioned in this regime -- while the CANCELLATION-FREE sumAbs moves by at most
// 6.3e-3. So: count must match exactly and sumAbs must match within RTOL_SUMABS, which is
// ~3x the measured conditioning bound. min/max/sum/sampled values are recorded as DATA,
// not as pass/fail, because single extreme elements are exactly what ill-conditioning and
// int8 bucket-flipping move first. Full conditioning table in the artifact README.
const RTOL_SUMABS = 2e-2;

// ---- memory instrumentation, installed before ORT allocates anything ------------------
(function install() {
  if (globalThis.__s04a1_mem) return;
  const state = { memories: [], grows: [] };
  globalThis.__s04a1_mem = state;

  const NativeMemory = WebAssembly.Memory;
  const nativeGrow = NativeMemory.prototype.grow;

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
  const s = globalThis.__s04a1_mem;
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
// JS heap is recorded SEPARATELY and is never used as evidence about the WASM heap.
// S-04 showed it is GC-timing-dominated (it fell 25.9 -> 10.8 MB in a single step there).
function jsHeap() {
  try {
    if (globalThis.performance && performance.memory) {
      return { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 };
    }
  } catch (e) {}
  return null;
}
function snap(label) {
  return { label, wasm: memState(), js: jsHeap(), at: Math.round(performance.now()) };
}

function makeFloats(n) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = ((i * 37) % 255) / 255;
  return a;
}
function prod(shape) { let n = 1; for (const d of shape) n *= d; return n; }

globalThis.runS04a1Probe = async function runS04a1Probe(contextName, opts) {
  opts = opts || {};
  const backend = opts.backend || "wasm";
  const cycles = opts.cycles === undefined ? 3 : opts.cycles;
  const phase = opts.phase || "full";   // "baselines" | "resident" | "full"

  const out = {
    context: contextName, probe: "s04a1-four-model", backend, cycles, phase,
    startedAt: new Date().toISOString(),
    requestedNumThreads: opts.numThreads === undefined ? "default" : opts.numThreads,
    hookErrors: {
      ctor: (globalThis.__s04a1_mem || {}).ctorHookError || null,
      grow: (globalThis.__s04a1_mem || {}).growHookError || null,
    },
    modelOrder: ["face", "ocr_det", "ocr_rec", "vlm_vision"],
    baselines: {}, residentSnapshots: [], lifecycleSnapshots: [], cycleSnapshots: [],
    growthEvents: [], correctness: [], timings: [], error: null, notes: [],
  };

  if (Array.isArray(opts.only) && opts.only.length) out.modelOrder = opts.only.slice();
  const ORDER = out.modelOrder;
  const modelBytes = {};

  async function loadModel(key) {
    if (modelBytes[key]) return modelBytes[key];
    // Same-origin extension resource read. NOT network.
    const r = await fetch((opts.modelBase || opts.wasmPaths || "") + MODEL_URLS[key]);
    const buf = new Uint8Array(await r.arrayBuffer());
    modelBytes[key] = buf;
    return buf;
  }

  async function makeSession(key) {
    const bytes = await loadModel(key);
    return ort.InferenceSession.create(bytes, {
      executionProviders: [backend], graphOptimizationLevel: "all",
    });
  }

  function buildFeeds(key) {
    const spec = REFERENCE.models[key];
    const feeds = {};
    for (const inName of Object.keys(spec.input_shapes)) {
      const shape = spec.input_shapes[inName];
      const kind = spec.input_kinds[inName];
      const n = prod(shape);
      if (kind === "ones_bool") {
        const a = new Uint8Array(n); a.fill(1);
        feeds[inName] = new ort.Tensor("bool", a, shape);
      } else {
        feeds[inName] = new ort.Tensor("float32", makeFloats(n), shape);
      }
    }
    return feeds;
  }

  async function inferAndVerify(key, session, tag) {
    const spec = REFERENCE.models[key];
    const t0 = performance.now();
    const res = await session.run(buildFeeds(key));
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    out.timings.push({ model: key, tag, phase: "infer", ms });

    const report = { model: key, tag, correct: true, worstRelErr: 0, outputs: {} };
    for (const name of session.outputNames) {
      const ref = spec.outputs[name];
      const t = res[name];
      if (!ref || !t) { report.correct = false; report.outputs[name] = { error: "no reference" }; continue; }
      const d = t.data;
      let mn = Infinity, mx = -Infinity, sum = 0, sumAbs = 0;
      for (let i = 0; i < d.length; i++) {
        const v = d[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        sum += v;
        sumAbs += v < 0 ? -v : v;
      }
      const relErrSumAbs = Math.abs(sumAbs - ref.sumAbs) / Math.max(1e-30, Math.abs(ref.sumAbs));
      const countOk = d.length === ref.count;
      const ok = countOk && relErrSumAbs <= RTOL_SUMABS;
      if (!ok) report.correct = false;
      if (relErrSumAbs > report.worstRelErr) report.worstRelErr = relErrSumAbs;
      report.outputs[name] = {
        count: d.length, expectedCount: ref.count, countOk, ok,
        sumAbs, refSumAbs: ref.sumAbs, relErrSumAbs,
        // recorded as data, NOT criteria
        min: mn, refMin: ref.min, max: mx, refMax: ref.max,
        sum, refSum: ref.sum,
        relErrSum: Math.abs(sum - ref.sum) / Math.max(1e-30, Math.abs(ref.sum)),
      };
    }
    out.correctness.push(report);
    return report.correct;
  }

  async function release(s) { if (s && typeof s.release === "function") await s.release(); }

  try {
    if (typeof ort === "undefined") { out.conclusion = "ORT global absent"; return out; }
    out.ortVersion = (ort.env && ort.env.versions && ort.env.versions.common) || "unknown";
    if (opts.wasmPaths) ort.env.wasm.wasmPaths = opts.wasmPaths;
    if (opts.numThreads !== undefined) ort.env.wasm.numThreads = opts.numThreads;
    ort.env.logLevel = "error";
    out.env = {
      sharedArrayBuffer: typeof SharedArrayBuffer === "function",
      configuredNumThreads: ort.env.wasm.numThreads,
      crossOriginIsolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : null,
    };

    // ================= SECTION 5: INDIVIDUAL BASELINES =================================
    // phase "resident" SKIPS this sweep. That matters: run in the same context, the sweep
    // grows the arena to its own high-water mark first, and every later residency number
    // then starts from a pre-grown arena. That is exactly the run-order confound S-04a hit
    // with its webgpu cell, so the clean §6 answer comes from a cold-start resident run.
    // Each model ALONE, in a clean-as-possible state: create, infer, destroy. This is the
    // baseline needed to interpret the combined number. Feasibility, not benchmarking.
    for (const key of (phase === "resident" ? [] : ORDER)) {
      const before = snap("baseline-" + key + "-before");
      const growsBefore = globalThis.__s04a1_mem.grows.length;
      const tc0 = performance.now();
      let s = null, err = null;
      try {
        s = await makeSession(key);
      } catch (e) { err = String((e && e.message) || e).slice(0, 300); }
      const createMs = Math.round((performance.now() - tc0) * 10) / 10;
      const afterCreate = snap("baseline-" + key + "-after-create");
      let correct = null;
      if (s) { correct = await inferAndVerify(key, s, "baseline-" + key); }
      const afterInfer = snap("baseline-" + key + "-after-infer");
      const td0 = performance.now();
      await release(s);
      const destroyMs = Math.round((performance.now() - td0) * 10) / 10;
      const afterDestroy = snap("baseline-" + key + "-after-destroy");

      out.timings.push({ model: key, tag: "baseline", phase: "create", ms: createMs });
      out.timings.push({ model: key, tag: "baseline", phase: "destroy", ms: destroyMs });
      out.baselines[key] = {
        error: err, correct,
        modelBytes: modelBytes[key] ? modelBytes[key].length : null,
        before: before.wasm, afterCreate: afterCreate.wasm,
        afterInfer: afterInfer.wasm, afterDestroy: afterDestroy.wasm,
        growsAdded: globalThis.__s04a1_mem.grows.length - growsBefore,
        createMs, destroyMs,
        js: { before: before.js, afterInfer: afterInfer.js },
      };
      if (err) out.notes.push("baseline " + key + " failed: " + err);
    }

    if (phase === "baselines") {
      out.growthEvents = globalThis.__s04a1_mem.grows.slice();
      out.allCorrect = out.correctness.every((c) => c.correct);
      out.conclusion = "baselines only";
      out.finishedAt = new Date().toISOString();
      return out;
    }

    // ================= SECTION 6: INCREMENTAL RESIDENCY ================================
    // Add one DIFFERENT model at a time, keeping every earlier session ALIVE. The question
    // is whether four different models cost A+B+C+D or share.
    const live = [];
    out.residentSnapshots.push(snap("resident-0-none"));
    for (let i = 0; i < ORDER.length; i++) {
      const key = ORDER[i];
      try {
        live.push({ key, session: await makeSession(key) });
      } catch (e) {
        out.notes.push("resident create failed for " + key + ": " + String((e && e.message) || e).slice(0, 200));
      }
      out.residentSnapshots.push(snap("resident-" + (i + 1) + "-" + ORDER.slice(0, i + 1).join("+")));
    }

    // ================= SECTION 7: INFER WITH ALL FOUR RESIDENT =========================
    for (const item of live) await inferAndVerify(item.key, item.session, "all-resident");
    out.residentSnapshots.push(snap("resident-4-after-infer-all"));

    // ================= SECTION 8: LIFECYCLE ===========================================
    // destroy one -> infer the rest -> destroy another -> ... then repeat the whole thing.
    out.lifecycleSnapshots.push(snap("lifecycle-start"));
    const remaining = live.slice();
    while (remaining.length > 0) {
      const dropped = remaining.pop();
      await release(dropped.session);
      out.lifecycleSnapshots.push(snap("after-destroy-" + dropped.key));
      for (const item of remaining) await inferAndVerify(item.key, item.session, "after-destroy-" + dropped.key);
      if (remaining.length) out.lifecycleSnapshots.push(snap("after-infer-remaining-" + remaining.length));
    }
    out.lifecycleSnapshots.push(snap("lifecycle-all-destroyed"));

    // repeated complete lifecycles -- the ONLY place a leak claim could come from
    for (let c = 1; c <= cycles; c++) {
      const batch = [];
      for (const key of ORDER) {
        try { batch.push({ key, session: await makeSession(key) }); }
        catch (e) { out.notes.push("cycle " + c + " create failed " + key); }
      }
      for (const item of batch) await inferAndVerify(item.key, item.session, "cycle-" + c);
      for (const item of batch) await release(item.session);
      out.cycleSnapshots.push(snap("after-cycle-" + c));
    }

    out.growthEvents = globalThis.__s04a1_mem.grows.slice();
    out.allCorrect = out.correctness.every((c) => c.correct);
    out.conclusion = (out.allCorrect ? "all output correct" : "OUTPUT INCORRECT") +
      "; " + out.growthEvents.length + " grow() call(s); final " + memState().mb + " MB";
  } catch (e) {
    out.growthEvents = ((globalThis.__s04a1_mem || {}).grows || []).slice();
    out.error = { name: e && e.name ? String(e.name) : null,
                  message: e && e.message ? String(e.message).slice(0, 400) : String(e).slice(0, 400) };
    out.conclusion = "threw: " + ((e && e.message) ? String(e.message).slice(0, 200) : String(e).slice(0, 200));
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
