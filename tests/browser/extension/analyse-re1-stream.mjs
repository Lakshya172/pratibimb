#!/usr/bin/env node
/**
 * M10.6 — RE-1 ON STREAM FRAMES, RE-READ. Reads the formal gesture record and M8.1's recorded run and
 * writes the per-image comparison. Nothing is re-run: this is arithmetic over two committed records.
 *
 * Why it exists: the formal record compared RE-1 scores as JSON TEXT, which also compares key order,
 * and M8.1 stored its fields in its own order. Here every comparison is `isDeepStrictEqual`, and the
 * box differences are measured rather than reduced to a boolean.
 *
 * Usage: node tests/browser/extension/analyse-re1-stream.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ROOT } from "../demo/server.mjs";
import { assertOwnEvidencePath, evidenceFileName, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const LOGS = join(ROOT, "artifacts", "experiments", "M10-visual-redaction-integration", "logs");
const SOURCE = join(LOGS, evidenceFileName(WS, "cft-gesture-redaction.json"));
const record = JSON.parse(readFileSync(SOURCE, "utf8"));
const M81 = JSON.parse(readFileSync(join(ROOT, "artifacts", "experiments", "M8.1-visual-text-screening", "results", "tr-01-run1.json"), "utf8"));

const cell = record.cells.find((c) => c.re1Stream);
if (!cell) throw new Error("the formal record carries no RE-1 stream block");

const images = cell.re1Stream.images.map((i) => {
  const m81Boxes = M81.inputs[i.image].boxes;
  const m81Score = M81.heldOut.perImage.find((p) => p.image === i.image);
  const sameCount = i.boxes.length === m81Boxes.length;
  // Paired by index: both lists come from the same post-processing, in its own order.
  let coord = 0;
  let score = 0;
  if (sameCount)
    i.boxes.forEach((a, k) => {
      const b = m81Boxes[k];
      coord = Math.max(coord, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
      score = Math.max(score, Math.abs(a.score - b.score));
    });
  return {
    image: i.image,
    detections: i.boxes.length,
    m81Detections: m81Boxes.length,
    boxesExactlyEqualM81: isDeepStrictEqual(i.boxes, m81Boxes),
    maxCoordinateDifferencePx: sameCount ? coord : null,
    maxScoreDifference: sameCount ? score : null,
    re1ScoreEqualsM81: isDeepStrictEqual({ image: i.image, ...i.score }, m81Score),
    re1FieldsDiffering: Object.keys(i.score).filter((k) => !isDeepStrictEqual(i.score[k], m81Score?.[k])),
    re1Gates: i.score.gates,
    exposedSensitiveGlyphs: i.exposedSensitiveGlyphs,
    sensitiveGlyphs: i.sensitiveGlyphs,
  };
});

const out = {
  analysis: "M10.6 — RE-1 on gesture-stream frames compared with M8.1 (deep equality; measured differences)",
  source: SOURCE.slice(ROOT.length + 1).replaceAll("\\", "/"),
  sourceRecordedAt: record.recordedAt,
  images,
  totals: {
    images: images.length,
    sameDetectionCountAsM81: images.filter((i) => i.detections === i.m81Detections).length,
    boxesExactlyEqualM81: images.filter((i) => i.boxesExactlyEqualM81).length,
    maxCoordinateDifferencePx: Math.max(...images.map((i) => i.maxCoordinateDifferencePx ?? Infinity)),
    maxScoreDifference: Math.max(...images.map((i) => i.maxScoreDifference ?? Infinity)),
    re1ScoreEqualsM81: images.filter((i) => i.re1ScoreEqualsM81).length,
    everyRe1GatePasses: images.every((i) => Object.values(i.re1Gates).every(Boolean)),
    exposedSensitiveGlyphs: images.reduce((n, i) => n + i.exposedSensitiveGlyphs, 0),
    sensitiveGlyphs: images.reduce((n, i) => n + i.sensitiveGlyphs, 0),
  },
};
const target = assertOwnEvidencePath(join(LOGS, evidenceFileName(WS, "cft-re1-stream-analysis.json")), WS);
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(JSON.stringify(out.totals, null, 2));
console.log(`written: ${target}`);
