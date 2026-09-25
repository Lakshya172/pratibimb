/**
 * M8.2 — the QG-03 feasibility probe for a text-region candidate. Runs INSIDE a throwaway MV3
 * extension: the Chromium offscreen document, or the Firefox event page.
 *
 * Everything is fixed by protocol.md and the files the builder injects:
 *   M82_REF     the candidate, the coexistence models, every input's sha256 and native reference
 *   M82_LIB     dbPostprocess / tensorStats / judgeWasm — the M8.1 SOURCE TEXT, injected verbatim
 *   __qg03_*    W1-QG03's instrumentation (WASM memory, network, GPU), copied verbatim
 *   security/   the SHIPPED @pratibimb/security: the ORT pin and the only sanctioned session
 *
 * Modes: cell | teardown | teardown-fresh | coexist | bench. No model here recognises text, no
 * recognition model is present, and nothing leaves but hashes, statistics, timings and boxes.
 *
 * Throwaway harness code. Never shipped.
 */
globalThis.runM82 = async function runM82(contextName, cfg) {
  const R = globalThis.M82_REF;
  const L = globalThis.M82_LIB;
  const base = cfg.base || "";
  const backend = cfg.backend || "wasm";
  const out = {
    context: contextName,
    mode: cfg.mode,
    candidate: R.candidate,
    backend,
    startedAt: new Date().toISOString(),
    userAgent: (globalThis.navigator && navigator.userAgent) || null,
    ortVersion: null,
    pin: null,
    memory: [],
    errors: [],
    timerResolutionMs: null,
    conclusion: null,
  };
  const snap = (label) => {
    const s = globalThis.__qg03_snapshot(label);
    out.memory.push(s);
    return s;
  };
  const now = () => performance.now();
  const r2 = (v) => Math.round(v * 100) / 100;
  async function sha256Hex(bytes) {
    const d = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const shaText = (s) => sha256Hex(new TextEncoder().encode(s));
  async function fetchBytes(path) {
    const res = await fetch(base + path);
    if (!res.ok) throw new Error("extension read failed: " + path);
    return new Uint8Array(await res.arrayBuffer());
  }
  async function loadModel(spec) {
    const bytes = await fetchBytes("models/" + spec.file);
    const sha = await sha256Hex(bytes);
    if (sha !== spec.sha256 || bytes.byteLength !== spec.bytes) throw new Error("model bytes are not " + spec.file + " as frozen");
    return bytes;
  }
  function synthetic640() {
    const n = 3 * 640 * 640;
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = ((i * 37) % 255) / 255;
    return a;
  }
  async function loadInput(name) {
    const spec = R.inputs[name];
    const a = name === "synthetic" ? synthetic640() : new Float32Array((await fetchBytes("fixtures/input-" + name + ".f32")).buffer);
    const sha = await sha256Hex(new Uint8Array(a.buffer));
    if (sha !== spec.inputSha256) throw new Error("input " + name + " is not the frozen tensor");
    return a;
  }
  const feeds = (session, data, shape) => ({ [session.inputNames[0]]: new ort.Tensor("float32", data, shape) });
  async function create(bytes) {
    const t = now();
    const s = await SEC.createPinnedInferenceSession(ort, bytes, { executionProviders: [backend], graphOptimizationLevel: "all" });
    return { session: s, ms: now() - t };
  }
  /** Hash every output in declared order, so a multi-output model (YuNet) is compared whole. */
  async function hashOutputs(session, res) {
    const parts = [];
    for (const n of session.outputNames) parts.push(await sha256Hex(new Uint8Array(res[n].data.buffer, res[n].data.byteOffset, res[n].data.byteLength)));
    return parts.length === 1 ? parts[0] : await shaText(parts.join(","));
  }
  let SEC = null;

  try {
    // timer resolution, measured rather than assumed (Firefox coarsens performance.now)
    let minStep = Infinity;
    for (let i = 0, prev = now(); i < 2000; i++) {
      const t = now();
      if (t > prev) { minStep = Math.min(minStep, t - prev); prev = t; }
    }
    out.timerResolutionMs = Number.isFinite(minStep) ? r2(minStep * 1000) / 1000 : null;

    if (typeof ort === "undefined") throw new Error("ORT Web global not present");
    out.ortVersion = (ort.env && ort.env.versions && ort.env.versions.common) || null;
    ort.env.logLevel = "error";
    if (backend === "wasm") ort.env.wasm.numThreads = 1;
    snap("baseline-before-anything");
    SEC = await import(base + "security/index.js");
    const installed = await SEC.installVerifiedOrtRuntime({ ort, resolveAssetUrl: (n) => base + n });
    out.pin = { installed: true, artifact: installed.artifact, sha256: installed.sha256 };

    if (cfg.mode === "cell") await cell();
    else if (cfg.mode === "teardown") await teardown(cfg.cycles || 5);
    else if (cfg.mode === "teardown-fresh") await teardown(1);
    else if (cfg.mode === "coexist") await coexist(cfg.rounds || 5);
    else if (cfg.mode === "bench") await bench(cfg.warm || 20);
    else throw new Error("unknown mode " + cfg.mode);
    out.conclusion = out.conclusion || "completed";
  } catch (e) {
    out.errors.push(String((e && e.message) || e).slice(0, 500));
    out.conclusion = "failed: " + String((e && e.message) || e).slice(0, 200);
  }
  out.network = globalThis.__qg03.network.map((n) => ({ kind: n.kind, origin: n.origin, foreign: n.foreign, path: n.url.replace(/^[a-z-]+:\/\/[^/]+/, "").slice(0, 80) }));
  out.gpu = globalThis.__qg03.gpu;
  out.selfOrigin = globalThis.__qg03.selfOrigin;
  return out;

  // ── one cell launch (protocol §4.2) ───────────────────────────────────────────────────────
  async function cell() {
    const bytes = await loadModel(R.model);
    const { session, ms } = await create(bytes);
    out.sessionCreated = true;
    out.coldLoadMs = ms;
    out.outputNames = session.outputNames;
    snap("after-create");
    const devIn = await loadInput("dev");
    const shape = R.inputs.dev.shape;
    let t = now();
    const first = await session.run(feeds(session, devIn, shape));
    out.coldInferenceMs = now() - t;
    snap("after-first-inference");
    const outputs = {};
    const record = async (name, res, ms2) => {
      const y = res[session.outputNames[0]];
      const data = new Float32Array(y.data);
      const stats = L.tensorStats(data);
      outputs[name] = { data, dims: y.dims };
      return {
        dims: y.dims,
        outputCount: session.outputNames.length,
        types: session.outputNames.map((o) => ({ name: o, type: res[o].type })),
        stats: { count: stats.count, min: stats.min, max: stats.max, sumAbs: stats.sumAbs },
        // S-04a-1's rule on the (single) output: exact element count and relative sumAbs.
        judge: L.judgeWasm({ count: stats.count, sumAbs: stats.sumAbs }, { count: R.inputs[name].native.count, sumAbs: R.inputs[name].native.sumAbs }),
        outputCountEqual: session.outputNames.length === R.inputs[name].native.outputs,
        outputSha256: await sha256Hex(new Uint8Array(data.buffer)),
        inferenceMs: ms2,
      };
    };
    out.inputs = { dev: await record("dev", first, out.coldInferenceMs) };
    out.warmMs = [];
    for (let i = 0; i < (cfg.warm || 10); i++) {
      t = now();
      await session.run(feeds(session, devIn, shape));
      out.warmMs.push(now() - t);
    }
    for (const name of R.heldOut) {
      const x = await loadInput(name);
      t = now();
      const res = await session.run(feeds(session, x, R.inputs[name].shape));
      out.inputs[name] = await record(name, res, now() - t);
    }
    const det = [];
    for (let i = 0; i < 3; i++) {
      const res = await session.run(feeds(session, devIn, shape));
      det.push(await sha256Hex(new Uint8Array(new Float32Array(res[session.outputNames[0]].data).buffer)));
    }
    out.determinism = { runs: det.length + 1, identical: det.every((d) => d === out.inputs.dev.outputSha256) };
    const synth = await loadInput("synthetic");
    const sres = await session.run(feeds(session, synth, R.inputs.synthetic.shape));
    out.inputs.synthetic = await record("synthetic", sres, null);
    delete outputs.synthetic;
    snap("after-all-inference");
    // the M8.1 post-processing, verbatim, on this context's own outputs
    out.boxes = {};
    out.postprocessMs = {};
    for (const [name, o] of Object.entries(outputs)) {
      const m = R.inputs[name].meta;
      const [, , H, W] = o.dims;
      t = now();
      const res = L.dbPostprocess(o.data, H, W, m.ratio_h, m.ratio_w, m.source_hw[0], m.source_hw[1]);
      out.postprocessMs[name] = now() - t;
      out.boxes[name] = res.boxes;
      out.inputs[name].boxesSha256 = await shaText(JSON.stringify(res.boxes));
    }
    await session.release();
    out.released = true;
    snap("after-release");
  }

  // ── teardown (protocol §5) ─────────────────────────────────────────────────────────────────
  async function teardown(cycles) {
    const bytes = await loadModel(R.model);
    const devIn = await loadInput("dev");
    out.cycles = [];
    for (let c = 0; c < cycles; c++) {
      const g0 = globalThis.__qg03.wasmGrows.length;
      const rec = { cycle: c + 1, ok: false };
      try {
        const { session, ms } = await create(bytes);
        rec.createMs = ms;
        rec.afterCreate = snap(`cycle${c + 1}-after-create`).wasm;
        const t = now();
        const res = await session.run(feeds(session, devIn, R.inputs.dev.shape));
        rec.inferenceMs = now() - t;
        rec.outputSha256 = await sha256Hex(new Uint8Array(new Float32Array(res[session.outputNames[0]].data).buffer));
        rec.afterInference = snap(`cycle${c + 1}-after-inference`).wasm;
        await session.release();
        rec.afterRelease = snap(`cycle${c + 1}-after-release`).wasm;
        rec.ok = true;
      } catch (e) {
        rec.error = String((e && e.message) || e).slice(0, 300);
      }
      rec.grows = globalThis.__qg03.wasmGrows.length - g0;
      out.cycles.push(rec);
    }
  }

  // ── coexistence (protocol §6) ──────────────────────────────────────────────────────────────
  async function coexist(rounds) {
    const specs = { uiHead: R.uiHead, yunet: R.yunet, candidate: R.model };
    const bytes = {};
    for (const [k, s] of Object.entries(specs)) bytes[k] = await loadModel(s);
    const inputs = { candidate: await loadInput("dev"), uiHead: synthetic640(), yunet: synthetic640() };
    const shapes = { candidate: R.inputs.dev.shape, uiHead: [1, 3, 640, 640], yunet: [1, 3, 640, 640] };
    const runOne = async (k, s) => {
      const t = now();
      const res = await s.run(feeds(s, inputs[k], shapes[k]));
      return { ms: now() - t, sha: await hashOutputs(s, res), res };
    };
    out.solo = {};
    out.soloMs = {};
    for (const k of ["candidate", "uiHead", "yunet"]) {
      const { session } = await create(bytes[k]);
      const r = await runOne(k, session);
      out.solo[k] = r.sha;
      out.soloMs[k] = r.ms;
      await session.release();
    }
    snap("after-solo");
    out.created = {};
    out.createMs = {};
    const live = {};
    for (const k of ["uiHead", "yunet", "candidate"]) {
      try {
        const c = await create(bytes[k]);
        live[k] = c.session;
        out.created[k] = true;
        out.createMs[k] = c.ms;
      } catch (e) {
        out.created[k] = false;
        out.errors.push(k + " create: " + String((e && e.message) || e).slice(0, 200));
      }
    }
    snap("after-coexist-create");
    out.rounds = [];
    out.roundMs = [];
    const P = await import(base + "perception/index.js");
    for (let i = 0; i < rounds; i++) {
      const row = {};
      const ms = {};
      const t = now();
      for (const k of ["uiHead", "yunet", "candidate"]) {
        if (!live[k]) continue;
        const r = await runOne(k, live[k]);
        row[k] = r.sha;
        ms[k] = r.ms;
        if (i === 0 && k === "uiHead") {
          const y = r.res[live[k].outputNames[0]];
          const d = P.decodeHeadOutput({ data: y.data, dims: y.dims });
          out.uiHeadShippedDecode = { ok: d.ok, detections: d.ok ? d.value.length : null };
        }
      }
      ms.round = now() - t;
      out.rounds.push(row);
      out.roundMs.push(ms);
    }
    snap("after-coexist-rounds");
    for (const k of Object.keys(live)) await live[k].release();
    snap("after-release-all");
    out.recreated = {};
    for (const k of ["uiHead", "yunet", "candidate"]) {
      try {
        live[k] = (await create(bytes[k])).session;
        out.recreated[k] = true;
      } catch (e) {
        out.recreated[k] = false;
        out.errors.push(k + " recreate: " + String((e && e.message) || e).slice(0, 200));
      }
    }
    const row = {};
    for (const k of ["uiHead", "yunet", "candidate"]) if (live[k]) row[k] = (await runOne(k, live[k])).sha;
    out.rounds.push(row);
    for (const k of Object.keys(live)) await live[k].release();
    snap("after-final-release");
  }

  // ── controlled benchmark (protocol §7) ─────────────────────────────────────────────────────
  async function bench(warm) {
    const png = await fetchBytes("fixtures/dev.png");
    const py = await loadInput("dev");
    const [, , oh, ow] = R.inputs.dev.shape;
    out.preprocess = [];
    let jsTensor = null;
    for (let rep = 0; rep < 6; rep++) {
      const t0 = now();
      const bmp = await createImageBitmap(new Blob([png], { type: "image/png" }));
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0);
      const rgba = cx.getImageData(0, 0, bmp.width, bmp.height).data;
      const t1 = now();
      const size = globalThis.M82_PREPROCESS.targetSize(R.preprocessRule, bmp.height, bmp.width);
      jsTensor = globalThis.M82_PREPROCESS.resizeNormalise(rgba, bmp.height, bmp.width, size[0], size[1]);
      const t2 = now();
      out.preprocess.push({ decodeMs: t1 - t0, resizeNormaliseMs: t2 - t1, size });
      bmp.close && bmp.close();
    }
    let maxAbs = 0;
    for (let i = 0; i < Math.min(jsTensor.length, py.length); i++) maxAbs = Math.max(maxAbs, Math.abs(jsTensor[i] - py[i]));
    out.preprocessParity = { sameLength: jsTensor.length === py.length, sizeMatches: out.preprocess[0].size[0] === oh && out.preprocess[0].size[1] === ow, maxAbsVsPython: maxAbs };

    const cand = await create(await loadModel(R.model));
    out.coldLoadMs = cand.ms;
    const ui = await create(await loadModel(R.uiHead));
    out.uiHeadLoadMs = ui.ms;
    snap("after-create");
    const uiIn = synthetic640();
    let t = now();
    let res = await cand.session.run(feeds(cand.session, py, R.inputs.dev.shape));
    out.coldInferenceMs = now() - t;
    out.warmMs = [];
    out.controlMs = [];
    let lastOut = null;
    for (let i = 0; i < warm; i++) {
      t = now();
      res = await cand.session.run(feeds(cand.session, py, R.inputs.dev.shape));
      out.warmMs.push(now() - t);
      lastOut = res[cand.session.outputNames[0]];
      t = now();
      await ui.session.run(feeds(ui.session, uiIn, [1, 3, 640, 640]));
      out.controlMs.push(now() - t);
    }
    snap("after-inference");
    const data = new Float32Array(lastOut.data);
    const m = R.inputs.dev.meta;
    out.postprocessMs = [];
    let boxes = null;
    for (let i = 0; i < 5; i++) {
      t = now();
      boxes = L.dbPostprocess(data, lastOut.dims[2], lastOut.dims[3], m.ratio_h, m.ratio_w, m.source_hw[0], m.source_hw[1]).boxes;
      out.postprocessMs.push(now() - t);
    }
    out.outputSha256 = await sha256Hex(new Uint8Array(data.buffer));
    out.boxesSha256 = await shaText(JSON.stringify(boxes));
    await cand.session.release();
    await ui.session.release();
    snap("after-release");
  }
};
