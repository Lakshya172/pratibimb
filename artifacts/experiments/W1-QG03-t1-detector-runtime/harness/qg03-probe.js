/**
 * QG-03 — does the ACTUAL trained T1 detector artifact execute correctly in a browser?
 *
 * S-03 answered "can an ORT Web session be created and run" with a 174-byte, two-op
 * synthetic model, and said so explicitly: it did NOT satisfy QG-03, and follow-up S-03c
 * was recorded as "repeat with a real detector before any latency figure is quoted". This
 * is S-03c. The model here is the real 302,960-byte artifact the training pipeline
 * produced, at revision ba6d9e93695b, and nothing else is substituted for it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * PYTHON CORRECTNESS IS NOT BROWSER CORRECTNESS
 *
 * The artifact already agrees with its torch source in eval mode. That says the export is
 * faithful. It says nothing about whether ORT Web's WASM SIMD kernels or its JSEP WebGPU
 * shaders compute the same convolution, and a detector that is subtly wrong in the browser
 * is worse than one that fails there, because it produces confident boxes nobody checks.
 *
 * So every claim below is a browser measurement compared against a reference produced
 * elsewhere, under conditions recorded in reference-summary.json.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS RUNS, AND WHY IT IS NOT A RE-IMPLEMENTATION
 *
 * Postprocessing is performed by the SHIPPED compiled package, imported from
 * ./perception/index.js — the same files the extension would ship. A harness that
 * re-implements decode and NMS tests the re-implementation, and the whole point of the
 * coordinate chain is that ONE implementation is correct everywhere.
 *
 * The ORT session is created through ADR-0001's own path: installVerifiedOrtRuntime()
 * hashes the packaged .wasm before ORT is touched, and createPinnedInferenceSession() is
 * the only sanctioned constructor. The detector's own weights are inlined as base64, so
 * the model itself performs ZERO fetches and "no runtime model download" is observable
 * rather than asserted.
 *
 * Throwaway spike code. Never shipped.
 */
