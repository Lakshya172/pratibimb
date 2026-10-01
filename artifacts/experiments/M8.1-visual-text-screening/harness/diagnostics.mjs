#!/usr/bin/env node
/**
 * M8.1 — POST-HOC DIAGNOSTICS. Written after the verdicts were computed; gates nothing and changes
 * nothing. They ask how much a pass rests on, so the record can say so:
 *
 *   1. native-runtime boxes, scored by the same RE-1 scorer — does the pass depend on which runtime
 *      produced the map? (The verdict is on WASM boxes, the product runtime.)
 *   2. WASM vs native boxes — count, and the largest edge movement between matched boxes.
 *   3. G1 margin — for every sensitive glyph, how far (px) it sits inside the single mask rectangle
 *      that contains it best. A small margin means a pass that a pixel of drift could turn over.
 *      A glyph covered only by the union of several rectangles is counted separately (margin 0).
 *
 * Reads run1's record and run1's native maps from models/ (git-ignored). No model is run.
 * Usage: node artifacts/experiments/M8.1-visual-text-screening/harness/diagnostics.mjs TR-01|TR-02
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { redactionMask } from "../../../../packages/privacy/src/redactionGeometry.ts";
import { scoreImage } from "../../../../tests/browser/support/redaction-metrics.mjs";
import { dbPostprocess } from "../../../../tests/browser/support/text-detector-screening.mjs";

const EXP = dirname(dirname(fileURLToPath(import.meta.url)));
const STEMS = { "TR-01": "tr01_ppocrv4_mobile_det", "TR-02": "tr02_ppocrv3_mobile_det" };
const cid = process.argv[2];
if (!STEMS[cid]) {
  console.error("usage: diagnostics.mjs TR-01|TR-02");
  process.exit(1);
}
const r1 = JSON.parse(readFileSync(join(EXP, "results", `${cid.toLowerCase()}-run1.json`), "utf8"));
const WORK = join(EXP, "models", `${STEMS[cid]}-run1`);
const frozen = JSON.parse(readFileSync(join(EXP, "..", "..", "..", "tests", "browser", "extension", "fixture", "heldout", "groundtruth.json"), "utf8"));

const iou = (a, b) => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return i === 0 ? 0 : i / (a.w * a.h + b.w * b.h - i);
};
const margin = (g, r) => Math.min(g.x - r.x, g.y - r.y, r.x + r.w - (g.x + g.w), r.y + r.h - (g.y + g.h));

/** Margins over sensitive glyphs against a mask. */
function g1Margins(mask, gt) {
  const margins = [];
  let unionOnly = 0;
  for (const s of gt.strings.filter((x) => x.sensitive)) {
    for (const g of s.glyphs) {
      const best = mask.reduce((m, r) => Math.max(m, margin(g, r)), -Infinity);
      if (best >= 0) margins.push(best);
      else unionOnly += 1; // covered (the verdict says so) but by no single rectangle
    }
  }
  margins.sort((a, b) => a - b);
  return {
    glyphs: margins.length + unionOnly,
    coveredByOneRect: margins.length,
    coveredOnlyByUnion: unionOnly,
    minPx: margins[0] ?? null,
    p05Px: margins[Math.floor(margins.length * 0.05)] ?? null,
    medianPx: margins[Math.floor(margins.length / 2)] ?? null,
    under1Px: margins.filter((m) => m < 1).length,
    under2Px: margins.filter((m) => m < 2).length,
  };
}

const out = { candidate: cid, note: "post-hoc diagnostics; gate nothing", perInput: {} };
const truthOf = (name) => (name === "dev" ? null : frozen.images.find((i) => i.image === name));

