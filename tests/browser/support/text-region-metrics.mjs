/**
 * THE VISUAL-TEXT SCREEN METRICS — one implementation, shared, so every detector is judged by the
 * same code.
 *
 * Moved verbatim out of `tests/browser/extension/run-text-region-eval.mjs` (M7), which scored the
 * shipped UI head, so that M7.1's scoring of `PP-OCRv5_mobile_det` cannot differ from the floor by
 * anything but the boxes. Thresholds are the ones pre-registered in
 * `docs/perception/text-region-acceptance.md`; none is defined anywhere else.
 */

/**
 * THE PRE-REGISTERED THRESHOLDS, quoted from `docs/perception/text-region-acceptance.md`.
 *
 * Reproduced rather than re-derived, and named after the criterion they come from, so a reader can
 * check them against the frozen document in one pass.
 */
export const CRITERIA = Object.freeze({
  localisationIou: 0.5, // criterion 2, quoted from constitution §7
  secretContainment: 0.95, // criterion 3
  floodAreaRatio: 3, // criterion 4
  wholeCanvasShare: 0.9, // criterion 4, second clause
});

export const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);
export const intersect = (a, b) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 <= x1 || y2 <= y1 ? 0 : (x2 - x1) * (y2 - y1);
};
export const iou = (a, b) => {
  const i = intersect(a, b);
  return i === 0 ? 0 : i / (area(a) + area(b) - i);
};
export const round = (n, p = 3) => Math.round(n * 10 ** p) / 10 ** p;

/**
 * How much of `region` the UNION of `boxes` covers — criterion 3.
 *
 * By scanline over the region rather than by summing per-box overlaps, because overlapping
 * predictions would otherwise be counted twice and a flood would "cover" more than 100%. One CSS
 * pixel per row and column: the regions here are tens of pixels tall, so exactness costs nothing.
 */
export function unionContainment(region, boxes) {
  if (area(region) === 0) return 0;
  const clipped = boxes.map((b) => ({
    x0: Math.max(b.x, region.x),
    x1: Math.min(b.x + b.w, region.x + region.w),
    y0: Math.max(b.y, region.y),
    y1: Math.min(b.y + b.h, region.y + region.h),
  })).filter((c) => c.x1 > c.x0 && c.y1 > c.y0);
  if (clipped.length === 0) return 0;
  let covered = 0;
  for (let y = region.y; y < region.y + region.h; y += 1) {
    const spans = clipped.filter((c) => y >= c.y0 && y < c.y1).map((c) => [c.x0, c.x1]).sort((a, b) => a[0] - b[0]);
    let reach = -Infinity;
    for (const [x0, x1] of spans) {
      const from = Math.max(x0, reach);
      if (x1 > from) {
        covered += x1 - from;
        reach = x1;
      }
    }
  }
  return covered / area(region);
}

/** Score one reading of the detections against the pre-registered criteria. */
export function screen(name, boxes, textRegions, canvas) {
  const sensitive = textRegions.filter((r) => r.sensitive);
  const perRegion = sensitive.map((region) => {
    const bestIou = boxes.reduce((acc, b) => Math.max(acc, iou(b, region)), 0);
    const containment = unionContainment(region, boxes);
    return {
      id: region.id,
      chars: region.chars,
      box: region,
      bestIou: round(bestIou),
      containment: round(containment),
      localised: bestIou >= CRITERIA.localisationIou,
      covered: containment >= CRITERIA.secretContainment,
    };
  });

  const insideCanvas = boxes.filter((b) => intersect(b, canvas) > 0);
  const predictedTextArea = insideCanvas.reduce((sum, b) => sum + intersect(b, canvas), 0);
  const trueTextArea = textRegions.reduce((sum, r) => sum + area(r), 0);
  const ratio = trueTextArea === 0 ? Infinity : predictedTextArea / trueTextArea;
  const widest = boxes.reduce((acc, b) => Math.max(acc, intersect(b, canvas) / area(canvas)), 0);

  return {
    reading: name,
    boxes: boxes.length,
    perRegion,
    flood: {
      predictionsInsideCanvas: insideCanvas.length,
      predictedAreaPx: Math.round(predictedTextArea),
      trueTextAreaPx: Math.round(trueTextArea),
      ratio: Number.isFinite(ratio) ? round(ratio, 2) : null,
      widestShareOfCanvas: round(widest),
    },
    criteria: {
      /** Criterion 2 — every sensitive region localised at IoU >= 0.5. */
      localisation: perRegion.every((r) => r.localised),
      /** Criterion 3 — every sensitive region >= 95% covered by the union. */
      secretCoverage: perRegion.every((r) => r.covered),
      /** Criterion 4 — predicted text area bounded, and nothing swallows the canvas. */
      noFlood: Number.isFinite(ratio) && ratio <= CRITERIA.floodAreaRatio && widest < CRITERIA.wholeCanvasShare,
    },
  };
}

