/**
 * QG-03b-2 — does the browser decode JPEG and WebP the way the reference decoder does?
 *
 * QG-03b proved the PNG path is byte-identical end to end. PNG is lossless and both sides
 * run the same resampler, so that was achievable. JPEG is not lossless, and the question
 * changes shape entirely.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS AND IS NOT BEING COMPARED
 *
 * A JPEG-decoded tensor will never equal the original PNG's tensor. Reporting that as a
 * failure would be reporting that JPEG is JPEG. So the comparison is:
 *
 *     the SAME ENCODED BYTES, decoded here, against the SAME ENCODED BYTES decoded by
 *     Pillow and preprocessed by the authoritative contract.
 *
 * The encoded file's SHA-256 is verified on this side before anything else runs, so
 * "both sides decoded the same file" is a measurement rather than an assumption. Whatever
 * difference survives that is DECODER IMPLEMENTATION VARIANCE, which is the only thing
 * worth asking about a lossy format.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THREE DECODE VARIANTS, BECAUSE "THE BROWSER DECODED IT" IS NOT ONE BEHAVIOUR
 *
 *   default            createImageBitmap with no options
 *   no-colorspace      colorSpaceConversion: "none" — isolates COLOUR MANAGEMENT. If this
 *                      differs from default, the browser applied a transform Pillow did not.
 *   no-premultiply     premultiplyAlpha: "none" — isolates the canvas ALPHA round trip. A
 *                      canvas stores premultiplied colour and getImageData un-premultiplies
 *                      it, which cannot be exact below alpha 255.
 *
 * Running all three means a divergence can be ATTRIBUTED rather than merely reported.
 *
 * Throwaway spike code. The module under test ships.
 */
