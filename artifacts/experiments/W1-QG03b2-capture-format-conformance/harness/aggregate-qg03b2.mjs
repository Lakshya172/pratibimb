/**
 * Fold the capture-format runs into metrics.json and print the QG-03b-2 table.
 *
 *   node artifacts/experiments/W1-QG03b2-capture-format-conformance/harness/aggregate-qg03b2.mjs
 *
 * Classification is per BROWSER x FORMAT, never averaged across either. "JPEG works" is not
 * a result; "Chromium 151 decodes JPEG identically to Pillow 12.3.0 on Windows" is.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const LOGS = join(EXP, "logs");
const fx = JSON.parse(readFileSync(join(EXP, "fixtures.json"), "utf8"));

const files = readdirSync(LOGS).filter((f) => f.startsWith("results-") && f.endsWith(".json"));
if (!files.length) {
  console.error(`no run logs in ${LOGS}`);
  process.exit(1);
}
const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

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

    const all = runs.flatMap((r) => r.fixtures);
    const byFormat = {};
    for (const enc of fx.encodings) {
      const rows = all.filter((x) => x.encoding === enc.name);
      if (!rows.length) continue;
      const opaque = rows.filter((x) => !x.variants?.default?.refusedNotOpaque);
      const refused = rows.filter((x) => x.variants?.default?.refusedNotOpaque);
      const dec = opaque.map((x) => x.variants?.default?.decoded).filter((d) => d && !d.lengthMismatch);

      // A CONJUNCTION over every fixture of every run. One failure fails the format.
      //
      // But a HARNESS error is not a failure of the thing under test. Firefox aborted
      // same-origin reads under sustained IO load, and scoring that as REJECT would have
      // published a browser defect that does not exist. A format with any harness error is
      // UNKNOWN -- the evidence is missing, which is a different claim from "it is wrong".
      const harnessErrors = rows.filter((x) => x.harnessError);
      const conformant = rows.every((x) => x.conformant === true);
      const bitwise = dec.length > 0 && dec.every((d) => d.identical === true);
      byFormat[enc.name] = {
        lossless: enc.lossless,
        fixtures: rows.length,
        conformant: rows.filter((x) => x.conformant).length,
        allConformant: conformant,
        refusedNotOpaque: refused.length,
        bitwiseIdenticalToReference: bitwise,
        worstDecodedMaxAbs: dec.length ? Math.max(...dec.map((d) => d.maxAbs)) : null,
        worstDecodedMeanAbs: dec.length ? Math.max(...dec.map((d) => d.meanAbs)) : null,
        worstFractionAboveTolerance: dec.length ? Math.max(...dec.map((d) => d.fractionAboveTolerance)) : null,
        geometryAlwaysExact: rows.every((x) => x.variants?.default?.geometryMatches !== false),
        encodedBytesVerified: rows.every((x) => x.encodedSha256Matches === true),
        // The classification, per browser x format, using the project's gate semantics.
        harnessErrors: harnessErrors.length,
        harnessErrorMessages: [...new Set(harnessErrors.map((x) => x.harnessError))],
        classification: harnessErrors.length
          ? "UNKNOWN"
          : !rows.every((x) => x.encodedSha256Matches === true)
            ? "UNKNOWN"
            : conformant
              ? "ACCEPT"
              : "REJECT",
      };
    }

    // TWO different questions, kept apart on purpose.
    //
    //   conformance             this browser vs the reference decode of the SAME bytes.
    //                           That is what QG-03b-2 asks, and it should be exact.
    //   compressionSensitivity  this encoding vs the LOSSLESS frame. That is how much the
    //                           detector minds being compressed -- a real finding, and NOT a
    //                           conformance result. Merging them would turn an exact browser
    //                           agreement into an apparent failure.
    const det = runs.flatMap((r) => r.detection ?? []);
    const detByFormat = {};
    for (const d of det) {
      const k = d.encoding;
      detByFormat[k] = detByFormat[k] || {
        samples: 0,
        conformance: { worstAgreement: 1, worstCountDelta: 0, worstCssPx: 0, allMeet: true, measured: false },
        compressionSensitivity: { worstAgreement: 1, worstCountDelta: 0, worstCssPx: 0, measured: false },
      };
      detByFormat[k].samples++;
      if (d.conformance) {
        const t = detByFormat[k].conformance;
        t.measured = true;
        t.worstAgreement = Math.min(t.worstAgreement, d.conformance.agreementRate);
        t.worstCountDelta = Math.max(t.worstCountDelta, d.conformance.countDelta);
        t.worstCssPx = Math.max(t.worstCssPx, d.conformance.worstCssDisplacementPx);
        if (d.meetsCriterion === false) t.allMeet = false;
      }
      if (d.compressionSensitivity) {
        const t = detByFormat[k].compressionSensitivity;
        t.measured = true;
        t.worstAgreement = Math.min(t.worstAgreement, d.compressionSensitivity.agreementRate);
        t.worstCountDelta = Math.max(t.worstCountDelta, d.compressionSensitivity.countDelta);
        t.worstCssPx = Math.max(t.worstCssPx, d.compressionSensitivity.worstCssDisplacementPx);
      }
    }

    cells.push({
      browser: log.browser,
      backend: log.backend,
      display: mode ? "headless" : "headful",
      platform: log.platform,
      runs: runs.length,
      userAgent: runs[0].userAgent,
      byFormat,
      detection: detByFormat,
      detectionUnavailable: runs.find((r) => r.detectionError)?.detectionError ?? null,
      latency: Object.fromEntries(
        ["png", "jpeg-q62", "webp-lossy-q62"].map((enc) => {
          const rows = runs.flatMap((r) => r.latency ?? []).filter((l) => l.encoding === enc);
          // MIN and MAX as well as the median, deliberately.
          //
          // A median over two runs is whichever of the two the index lands on, and the first
          // run of a batch pays browser launch and JIT warm-up: one cell reported 107.7 ms
          // where every other run of the identical code reported 26-31 ms. Publishing that as
          // "the" figure would have described a cold start as a preprocessing cost. The
          // spread makes an outlier visible instead of letting it become the headline.
          const spread = (xs) => ({ min: Math.min(...xs), median: median(xs), max: Math.max(...xs), runs: xs.length });
          return [
            enc,
            rows.length
              ? {
                  source: rows[0].source,
                  sourceSize: rows[0].sourceSize,
                  encodedBytes: rows[0].encodedBytes,
                  decodeMs: spread(rows.map((r) => r.decodeMs.p50)),
                  preprocessMs: spread(rows.map((r) => r.preprocessMs.p50)),
                  combinedMs: spread(rows.map((r) => r.combinedP50Ms)),
                  note:
                    "p50 within a run; min/median/max ACROSS runs. The first run of a batch pays " +
                    "browser launch and JIT warm-up and is visible here as the max.",
                }
              : null,
          ];
        })
      ),
      attribution: {
        colourManagementEverAffects: runs.some((r) => r.summary?.colourManagementEverAffects === true),
        premultiplyEverAffects: runs.some((r) => r.summary?.premultiplyEverAffects === true),
      },
    });
  }
}

const out = {
  experiment: "W1-QG03b2-capture-format-conformance",
  question: "Does the browser decode and preprocess every real capture format the way the reference does?",
  lineage: "QG-03b-2 — raised by QG-03b, which proved only the PNG path",
  unitOfEvidence: "browser x backend x display mode x format x fixture",
  scope: fx.scope,
  criterion: fx.criterion,
  reference: fx.reference,
  generatedAt: new Date().toISOString(),
  cells,
};
writeFileSync(join(EXP, "metrics.json"), JSON.stringify(out, null, 2));

console.log("QG-03b-2 — capture-format preprocessing conformance\n");
const h = "browser    backend  display   format            fixtures  bitwise  maxAbs  class    conform  vs-lossless";
console.log(h);
console.log("-".repeat(h.length));
for (const c of cells) {
  for (const [fmt, v] of Object.entries(c.byFormat)) {
    const d = c.detection[fmt];
    console.log(
      `${c.browser.padEnd(10)} ${c.backend.padEnd(8)} ${c.display.padEnd(9)} ${fmt.padEnd(17)} ` +
        `${String(v.conformant + "/" + v.fixtures).padStart(6)}  ` +
        `${String(v.bitwiseIdenticalToReference).padStart(7)}  ` +
        `${String(v.worstDecodedMaxAbs ?? "-").padStart(6)}  ${v.classification.padEnd(7)}  ` +
        `${d && d.conformance.measured ? (d.conformance.worstAgreement * 100).toFixed(0) + "%" + (d.conformance.allMeet ? "" : " MISS") : c.detectionUnavailable ? "n/a" : "-"}`.padStart(9) +
        `  ${d && d.compressionSensitivity.measured ? (d.compressionSensitivity.worstAgreement * 100).toFixed(0) + "%" : "-"}`
    );
  }
}
console.log(`\nwrote ${join(EXP, "metrics.json")}`);
