/**
 * REDACTION-ORIENTED SCORING — the NEXT-CANDIDATE CRITERION for visual-text detectors (RE-1).
 *
 * Pre-registered in `docs/perception/redaction-evaluation.md` on 2026-09-25, BEFORE any candidate
 * was scored with it. It applies to candidates evaluated AFTER that date. It does not re-score
 * `PP-OCRv5_mobile_det`, whose verdict of record — REJECTED FOR V1 — was reached under
 * `docs/perception/text-region-acceptance.md` and scored by `text-region-metrics.mjs`, which is
 * left exactly as it was.
 *
 * WHAT IT MEASURES IS THE MASK, NOT THE BOX. A detector's boxes are turned into the redaction mask
 * the FROZEN union semantics define (`docs/security/security-invariants.md`, "Redaction union
 * semantics — FROZEN"): every box dilated 4 px, boxes merged at IoU > 0.3. The mask is then compared
 * with ground truth. Tight-box localisation is reported, and gates nothing.
 *
 * WHY THE GATES ARE ASYMMETRIC. The same frozen section says it in one line: "over-masking is free
 * and under-masking is fatal." So coverage of sensitive ink is absolute — zero exposed sensitive
 * glyphs — while over-masking is bounded only to stop a degenerate detector from buying coverage by
 * masking everything. The two are never traded against each other.
 *
 * NO TEXT ANYWHERE. Ground truth here is geometry: boxes, a sensitive flag and glyph indices. The
 * scorer never needs, and never receives, a character.
 *
 * ONE GEOMETRY (M7.3). As pre-registered, this file carried its own implementation of the union.
 * It now imports the canonical one from `packages/privacy/src/redactionGeometry.ts` — the product's
 * redaction geometry — and keeps only the METRICS. The refactor changed no output:
 * `redaction-geometry.golden.json`, recorded from this file as committed in aabf558 before the
 * change, is reproduced exactly (90 cases across the six held-out images), and a test holds it so.
 */
import {
  REDACTION_UNION,
  clipTo,
  dilate,
  failClosedMask,
  maskCoverage,
  overlapRatio,
  rectArea,
  redactionMask,
  toAxisAligned,
} from "../../../packages/privacy/src/redactionGeometry.ts";

/** The names the pre-registered scorer exported, now bound to the canonical implementation. */
export { overlapRatio as iou, toAxisAligned as toRect, redactionMask as unionMask, maskCoverage as coveredArea };

/** RE-1. Every value is quoted from a frozen rule or derived in redaction-evaluation.md §4. */
export const REDACTION_CRITERIA = Object.freeze({
  version: "RE-1",
  /** Quoted: "Boxes dilated 4 px and merged at IoU > 0.3" — security-invariants.md, FROZEN. */
  unionDilationPx: REDACTION_UNION.dilationPx,
  unionMergeIou: REDACTION_UNION.mergeIou,
  /** GATE 1, safety. Not one sensitive glyph may be left partly visible. */
  maxExposedSensitiveGlyphs: 0,
  /** GATE 2, utility. Masked non-text area at most 1.0x the text's own line-box area. */
  maxOverMaskRatio: 1.0,
  /** GATE 3, degeneracy. Quoted from text-region-acceptance.md criterion 4 (unchanged value). */
  maxSingleBoxRegionShare: 0.9,
  /** GATE 5, runtime. Quoted: W1-S04a-1's frozen WASM rule. */
  wasmRtolSumAbs: 2e-2,
  /** Held-out size floors, so "zero exposed" means something (see §6 of the design). */
  minImages: 6,
  minSensitiveStrings: 12,
  minSensitiveGlyphs: 150,
});

/** Absolute area tolerance, px². Floating-point residue only; not a coverage allowance. */
const AREA_EPS = 1e-6;

/**
 * Score one image.
 *
 * `prediction.failed` is INV-23: a detector that errors or times out counts as a positive, so the
 * whole visual-only region is masked. That is safe, and it fails the utility gate — which is the
 * honest outcome for a detector that did not work.
 *
 * `gt` = { region, strings: [{ id, sensitive, ink, line, glyphs: [{ x, y, w, h }] }] } — geometry
 * only, no characters.
 */
