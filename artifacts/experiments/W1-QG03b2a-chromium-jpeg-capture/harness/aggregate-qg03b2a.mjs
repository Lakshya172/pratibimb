/**
 * Fold the QG-03b-2a runs into metrics.json and print the table.
 *
 *   node artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/harness/aggregate-qg03b2a.mjs
 *
 * Classification is per BACKEND x DISPLAY x FORMAT. "Chromium decodes its own JPEG" is not
 * a result; "Chromium 151 on Windows, WASM backend, headful, decodes its own captureVisibleTab
 * JPEG identically to Pillow 12.3.0" is.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THREE REFUSALS, EACH FOR A MISTAKE THAT HAS ALREADY HAPPENED ONCE
 *
 *   1. A cell whose probe reports a different backend than its label. QG-03 published a
 *      cell labelled "webgpu" that had measured WASM, because an interrupted build left the
 *      backend baked in and the placeholder substitution silently did nothing.
 *   2. A webgpu cell that submitted no GPU work. ORT falls back without raising.
 *   3. A harness error scored as a product verdict. QG-03b-2 nearly published a Firefox
 *      WebP defect that did not exist because a same-origin read aborted under IO load.
 *      A format with any harness error is UNKNOWN — missing evidence, not a wrong answer.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const LOGS = join(EXP, "logs");
const fx = JSON.parse(readFileSync(join(EXP, "fixtures.json"), "utf8"));
const capManifestPath = join(HERE, "captured", "manifest.json");

const files = readdirSync(LOGS).filter((f) => f.startsWith("results-") && f.endsWith(".json"));
if (!files.length) {
  console.error(`no run logs in ${LOGS}`);
  process.exit(1);
}
const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const spread = (xs) => ({ min: Math.min(...xs), median: median(xs), max: Math.max(...xs), samples: xs.length });

const cells = [];
for (const file of files) {
  const log = JSON.parse(readFileSync(join(LOGS, file), "utf8"));
  for (const mode of [false, true]) {
    const runs = log.runs.filter((r) => r.headless === mode).map((r) => r.result).filter(Boolean);
    if (!runs.length) continue;

    const requested = [...new Set(runs.map((r) => r.requestedBackend))];
    if (requested.length !== 1 || requested[0] !== log.backend) {
      console.error(`REFUSED: ${log.browser} labelled "${log.backend}" but the probe reported ${JSON.stringify(requested)}.`);
      process.exit(1);
    }
    // A backend label that was never observed is not a backend label.
    const verified = runs.every((r) => r.backendLabelVerified === true);
    if (!verified) {
      console.error(
        `REFUSED: ${log.backend} ${mode ? "headless" : "headful"} — backend label unverified. ` +
          `GPU submits: ${JSON.stringify(runs.map((r) => r.gpu?.submits))}`
      );
      process.exit(1);
    }

    // The whole experiment rests on these bytes having come out of the browser. If the
    // fixture manifest ever stops saying so, nothing below is about the capture path.
    const provenance = fx.fixtures.every((f) => f.producedBy === "chrome.tabs.captureVisibleTab");
    if (!provenance) {
      console.error("REFUSED: a fixture is not attributed to chrome.tabs.captureVisibleTab.");
      process.exit(1);
    }

    const all = runs.flatMap((r) => r.fixtures);
    const byFormat = {};
    for (const enc of fx.encodings) {
      const rows = all.filter((x) => x.encoding === enc.name);
      if (!rows.length) continue;
      const dec = rows.map((x) => x.variants?.default?.decoded).filter((d) => d && !d.lengthMismatch);
      const harnessErrors = rows.filter((x) => x.harnessError);
      const conformant = rows.every((x) => x.conformant === true);
      const bitwise = dec.length > 0 && dec.every((d) => d.identical === true);
      byFormat[enc.name] = {
        lossless: enc.lossless,
        fixtures: rows.length,
        conformant: rows.filter((x) => x.conformant).length,
        allConformant: conformant,
        bitwiseIdenticalToReference: bitwise,
        worstDecodedMaxAbs: dec.length ? Math.max(...dec.map((d) => d.maxAbs)) : null,
        worstDecodedMeanAbs: dec.length ? Math.max(...dec.map((d) => d.meanAbs)) : null,
        geometryAlwaysExact: rows.every((x) => x.variants?.default?.geometryMatches !== false),
        encodedBytesVerified: rows.every((x) => x.encodedSha256Matches === true),
        magicMatchesDeclaredMime: rows.every((x) => x.magicMatchesDeclaredMime === true),
        tensorDigestAlwaysMatches: rows.every((x) => x.variants?.default?.tensorDigestMatches === true),
        harnessErrors: harnessErrors.length,
        harnessErrorMessages: [...new Set(harnessErrors.map((x) => x.harnessError))],
        // The CAPTURE PATH's own verdict: decode, geometry, tensor. This is the part of the
        // pipeline QG-03b-2a exists to test, and it is scored on its own before the detector
        // is consulted, so a downstream problem cannot be mistaken for a capture problem —
        // nor a clean capture path be used to excuse one.
        pathClassification: harnessErrors.length
          ? "UNKNOWN"
          : !rows.every((x) => x.encodedSha256Matches === true)
            ? "UNKNOWN"
            : conformant
              ? "ACCEPT"
              : "REJECT",
      };
    }

    // TWO different questions, kept apart on purpose. Merging them turns an exact browser
    // agreement into an apparent failure, which is what a JPEG-vs-PNG comparison looks like.
    const det = runs.flatMap((r) => r.detection ?? []);
    const detByFormat = {};
    for (const d of det) {
      const k = d.encoding;
      detByFormat[k] = detByFormat[k] || {
        samples: 0,
        saturatedAtCap: 0,
        conformance: { worstAgreement: 1, worstCountDelta: 0, worstCssPx: 0, worstScoreDelta: 0, allMeet: true, measured: false },
        compressionSensitivity: { worstAgreement: 1, worstCountDelta: 0, worstCssPx: 0, measured: false },
      };
      detByFormat[k].samples++;
      if (d.conformance) {
        const t = detByFormat[k].conformance;
        t.measured = true;
        t.worstAgreement = Math.min(t.worstAgreement, d.conformance.agreementRate);
        t.worstCountDelta = Math.max(t.worstCountDelta, d.conformance.countDelta);
        t.worstCssPx = Math.max(t.worstCssPx, d.conformance.worstCssDisplacementPx);
        t.worstScoreDelta = Math.max(t.worstScoreDelta, d.conformance.worstScoreDelta ?? 0);
        if (d.meetsCriterion === false) t.allMeet = false;
        // A fixture at the max-detections cap is worth flagging: agreement there is exact
        // in this run, but the cap means two implementations could in principle keep
        // different boxes for a vanishing score difference. Reported, not hidden.
        if (d.conformance.emitted >= 300) detByFormat[k].saturatedAtCap++;
      }
      if (d.compressionSensitivity) {
        const t = detByFormat[k].compressionSensitivity;
        t.measured = true;
        t.worstAgreement = Math.min(t.worstAgreement, d.compressionSensitivity.agreementRate);
        t.worstCountDelta = Math.max(t.worstCountDelta, d.compressionSensitivity.countDelta);
        t.worstCssPx = Math.max(t.worstCssPx, d.compressionSensitivity.worstCssDisplacementPx);
      }
    }

    /**
     * The pre-registered criterion named DETECTOR OUTPUT as primary, so the classification
     * has to answer to it.
     *
     * A format whose capture path is bitwise-exact but whose detector bound fails is NOT
     * ACCEPT. It is CONDITIONAL: a real difference exists, it is bounded, and the condition
     * has to be stated. Reading it as ACCEPT because the cause turned out to be downstream
     * would be fitting the verdict to the explanation — the same error as loosening a
     * tolerance to obtain a pass, pointed the other way.
     */
    for (const [name, v] of Object.entries(byFormat)) {
      const d = detByFormat[name];
      v.detectorMeasured = !!d?.conformance?.measured;
      v.detectorCriterionMet = v.detectorMeasured ? d.conformance.allMeet === true : null;
      v.classification =
        v.pathClassification !== "ACCEPT"
          ? v.pathClassification
          : v.detectorCriterionMet === false
            ? "CONDITIONAL"
            : v.detectorCriterionMet === true
              ? "ACCEPT"
              : "UNKNOWN"; // the detector could not be measured; that is missing evidence
      if (v.classification === "CONDITIONAL") {
        v.condition =
          "capture path bitwise-exact on every fixture; the detector bound " +
          `(${fx.criterion.detector.maxCssDisplacementPx} CSS px) is exceeded on at least one fixture ` +
          `(worst ${d.conformance.worstCssPx.toFixed(2)} px). See saturation-control.json: the tensor is ` +
          "bitwise identical there, so the difference is downstream of capture.";
      }
    }

    cells.push({
      browser: log.browser,
      backend: log.backend,
      backendLabelVerified: true,
      gpuSubmits: spread(runs.map((r) => r.gpu?.submits ?? 0)),
      display: mode ? "headless" : "headful",
      platform: log.platform,
      runs: runs.length,
      userAgent: runs[0].userAgent,
      byFormat,
      detection: detByFormat,
      detectionUnavailable: runs.find((r) => r.detectionError)?.detectionError ?? null,
      colourManagementEverAffects: runs.some((r) => r.summary?.colourManagementEverAffects === true),
      premultiplyEverAffects: runs.some((r) => r.summary?.premultiplyEverAffects === true),
      // DECODE and PREPROCESS only. Capture latency is a different measurement taken in a
      // different process and is reported below under `captureLatency`, never added to these.
      latency: Object.fromEntries(
        fx.encodings.map((enc) => {
          const rows = runs.flatMap((r) => r.latency ?? []).filter((l) => l.encoding === enc.name);
          return [
            enc.name,
            rows.length
              ? {
                  source: rows[0].source,
                  sourceSize: rows[0].sourceSize,
                  encodedBytes: rows[0].encodedBytes,
                  decodeMs: spread(rows.map((r) => r.decodeMs.p50)),
                  preprocessMs: spread(rows.map((r) => r.preprocessMs.p50)),
                  combinedMs: spread(rows.map((r) => r.combinedP50Ms)),
                  note: "p50 within a run; min/median/max ACROSS runs. Decode + preprocess only — no capture.",
                }
              : null,
          ];
        })
      ),
    });
  }
}

