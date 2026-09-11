/**
 * Fold the conformance runs into metrics.json and print the QG-03b table.
 *
 *   node artifacts/experiments/W1-QG03b-letterbox-conformance/harness/aggregate-qg03b.mjs
 *
 * Conformance is a BOOLEAN per fixture per cell, and it is aggregated as a conjunction, not
 * an average. "14 of 15 stages matched" is not 93% conformant; it is not conformant.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const LOGS = join(EXP, "logs");

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
for (const f of files) {
  const log = JSON.parse(readFileSync(join(LOGS, f), "utf8"));
  for (const mode of [false, true]) {
    const runs = log.runs.filter((r) => r.headless === mode).map((r) => r.result).filter(Boolean);
    if (!runs.length) continue;

    const requested = [...new Set(runs.map((r) => r.requestedBackend))];
    if (requested.length !== 1 || requested[0] !== log.backend) {
      console.error(`REFUSED: ${log.browser} labelled "${log.backend}" but the probe reported ${JSON.stringify(requested)}.`);
      process.exit(1);
    }

    const allFixtures = runs.flatMap((r) => r.fixtures);
    const cell = {
      browser: log.browser,
      backend: log.backend,
      display: mode ? "headless" : "headful",
      platform: log.platform,
      runs: runs.length,
      userAgent: runs[0].userAgent,
      canvasKind: runs[0].canvasKind,
      fixturesPerRun: runs[0].fixtures.length,
      // Conjunction across every fixture of every run. One failure fails the cell.
      conformant: allFixtures.every((x) => x.conformant === true),
      decodeConformant: allFixtures.every((x) => x.stages?.decoded === true),
      resizeConformant: allFixtures.every((x) => x.stages?.resized === true),
      paddingConformant: allFixtures.every((x) => x.stages?.letterboxed === true),
      tensorConformant: allFixtures.every((x) => x.stages?.tensor === true),
      geometryConformant: allFixtures.every((x) => x.geometryMatches === true),
      firstDivergences: [...new Set(allFixtures.filter((x) => x.firstDivergence).map((x) => `${x.name}:${x.firstDivergence}`))],
      latency: {
        preprocessP50Ms: median(runs.map((r) => r.latency?.preprocessMs.p50).filter((v) => v != null)),
        preprocessP95Ms: median(runs.map((r) => r.latency?.preprocessMs.p95).filter((v) => v != null)),
        pngDecodeP50Ms: median(runs.map((r) => r.latency?.pngDecodeMs.p50).filter((v) => v != null)),
        fixture: runs[0].latency?.fixture ?? null,
        source: runs[0].latency?.source ?? null,
        note: "preprocessing and PNG decoding timed SEPARATELY — the decode is paid by the capture consumer either way",
      },
    };

    // The control: how the OLD canvas path behaved on the same pixels in the same run.
    const controls = allFixtures.filter((x) => x.canvasControl);
    if (controls.length) {
      cell.canvasControl = {
        everMatchedPython: controls.some((x) => x.canvasControl.low.letterboxedMatchesPython || x.canvasControl.high.letterboxedMatchesPython),
        matchedFixtures: [...new Set(controls.filter((x) => x.canvasControl.high.letterboxedMatchesPython).map((x) => x.name))],
        worstMaxAbsDiff255: Math.max(...controls.map((x) => x.canvasControl.high.maxAbsDiffVsShipped255)),
        worstDifferingFraction: Math.max(...controls.map((x) => x.canvasControl.high.differingFractionVsShipped)),
        // Whether the browser honours imageSmoothingQuality at all: if low and high produce
        // identical numbers on every fixture, the hint is being ignored.
        honoursImageSmoothingQuality: controls.some(
          (x) => x.canvasControl.low.maxAbsDiffVsShipped255 !== x.canvasControl.high.maxAbsDiffVsShipped255
        ),
      };
    }

    const det = runs.flatMap((r) => r.detection ?? []).filter((d) => d.shipped);
    if (det.length) {
      cell.detection = {
        samples: [...new Set(det.map((d) => d.name))],
        shippedAgreementRate: Math.min(...det.map((d) => d.shipped.agreementRate)),
        shippedExactCount: det.every((d) => d.shipped.exactCount),
        shippedWorstCssDeltaPx: Math.max(...det.map((d) => d.shipped.worstCssCoordinateDeltaPx)),
        canvasControlAgreementRate: det.every((d) => d.canvasControlHigh)
          ? Math.min(...det.map((d) => d.canvasControlHigh.agreementRate))
          : null,
        canvasControlWorstCssDeltaPx: det.every((d) => d.canvasControlHigh)
          ? Math.max(...det.map((d) => d.canvasControlHigh.worstCssCoordinateDeltaPx))
          : null,
      };
    } else if (runs.some((r) => r.detectionError)) {
      // Conformance is a CPU question and survives a backend failure by design.
      cell.detection = { unavailable: runs.find((r) => r.detectionError).detectionError };
    }
    cells.push(cell);
  }
}

const out = {
  experiment: "W1-QG03b-letterbox-conformance",
  question: "Does the browser produce the SAME tensor as the Python reference, from the same PNG, stage by stage?",
  lineage: "QG-03b — the blocker QG-03 left CONDITIONAL",
  unitOfEvidence: "browser x backend x display mode x fixture x pipeline stage",
  generatedAt: new Date().toISOString(),
  summary: {
    cells: cells.length,
    conformantCells: cells.filter((c) => c.conformant).length,
    everyStageConformant: cells.every((c) => c.conformant),
    canvasControlEverMatchedNonTrivially: cells.some(
      (c) => c.canvasControl && c.canvasControl.matchedFixtures.some((n) => n !== "square-exact")
    ),
  },
  cells,
};
writeFileSync(join(EXP, "metrics.json"), JSON.stringify(out, null, 2));

console.log("QG-03b — preprocessing conformance, T1 detector contract\n");
const h = "browser    backend  display   fixtures  decode resize pad tensor  pre p50  decode p50  detect agree  canvas ctrl";
console.log(h);
console.log("-".repeat(h.length));
const tick = (b) => (b ? " ok " : "FAIL");
for (const c of cells) {
  console.log(
    `${c.browser.padEnd(10)} ${c.backend.padEnd(8)} ${c.display.padEnd(9)} ` +
      `${String(c.fixturesPerRun).padStart(5)}x${c.runs}  ` +
      `${tick(c.decodeConformant)}  ${tick(c.resizeConformant)}  ${tick(c.paddingConformant)} ${tick(c.tensorConformant)}  ` +
      `${String(c.latency.preprocessP50Ms).padStart(6)} ms  ${String(c.latency.pngDecodeP50Ms).padStart(6)} ms  ` +
      `${c.detection?.shippedAgreementRate != null ? (c.detection.shippedAgreementRate * 100).toFixed(0) + "%" : c.detection?.unavailable ? "n/a" : "-"}`.padStart(13) +
      `  ${c.canvasControl ? (c.canvasControl.canvasControlAgreementRate, (c.detection?.canvasControlAgreementRate != null ? (c.detection.canvasControlAgreementRate * 100).toFixed(0) + "%" : "-")) : "-"}`
  );
}
console.log(`\nconformant cells: ${out.summary.conformantCells}/${cells.length}`);
console.log(`wrote ${join(EXP, "metrics.json")}`);
