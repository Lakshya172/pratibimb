/**
 * DETERMINISTIC BOX SETS FOR THE REDACTION-GEOMETRY EQUIVALENCE CHECK — geometry only.
 *
 * Every box here is derived from the FROZEN held-out ground truth (`fixture/heldout/groundtruth.json`)
 * by fixed arithmetic. No detector is involved, no model has seen the held-out set, and no character
 * is read: the inputs are the truth's own ink, line and glyph boxes, padded, shrunk, shifted, skewed
 * and combined in ways chosen to exercise every branch of the frozen union — dilation, repeated
 * merging, clipping at the region edge, quadrilateral input, empty input and INV-23 failure.
 *
 * These are NOT candidate detections and are never written into the ground truth. They exist so that
 * the pre-registered RE-1 scorer's geometry could be recorded BEFORE it was refactored onto the
 * canonical implementation in `packages/privacy`, and re-checked against that record for ever after.
 */
import { readFileSync } from "node:fs";

const GROUND_TRUTH = new URL("../extension/fixture/heldout/groundtruth.json", import.meta.url);

export function loadHeldOut() {
  return JSON.parse(readFileSync(GROUND_TRUTH, "utf8"));
}

const pad = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
const shift = (r, dx, dy) => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
/** A gently skewed quadrilateral around a box, as a rotated-text detector might emit. */
const quad = (r, k) => ({
  points: [
    [r.x, r.y + k],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h - k],
    [r.x, r.y + r.h],
  ],
});

/** The named box sets for one held-out image. Order is fixed; so is every number. */
export function boxSetsFor(image) {
  const s = image.strings;
  const region = image.region;
  return [
    ["ink", { boxes: s.map((x) => x.ink) }],
    ["line", { boxes: s.map((x) => x.line) }],
    ["glyphs", { boxes: s.flatMap((x) => x.glyphs) }],
    ["ink-pad-6", { boxes: s.map((x) => pad(x.ink, 6)) }],
    ["ink-pad-12", { boxes: s.map((x) => pad(x.ink, 12)) }],
    ["line-shrink-3", { boxes: s.map((x) => pad(x.line, -3)) }],
    ["ink-shift-right-5", { boxes: s.map((x) => shift(x.ink, 5, 0)) }],
    ["ink-shift-down-7", { boxes: s.map((x) => shift(x.ink, 0, 7)) }],
    ["line-quads", { boxes: s.map((x) => quad(x.line, 2)) }],
    ["sensitive-ink-only", { boxes: s.filter((x) => x.sensitive).map((x) => x.ink) }],
    ["non-sensitive-line-only", { boxes: s.filter((x) => !x.sensitive).map((x) => x.line) }],
    ["over-the-edge", { boxes: s.map((x) => pad(x.line, 40)) }],
    ["blanket", { boxes: [region] }],
    ["empty", { boxes: [] }],
    ["failed", { failed: true, boxes: [] }],
  ];
}