/**
 * Capture latency, from the capture phase, kept in its own block.
 *
 * This is wall time inside `chrome.tabs.captureVisibleTab` in a real browser — a different
 * process, a different phase, and a cost the decode benchmark above does not contain.
 * Adding the two would produce a number describing no real operation, so they are adjacent
 * and never summed for the reader.
 */
let captureLatency = null;
let captureSummary = null;
if (existsSync(capManifestPath)) {
  const cap = JSON.parse(readFileSync(capManifestPath, "utf8"));
  const rows = cap.captures.flatMap((c) =>
    c.files.filter((f) => f.captureMs != null).map((f) => ({ display: c.display, mime: f.mime, ms: f.captureMs, bytes: f.bytes, page: c.page }))
  );
  captureLatency = {};
  for (const display of ["headful", "headless"]) {
    for (const mime of ["image/png", "image/jpeg"]) {
      const xs = rows.filter((r) => r.display === display && r.mime === mime);
      if (!xs.length) continue;
      captureLatency[`${display}/${mime}`] = {
        calls: xs.length,
        captureMs: spread(xs.map((r) => r.ms)),
        encodedBytes: spread(xs.map((r) => r.bytes)),
      };
    }
  }
  const surface = cap.captures.find((c) => c.apiSurface)?.apiSurface ?? null;
  captureSummary = {
    api: "chrome.tabs.captureVisibleTab",
    nativeBinding: cap.captures[0].apiBinding?.source ?? null,
    browserVersion: cap.captures[0].browserVersion,
    allWindowTargetsHit: cap.captures.every((c) => c.windowFitHitTarget),
    allDigestsAgreeWithBrowser: cap.captures.every((c) => c.files.every((f) => f.sha256AgreesWithBrowser !== false)),
    throttleRetriesTotal: cap.captures.reduce((n, c) => n + c.files.reduce((m, f) => m + (f.throttleRetries ?? 0), 0), 0),
    apiSurface: surface
      ? Object.fromEntries(Object.entries(surface).map(([k, v]) => [k, v.ok ? { mime: v.mime, bytes: v.bytes, magic: v.magic } : { rejected: v.error }]))
      : null,
  };
}