export function scoreImage(prediction, gt) {
  const C = REDACTION_CRITERIA;
  const region = gt.region;
  const boxes = prediction.failed ? [] : prediction.boxes.map(toAxisAligned);
  const mask = prediction.failed ? failClosedMask(region) : redactionMask(boxes, region);

  const exposed = [];
  let sensitiveGlyphs = 0;
  let nonSensitiveGlyphs = 0;
  let nonSensitiveCovered = 0;
  const strings = gt.strings.map((s) => {
    let covered = 0;
    s.glyphs.forEach((g, index) => {
      const full = maskCoverage(g, mask) >= rectArea(g) - AREA_EPS;
      if (s.sensitive) {
        sensitiveGlyphs += 1;
        if (!full) exposed.push({ string: s.id, glyph: index });
      } else {
        nonSensitiveGlyphs += 1;
        if (full) nonSensitiveCovered += 1;
      }
      if (full) covered += 1;
    });
    const bestIou = boxes.reduce((m, b) => Math.max(m, overlapRatio(b, s.ink)), 0);
    return {
      id: s.id,
      sensitive: s.sensitive,
      glyphs: s.glyphs.length,
      glyphsFullyMasked: covered,
      inkAreaMasked: rectArea(s.ink) === 0 ? 1 : maskCoverage(s.ink, mask) / rectArea(s.ink),
      /** Diagnostic only. RE-1 gates nothing on it. */
      bestIouUndilated: bestIou,
    };
  });

  // Over-masking: masked area outside the text's line boxes, each allowed the frozen 4 px dilation.
  const lines = gt.strings.map((s) => clipTo(s.line, region)).filter(Boolean);
  const allowed = lines.map((l) => dilate(l, C.unionDilationPx));
  const lineArea = maskCoverage(region, lines);
  const overMaskArea = maskCoverage(region, mask, allowed);
  const overMaskRatio = lineArea === 0 ? Infinity : overMaskArea / lineArea;

  const regionArea = rectArea(region);
  const perBoxShare = prediction.failed
    ? [1]
    : boxes.map((b) => {
        const c = clipTo(dilate(b, C.unionDilationPx), region);
        return c ? rectArea(c) / regionArea : 0;
      });
  const largestShare = perBoxShare.length ? Math.max(...perBoxShare) : 0;

  return {
    failed: Boolean(prediction.failed),
    boxes: boxes.length,
    maskRects: mask.length,
    sensitiveGlyphs,
    exposedSensitiveGlyphs: exposed.length,
    exposed,
    /** Diagnostic: under the fail-closed policy all visual-only text is masked, so this is expected high. */
    nonSensitiveGlyphsFullyMasked: nonSensitiveGlyphs === 0 ? null : nonSensitiveCovered / nonSensitiveGlyphs,
    strings,
    lineAreaPx: lineArea,
    overMaskAreaPx: overMaskArea,
    overMaskRatio,
    largestSingleBoxRegionShare: largestShare,
    maskedRegionShare: maskCoverage(region, mask) / regionArea,
    gates: {
      noExposedSensitiveGlyph: exposed.length <= C.maxExposedSensitiveGlyphs,
      overMaskWithinBudget: overMaskRatio <= C.maxOverMaskRatio,
      noBlanketBox: largestShare < C.maxSingleBoxRegionShare,
    },
  };
}

/**
 * The set-level verdict. Every gate must hold on EVERY image — an average would let one leaking
 * image hide behind five clean ones.
 */
export function scoreSet(perImage, { wasmPassedOnEveryInput, deterministic, noPlaintextOutput }) {
  const C = REDACTION_CRITERIA;
  const sensitiveStrings = perImage.reduce((n, r) => n + r.strings.filter((s) => s.sensitive).length, 0);
  const sensitiveGlyphs = perImage.reduce((n, r) => n + r.sensitiveGlyphs, 0);
  const every = (k) => perImage.length > 0 && perImage.every((r) => r.gates[k] === true);
  const sizeOk = perImage.length >= C.minImages && sensitiveStrings >= C.minSensitiveStrings && sensitiveGlyphs >= C.minSensitiveGlyphs;
  const gates = {
    heldOutLargeEnough: sizeOk,
    noExposedSensitiveGlyph: every("noExposedSensitiveGlyph"),
    overMaskWithinBudget: every("overMaskWithinBudget"),
    noBlanketBox: every("noBlanketBox"),
    wasmValidOnEveryInput: wasmPassedOnEveryInput === true,
    deterministic: deterministic === true,
    noPlaintextOutput: noPlaintextOutput === true,
  };
  return {
    criterion: C.version,
    images: perImage.length,
    sensitiveStrings,
    sensitiveGlyphs,
    /** Rule of three: with zero exposures in n glyphs, the 95% upper bound on the per-glyph miss rate. */
    perGlyphMissRateUpper95: sensitiveGlyphs > 0 ? 3 / sensitiveGlyphs : null,
    gates,
    pass: Object.values(gates).every((v) => v === true),
  };
}
