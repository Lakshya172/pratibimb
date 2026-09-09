/**
 * S-04a-1b -- minimal int8 reproducers in the browser, wasm vs webgpu, against the native
 * ONNX Runtime CPU reference.
 *
 * These tensors are tiny (at most 8x32), so the comparison is EXACT and element-wise. Integer
 * outputs must match bit for bit; float outputs are compared per element with a stated
 * tolerance AND the exact-match count is reported alongside, so "how wrong" is visible rather
 * than collapsed into a pass/fail.
 *
 * No aggregate statistic is used here. Section 12 forbids relaxing the criterion, and at this
 * size there is no reason to.
 *
 * Throwaway spike code.
 */
const REFERENCE = __MICRO_REFERENCE_JSON__;
const SPECS = __MICRO_SPECS_JSON__;
const MODEL_DIR = "micro/";
const FTOL = 1e-4;   // float tolerance, relative to the reference tensor's own scale

function makeInput(kind, shape) {
  let n = 1;
  for (const d of shape) n *= d;
  if (kind === "u8") {
    const a = new Uint8Array(n);
    for (let i = 0; i < n; i++) a[i] = (i * 11) % 256;
    return { type: "uint8", data: a };
  }
  if (kind === "i8") {
    const a = new Int8Array(n);
    for (let i = 0; i < n; i++) a[i] = ((i * 7) % 251) - 125;
    return { type: "int8", data: a };
  }
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = ((i * 37) % 255) / 255;
  return { type: "float32", data: a };
}

function compare(actual, ref) {
  const exp = ref.values;
  const n = exp.length;
  const isInt = ref.dtype.indexOf("int") === 0 || ref.dtype.indexOf("uint") === 0;
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(exp[i]));
  if (scale === 0) scale = 1;

  let exact = 0, worstAbs = 0, worstRel = 0, worstIdx = -1;
  let firstBadIdx = -1, firstBadGot = null, firstBadExp = null;
  for (let i = 0; i < n; i++) {
    const g = Number(actual[i]);
    const e = exp[i];
    if (g === e) exact++;
    const abs = Math.abs(g - e);
    const rel = abs / scale;
    if (abs > worstAbs) { worstAbs = abs; worstIdx = i; }
    if (rel > worstRel) worstRel = rel;
    const bad = isInt ? (g !== e) : (rel > FTOL);
    if (bad && firstBadIdx < 0) { firstBadIdx = i; firstBadGot = g; firstBadExp = e; }
  }
  return {
    count: actual.length, expectedCount: n, countOk: actual.length === n,
    dtypeRef: ref.dtype, isInt,
    exactMatches: exact, exactMatchPct: Math.round(exact / n * 1000) / 10,
    worstAbs, worstRel, worstIdx,
    firstBadIdx, firstBadGot, firstBadExp,
    ok: (actual.length === n) && (isInt ? exact === n : worstRel <= FTOL),
    // a short prefix, so a wrong tensor can be eyeballed rather than trusted
    gotHead: Array.prototype.slice.call(actual, 0, 8).map(Number),
    expHead: exp.slice(0, 8),
  };
}

globalThis.runMicroProbe = async function runMicroProbe(contextName, opts) {
  opts = opts || {};
  const backend = opts.backend || "wasm";
  const base = opts.modelBase || opts.wasmPaths || "";
  const out = {
    context: contextName, probe: "s04a1b-micro", backend,
    startedAt: new Date().toISOString(),
    graphs: {}, error: null, env: null, ortVersion: null,
  };
  try {
    if (typeof ort === "undefined") { out.conclusion = "ORT global absent"; return out; }
    out.ortVersion = (ort.env && ort.env.versions && ort.env.versions.common) || "unknown";
    if (opts.wasmPaths) ort.env.wasm.wasmPaths = opts.wasmPaths;
    if (opts.numThreads !== undefined) ort.env.wasm.numThreads = opts.numThreads;
    ort.env.logLevel = "warning";
    out.env = {
      sharedArrayBuffer: typeof SharedArrayBuffer === "function",
      hasWebGPU: typeof navigator !== "undefined" && !!navigator.gpu,
    };

    for (const name of Object.keys(SPECS)) {
      const spec = SPECS[name];
      const rec = { file: spec.file, error: null, outputs: {}, allOk: null, createMs: null };
      try {
        const t0 = performance.now();
        const r = await fetch(base + MODEL_DIR + spec.file);
        const bytes = new Uint8Array(await r.arrayBuffer());
        const sess = await ort.InferenceSession.create(bytes, {
          executionProviders: [backend], graphOptimizationLevel: "all",
        });
        rec.createMs = Math.round((performance.now() - t0) * 10) / 10;

        const feeds = {};
        for (const inName of Object.keys(spec.inputs)) {
          const s = spec.inputs[inName];
          const mk = makeInput(s.kind, s.shape);
          feeds[inName] = new ort.Tensor(mk.type, mk.data, s.shape);
        }
        const res = await sess.run(feeds);
        const refG = REFERENCE.graphs[name];
        let allOk = true;
        for (const oName of sess.outputNames) {
          const ref = refG.outputs[oName];
          if (!ref) { rec.outputs[oName] = { error: "no reference" }; allOk = false; continue; }
          const cmp = compare(res[oName].data, ref);
          cmp.dtypeGot = res[oName].type;
          rec.outputs[oName] = cmp;
          if (!cmp.ok) allOk = false;
        }
        rec.allOk = allOk;
        if (sess.release) await sess.release();
      } catch (e) {
        rec.error = { name: String(e && e.name), message: String((e && e.message) || e).slice(0, 400) };
        rec.allOk = false;
      }
      out.graphs[name] = rec;
    }
    const names = Object.keys(out.graphs);
    const bad = names.filter((n) => !out.graphs[n].allOk);
    out.conclusion = bad.length === 0
      ? ("all " + names.length + " micro graphs correct")
      : ("INCORRECT or ERRORED: " + bad.join(", "));
  } catch (e) {
    out.error = { name: String(e && e.name), message: String((e && e.message) || e).slice(0, 400) };
    out.conclusion = "threw: " + String((e && e.message) || e).slice(0, 200);
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
