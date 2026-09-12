/**
 * QG-03a-B3-1 probe. Runs INSIDE the MV3 extension: in the offscreen document, or in the
 * dedicated worker the offscreen document creates. The same file serves both realms.
 *
 * It performs, in the realm, the calls apps/extension/entrypoints/ortRuntime.ts
 * (bootstrapOrtRealm) makes, from the SHIPPED compiled packages copied verbatim into the
 * extension:
 *   1. assertWasmCompilationAllowed
 *   2. ort.env.wasm.numThreads = 1, proxy = false, logLevel = "error"
 *   3. installVerifiedOrtRuntime, resolving assets against self.location (resolvePackagedAsset)
 *   4. createPinnedInferenceSession
 * then, per fixture, B2's path: native createImageBitmap decode -> shipped preprocessToTensor
 * -> 3 runs -> digests -> shipped decodeHeadOutput. The first raw output of each fixture is
 * posted, as binary, to the loopback collector; the analysis decodes it again from the dump.
 *
 * Nothing here decides a verdict. It records what happened, including failures, and the Node
 * guards decide.
 *
 * Throwaway harness code. Never shipped.
 */
globalThis.runB3Probe = async function runB3Probe(cfg) {
  const g = globalThis;
  const F = g.B3_FIXTURES;
  const S = g.__b3;
  const out = {
    probe: "qg03a-b3-1",
    realmRequested: cfg.realm,
    backend: cfg.backend,
    startedAt: new Date().toISOString(),
    userAgent: (g.navigator && g.navigator.userAgent) || null,
    context: null,
    runtime: {},
    model: {},
    rows: [],
    gpu: null,
    network: null,
    error: null,
  };
  const hex = (buf) => Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, "0")).join("");
  const sha = async (u8) => hex(await crypto.subtle.digest("SHA-256", u8));
  const r2 = (v) => Math.round(v * 100) / 100;
  const b64ToBytes = (b64) => {
    const bin = atob(b64);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) a[i] = bin.charCodeAt(i);
    return a;
  };
  const isWorker = typeof g.WorkerGlobalScope !== "undefined" && g instanceof g.WorkerGlobalScope;
  out.context = {
    origin: g.location.origin,
    href: g.location.href,
    realmKind: isWorker ? "dedicated-worker" : "document",
    isDedicatedWorker: typeof g.DedicatedWorkerGlobalScope !== "undefined" && g instanceof g.DedicatedWorkerGlobalScope,
    hasDocument: typeof g.document !== "undefined",
    runtimeId: (g.chrome && g.chrome.runtime && g.chrome.runtime.id) || null,
  };
  // ortRuntime.ts resolvePackagedAsset: relative to THIS realm's own location.
  const resolve = (name) => new URL(name, g.location.href).href;
  const post = async (path, body, type) => {
    const res = await fetch(cfg.collector + path, { method: "POST", headers: { "content-type": type }, body: body });
    if (!res.ok) throw new Error("collector " + path.split("?")[0] + " answered " + res.status);
  };
  let session = null;
  let submitsBefore = S.gpu.submits;
  try {
    if (!F || !S) throw new Error("fixtures or instrumentation missing in this realm");
    const ort = g.ort;
    if (!ort) throw new Error("ORT Web global not present in this realm");
    const SEC = await import(resolve("security/index.js"));
    const P = await import(resolve("perception/index.js"));

    out.runtime.capability = await SEC.assertWasmCompilationAllowed("qg03a-b3-1-" + out.context.realmKind);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = "error";
    out.runtime.pin = await SEC.installVerifiedOrtRuntime({ ort: ort, resolveAssetUrl: resolve });
    out.runtime.numThreads = ort.env.wasm.numThreads;
    out.runtime.proxy = ort.env.wasm.proxy;
    out.runtime.ortEnvVersions = ort.env.versions ? JSON.parse(JSON.stringify(ort.env.versions)) : null;

    const modelBytes = b64ToBytes(F.model.b64);
    out.model.sha256SeenInRealm = await sha(modelBytes);
    out.model.bytes = modelBytes.length;

    const t0 = performance.now();
    session = await SEC.createPinnedInferenceSession(ort, modelBytes, { executionProviders: [cfg.backend], graphOptimizationLevel: "all" });
    out.sessionCreateMs = r2(performance.now() - t0);
    out.session = { inputNames: Array.from(session.inputNames), outputNames: Array.from(session.outputNames) };
    if (cfg.backend === "webgpu") {
      try {
        const a = ort.env.webgpu && ort.env.webgpu.adapter;
        out.adapterFromOrt = a ? g.__b3_describeAdapter(a) : null;
      } catch (e) {
        out.adapterFromOrtError = String(e).slice(0, 200);
      }
    }

    submitsBefore = S.gpu.submits;
    const N = 3 * 640 * 640;
    for (const f of F.fixtures) {
      const rec = { name: f.name };
      try {
        const png = b64ToBytes(F.blobs[f.file]);
        rec.pngSha256 = await sha(png);
        rec.magic = Array.from(png.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        if (rec.pngSha256 !== f.encodedSha256) throw new Error("PNG bytes differ from fixtures.json");

        let t = performance.now();
        const bmp = await createImageBitmap(new Blob([png], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
        if (bmp.close) bmp.close();
        rec.pngDecodeMs = r2(performance.now() - t);
        rec.decodedSize = { w: img.width, h: img.height };

        t = performance.now();
        const pre = P.preprocessToTensor({ width: img.width, height: img.height, rgba: new Uint8Array(img.data.buffer.slice(0)) }, P.HEAD_CONTRACT);
        rec.preprocessMs = r2(performance.now() - t);
        if (pre.tensor.length !== N) throw new Error("tensor length " + pre.tensor.length + ", required " + N);
        rec.tensorSha256 = await sha(pre.tensor.buffer.slice(pre.tensor.byteOffset, pre.tensor.byteOffset + pre.tensor.byteLength));
        rec.inputDims = [1, 3, 640, 640];
        const feeds = {};
        feeds[session.inputNames[0]] = new ort.Tensor("float32", pre.tensor, rec.inputDims);

        const dumps = [];
        rec.inferMs = [];
        rec.submits = [];
        for (let k = 0; k < cfg.runs; k += 1) {
          const s0 = S.gpu.submits;
          const t1 = performance.now();
          const res = await session.run(feeds);
          const o = res[session.outputNames[0]];
          rec.inferMs.push(r2(performance.now() - t1));
          rec.submits.push(S.gpu.submits - s0);
          const data = o.data instanceof Float32Array ? o.data : Float32Array.from(o.data);
          if (k === 0) {
            rec.dims = Array.from(o.dims);
            let bad = 0;
            for (let i = 0; i < data.length; i += 1) if (!Number.isFinite(data[i])) bad += 1;
            rec.nonFinite = bad;
            rec.outputValues = data.length;
          }
          dumps.push(new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
        }
        rec.outputSha256 = await sha(dumps[0]);
        rec.repeatSha256 = [];
        for (let k = 1; k < dumps.length; k += 1) rec.repeatSha256.push(await sha(dumps[k]));
        rec.deterministic = rec.repeatSha256.length === cfg.runs - 1 && rec.repeatSha256.every((s) => s === rec.outputSha256);

        const td = performance.now();
        const dec = P.decodeHeadOutput({ data: new Float32Array(dumps[0].buffer.slice(0)), dims: rec.dims });
        rec.decodeNmsMs = r2(performance.now() - td);
        rec.decodedCount = dec.ok ? dec.value.length : null;
        rec.decodeRefusal = dec.ok ? null : dec.code;

        await post("/dump?cell=" + encodeURIComponent(cfg.cell) + "&fixture=" + encodeURIComponent(f.name) + "&sha=" + rec.outputSha256, dumps[0], "application/octet-stream");
        rec.dumpPosted = true;
      } catch (e) {
        rec.error = String((e && e.message) || e).slice(0, 300);
      }
      out.rows.push(rec);
    }
  } catch (e) {
    out.error = String((e && e.stack) || e).slice(0, 800);
  } finally {
    out.gpu = {
      hookInstalled: S ? S.gpu.hookInstalled : false,
      hookError: S ? S.gpu.hookError : "no instrumentation",
      submitsTotal: S ? S.gpu.submits : null,
      submitsDuringInference: S ? S.gpu.submits - submitsBefore : null,
      computePipelines: S ? S.gpu.computePipelines : null,
      requestAdapterCalls: S ? S.gpu.requestAdapterCalls : null,
      adapterFromRequestAdapter: S ? S.gpu.adapter : null,
    };
    try {
      if (session && typeof session.release === "function") await session.release();
    } catch (e) {
      out.releaseError = String(e).slice(0, 200);
    }
    const arrivals = S ? S.network.arrivals : [];
    const byOrigin = {};
    for (const a of arrivals) byOrigin[a.origin] = (byOrigin[a.origin] || 0) + 1;
    out.network = {
      observed: S ? S.network.observed : false,
      hookErrors: S ? S.network.hookErrors : [],
      selfOrigin: S ? S.selfOrigin : null,
      arrivals: arrivals.length,
      byOrigin: byOrigin,
      nonSelf: arrivals.filter((a) => a.origin !== (S && S.selfOrigin)).map((a) => ({ kind: a.kind, origin: a.origin, url: a.url.split("?")[0] })).slice(0, 200),
    };
    out.finishedAt = new Date().toISOString();
  }
  return out;
};
