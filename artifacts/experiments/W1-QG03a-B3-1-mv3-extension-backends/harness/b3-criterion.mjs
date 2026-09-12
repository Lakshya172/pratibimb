/**
 * QG-03a-B3-1 — the B2 comparison, unchanged in meaning, as pure functions.
 *
 * Ported from W1-QG03a-B2-real-model-nms/harness/analyze-b2.mjs. The categories, the matcher,
 * tau and preRegisteredPass are B2's; the only addition is `b1Pass`, which is the candidate B1
 * criterion as proposed in B2's decision.md: the pre-registered bound AND zero true failures.
 *
 * Decoding is the SHIPPED decodeHeadOutput + projectToCapture, passed in as `P` (the compiled
 * packages/perception/dist module). Nothing here re-implements decode or NMS.
 *
 * For each reference detection r, taking the best unused same-class match at IoU >= 0.5:
 *   identical        displacement 0
 *   same anchor      displacement <= tau (3x the largest raw box-channel difference, in CSS px)
 *   survivor swap    displacement > tau, but the match's centre lies inside r
 * TRUE FAILURES:
 *   off target       the match's centre lies outside r and inside no other reference box
 *   wrong element    the match's centre lies outside r but inside another reference box
 *   class change     no same-class match, but a different-class box at IoU >= 0.5
 *   element lost     no match at all
 *   material count   |count delta| > 2
 */
export const A = 6400;
export const CH = 12;
export const OP = 0.55;
export const CRITERION = Object.freeze({
  minMatchedAtIou50: 0.95,
  maxCountDelta: 2,
  maxCssDisplacementPx: 2.0,
  zeroTrueFailures: true,
  views: ["shipped", "op055"],
  status: "CANDIDATE: B1 ARCHITECT APPROVAL REQUIRED",
  origin: "numbers pre-registered in QG-03b-2 as an identical-input detector-equivalence criterion; proposed for backend-noise robustness in QG-03a-B2",
});

export function geometry(P, fixture) {
  const lb = P.computeLetterbox(fixture.captureSize, 640);
  const s = fixture.viewportCss.w / fixture.captureSize.w;
  return { lb, s, cssPerModel: s / lb.scale };
}

/** Shipped decode, then the continuous capture projection, then CSS. Emission order is kept. */
export function detect(P, out, geom) {
  const d = P.decodeHeadOutput({ data: out, dims: [1, CH, A] });
  if (!d.ok) return { error: d.code };
  return P.projectToCapture(d.value, geom.lb).map((x) => ({
    label: x.label,
    score: x.score,
    box: { x: x.box.x * geom.s, y: x.box.y * geom.s, w: x.box.w * geom.s, h: x.box.h * geom.s },
  }));
}

export const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const i = (x2 - x1) * (y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i);
};
export const centre = (b) => [b.x + b.w / 2, b.y + b.h / 2];
export const inside = (p, b) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
export const disp = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));

export function rawDiff(a, b) {
  if (a.length !== b.length) throw new Error(`rawDiff: length ${a.length} vs ${b.length}`);
  let max = 0, sum = 0, signed = 0, n = 0, boxMax = 0, clsMax = 0, relMax = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    signed += b[i] - a[i];
    if (d > 0) n += 1;
    if (d > max) max = d;
    if (Math.floor(i / A) < 4) { if (d > boxMax) boxMax = d; } else if (d > clsMax) clsMax = d;
    const rel = d / Math.max(Math.abs(a[i]), 1e-6);
    if (d > 0 && rel > relMax) relMax = rel;
  }
  return { maxAbs: max, meanAbs: sum / a.length, meanSigned: signed / a.length, elementsDiffering: n, boxChannelMaxAbs: boxMax, classChannelMaxAbs: clsMax, maxRelative: relMax };
}