globalThis.runQg03Probe = async function runQg03Probe(contextName, opts) {
  opts = opts || {};
  const F = globalThis.QG03_FIXTURES;
  const backend = opts.backend || "wasm";
  const base = opts.base || "";
  const warmRuns = opts.warmRuns === undefined ? 30 : opts.warmRuns;
  const determinismRuns = opts.determinismRuns === undefined ? 3 : opts.determinismRuns;
  const SIZE = 640;

  const out = {
    context: contextName,
    probe: "qg03-t1-detector",
    requestedBackend: backend,
    startedAt: new Date().toISOString(),
    globalKind:
      typeof window !== "undefined" ? "window" : typeof WorkerGlobalScope !== "undefined" ? "worker" : "unknown",
    userAgent: (globalThis.navigator && navigator.userAgent) || null,
    ortVersion: null,
    model: { sha256Declared: F.model.sha256, bytesDeclared: F.model.bytes, sha256Observed: null, bytesObserved: null },
    pin: null,
    sessionCreated: false,
    schema: null,
    memory: { snapshots: [] },
    latency: {},
    cases: [],
    determinism: null,
    gpu: null,
    network: null,
    backendEvidence: null,
    error: null,
    conclusion: null,
  };

  const snap = (label) => {
    const s = globalThis.__qg03_snapshot(label);
    out.memory.snapshots.push(s);
    return s;
  };

  // ---- helpers -------------------------------------------------------------------
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  async function sha256Hex(buf) {
    const d = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(d))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  /**
   * The synthetic input, rebuilt from the formula rather than transferred.
   *
   * ((i * 37) % 255) / 255 is integer arithmetic over a power-of-two-friendly denominator,
   * so the double that JavaScript computes and the float64 numpy computes round to the
   * SAME float32. Its SHA-256 is checked against the reference below, which turns that
   * reasoning into a measurement.
   */
  function synthInput() {
    const n = 3 * SIZE * SIZE;
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = ((i * 37) % 255) / 255;
    return a;
  }
  /** uint8 HWC RGB -> float32 NCHW /255, matching tools/detector/data.py exactly. */
  function u8HwcToNchw(u8) {
    const a = new Float32Array(3 * SIZE * SIZE);
    const plane = SIZE * SIZE;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const src = (y * SIZE + x) * 3;
        const dst = y * SIZE + x;
        a[dst] = u8[src] / 255;
        a[plane + dst] = u8[src + 1] / 255;
        a[2 * plane + dst] = u8[src + 2] / 255;
      }
    }
    return a;
  }
  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const round1 = (v) => Math.round(v * 10) / 10;

  try {
    if (typeof ort === "undefined") {
      out.conclusion = "ORT Web global not present in this context";
      return out;
    }
    out.ortVersion = (ort.env && ort.env.versions && ort.env.versions.common) || ort.version || "unknown";
    ort.env.logLevel = "error";
    if (backend === "wasm") ort.env.wasm.numThreads = 1;

    snap("baseline-before-anything");

    // ---- ADR-0001: the runtime pin, installed before any session exists ------------
    // Not re-implemented here. This is the shipped @pratibimb/security module, so a change
    // that broke the pin would break this harness too — which is the correct coupling.
    const SEC = await import(base + "security/index.js");
    const P = await import(base + "perception/index.js");
    try {
      const installed = await SEC.installVerifiedOrtRuntime({
        ort,
        resolveAssetUrl: (name) => base + name,
      });
      out.pin = { installed: true, artifact: installed.artifact, sha256: installed.sha256, bytes: installed.bytes };
    } catch (e) {
      out.pin = { installed: false, code: (e && e.code) || null, message: String((e && e.message) || e).slice(0, 400) };
      out.conclusion = "ADR-0001 runtime pin refused: " + ((e && e.message) || e);
      return out;
    }

    // ---- the model bytes, inlined: zero fetches for the weights --------------------
    const modelBytes = b64ToBytes(F.model.b64);
    out.model.bytesObserved = modelBytes.byteLength;
    out.model.sha256Observed = await sha256Hex(modelBytes.buffer.slice(0));
    if (out.model.sha256Observed !== F.model.sha256 || modelBytes.byteLength !== F.model.bytes) {
      out.conclusion =
        "REFUSED: the model bytes present in this extension are not the artifact the " +
        "reference describes. Benchmarking a different file than the evidence names is " +
        "how a matrix becomes fiction.";
      return out;
    }

    // ---- session creation ----------------------------------------------------------
    const t0 = performance.now();
    const session = await SEC.createPinnedInferenceSession(ort, modelBytes, {
      executionProviders: [backend],
      graphOptimizationLevel: "all",
    });
    out.latency.sessionCreateMs = round1(performance.now() - t0);
    out.sessionCreated = true;
    snap("after-session-create");

    out.schema = {
      inputNames: session.inputNames,
      outputNames: session.outputNames,
      inputName: session.inputNames[0],
      outputName: session.outputNames[0],
    };

    // ---- correctness, case by case -------------------------------------------------
    const refByName = new Map(F.reference.cases.map((c) => [c.name, c]));
    const feedsFor = (arr) => {
      const f = {};
      f[session.inputNames[0]] = new ort.Tensor("float32", arr, [1, 3, SIZE, SIZE]);
      return f;
    };

    let firstInferenceMs = null;
    const primaryOutputs = [];

    for (const name of opts.cases || F.reference.cases.map((c) => c.name)) {
      const ref = refByName.get(name);
      if (!ref) continue;
      const rec = { name, kind: ref.kind };

      // build the input
      let input;
      if (name === "synth") input = synthInput();
      else input = u8HwcToNchw(b64ToBytes(F.letterboxed[name]));

      rec.inputSha256 = await sha256Hex(input.buffer.slice(0));
      rec.inputMatchesReference = rec.inputSha256 === ref.inputSha256;
      if (!rec.inputMatchesReference) {
        // Everything downstream would be a comparison of two different questions.
        rec.skipped = "input tensor differs from the reference input; correctness not evaluated";
        out.cases.push(rec);
        continue;
      }

      const gpuBefore = globalThis.__qg03.gpu.submits;
      const t = performance.now();
      const res = await session.run(feedsFor(input));
      const ms = round1(performance.now() - t);
      if (firstInferenceMs === null) {
        firstInferenceMs = ms;
        out.latency.firstInferenceMs = ms;
        snap("after-first-inference");
      }
      rec.inferenceMs = ms;
      rec.gpuSubmitsDuringRun = globalThis.__qg03.gpu.submits - gpuBefore;

      const tensor = res[session.outputNames[0]];
      rec.outputDims = tensor.dims;
      rec.outputType = tensor.type;
      const got = tensor.data;
      const expected = new Float32Array(b64ToBytes(F.expected[name]).buffer);

      rec.shapeMatches =
        tensor.dims.length === ref.outputShape.length && tensor.dims.every((d, i) => d === ref.outputShape[i]);
      rec.declaredOutputShape = ref.outputShape;

      if (!rec.shapeMatches || got.length !== expected.length) {
        rec.correct = false;
        rec.reason = "output shape or length disagrees with the reference";
        out.cases.push(rec);
        continue;
      }

      // Box and class channels are compared SEPARATELY. They live on different scales —
      // box channels are model pixels up to ~640, class channels are sigmoid outputs in
      // 0..1 — so a single max-abs number over the whole tensor would be the box error
      // wearing a label that claims to cover both.
      const anchors = tensor.dims[2];
      let boxMax = 0;
      let clsMax = 0;
      let nonFinite = 0;
      let boxAt = -1;
      let clsAt = -1;
      for (let i = 0; i < got.length; i++) {
        const g = got[i];
        if (!Number.isFinite(g)) {
          nonFinite++;
          continue;
        }
        const d = Math.abs(g - expected[i]);
        if (i < 4 * anchors) {
          if (d > boxMax) {
            boxMax = d;
            boxAt = i;
          }
        } else if (d > clsMax) {
          clsMax = d;
          clsAt = i;
        }
      }
      rec.diff = {
        boxChannelsMaxAbs: boxMax,
        classChannelsMaxAbs: clsMax,
        nonFinite,
        worstBoxIndex: boxAt,
        worstClassIndex: clsAt,
      };
      const crit = F.reference.criterion;
      rec.correct =
        nonFinite === 0 && boxMax <= crit.boxChannelsMaxAbs && clsMax <= crit.classChannelsMaxAbs;
      rec.criterion = { boxChannelsMaxAbs: crit.boxChannelsMaxAbs, classChannelsMaxAbs: crit.classChannelsMaxAbs };

      // ---- the shipped decode, the shipped letterbox, the shipped coordinate chain ----
      // Run through createUiElementDetector so the TYPED contract is exercised, not just
      // the arithmetic: a Detection that fails validateDetections never becomes a box.
      const geom = {
        dpr: ref.geometry.capture.w / ref.geometry.viewportCss.w,
        zoom: 1,
        viewportCss: ref.geometry.viewportCss,
        captureSize: ref.geometry.capture,
        scroll: { x: 0, y: 0 },
        origin: "https://qg03.invalid",
      };
      const frame = {
        id: P.frameId("qg03-" + name),
        capturedAt: Date.now(),
        pixels: new Uint8Array(0), // preprocess is injected, so no decode is needed here
        format: "png",
        geometry: geom,
      };
      const detector = P.createUiElementDetector({
        infer: async () => ({ data: got, dims: tensor.dims }),
        preprocess: async () => input,
        modelId: F.model.modelId,
        revision: F.model.revision,
        // The cell under measurement is declared accepted ONLY for this harness run.
        // Nothing here writes to the registry; adoption is a separate decision.
        acceptedBackends: [backend],
      });
      const detected = await detector.detect(frame, backend);
      rec.detectorContract = { ok: detected.ok, code: detected.ok ? null : detected.code };

      if (detected.ok) {
        // validateDetections takes the FLAT, untrusted shape a runtime adapter emits —
        // {x, y, w, h, score, label} in capture pixels — not an already-branded Detection.
        // Feeding it Detection objects would make it refuse on the wrong grounds and turn
        // a real bounds check into a shape mismatch that always fails.
        const flat = detected.value.map((d) => ({
          x: d.box.x, y: d.box.y, w: d.box.w, h: d.box.h, score: d.score, label: d.label,
        }));
        const validated = P.validateDetections(flat, frame);
        rec.detectionsValid = validated.ok;
        rec.detectionsInvalidReason = validated.ok ? null : validated.code + ": " + validated.detail;
        const visual = P.toVisualDetections(detected.value, frame, detector);
        rec.detectionCount = visual.length;
        rec.provenance = {
          allCarryFrameId: visual.every((v) => v.frameId === frame.id),
          allCarryModelId: visual.every((v) => v.modelId === F.model.modelId),
          allCarryRevision: visual.every((v) => v.revision === F.model.revision),
          roles: Array.from(new Set(visual.map((v) => v.role))),
        };
        rec.boundsValid = visual.every(
          (v) =>
            Number.isFinite(v.box.x) &&
            Number.isFinite(v.box.y) &&
            v.box.w > 0 &&
            v.box.h > 0 &&
            v.score > 0 &&
            v.score <= 1 &&
            P.UI_CLASSES.includes(v.label)
        );

        // Compare the CSS boxes against the reference's, pairwise in emitted order. NMS is
        // deterministic on both sides, so order is part of the contract, not an accident.
        const refBoxes = ref.shippedDecode.cssBoxes;
        rec.referenceDetectionCount = refBoxes.length;
        rec.countMatches = refBoxes.length === visual.length;
        let worstCoord = 0;
        let worstScore = 0;
        let labelMismatches = 0;
        for (let i = 0; i < Math.min(refBoxes.length, visual.length); i++) {
          const a = refBoxes[i];
          const b = visual[i];
          if (a.label !== b.label) labelMismatches++;
          worstCoord = Math.max(
            worstCoord,
            Math.abs(a.box[0] - b.box.x),
            Math.abs(a.box[1] - b.box.y),
            Math.abs(a.box[2] - b.box.w),
            Math.abs(a.box[3] - b.box.h)
          );
          worstScore = Math.max(worstScore, Math.abs(a.score - b.score));
        }
        rec.boxAgreement = {
          worstCssCoordinateDeltaPx: worstCoord,
          worstScoreDelta: worstScore,
          labelMismatches,
        };
        rec.postprocessingAgrees =
          rec.countMatches && labelMismatches === 0 && worstCoord <= 1.0 && worstScore <= 1e-3;
        rec.sampleBoxes = visual.slice(0, 3).map((v) => ({
          label: v.label,
          score: Math.round(v.score * 1e6) / 1e6,
          css: [
            Math.round(v.box.x * 100) / 100,
            Math.round(v.box.y * 100) / 100,
            Math.round(v.box.w * 100) / 100,
            Math.round(v.box.h * 100) / 100,
          ],
        }));
      }

      if (name === "synth") primaryOutputs.push(new Float32Array(got));
      out.cases.push(rec);
    }

    // ---- preprocessing parity: the browser's own letterbox vs the trainer's ---------
    //
    // In production NOTHING hands the browser a pre-letterboxed tensor. It receives a PNG
    // from captureVisibleTab and must letterbox it itself, with canvas resampling rather
    // than PIL's. That difference is invisible to every check above, because every check
    // above deliberately fed both sides identical pixels in order to isolate ORT.
    //
    // It is measured here rather than assumed away, and it is measured in TWO variants,
    // because the project has two letterboxes that do not quite agree:
    //
    //   float    computeLetterbox() in the shipped package places content at a FRACTIONAL
    //            offset: padY = (640 - h*scale) / 2.
    //   integer  letterbox_image() in tools/detector/data.py pastes a rounded bitmap at an
    //            INTEGER offset: (640 - round(h*scale)) // 2.
    //
    // For a 960x640 capture that is padY 106.67 against 106 — a sub-pixel disagreement
    // between the pixels the model was TRAINED on and the coordinates its labels were
    // expressed in. Sub-pixel is not zero, and it is exactly the class of thing that never
    // shows up in a metric computed at IoU 0.5.
    out.preprocessingParity = [];
    for (const ref of F.reference.cases) {
      if (!ref.sampleId || !F.png[ref.name]) continue;
      const rec = { name: ref.name, sampleId: ref.sampleId };
      try {
        const bmp = await createImageBitmap(new Blob([b64ToBytes(F.png[ref.name])], { type: "image/png" }));
        rec.decoded = { w: bmp.width, h: bmp.height };
        const t = P.computeLetterbox(ref.geometry.capture, 640);
        rec.transform = { scale: t.scale, padX: t.padX, padY: t.padY };

        const draw = (mode, quality) => {
          const canvas =
            typeof OffscreenCanvas === "function"
              ? new OffscreenCanvas(SIZE, SIZE)
              : Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          // imageSmoothingQuality is the browser's OWN better option, and reporting that
          // canvas cannot match PIL without trying it would be an unfair comparison.
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = quality;
          ctx.fillStyle = "rgb(114,114,114)";
          ctx.fillRect(0, 0, SIZE, SIZE);
          if (mode === "float") {
            ctx.drawImage(bmp, t.padX, t.padY, t.contentSize.w, t.contentSize.h);
          } else {
            const nw = Math.max(1, Math.round(bmp.width * t.scale));
            const nh = Math.max(1, Math.round(bmp.height * t.scale));
            ctx.drawImage(bmp, Math.floor((SIZE - nw) / 2), Math.floor((SIZE - nh) / 2), nw, nh);
          }
          const img = ctx.getImageData(0, 0, SIZE, SIZE).data; // RGBA
          const a = new Float32Array(3 * SIZE * SIZE);
          const plane = SIZE * SIZE;
          for (let i = 0, px = 0; px < plane; px++, i += 4) {
            a[px] = img[i] / 255;
            a[plane + px] = img[i + 1] / 255;
            a[2 * plane + px] = img[i + 2] / 255;
          }
          return a;
        };

        const iou = (a, b) => {
          const x1 = Math.max(a[0], b[0]);
          const y1 = Math.max(a[1], b[1]);
          const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
          const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
          if (x2 <= x1 || y2 <= y1) return 0;
          const inter = (x2 - x1) * (y2 - y1);
          return inter / (a[2] * a[3] + b[2] * b[3] - inter);
        };
        const trainerTensor = u8HwcToNchw(b64ToBytes(F.letterboxed[ref.name]));
        const variants = [
          ["float", "low"], ["float", "high"], ["integer", "low"], ["integer", "high"],
        ];
        rec.variants = {};
        for (const [mode, quality] of variants) {
          const key = mode + "-" + quality;
          const got = draw(mode, quality);
          let maxAbs = 0;
          let sumAbs = 0;
          let differing = 0;
          for (let i = 0; i < got.length; i++) {
            const d = Math.abs(got[i] - trainerTensor[i]);
            if (d > 0) differing++;
            if (d > maxAbs) maxAbs = d;
            sumAbs += d;
          }
          const v = {
            mode,
            quality,
            // In 0..255 terms, which is the unit anyone reasoning about resampling thinks in.
            maxAbsDiff255: maxAbs * 255,
            meanAbsDiff255: (sumAbs / got.length) * 255,
            differingFraction: differing / got.length,
          };

          // Pixel divergence only matters if it changes what the detector SAYS. Every
          // variant is run through inference, because a variant with a worse mean error
          // can still produce better detections and picking on pixel error alone would
          // optimise the wrong quantity.
          const rv = await session.run(feedsFor(got));
          const tv = rv[session.outputNames[0]];
          const dv = P.decodeHeadOutput({ data: tv.data, dims: tv.dims });
          if (dv.ok) {
            const projected = P.projectToCapture(dv.value, t);
            const cssScale = ref.geometry.viewportCss.w / ref.geometry.capture.w;
            const boxes = projected.map((d) => ({
              label: d.label,
              box: [d.box.x * cssScale, d.box.y * cssScale, d.box.w * cssScale, d.box.h * cssScale],
            }));
            const refBoxes = ref.shippedDecode.cssBoxes;
            let matched = 0;
            const used = new Set();
            for (const rb of refBoxes) {
              let bestJ = -1;
              let bestI = 0.5;
              for (let j = 0; j < boxes.length; j++) {
                if (used.has(j) || boxes[j].label !== rb.label) continue;
                const iv = iou(rb.box, boxes[j].box);
                if (iv >= bestI) { bestI = iv; bestJ = j; }
              }
              if (bestJ >= 0) { used.add(bestJ); matched++; }
            }
            v.detections = boxes.length;
            v.referenceDetections = refBoxes.length;
            v.matchedAtIou50 = matched;
            v.agreementRate = refBoxes.length ? matched / refBoxes.length : null;
          } else {
            v.decodeRefused = dv.code;
          }
          rec.variants[key] = v;
        }

        bmp.close && bmp.close();
      } catch (e) {
        rec.error = String((e && e.message) || e).slice(0, 300);
      }
      out.preprocessingParity.push(rec);
    }

    // ---- determinism: repeated identical calls must be BITWISE identical ------------
    const synth = synthInput();
    const detFeeds = feedsFor(synth);
    const runs = [];
    for (let k = 0; k < determinismRuns; k++) {
      const r = await session.run(detFeeds);
      runs.push(new Float32Array(r[session.outputNames[0]].data));
    }
    let firstDiffIndex = -1;
    let identical = true;
    for (let k = 1; k < runs.length && identical; k++) {
      const a = new Uint8Array(runs[0].buffer);
      const b = new Uint8Array(runs[k].buffer);
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          identical = false;
          firstDiffIndex = i;
          break;
        }
      }
    }
    out.determinism = {
      runs: runs.length,
      bitwiseIdentical: identical,
      firstDifferingByte: firstDiffIndex,
      note: "bitwise, not within-tolerance. A detector whose output moves between identical calls cannot be regression-tested.",
    };

    // ---- latency: cold and warm kept apart -----------------------------------------
    const warm = [];
    const gpuBeforeWarm = globalThis.__qg03.gpu.submits;
    for (let k = 0; k < warmRuns; k++) {
      const t = performance.now();
      await session.run(detFeeds);
      warm.push(performance.now() - t);
    }
    const gpuDuringWarm = globalThis.__qg03.gpu.submits - gpuBeforeWarm;
    const sorted = warm.slice().sort((a, b) => a - b);
    out.latency.warm = {
      runs: warm.length,
      p50: round1(pct(sorted, 50)),
      p95: warm.length >= 20 ? round1(pct(sorted, 95)) : null,
      p95Suppressed: warm.length >= 20 ? null : "fewer than 20 samples — p95 would be a single observation wearing a percentile's name",
      min: round1(sorted[0]),
      max: round1(sorted[sorted.length - 1]),
      mean: round1(warm.reduce((a, b) => a + b, 0) / warm.length),
    };
    out.latency.input = "the synthetic deterministic tensor — identical work every run, so the spread is the runtime's, not the input's";
    snap("steady-state-after-warm");

    // ---- backend identity, observed rather than configured --------------------------
    out.gpu = {
      navigatorGpuPresent: !!(globalThis.navigator && navigator.gpu),
      submitsTotal: globalThis.__qg03.gpu.submits,
      submitsDuringWarmRuns: gpuDuringWarm,
      computePipelinesCreated: globalThis.__qg03.gpu.computePipelines,
      adaptersReturned: globalThis.__qg03.gpu.devices,
      adapterInfo: globalThis.__qg03.gpu.adapterInfo,
      hookError: globalThis.__qg03.gpu.hookError,
    };
    out.backendEvidence = {
      requested: backend,
      gpuSubmitsDuringInference: gpuDuringWarm,
      executedOnGpu: gpuDuringWarm > 0,
      verdict:
        backend === "webgpu"
          ? gpuDuringWarm > 0
            ? "CONFIRMED — GPU command submissions observed during inference"
            : "NOT CONFIRMED — zero GPU submissions during inference; ORT reported webgpu but the GPU did no work"
          : gpuDuringWarm > 0
            ? "UNEXPECTED — GPU submissions during a wasm-configured session"
            : "CONSISTENT — no GPU submissions, as expected for wasm",
      method:
        "GPUQueue.prototype.submit counted, wrapped before ORT loaded. Configuration is not execution.",
    };

    // ---- network: arrivals, not intent ----------------------------------------------
    const net = globalThis.__qg03.network;
    out.network = {
      selfOrigin: globalThis.__qg03.selfOrigin,
      total: net.length,
      foreign: net.filter((n) => n.foreign).length,
      foreignUrls: net.filter((n) => n.foreign).map((n) => n.url),
      byKind: net.reduce((acc, n) => {
        acc[n.kind] = (acc[n.kind] || 0) + 1;
        return acc;
      }, {}),
      urls: net.map((n) => n.url.replace(/^chrome-extension:\/\/[a-z]+\//, "<ext>/").replace(/^moz-extension:\/\/[0-9a-f-]+\//, "<ext>/")),
      modelFetched: net.some((n) => /\.onnx/i.test(n.url)),
      hookErrors: globalThis.__qg03.hookErrors,
    };

    // ---- teardown -------------------------------------------------------------------
    const t2 = performance.now();
    if (typeof session.release === "function") await session.release();
    out.latency.releaseMs = round1(performance.now() - t2);
    out.released = true;
    snap("after-release");

    const allCorrect = out.cases.length > 0 && out.cases.every((c) => c.correct === true);
    const allPost = out.cases.every((c) => c.postprocessingAgrees !== false);
    out.conclusion =
      (allCorrect ? "correct" : "INCORRECT") +
      " on " +
      backend +
      "; postprocessing " +
      (allPost ? "agrees" : "DISAGREES") +
      "; determinism " +
      (identical ? "bitwise" : "NOT BITWISE");
  } catch (e) {
    out.error = {
      name: (e && e.name) || null,
      message: String((e && e.message) || e).slice(0, 500),
      stack: e && e.stack ? String(e.stack).slice(0, 400) : null,
    };
    out.conclusion = "threw: " + String((e && e.message) || e).slice(0, 200);
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
