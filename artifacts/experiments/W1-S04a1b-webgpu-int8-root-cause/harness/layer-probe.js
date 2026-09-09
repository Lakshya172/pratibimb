/**
 * S-04a-1b -- LAYER-WISE comparison of the instrumented int8 vision encoder.
 *
 * Runs the instrumented model and reports, per checkpoint, exactly the statistics the CPU
 * reference recorded: shape, dtype, min, max, mean, sum, sumAbs, and the values at the same
 * fixed sample indices. The point is to find the FIRST checkpoint where WebGPU departs from
 * CPU while WASM does not.
 *
 * Divergence is reported per checkpoint with several independent measures rather than one
 * pass/fail, so a genuinely wrong layer cannot hide behind a lucky aggregate and a merely
 * ill-conditioned one is visible as such.
 *
 * Throwaway spike code.
 */
const LAYER_REFERENCE = __LAYER_REFERENCE_JSON__;

globalThis.runLayerProbe = async function runLayerProbe(contextName, opts) {
  opts = opts || {};
  const backend = opts.backend || "wasm";
  const base = opts.modelBase || opts.wasmPaths || "";
  const out = {
    context: contextName, probe: "s04a1b-layerwise", backend,
    startedAt: new Date().toISOString(),
    checkpoints: {}, order: [], error: null, ortVersion: null,
  };
  try {
    if (typeof ort === "undefined") { out.conclusion = "ORT global absent"; return out; }
    out.ortVersion = (ort.env && ort.env.versions && ort.env.versions.common) || "unknown";
    if (opts.wasmPaths) ort.env.wasm.wasmPaths = opts.wasmPaths;
    if (opts.numThreads !== undefined) ort.env.wasm.numThreads = opts.numThreads;
    ort.env.logLevel = "error";

    const t0 = performance.now();
    const modelFile = opts.modelFile || "sliced/vision_encoder_int8_instrumented.onnx";
    out.modelFile = modelFile;
    const r = await fetch(base + modelFile);
    const bytes = new Uint8Array(await r.arrayBuffer());
    // graphOptimizationLevel is a VARIABLE here, not a constant. With "all", ORT Web
    // reported only 5 of the model's 15 graph outputs -- it drops promoted outputs during
    // optimization -- and the observed divergence moved when instrumentation changed. That
    // makes fusion a first-class suspect, so it must be switchable.
    const optLevel = opts.optLevel || "all";
    out.optLevel = optLevel;
    const sess = await ort.InferenceSession.create(bytes, {
      executionProviders: [backend], graphOptimizationLevel: optLevel,
    });
    out.reportedOutputs = sess.outputNames.slice();
    out.createMs = Math.round((performance.now() - t0) * 10) / 10;

    const shp = LAYER_REFERENCE.input_shapes;
    function prod(s) { let n = 1; for (const d of s) n *= d; return n; }
    const nPix = prod(shp.pixel_values);
    const pix = new Float32Array(nPix);
    for (let i = 0; i < nPix; i++) pix[i] = ((i * 37) % 255) / 255;
    const nMask = prod(shp.pixel_attention_mask);
    const mask = new Uint8Array(nMask); mask.fill(1);

    const feeds = {
      pixel_values: new ort.Tensor("float32", pix, shp.pixel_values),
      pixel_attention_mask: new ort.Tensor("bool", mask, shp.pixel_attention_mask),
    };
    const t1 = performance.now();
    const res = await sess.run(feeds);
    out.inferMs = Math.round((performance.now() - t1) * 10) / 10;

    for (const name of sess.outputNames) {
     try {
      const ref = LAYER_REFERENCE.checkpoints[name];
      const t = res[name];
      if (!ref || !t) { out.checkpoints[name] = { error: "no reference or no output" }; continue; }
      const d = t.data;
      // int64 tensors arrive as BigInt64Array. Mixing BigInt with Number throws, which
      // aborted this loop after the five float32 outputs and made ten checkpoints silently
      // vanish from every earlier run. Convert explicitly.
      const isBig = (typeof BigInt64Array !== "undefined" && d instanceof BigInt64Array) ||
                    (typeof BigUint64Array !== "undefined" && d instanceof BigUint64Array);
      let mn = Infinity, mx = -Infinity, sum = 0, sumAbs = 0;
      for (let i = 0; i < d.length; i++) {
        const v = isBig ? Number(d[i]) : d[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        sum += v;
        sumAbs += v < 0 ? -v : v;
      }
      const scale = Math.max(Math.abs(ref.min), Math.abs(ref.max)) || 1;
      const samples = ref.sampleIdx.map((ix) => Number(d[ix]));
      // per-checkpoint failure must not abort the whole sweep
      let worstSampleAbs = 0;
      for (let k = 0; k < samples.length; k++) {
        const a = Math.abs(samples[k] - ref.sampleVals[k]);
        if (a > worstSampleAbs) worstSampleAbs = a;
      }
      out.checkpoints[name] = {
        label: ref.label,
        dtype: t.type, dtypeRef: ref.dtype,
        shape: t.dims, shapeRef: ref.shape,
        countOk: d.length === ref.count,
        count: d.length, expectedCount: ref.count,
        min: mn, refMin: ref.min,
        max: mx, refMax: ref.max,
        mean: sum / d.length, refMean: ref.mean,
        sum: sum, refSum: ref.sum,
        sumAbs: sumAbs, refSumAbs: ref.sumAbs,
        // the primary divergence measures
        relErrSumAbs: Math.abs(sumAbs - ref.sumAbs) / Math.max(1e-30, Math.abs(ref.sumAbs)),
        relErrMinOverScale: Math.abs(mn - ref.min) / scale,
        relErrMaxOverScale: Math.abs(mx - ref.max) / scale,
        worstSampleAbs: worstSampleAbs,
        worstSampleRelOverScale: worstSampleAbs / scale,
        samples: samples, refSamples: ref.sampleVals,
      };
      out.order.push(name);
     } catch (e) {
      out.checkpoints[name] = { perCheckpointError: String((e && e.message) || e).slice(0, 200) };
     }
    }
    if (sess.release) await sess.release();
    out.conclusion = "layerwise complete, " + out.order.length + " checkpoints";
  } catch (e) {
    out.error = { name: String(e && e.name), message: String((e && e.message) || e).slice(0, 400) };
    out.conclusion = "threw: " + String((e && e.message) || e).slice(0, 200);
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
