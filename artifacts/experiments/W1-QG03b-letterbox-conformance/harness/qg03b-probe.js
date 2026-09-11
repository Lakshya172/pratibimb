/**
 * QG-03b — does the BROWSER produce the same tensor as the Python reference, stage by stage?
 *
 * QG-03 established that the two disagreed and that 16–34% of detections changed as a
 * result. It compared final tensors and final boxes, so it could not say WHERE the
 * divergence began — a decode difference, a resize difference and a padding difference are
 * indistinguishable at the end.
 *
 * This compares FOUR STAGES in order and reports the FIRST that diverges:
 *
 *   decoded      browser PNG decode   vs  PIL decode        -- isolates image decoding
 *   resized      shipped resampler    vs  PIL BILINEAR      -- isolates the kernel
 *   letterboxed  shipped padding      vs  PIL paste         -- isolates placement
 *   tensor       shipped normalise    vs  numpy /255        -- isolates order and scaling
 *
 * Two preprocessing paths are run on the same decoded pixels so the comparison is a
 * controlled one:
 *
 *   CANVAS     the QG-03 path — ctx.drawImage() scaling. Unspecified kernel; Chromium
 *              honours imageSmoothingQuality and Firefox ignores it. Kept as the CONTROL,
 *              because "the new path is better" is only meaningful against the old one
 *              measured on the same machine in the same run.
 *   SHIPPED    preprocessToTensor() from @pratibimb/perception — PIL's algorithm
 *              reimplemented exactly, including its 22-bit fixed-point coefficients.
 *
 * Throwaway spike code. Never shipped. The module under test is.
 */
