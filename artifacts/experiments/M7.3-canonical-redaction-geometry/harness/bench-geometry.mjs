#!/usr/bin/env node
/**
 * M7.3 — what the canonical redaction geometry costs on W1, stage by stage.
 *
 * Box sets are the geometry-only sets derived from the frozen held-out truth (no detector, no model).
 * Each stage is timed separately with the canonical functions themselves, then the whole
 * `redactionMask` call. Medians over many iterations; W1 only, Node, not a browser, not general.
 */
import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { clipTo, dilate, mergeOverlapping, redactionMask, toAxisAligned } from "../../../../packages/privacy/src/redactionGeometry.ts";
import { boxSetsFor, loadHeldOut } from "../../../../tests/browser/support/redaction-golden-inputs.mjs";

const SETS = ["ink", "line", "ink-pad-6", "glyphs", "over-the-edge"];
const WARM = 300;
const RUNS = 3000;
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const time = (fn) => {
  for (let i = 0; i < WARM; i += 1) fn();
  const t = [];
  for (let i = 0; i < RUNS; i += 1) {
    const s = process.hrtime.bigint();
    fn();
    t.push(Number(process.hrtime.bigint() - s) / 1000);
  }
  return Math.round(median(t) * 10) / 10;
};

const rows = [];
for (const image of loadHeldOut().images) {
  for (const [name, p] of boxSetsFor(image)) {
    if (!SETS.includes(name)) continue;
    const region = image.region;
    const aligned = p.boxes.map(toAxisAligned);
    const dilated = aligned.map((b) => dilate(b));
    const merged = mergeOverlapping(dilated);
    rows.push({
      image: image.image,
      set: name,
      boxes: p.boxes.length,
      maskRects: redactionMask(p.boxes, region).length,
      us: {
        dilate: time(() => p.boxes.map((b) => dilate(toAxisAligned(b)))),
        merge: time(() => mergeOverlapping(dilated)),
        clip: time(() => merged.map((r) => clipTo(r, region)).filter(Boolean)),
        total: time(() => redactionMask(p.boxes, region)),
      },
    });
  }
}
const record = {
  experiment: "M7.3-canonical-redaction-geometry-cost",
  workstation: "W1",
  cpu: cpus()[0]?.model ?? null,
  runtime: `node ${process.version}`,
  method: `median of ${RUNS} calls after ${WARM} warm-up, per stage, microseconds`,
  rows,
};
writeFileSync(new URL("../logs/w1-geometry-cost.json", import.meta.url), JSON.stringify(record, null, 2) + "\n");
console.log(`${record.cpu} · ${record.runtime}`);
for (const r of rows) {
  console.log(`${r.image} ${r.set.padEnd(14)} boxes ${String(r.boxes).padStart(3)} -> ${String(r.maskRects).padStart(3)} rects | dilate ${r.us.dilate} merge ${r.us.merge} clip ${r.us.clip} total ${r.us.total} us`);
}