/** Encoder characteristics, read out of the captured files rather than assumed. */
const jpegs = fx.fixtures.filter((f) => f.encoding === "capture-jpeg");
const pngs = fx.fixtures.filter((f) => f.encoding === "capture-png");
const encoder = {
  jpeg: {
    files: jpegs.length,
    subsampling: [...new Set(jpegs.map((f) => f.encoder.subsamplingName))],
    progressive: [...new Set(jpegs.map((f) => f.encoder.progressive))],
    quantTableCount: [...new Set(jpegs.map((f) => f.encoder.quantTableCount))],
    impliedIjgQuality: [...new Set(jpegs.map((f) => JSON.stringify(f.encoder.impliedIjgQuality?.qualities)))].map((s) => JSON.parse(s)),
    iccProfileBytes: [...new Set(jpegs.map((f) => f.encoder.iccProfileBytes))],
    iccProfileSha256: [...new Set(jpegs.map((f) => f.encoder.iccProfileSha256))],
    iccDescription: [...new Set(jpegs.map((f) => f.encoder.iccDescription))],
    iccIdentityToSrgb: {
      identical: jpegs.filter((f) => f.encoder.iccIsIdentityToSrgb === true).length,
      differs: jpegs.filter((f) => f.encoder.iccIsIdentityToSrgb === false).length,
      worstMaxAbs: Math.max(...jpegs.map((f) => f.encoder.iccToSrgbMaxAbs ?? 0)),
    },
    note: "read from the DQT/APP2 markers of the captured files; quality is DERIVED from the tables, not assumed",
  },
  png: {
    files: pngs.length,
    iccProfileBytes: [...new Set(pngs.map((f) => f.encoder.iccProfileBytes))],
  },
};

