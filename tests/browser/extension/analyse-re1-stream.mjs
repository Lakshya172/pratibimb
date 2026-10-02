#!/usr/bin/env node
/**
 * M10.6 — RE-1 ON STREAM FRAMES, RE-READ. Reads the formal gesture record and this workstation's M8.2
 * baseline and writes the per-image comparison. Nothing is re-run: arithmetic over committed records.
 *
 * Why it exists: the formal record compared RE-1 scores as JSON TEXT, which also compares key order,
 * and the baseline stores its fields in its own order. Here every comparison is `isDeepStrictEqual`,
 * and the box differences are measured rather than reduced to a boolean.
 *
 * TWO COMPARISONS, kept apart on purpose:
 *   vsBaseline — within this machine, and EXACT. This is the check that means something.
 *   vsW1       — across machines, and MEASURED, never asserted. M8.2's native reference is
 *                machine-local (CPU kernel dispatch), and a different GPU rasterises the same DOM to
 *                different pixels, so cross-machine equality is not expected. It is reported rather
 *                than hidden: the differences are themselves the evidence. Omitted when this IS W1.
 *
 * Usage: node tests/browser/extension/analyse-re1-stream.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ROOT } from "../demo/server.mjs";
import { baselinePath, loadBaseline } from "../support/m82-baseline.mjs";
import { assertOwnEvidencePath, evidenceFileName, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const LOGS = join(ROOT, "artifacts", "experiments", "M10-visual-redaction-integration", "logs");
const SOURCE = join(LOGS, evidenceFileName(WS, "cft-gesture-redaction.json"));
const record = JSON.parse(readFileSync(SOURCE, "utf8"));
const BASELINE = loadBaseline("TR-01", WS);
const W1_PATH = join(ROOT, "artifacts", "experiments", "M8.1-visual-text-screening", "results", "tr-01-run1.json");
/** W1's historical record, read ONLY to measure the cross-machine difference. Never an assertion. */
const W1 = WS.id === "W1" ? null : JSON.parse(readFileSync(W1_PATH, "utf8"));

const rel = (p) => p.slice(ROOT.length + 1).replaceAll("\\", "/");

/** Paired by index: both lists come from the same post-processing, in its own order. */
const deltas = (mine, theirs) => {
  if (mine.length !== theirs.length) return { sameCount: false, maxCoordinateDifferencePx: null, maxScoreDifference: null };
  let coord = 0;
  let score = 0;
  mine.forEach((a, k) => {
    const b = theirs[k];
    coord = Math.max(coord, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
    score = Math.max(score, Math.abs(a.score - b.score));
  });
  return { sameCount: true, maxCoordinateDifferencePx: coord, maxScoreDifference: score };
};

const cell = record.cells.find((c) => c.re1Stream);
if (!cell) throw new Error("the formal record carries no RE-1 stream block");

const images = cell.re1Stream.images.map((i) => {
  const baseBoxes = BASELINE.inputs[i.image].boxes;
  const baseScore = BASELINE.heldOut.perImage.find((p) => p.image === i.image);
  const d = deltas(i.boxes, baseBoxes);
  const row = {
    image: i.image,
    detections: i.boxes.length,
    baselineDetections: baseBoxes.length,
    boxesExactlyEqualBaseline: isDeepStrictEqual(i.boxes, baseBoxes),
    maxCoordinateDifferencePx: d.maxCoordinateDifferencePx,
    maxScoreDifference: d.maxScoreDifference,
    re1ScoreEqualsBaseline: isDeepStrictEqual({ image: i.image, ...i.score }, baseScore),
    re1FieldsDiffering: Object.keys(i.score).filter((k) => !isDeepStrictEqual(i.score[k], baseScore?.[k])),
    re1Gates: i.score.gates,
    exposedSensitiveGlyphs: i.exposedSensitiveGlyphs,
    sensitiveGlyphs: i.sensitiveGlyphs,
  };
  if (W1) {
    const w1Boxes = W1.inputs[i.image].boxes;
    const w1Score = W1.heldOut.perImage.find((p) => p.image === i.image);
    const w = deltas(i.boxes, w1Boxes);
    row.vsW1 = {
      w1Detections: w1Boxes.length,
      sameDetectionCount: w.sameCount,
      boxGeometryIdentical: w.sameCount && w.maxCoordinateDifferencePx === 0,
      maxCoordinateDifferencePx: w.maxCoordinateDifferencePx,
      maxScoreDifference: w.maxScoreDifference,
      re1ScoreIdentical: isDeepStrictEqual({ image: i.image, ...i.score }, w1Score),
      note: "MEASURED, not asserted: cross-machine equality is not expected and is not a gate",
    };
  }
  return row;
});

const out = {
  analysis: "M10.6 — RE-1 on gesture-stream frames: exact against this workstation's baseline, measured against W1",
  workstation: WS.id,
  baseline: rel(baselinePath("TR-01", WS)),
  source: rel(SOURCE),
  sourceRecordedAt: record.recordedAt,
  images,
  totals: {
    images: images.length,
    sameDetectionCountAsBaseline: images.filter((i) => i.detections === i.baselineDetections).length,
    boxesExactlyEqualBaseline: images.filter((i) => i.boxesExactlyEqualBaseline).length,
    maxCoordinateDifferencePx: Math.max(...images.map((i) => i.maxCoordinateDifferencePx ?? Infinity)),
    maxScoreDifference: Math.max(...images.map((i) => i.maxScoreDifference ?? Infinity)),
    re1ScoreEqualsBaseline: images.filter((i) => i.re1ScoreEqualsBaseline).length,
    everyRe1GatePasses: images.every((i) => Object.values(i.re1Gates).every(Boolean)),
    exposedSensitiveGlyphs: images.reduce((n, i) => n + i.exposedSensitiveGlyphs, 0),
    sensitiveGlyphs: images.reduce((n, i) => n + i.sensitiveGlyphs, 0),
  },
  ...(W1
    ? {
        vsW1: {
          w1Record: rel(W1_PATH),
          note: "MEASURED cross-machine difference. Not a gate, not expected to be zero, and not hidden.",
          sameDetectionCount: images.filter((i) => i.vsW1.sameDetectionCount).length,
          boxGeometryIdentical: images.filter((i) => i.vsW1.boxGeometryIdentical).length,
          maxCoordinateDifferencePx: Math.max(...images.map((i) => i.vsW1.maxCoordinateDifferencePx ?? Infinity)),
          maxScoreDifference: Math.max(...images.map((i) => i.vsW1.maxScoreDifference ?? Infinity)),
          re1ScoreIdentical: images.filter((i) => i.vsW1.re1ScoreIdentical).length,
        },
      }
    : {}),
};
const target = assertOwnEvidencePath(join(LOGS, evidenceFileName(WS, "cft-re1-stream-analysis.json")), WS);
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ totals: out.totals, vsW1: out.vsW1 ?? null }, null, 2));
console.log(`written: ${target}`);