globalThis.runQg03bProbe = async function runQg03bProbe(contextName, opts) {
  opts = opts || {};
  const F = globalThis.QG03B_FIXTURES;
  const base = opts.base || "";
  const backend = opts.backend || "wasm";

  const out = {
    context: contextName,
    probe: "qg03b-preprocessing-conformance",
    requestedBackend: backend,
    startedAt: new Date().toISOString(),
    userAgent: (globalThis.navigator && navigator.userAgent) || null,
    canvasKind: typeof OffscreenCanvas === "function" ? "OffscreenCanvas" : "HTMLCanvasElement",
    fixtures: [],
    latency: null,
    detection: [],
    summary: null,
    error: null,
  };

  const b64ToBytes = (b64) => {
    const bin = atob(b64);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  };
  const sha256 = async (buf) => {
    const d = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(d))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };
  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const r1 = (v) => Math.round(v * 10) / 10;

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  /**
   * Decode a PNG to RGBA at its NATIVE size.
   *
   * At native size the canvas performs no resampling at all, so whatever comes back is the
   * browser's decoder output and nothing else. Any divergence here is a decode difference
   * and cannot be blamed on the resize.
   */
  async function decodeNative(pngBytes) {
    const bmp = await createImageBitmap(new Blob([pngBytes], { type: "image/png" }));
    const canvas = makeCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    if (bmp.close) bmp.close();
    return { width: img.width, height: img.height, rgba: new Uint8Array(img.data.buffer.slice(0)) };
  }

  /** The QG-03 control path: let the canvas do the scaling. */
  function canvasLetterbox(rgba, w, h, t, quality) {
    const src = makeCanvas(w, h);
    const sctx = src.getContext("2d", { willReadFrequently: true });
    const id = sctx.createImageData(w, h);
    id.data.set(rgba);
    sctx.putImageData(id, 0, 0);

    const S = t.modelSize;
    const dst = makeCanvas(S, S);
    const dctx = dst.getContext("2d", { willReadFrequently: true });
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = quality;
    dctx.fillStyle = "rgb(" + t.padByte + "," + t.padByte + "," + t.padByte + ")";
    dctx.fillRect(0, 0, S, S);
    dctx.drawImage(src, t.padLeft, t.padTop, t.resizedW, t.resizedH);
    const data = dctx.getImageData(0, 0, S, S).data;

    const plane = S * S;
    const rgb = new Uint8Array(plane * 3);
    const tensor = new Float32Array(3 * plane);
    for (let i = 0, p = 0; p < plane; p++, i += 4) {
      rgb[p * 3] = data[i];
      rgb[p * 3 + 1] = data[i + 1];
      rgb[p * 3 + 2] = data[i + 2];
      tensor[p] = data[i] / 255;
      tensor[plane + p] = data[i + 1] / 255;
      tensor[2 * plane + p] = data[i + 2] / 255;
    }
    return { letterboxed: rgb, tensor };
  }

  try {
    const P = await import(base + "perception/index.js");
    const contract = P.HEAD_CONTRACT;

    for (const f of F.fixtures) {
      const rec = { name: f.name, source: f.source, stages: {}, firstDivergence: null };
      try {
        const decoded = await decodeNative(b64ToBytes(F.png[f.name]));
        rec.decodedSize = { w: decoded.width, h: decoded.height };
        rec.decodedSizeMatches = decoded.width === f.source.w && decoded.height === f.source.h;

        const rgb = P.rgbaToRgb(decoded.rgba, decoded.width, decoded.height);
        rec.stages.decoded = (await sha256(rgb.buffer.slice(0))) === f.digests.decoded;

        const t = P.rasterLetterbox(f.source, contract.inputSize, contract.padValue);
        rec.geometryMatches =
          t.resizedW === f.geometry.resizedW &&
          t.resizedH === f.geometry.resizedH &&
          t.padLeft === f.geometry.padLeft &&
          t.padTop === f.geometry.padTop &&
          t.padRight === f.geometry.padRight &&
          t.padBottom === f.geometry.padBottom;

        const got = P.preprocessToTensor(decoded, contract);
        rec.stages.resized = (await sha256(got.resized.buffer.slice(0))) === f.digests.resized;
        rec.stages.letterboxed = (await sha256(got.letterboxed.buffer.slice(0))) === f.digests.letterboxed;
        rec.stages.tensor =
          (await sha256(got.tensor.buffer.slice(0, got.tensor.byteLength))) === f.digests.tensor;

        for (const s of ["decoded", "resized", "letterboxed", "tensor"]) {
          if (!rec.stages[s]) {
            rec.firstDivergence = s;
            break;
          }
        }
        rec.conformant = rec.firstDivergence === null && rec.geometryMatches && rec.decodedSizeMatches;

        // The CONTROL. Same decoded pixels, the old canvas path, both quality settings —
        // so the improvement is measured rather than asserted.
        rec.canvasControl = {};
        for (const q of ["low", "high"]) {
          const c = canvasLetterbox(decoded.rgba, decoded.width, decoded.height, t, q);
          const okLb = (await sha256(c.letterboxed.buffer.slice(0))) === f.digests.letterboxed;
          let maxAbs = 0;
          let differing = 0;
          for (let i = 0; i < c.tensor.length; i++) {
            const d = Math.abs(c.tensor[i] - got.tensor[i]);
            if (d > 0) differing++;
            if (d > maxAbs) maxAbs = d;
          }
          rec.canvasControl[q] = {
            letterboxedMatchesPython: okLb,
            maxAbsDiffVsShipped255: maxAbs * 255,
            differingFractionVsShipped: differing / c.tensor.length,
          };
        }
      } catch (e) {
        rec.error = String((e && e.message) || e).slice(0, 300);
      }
      out.fixtures.push(rec);
    }

    // ---- latency: the lightweight constraint applies to preprocessing too -------------
    // Measured on the largest realistic frame in the set, warm, after a discarded first
    // run. Reported separately from inference because it is a separate cost that the
    // dossier's projected budget folds into "capture + downscale".
    const big = F.fixtures.filter((f) => f.source.w >= 1024).sort((a, b) => b.source.w * b.source.h - a.source.w * a.source.h)[0];
    if (big) {
      const decoded = await decodeNative(b64ToBytes(F.png[big.name]));
      P.preprocessToTensor(decoded, contract); // discard: first call pays JIT warm-up
      const samples = [];
      for (let i = 0; i < 30; i++) {
        const t0 = performance.now();
        P.preprocessToTensor(decoded, contract);
        samples.push(performance.now() - t0);
      }
      const sorted = samples.slice().sort((a, b) => a - b);
      // The decode is timed separately: in production it is paid by captureVisibleTab's
      // consumer either way, and folding it in would overstate what this module costs.
      const dsamples = [];
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        await decodeNative(b64ToBytes(F.png[big.name]));
        dsamples.push(performance.now() - t0);
      }
      const dsorted = dsamples.slice().sort((a, b) => a - b);
      out.latency = {
        fixture: big.name,
        source: big.source,
        preprocessMs: {
          runs: samples.length,
          p50: r1(pct(sorted, 50)),
          p95: r1(pct(sorted, 95)),
          min: r1(sorted[0]),
          max: r1(sorted[sorted.length - 1]),
        },
        pngDecodeMs: { runs: dsorted.length, p50: r1(pct(dsorted, 50)), min: r1(dsorted[0]), max: r1(dsorted[dsorted.length - 1]) },
      };
    }

    // ---- the production question: same PNG, same detections? -------------------------
    // Wrapped separately from the conformance loop above. The Firefox WebGPU headless cell
    // has no GPU adapter (QG-03), so ORT throws there -- and preprocessing conformance is a
    // CPU question that has nothing to do with the backend. Letting an inference failure
    // discard the conformance result would lose the measurement this experiment exists for.
    if (F.model && typeof ort !== "undefined") try {
      const SEC = await import(base + "security/index.js");
      await SEC.installVerifiedOrtRuntime({ ort, resolveAssetUrl: (n) => base + n });
      ort.env.logLevel = "error";
      if (backend === "wasm") ort.env.wasm.numThreads = 1;
      const session = await SEC.createPinnedInferenceSession(ort, b64ToBytes(F.model.b64), {
        executionProviders: [backend],
        graphOptimizationLevel: "all",
      });

      for (const f of F.fixtures) {
        if (!f.referenceBoxes) continue;
        const rec = { name: f.name, sampleId: f.sampleId };
        try {
          const decoded = await decodeNative(b64ToBytes(F.png[f.name]));
          const t = P.rasterLetterbox(f.source, contract.inputSize, contract.padValue);
          // The DECODE and coordinate transform still use the CONTINUOUS letterbox, because
          // that is the space the model's training labels were expressed in and therefore
          // the space its predictions come back in. Mixing the raster transform in here
          // would move every box by the sub-pixel amount §6 of the contract describes.
          const lb = P.computeLetterbox(f.geometryCss.capture, contract.inputSize);

          const runOne = async (tensor) => {
            const feeds = {};
            feeds[session.inputNames[0]] = new ort.Tensor("float32", tensor, [1, 3, contract.inputSize, contract.inputSize]);
            const r = await session.run(feeds);
            const o = r[session.outputNames[0]];
            const dec = P.decodeHeadOutput({ data: o.data, dims: o.dims });
            if (!dec.ok) return { refused: dec.code };
            const proj = P.projectToCapture(dec.value, lb);
            const s = f.geometryCss.viewportCss.w / f.geometryCss.capture.w;
            return {
              boxes: proj.map((d) => ({
                label: d.label,
                score: d.score,
                box: [d.box.x * s, d.box.y * s, d.box.w * s, d.box.h * s],
              })),
            };
          };

          const shipped = await runOne(P.preprocessToTensor(decoded, contract).tensor);
          const control = await runOne(canvasLetterbox(decoded.rgba, decoded.width, decoded.height, t, "high").tensor);

          const iou = (a, b) => {
            const x1 = Math.max(a[0], b[0]);
            const y1 = Math.max(a[1], b[1]);
            const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
            const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
            if (x2 <= x1 || y2 <= y1) return 0;
            const i = (x2 - x1) * (y2 - y1);
            return i / (a[2] * a[3] + b[2] * b[3] - i);
          };
          const agree = (boxes) => {
            if (!boxes) return null;
            const used = new Set();
            let matched = 0;
            let worstCoord = 0;
            let worstScore = 0;
            for (const rb of f.referenceBoxes) {
              let bj = -1;
              let bi = 0.5;
              for (let j = 0; j < boxes.length; j++) {
                if (used.has(j) || boxes[j].label !== rb.label) continue;
                const v = iou(rb.box, boxes[j].box);
                if (v >= bi) {
                  bi = v;
                  bj = j;
                }
              }
              if (bj >= 0) {
                used.add(bj);
                matched++;
                const m = boxes[bj];
                worstCoord = Math.max(
                  worstCoord,
                  Math.abs(rb.box[0] - m.box[0]),
                  Math.abs(rb.box[1] - m.box[1]),
                  Math.abs(rb.box[2] - m.box[2]),
                  Math.abs(rb.box[3] - m.box[3])
                );
                worstScore = Math.max(worstScore, Math.abs(rb.score - m.score));
              }
            }
            return {
              emitted: boxes.length,
              reference: f.referenceBoxes.length,
              matchedAtIou50: matched,
              agreementRate: f.referenceBoxes.length ? matched / f.referenceBoxes.length : null,
              worstCssCoordinateDeltaPx: worstCoord,
              worstScoreDelta: worstScore,
              exactCount: boxes.length === f.referenceBoxes.length,
            };
          };
          rec.shipped = agree(shipped.boxes);
          rec.canvasControlHigh = agree(control.boxes);
        } catch (e) {
          rec.error = String((e && e.message) || e).slice(0, 300);
        }
        out.detection.push(rec);
      }
      if (typeof session.release === "function") await session.release();
    } catch (e) {
      out.detectionError = String((e && e.message) || e).slice(0, 300);
    }

    const conformant = out.fixtures.filter((f) => f.conformant).length;
    out.summary = {
      fixtures: out.fixtures.length,
      conformant,
      nonConformant: out.fixtures.length - conformant,
      firstDivergences: out.fixtures.filter((f) => f.firstDivergence).map((f) => f.name + ":" + f.firstDivergence),
      decodeConformant: out.fixtures.every((f) => f.stages && f.stages.decoded === true),
      canvasControlEverMatchedPython: out.fixtures.some(
        (f) => f.canvasControl && (f.canvasControl.low.letterboxedMatchesPython || f.canvasControl.high.letterboxedMatchesPython)
      ),
    };
    out.conclusion =
      out.summary.nonConformant === 0
        ? "CONFORMANT — every stage matches the Python reference byte for byte"
        : "NOT CONFORMANT — first divergences: " + out.summary.firstDivergences.join(", ");
  } catch (e) {
    out.error = { message: String((e && e.message) || e).slice(0, 400), stack: e && e.stack ? String(e.stack).slice(0, 300) : null };
    out.conclusion = "threw: " + String((e && e.message) || e).slice(0, 200);
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
