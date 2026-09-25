#!/usr/bin/env node
/**
 * RECORD THE PRE-REGISTERED RE-1 GEOMETRY — run ONCE, against the scorer exactly as committed in
 * aabf558, BEFORE it was refactored onto `packages/privacy/src/redactionGeometry.ts`.
 *
 * Writes the mask and the full score for every derived box set on every held-out image. The
 * equivalence test then requires the refactored scorer AND the canonical product geometry to
 * reproduce this file exactly. Refuses to run if the scorer differs from the pre-registered commit.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

import { REDACTION_CRITERIA, scoreImage, unionMask } from "./redaction-metrics.mjs";
import { boxSetsFor, loadHeldOut } from "./redaction-golden-inputs.mjs";

const PRE_REGISTERED = "aabf558";
const diff = execFileSync("git", ["diff", "--stat", PRE_REGISTERED, "--", "tests/browser/support/redaction-metrics.mjs"], { encoding: "utf8" });
if (diff.trim() !== "") {
  console.error("REFUSING: redaction-metrics.mjs differs from the pre-registered commit; the golden must come from it.");
  process.exit(1);
}

const heldOut = loadHeldOut();
const cases = [];
for (const image of heldOut.images) {
  const gt = { region: image.region, strings: image.strings };
  for (const [name, prediction] of boxSetsFor(image)) {
    const mask = prediction.failed ? [image.region] : unionMask(prediction.boxes, image.region);
    cases.push({ image: image.image, set: name, mask, score: scoreImage(prediction, gt) });
  }
}
const body = { criterion: REDACTION_CRITERIA.version, recordedFrom: PRE_REGISTERED, cases };
const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
writeFileSync(
  new URL("./redaction-geometry.golden.json", import.meta.url),
  JSON.stringify({ note: "Geometry only. Recorded from the pre-registered RE-1 scorer before refactoring.", sha256OfBody: digest, ...body }, null, 1) + "\n"
);
console.log(`recorded ${cases.length} cases from ${heldOut.images.length} held-out images · body sha256 ${digest}`);