for (const [name, e] of Object.entries(r1.inputs)) {
  if (name === "synthetic") continue;
  const [, , H, W] = e.wasm.dims;
  const [srcH, srcW] = e.input.source_hw;
  const nativeMap = new Float32Array(new Uint8Array(readFileSync(join(WORK, `native-${name}.f32`))).buffer);
  const nativeBoxes = dbPostprocess(nativeMap, H, W, e.input.ratio_h, e.input.ratio_w, srcH, srcW).boxes;
  const wasmBoxes = e.boxes;
  let maxEdgeDelta = 0;
  let unmatched = 0;
  for (const b of wasmBoxes) {
    const m = nativeBoxes.reduce((best, n) => (iou(b, n) > iou(b, best ?? n) || !best ? n : best), null);
    if (!m || iou(b, m) < 0.5) {
      unmatched += 1;
      continue;
    }
    maxEdgeDelta = Math.max(maxEdgeDelta, Math.abs(b.x - m.x), Math.abs(b.y - m.y), Math.abs(b.x + b.w - m.x - m.w), Math.abs(b.y + b.h - m.y - m.h));
  }
  const entry = {
    boxes: { wasm: wasmBoxes.length, native: nativeBoxes.length, wasmUnmatchedInNative: unmatched, maxEdgeDeltaPx: maxEdgeDelta },
  };
  const gt = truthOf(name);
  if (gt) {
    const nat = scoreImage({ boxes: nativeBoxes }, gt);
    entry.nativeRe1 = { exposed: nat.exposedSensitiveGlyphs, overMaskRatio: nat.overMaskRatio, largest: nat.largestSingleBoxRegionShare, gates: nat.gates };
    entry.g1MarginWasm = g1Margins(redactionMask(wasmBoxes, gt.region), gt);
    const wasmScore = r1.heldOut.perImage.find((p) => p.image === name);
    entry.diagnosticsFromScorer = {
      nonSensitiveGlyphsFullyMasked: wasmScore.nonSensitiveGlyphsFullyMasked,
      maskedRegionShare: wasmScore.maskedRegionShare,
      minBestIouSensitive: Math.min(...wasmScore.strings.filter((s) => s.sensitive).map((s) => s.bestIouUndilated)),
    };
  } else {
    entry.devScreen = {
      detections: wasmBoxes.length,
      exposed: r1.developmentScreen.score.exposedSensitiveGlyphs,
      sensitiveInkMasked: r1.developmentScreen.score.strings.filter((s) => s.sensitive).map((s) => ({ id: s.id, inkAreaMasked: s.inkAreaMasked, bestIouUndilated: s.bestIouUndilated })),
      overMaskRatio: r1.developmentScreen.score.overMaskRatio,
      largestSingleBoxRegionShare: r1.developmentScreen.score.largestSingleBoxRegionShare,
      nonSensitiveGlyphsFullyMasked: r1.developmentScreen.score.nonSensitiveGlyphsFullyMasked,
      maskedRegionShare: r1.developmentScreen.score.maskedRegionShare,
    };
  }
  out.perInput[name] = entry;
}

const held = Object.entries(out.perInput).filter(([n]) => n !== "dev").map(([, e]) => e);
out.summary = {
  nativeBoxesPassEveryHeldOutGate: held.every((e) => Object.values(e.nativeRe1.gates).every(Boolean)),
  nativeExposedTotal: held.reduce((n, e) => n + e.nativeRe1.exposed, 0),
  g1MinMarginPx: Math.min(...held.map((e) => e.g1MarginWasm.minPx ?? Infinity)),
  g1GlyphsUnder1Px: held.reduce((n, e) => n + e.g1MarginWasm.under1Px, 0),
  g1GlyphsUnder2Px: held.reduce((n, e) => n + e.g1MarginWasm.under2Px, 0),
  g1GlyphsCoveredOnlyByUnion: held.reduce((n, e) => n + e.g1MarginWasm.coveredOnlyByUnion, 0),
  maxWasmNativeEdgeDeltaPx: Math.max(...Object.values(out.perInput).map((e) => e.boxes.maxEdgeDeltaPx)),
  boxCountDifferences: Object.fromEntries(Object.entries(out.perInput).map(([n, e]) => [n, e.boxes.wasm - e.boxes.native])),
};
writeFileSync(join(EXP, "results", `${cid.toLowerCase()}-diagnostics.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.summary, null, 1));
