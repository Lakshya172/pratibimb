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
 */

/** RE-1. Every value is quoted from a frozen rule or derived in redaction-evaluation.md §4. */
export const REDACTION_CRITERIA = Object.freeze({
  version: "RE-1",
  /** Quoted: "Boxes dilated 4 px and merged at IoU > 0.3" — security-invariants.md, FROZEN. */
  unionDilationPx: 4,
  unionMergeIou: 0.3,
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

const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);

const clip = (r, to) => {
  const x0 = Math.max(r.x, to.x);
  const y0 = Math.max(r.y, to.y);
  const x1 = Math.min(r.x + r.w, to.x + to.w);
  const y1 = Math.min(r.y + r.h, to.y + to.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

export const iou = (a, b) => {
  const i = clip(a, b);
  if (!i) return 0;
  const inter = area(i);
  return inter / (area(a) + area(b) - inter);
};

/**
 * Any detector output as an axis-aligned rectangle.
 *
 * A rotated box or quadrilateral becomes its axis-aligned bounding rectangle. That can only ADD
 * masked area, never remove it — the safe direction under "over-masking is free".
 */
export function toRect(box) {
  if (Array.isArray(box?.points)) {
    const xs = box.points.map((p) => p[0]);
    const ys = box.points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

const dilate = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

const bounds = (a, b) => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * The redaction mask the frozen union semantics produce from a set of boxes.
 *
 * Dilate every box by 4 px, then repeatedly merge any pair with IoU > 0.3 into their bounding
 * rectangle until no pair qualifies, then clip to the region being redacted. Deterministic: pairs
 * are examined in a fixed order. Merging can only grow the mask.
 */
export function unionMask(boxes, region) {
  let rects = boxes.map((b) => dilate(toRect(b), REDACTION_CRITERIA.unionDilationPx));
  const order = (a, b) => a.y - b.y || a.x - b.x || a.w - b.w || a.h - b.h;
  let merged = true;
  while (merged) {
    merged = false;
    rects.sort(order);
    outer: for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        if (iou(rects[i], rects[j]) > REDACTION_CRITERIA.unionMergeIou) {
          const m = bounds(rects[i], rects[j]);
          rects = rects.filter((_, k) => k !== i && k !== j);
          rects.push(m);
          merged = true;
          break outer;
        }
      }
    }
  }
  return rects.map((r) => clip(r, region)).filter((r) => r !== null);
}

/**
 * Exact area of `within` covered by the union of `cover`, optionally excluding the union of `exclude`.
 *
 * Coordinate compression over every edge involved, then each elementary cell is tested at its
 * centre. Exact for axis-aligned rectangles — no pixel grid, no sampling, no rounding.
 */
export function coveredArea(within, cover, exclude = []) {
  const parts = cover.map((r) => clip(r, within)).filter(Boolean);
  if (parts.length === 0) return 0;
  const cuts = exclude.map((r) => clip(r, within)).filter(Boolean);
  const xs = new Set([within.x, within.x + within.w]);
  const ys = new Set([within.y, within.y + within.h]);
  for (const r of [...parts, ...cuts]) {
    xs.add(r.x).add(r.x + r.w);
    ys.add(r.y).add(r.y + r.h);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const inside = (rs, cx, cy) => rs.some((r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h);
  let total = 0;
  for (let i = 0; i + 1 < X.length; i += 1) {
    const cx = (X[i] + X[i + 1]) / 2;
    for (let j = 0; j + 1 < Y.length; j += 1) {
      const cy = (Y[j] + Y[j + 1]) / 2;
      if (inside(parts, cx, cy) && !inside(cuts, cx, cy)) total += (X[i + 1] - X[i]) * (Y[j + 1] - Y[j]);
    }
  }
  return total;
}

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
  const boxes = prediction.failed ? [] : prediction.boxes.map(toRect);
  const mask = prediction.failed ? [region] : unionMask(boxes, region);

  const exposed = [];
  let sensitiveGlyphs = 0;
  let nonSensitiveGlyphs = 0;
  let nonSensitiveCovered = 0;
  const strings = gt.strings.map((s) => {
    let covered = 0;
    s.glyphs.forEach((g, index) => {
      const full = coveredArea(g, mask) >= area(g) - AREA_EPS;
      if (s.sensitive) {
        sensitiveGlyphs += 1;
        if (!full) exposed.push({ string: s.id, glyph: index });
      } else {
        nonSensitiveGlyphs += 1;
        if (full) nonSensitiveCovered += 1;
      }
      if (full) covered += 1;
    });
    const bestIou = boxes.reduce((m, b) => Math.max(m, iou(b, s.ink)), 0);
    return {
      id: s.id,
      sensitive: s.sensitive,
      glyphs: s.glyphs.length,
      glyphsFullyMasked: covered,
      inkAreaMasked: area(s.ink) === 0 ? 1 : coveredArea(s.ink, mask) / area(s.ink),
      /** Diagnostic only. RE-1 gates nothing on it. */
      bestIouUndilated: bestIou,
    };
  });

  // Over-masking: masked area outside the text's line boxes, each allowed the frozen 4 px dilation.
  const lines = gt.strings.map((s) => clip(s.line, region)).filter(Boolean);
  const allowed = lines.map((l) => dilate(l, C.unionDilationPx));
  const lineArea = coveredArea(region, lines);
  const overMaskArea = coveredArea(region, mask, allowed);
  const overMaskRatio = lineArea === 0 ? Infinity : overMaskArea / lineArea;

  const regionArea = area(region);
  const perBoxShare = prediction.failed
    ? [1]
    : boxes.map((b) => {
        const c = clip(dilate(b, C.unionDilationPx), region);
        return c ? area(c) / regionArea : 0;
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
    maskedRegionShare: coveredArea(region, mask) / regionArea,
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