globalThis.runQg03b2Probe = async function runQg03b2Probe(contextName, opts) {
  opts = opts || {};
  const F = globalThis.QG03B2_FIXTURES;
  const base = opts.base || "";
  const backend = opts.backend || "wasm";

  const out = {
    context: contextName,
    probe: "qg03b2-capture-format-conformance",
    requestedBackend: backend,
    startedAt: new Date().toISOString(),
    userAgent: (globalThis.navigator && navigator.userAgent) || null,
    fixtures: [],
    latency: [],
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
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const pct = (s, p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  const r1 = (v) => Math.round(v * 10) / 10;
  const MIME = { png: "image/png", "jpeg-q95": "image/jpeg", "jpeg-q62": "image/jpeg", "webp-lossy-q62": "image/webp", "webp-lossless": "image/webp" };

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  /** Decode at NATIVE size: the canvas resamples nothing, so this is the decoder's output. */
  async function decodeNative(bytes, mime, variant) {
    const blob = new Blob([bytes], { type: mime });
    const o = {};
    if (variant === "no-colorspace") o.colorSpaceConversion = "none";
    if (variant === "no-premultiply") o.premultiplyAlpha = "none";
    const bmp = await createImageBitmap(blob, o);
    const canvas = makeCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    if (bmp.close) bmp.close();
    return { width: img.width, height: img.height, rgba: new Uint8Array(img.data.buffer.slice(0)) };
  }

  /**
   * Fetch a reference dump, with one retry.
   *
   * A same-origin extension read should not fail, and under sustained load in Firefox it
   * did -- "The operation was aborted." Retrying once turns a transient resource problem
   * into a delay; failing loudly afterwards keeps it from being mistaken for a verdict.
   */
  async function fetchRef(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return new Uint8Array(await (await fetch(url)).arrayBuffer());
      } catch (e) {
        if (attempt === 1) throw new Error("reference fetch failed after retry: " + String((e && e.message) || e));
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    return null;
  }

  function compare(mine, reference) {
    let max = 0;
    let sum = 0;
    let differing = 0;
    let aboveTol = 0;
    const tol = F.criterion.lossy.decodedMaxAbs;
    for (let i = 0; i < mine.length; i++) {
      const d = Math.abs(mine[i] - reference[i]);
      if (d > 0) differing++;
      if (d > tol) aboveTol++;
      if (d > max) max = d;
      sum += d;
    }
    return {
      maxAbs: max,
      meanAbs: sum / mine.length,
      fractionDiffering: differing / mine.length,
      fractionAboveTolerance: aboveTol / mine.length,
      identical: differing === 0,
    };
  }

  try {
    const P = await import(base + "perception/index.js");
    const contract = P.HEAD_CONTRACT;

    // ---- latency, per FORMAT, MEASURED FIRST -----------------------------------------
    //
    // Position is load-bearing. Run after the comparison loop, this reported a preprocess
    // p50 of 108 ms for an image QG-03b measured at 17-24 ms — because by then the probe
    // had fetched ~180 MB of reference dumps and run 135 decode+preprocess cycles, and the
    // figure was measuring GC pressure rather than the pipeline. It is taken here, on a
    // clean heap, before any of that.
    for (const encName of ["png", "jpeg-q62", "webp-lossy-q62"]) {
      const f = F.fixtures.find((x) => x.encoding === encName && x.source === "text-edges");
      if (!f) continue;
      const bytes = b64ToBytes(F.blobs[f.file]);
      const mime = MIME[encName];
      await decodeNative(bytes, mime, "default"); // discard: warm-up
      const dec = [];
      for (let i = 0; i < 12; i++) {
        const t0 = performance.now();
        await decodeNative(bytes, mime, "default");
        dec.push(performance.now() - t0);
      }
      const img = await decodeNative(bytes, mime, "default");
      P.preprocessToTensor(img, contract);
      const pre = [];
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        P.preprocessToTensor(img, contract);
        pre.push(performance.now() - t0);
      }
      const ds = dec.sort((a, b) => a - b);
      const ps = pre.sort((a, b) => a - b);
      out.latency.push({
        encoding: encName,
        source: f.source,
        sourceSize: f.sourceSize,
        encodedBytes: bytes.length,
        decodeMs: { p50: r1(pct(ds, 50)), p95: r1(pct(ds, 95)), min: r1(ds[0]), max: r1(ds[ds.length - 1]) },
        preprocessMs: { p50: r1(pct(ps, 50)), p95: r1(pct(ps, 95)) },
        combinedP50Ms: r1(pct(ds, 50) + pct(ps, 50)),
      });
    }


    for (const f of F.fixtures) {
      const rec = { source: f.source, encoding: f.encoding, lossless: f.lossless, variants: {} };
      try {
        const bytes = b64ToBytes(F.blobs[f.file]);
        // Both sides must have decoded the SAME FILE. Without this the whole comparison is
        // between two unrelated questions.
        rec.encodedSha256Matches = (await sha256(bytes.buffer.slice(0))) === f.encodedSha256;
        rec.encodedBytes = bytes.length;
        if (!rec.encodedSha256Matches) {
          rec.skipped = "encoded bytes differ from the reference file";
          out.fixtures.push(rec);
          continue;
        }

        // The reference dumps are FETCHED from the extension's own origin rather than
        // inlined: 45 decoded RGB images is ~124 MB, which as base64 in a JS file would
        // have to be parsed before the probe could start. Same-origin extension read; the
        // mechanism ADR-0001 already uses for the pinned ORT artifact.
        //
        // ONCE per fixture, not once per variant. Fetching inside the variant loop tripled
        // the IO for no reason and Firefox began aborting reads under the load -- which the
        // first aggregation scored as a CONFORMANCE FAILURE. A harness running out of
        // resources must never be able to look like a product result.
        const refDecoded = await fetchRef(base + f.refDecoded);
        const refLb = await fetchRef(base + f.refLetterboxed);
        const mime = MIME[f.encoding];

        for (const variant of ["default", "no-colorspace", "no-premultiply"]) {
          const v = {};
          try {
            const dec = await decodeNative(bytes, mime, variant);
            v.decodedSize = { w: dec.width, h: dec.height };
            v.decodedSizeMatches = dec.width === f.decodedSize.w && dec.height === f.decodedSize.h;

            const rgb = P.rgbaToRgb(dec.rgba, dec.width, dec.height);
            v.decodedDigestMatches = (await sha256(rgb.buffer.slice(0))) === f.digests.decoded;
            v.decoded = rgb.length === refDecoded.length ? compare(rgb, refDecoded) : { lengthMismatch: true };

            const t = P.rasterLetterbox(f.decodedSize, contract.inputSize, contract.padValue);
            v.geometryMatches =
              t.resizedW === f.geometry.resizedW &&
              t.resizedH === f.geometry.resizedH &&
              t.padLeft === f.geometry.padLeft &&
              t.padTop === f.geometry.padTop &&
              t.padRight === f.geometry.padRight &&
              t.padBottom === f.geometry.padBottom;

            // A non-opaque frame is REFUSED by the shipped module, and that refusal is the
            // correct outcome rather than a failure: the canvas premultiply round trip has
            // already corrupted the RGB, so any tensor built from it would look normal and
            // be wrong. Recorded as `refusedNotOpaque`, and conformance for such a fixture
            // means "it refused", not "it matched".
            let got = null;
            try {
              got = P.preprocessToTensor(dec, contract);
            } catch (e) {
              if ((e && e.code) === "FRAME_NOT_OPAQUE") {
                v.refusedNotOpaque = true;
                v.refusalMessage = String(e.message).slice(0, 200);
              } else {
                throw e;
              }
            }

            if (got) {
              v.letterboxedDigestMatches = (await sha256(got.letterboxed.buffer.slice(0))) === f.digests.letterboxed;
              v.tensorDigestMatches = (await sha256(got.tensor.buffer.slice(0, got.tensor.byteLength))) === f.digests.tensor;
              v.letterboxed = got.letterboxed.length === refLb.length ? compare(got.letterboxed, refLb) : { lengthMismatch: true };
            }

            // Conformance for a LOSSLESS format is bitwise; for a LOSSY one it is the
            // pre-registered bound. Two different bars, stated separately, never averaged.
            v.conformant = v.refusedNotOpaque
              ? true // refusing an untrustworthy frame IS the conformant behaviour
              : f.lossless
                ? v.decodedDigestMatches === true && v.letterboxedDigestMatches === true && v.tensorDigestMatches === true
                : v.geometryMatches === true &&
                  v.decodedSizeMatches === true &&
                  v.decoded.maxAbs <= F.criterion.lossy.decodedMaxAbs &&
                  v.decoded.meanAbs <= F.criterion.lossy.decodedMeanAbs;
          } catch (e) {
            v.error = String((e && e.message) || e).slice(0, 250);
          }
          rec.variants[variant] = v;
        }

        const d = rec.variants.default;
        rec.conformant = d && d.conformant === true;
        // If the variants disagree, the cause is attributable rather than mysterious.
        rec.colourManagementAffects =
          d && rec.variants["no-colorspace"] && rec.variants["no-colorspace"].decoded && d.decoded
            ? d.decoded.maxAbs !== rec.variants["no-colorspace"].decoded.maxAbs
            : null;
        rec.premultiplyAffects =
          d && rec.variants["no-premultiply"] && rec.variants["no-premultiply"].decoded && d.decoded
            ? d.decoded.maxAbs !== rec.variants["no-premultiply"].decoded.maxAbs
            : null;
      } catch (e) {
        // A HARNESS failure, not a conformance verdict. Kept as a distinct field so the
        // aggregator can refuse to classify rather than scoring it as REJECT.
        rec.harnessError = String((e && e.message) || e).slice(0, 300);
        rec.conformant = null;
      }
      out.fixtures.push(rec);
    }

    // ---- does the DETECTOR say the same thing? the primary criterion ------------------
    if (F.model && typeof ort !== "undefined") try {
      const SEC = await import(base + "security/index.js");
      await SEC.installVerifiedOrtRuntime({ ort, resolveAssetUrl: (n) => base + n });
      ort.env.logLevel = "error";
      if (backend === "wasm") ort.env.wasm.numThreads = 1;
      const session = await SEC.createPinnedInferenceSession(ort, b64ToBytes(F.model.b64), {
        executionProviders: [backend],
        graphOptimizationLevel: "all",
      });

      const iou = (a, b) => {
        const x1 = Math.max(a[0], b[0]);
        const y1 = Math.max(a[1], b[1]);
        const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
        const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
        if (x2 <= x1 || y2 <= y1) return 0;
        const i = (x2 - x1) * (y2 - y1);
        return i / (a[2] * a[3] + b[2] * b[3] - i);
      };

      for (const f of F.fixtures) {
        if (!f.referenceBoxesThisEncoding && !f.referenceBoxesPng) continue;
        const rec = { source: f.source, encoding: f.encoding, sampleId: f.sampleId };
        try {
          const dec = await decodeNative(b64ToBytes(F.blobs[f.file]), MIME[f.encoding], "default");
          const lb = P.computeLetterbox(f.captureSize, contract.inputSize);
          const feeds = {};
          feeds[session.inputNames[0]] = new ort.Tensor(
            "float32",
            P.preprocessToTensor(dec, contract).tensor,
            [1, 3, contract.inputSize, contract.inputSize]
          );
          const r = await session.run(feeds);
          const o = r[session.outputNames[0]];
          const d2 = P.decodeHeadOutput({ data: o.data, dims: o.dims });
          if (!d2.ok) {
            rec.refused = d2.code;
          } else {
            const s = f.viewportCss.w / f.captureSize.w;
            const boxes = P.projectToCapture(d2.value, lb).map((x) => ({
              label: x.label,
              score: x.score,
              box: [x.box.x * s, x.box.y * s, x.box.w * s, x.box.h * s],
            }));
            const against = (ref) => {
              if (!ref) return null;
              const used = new Set();
              let matched = 0;
              let worst = 0;
              let worstScore = 0;
              for (const rb of ref) {
                let bj = -1;
                let bi = 0.5;
                for (let j = 0; j < boxes.length; j++) {
                  if (used.has(j) || boxes[j].label !== rb.label) continue;
                  const v = iou(rb.box, boxes[j].box);
                  if (v >= bi) { bi = v; bj = j; }
                }
                if (bj >= 0) {
                  used.add(bj);
                  matched++;
                  const m = boxes[bj];
                  worst = Math.max(worst, Math.abs(rb.box[0] - m.box[0]), Math.abs(rb.box[1] - m.box[1]),
                                   Math.abs(rb.box[2] - m.box[2]), Math.abs(rb.box[3] - m.box[3]));
                  worstScore = Math.max(worstScore, Math.abs(rb.score - m.score));
                }
              }
              return {
                emitted: boxes.length,
                reference: ref.length,
                matchedAtIou50: matched,
                agreementRate: ref.length ? matched / ref.length : null,
                countDelta: Math.abs(boxes.length - ref.length),
                worstCssDisplacementPx: worst,
                worstScoreDelta: worstScore,
              };
            };

            // CONFORMANCE: this browser against the reference decode of the SAME bytes.
            rec.conformance = against(f.referenceBoxesThisEncoding);
            // COMPRESSION SENSITIVITY: this encoding against the LOSSLESS frame. Expected to
            // be imperfect for a lossy format -- that is the detector minding compression,
            // not the browser disagreeing with the reference. Reported, never classified.
            rec.compressionSensitivity = against(f.referenceBoxesPng);

            const c = F.criterion.detector;
            rec.meetsCriterion = rec.conformance
              ? rec.conformance.agreementRate >= c.minMatchedAtIou50 &&
                rec.conformance.countDelta <= c.maxCountDelta &&
                rec.conformance.worstCssDisplacementPx <= c.maxCssDisplacementPx
              : null;
          }
        } catch (e) {
          rec.error = String((e && e.message) || e).slice(0, 250);
        }
        out.detection.push(rec);
      }
      if (typeof session.release === "function") await session.release();
    } catch (e) {
      out.detectionError = String((e && e.message) || e).slice(0, 300);
    }

    const byFormat = {};
    for (const f of out.fixtures) {
      const key = f.encoding;
      byFormat[key] = byFormat[key] || { total: 0, conformant: 0, worstMaxAbs: 0, worstMeanAbs: 0 };
      byFormat[key].total++;
      if (f.conformant) byFormat[key].conformant++;
      if (f.variants?.default?.refusedNotOpaque) byFormat[key].refusedNotOpaque = (byFormat[key].refusedNotOpaque || 0) + 1;
      const d = f.variants?.default?.refusedNotOpaque ? null : f.variants?.default?.decoded;
      if (d && !d.lengthMismatch) {
        byFormat[key].worstMaxAbs = Math.max(byFormat[key].worstMaxAbs, d.maxAbs);
        byFormat[key].worstMeanAbs = Math.max(byFormat[key].worstMeanAbs, d.meanAbs);
      }
    }
    out.summary = {
      fixtures: out.fixtures.length,
      conformant: out.fixtures.filter((f) => f.conformant).length,
      byFormat,
      colourManagementEverAffects: out.fixtures.some((f) => f.colourManagementAffects === true),
      premultiplyEverAffects: out.fixtures.some((f) => f.premultiplyAffects === true),
    };
    out.conclusion =
      Object.entries(byFormat).map(([k, v]) => `${k} ${v.conformant}/${v.total}`).join("  ");
  } catch (e) {
    out.error = { message: String((e && e.message) || e).slice(0, 400) };
    out.conclusion = "threw: " + String((e && e.message) || e).slice(0, 200);
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