export function classify(ref, got, tauCss) {
  const o = { ref: ref.length, got: got.length, countDelta: got.length - ref.length, identical: 0, sameAnchor: 0, survivorSwap: 0, offTarget: 0, wrongElement: 0, classChange: 0, elementLost: 0, worstMatchedDispCss: 0, worstSwapDispCss: 0, minMatchedIou: 1 };
  const used = new Set();
  for (const r of ref) {
    let bj = -1, bi = 0.5;
    got.forEach((g, j) => { if (used.has(j) || g.label !== r.label) return; const v = iou(r.box, g.box); if (v >= bi) { bi = v; bj = j; } });
    if (bj >= 0) {
      used.add(bj);
      const g = got[bj];
      const d = disp(r.box, g.box);
      o.worstMatchedDispCss = Math.max(o.worstMatchedDispCss, d);
      o.minMatchedIou = Math.min(o.minMatchedIou, bi);
      if (d === 0) o.identical += 1;
      else if (d <= tauCss) o.sameAnchor += 1;
      else {
        const c = centre(g.box);
        if (inside(c, r.box)) { o.survivorSwap += 1; o.worstSwapDispCss = Math.max(o.worstSwapDispCss, d); }
        else if (ref.some((r2) => r2 !== r && inside(c, r2.box))) o.wrongElement += 1;
        else o.offTarget += 1;
      }
    } else if (got.some((g) => g.label !== r.label && iou(r.box, g.box) >= 0.5)) o.classChange += 1;
    else o.elementLost += 1;
  }
  o.matched = o.ref - o.elementLost - o.classChange;
  o.matchedFraction = o.ref === 0 ? 1 : o.matched / o.ref;
  o.materialCountChange = Math.abs(o.countDelta) > CRITERION.maxCountDelta;
  o.trueFailures = o.offTarget + o.wrongElement + o.classChange + o.elementLost + (o.materialCountChange ? 1 : 0);
  // B2's formula, unchanged: matched share, count change and worst displacement.
  o.preRegisteredPass = o.matchedFraction >= CRITERION.minMatchedAtIou50 && Math.abs(o.countDelta) <= CRITERION.maxCountDelta && o.worstMatchedDispCss <= CRITERION.maxCssDisplacementPx;
  // The candidate B1 criterion: the pre-registered bound AND zero true failures.
  o.b1Pass = o.preRegisteredPass && o.trueFailures === 0;
  return o;
}

export const view = (dets, v) => (v === "op055" ? dets.filter((d) => d.score >= OP) : dets);

/** One fixture, one pair. A decode refusal on either side is a failure, never a skip. */
export function compare(P, aOut, bOut, geom) {
  const raw = rawDiff(aOut, bOut);
  const tauCss = 3 * raw.boxChannelMaxAbs * geom.cssPerModel + 1e-9;
  const da = detect(P, aOut, geom), db = detect(P, bOut, geom);
  if (da.error || db.error) return { raw, tauCss, error: da.error || db.error, b1Pass: false };
  const shipped = classify(da, db, tauCss);
  const op055 = classify(view(da, "op055"), view(db, "op055"), tauCss);
  return { raw, tauCss, shipped, op055, b1Pass: shipped.b1Pass && op055.b1Pass };
}

export function sumRows(rows, key) {
  const acc = { fixtures: rows.length, errors: 0, identical: 0, sameAnchor: 0, survivorSwap: 0, offTarget: 0, wrongElement: 0, classChange: 0, elementLost: 0, materialCountChanges: 0, trueFailures: 0, refDetections: 0, preRegisteredPass: 0, b1Pass: 0, worstMatchedDispCss: 0, worstSwapDispCss: 0, minMatchedIou: 1, minMatchedFraction: 1, maxAbsCountDelta: 0 };
  for (const r of rows) {
    const c = r[key];
    if (!c) { acc.errors += 1; continue; }
    for (const k of ["identical", "sameAnchor", "survivorSwap", "offTarget", "wrongElement", "classChange", "elementLost", "trueFailures"]) acc[k] += c[k];
    acc.refDetections += c.ref;
    if (c.materialCountChange) acc.materialCountChanges += 1;
    if (c.preRegisteredPass) acc.preRegisteredPass += 1;
    if (c.b1Pass) acc.b1Pass += 1;
    acc.worstMatchedDispCss = Math.max(acc.worstMatchedDispCss, c.worstMatchedDispCss);
    acc.worstSwapDispCss = Math.max(acc.worstSwapDispCss, c.worstSwapDispCss);
    acc.minMatchedIou = Math.min(acc.minMatchedIou, c.minMatchedIou);
    acc.minMatchedFraction = Math.min(acc.minMatchedFraction, c.matchedFraction);
    acc.maxAbsCountDelta = Math.max(acc.maxAbsCountDelta, Math.abs(c.countDelta));
  }
  return acc;
}

/**
 * The criterion over a set of fixtures: every fixture must pass in BOTH views, and no row may
 * have errored. Returns the counts that make the verdict checkable.
 */
export function criterionOver(rows) {
  const shipped = sumRows(rows, "shipped");
  const op055 = sumRows(rows, "op055");
  const failing = rows.filter((r) => !r.b1Pass).map((r) => r.name);
  return { fixtures: rows.length, fixturesMeeting: rows.length - failing.length, failing, met: rows.length > 0 && failing.length === 0, shipped, op055 };
}

/** Margin only, never a gate: scale the ACTUAL difference between two real outputs. */
export function scaledDelta(P, refOut, otherOut, geom, alpha) {
  const p = new Float32Array(refOut.length);
  for (let i = 0; i < refOut.length; i += 1) {
    p[i] = Math.fround(refOut[i] + alpha * (otherOut[i] - refOut[i]));
    if (i >= 4 * A) p[i] = Math.min(1, Math.max(0, p[i]));
  }
  return compare(P, refOut, p, geom);
}