/** Compression sensitivity, from the reference side: JPEG capture vs PNG capture. */
const compression = jpegs
  .filter((f) => f.display === "headful" && f.vsPngDecoded)
  .map((f) => ({
    page: f.page,
    category: f.category,
    pngBytes: pngs.find((p) => p.source === f.source)?.encodedBytes ?? null,
    jpegBytes: f.encodedBytes,
    decodedMaxAbs: f.vsPngDecoded.maxAbs,
    decodedMeanAbs: Number(f.vsPngDecoded.meanAbs.toFixed(4)),
    fractionDiffering: Number(f.vsPngDecoded.fractionDiffering.toFixed(4)),
  }));

const classifications = [...new Set(cells.flatMap((c) => Object.values(c.byFormat).map((v) => v.classification)))];
const out = {
  experiment: "W1-QG03b2a-chromium-jpeg-capture",
  gate: fx.gate,
  generatedAt: new Date().toISOString(),
  question:
    "Does the JPEG that Chromium's own captureVisibleTab produces decode and preprocess the " +
    "way the reference decoder does — the assumption QG-03b-2 validated using Pillow-encoded files?",
  scope: fx.scope,
  criterion: fx.criterion,
  capture: captureSummary,
  captureLatency,
  encoder,
  cells,
  compressionSensitivity: {
    note:
      "JPEG capture vs PNG capture of the SAME paint. NOT a conformance measurement — it is how " +
      "much the encoding costs, and it belongs to QG-03a. Never used to classify this gate.",
    perFixture: compression,
  },
  overall: {
    cells: cells.length,
    classifications,
    capturePathClassifications: [...new Set(cells.flatMap((c) => Object.values(c.byFormat).map((v) => v.pathClassification)))],
    // ACCEPT only if every cell and every format reached it. One REJECT or UNKNOWN anywhere
    // means the gate is not ACCEPT, whatever the other cells say.
    // The weakest cell decides. Averaging eight cells into one score would let a clean
    // WebGPU pair hide a WASM condition.
    classification: classifications.includes("REJECT")
      ? "REJECT"
      : classifications.includes("UNKNOWN")
        ? "UNKNOWN"
        : classifications.includes("CONDITIONAL")
          ? "CONDITIONAL"
          : "ACCEPT",
  },
};

writeFileSync(join(EXP, "metrics.json"), JSON.stringify(out, null, 2));

console.log(`\nQG-03b-2a — real Chromium captureVisibleTab JPEG conformance`);
console.log(`capture: ${captureSummary?.api}  ${captureSummary?.nativeBinding}`);
console.log(`browser: ${captureSummary?.browserVersion}\n`);
console.log("backend  display   format         fixtures  bitwise  geometry  tensor  detector  class");
for (const c of cells) {
  for (const [name, v] of Object.entries(c.byFormat)) {
    console.log(
      `${c.backend.padEnd(8)} ${c.display.padEnd(9)} ${name.padEnd(14)} ` +
        `${String(v.conformant + "/" + v.fixtures).padEnd(9)} ${String(v.bitwiseIdenticalToReference).padEnd(8)} ` +
        `${String(v.geometryAlwaysExact).padEnd(9)} ${String(v.tensorDigestAlwaysMatches).padEnd(7)} ` +
        `${String(v.detectorCriterionMet).padEnd(9)} ${v.classification}`
    );
  }
}
console.log(`\nencoder: JPEG ${encoder.jpeg.subsampling.join("/")} quality ${JSON.stringify(encoder.jpeg.impliedIjgQuality)} ` +
  `progressive=${encoder.jpeg.progressive.join("/")} icc=${encoder.jpeg.iccProfileBytes.join("/")}B (${encoder.jpeg.iccDescription.join("/")})`);
console.log(`         PNG icc=${encoder.png.iccProfileBytes.join("/")}B`);
console.log(`\ncolour management ever affects a decode: ${cells.some((c) => c.colourManagementEverAffects)}`);
console.log(`OVERALL: ${out.overall.classification}`);
console.log(`\nwrote ${join(EXP, "metrics.json")}`);
