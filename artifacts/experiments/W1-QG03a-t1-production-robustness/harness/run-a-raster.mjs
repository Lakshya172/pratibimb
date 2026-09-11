/**
 * QG-03a-A — the SHIPPED rasteriser against the Pillow reference, stage by stage, in Node.
 *
 *   python .../harness/qg03a_reference.py          (first: builds reference.json + generated/)
 *   npm run typecheck                               (builds packages/perception/dist)
 *   node   .../harness/run-a-raster.mjs --label=<before|after>
 *
 * The input is the reference's own decoded RGB, so this isolates the RASTER arithmetic
 * (resize, placement, pad, normalise) from image decoding. run-a-browser.mjs covers the
 * native decode.
 *
 * It compares stages IN ORDER and names the FIRST one that diverges. It also reports the
 * size of any divergence, because "differs" and "differs by one row of pixels" are different
 * findings.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const LOGS = join(HERE, "..", "logs");
const GEN = join(HERE, "generated");
const P = await import(pathToFileURL(join(ROOT, "packages/perception/dist/src/index.js")).href);
const label = (process.argv.find((a) => a.startsWith("--label=")) ?? "--label=run").split("=")[1];

const ref = JSON.parse(readFileSync(join(HERE, "reference.json"), "utf8"));
const sha = (u8) => createHash("sha256").update(u8).digest("hex");
const GEOM = ["resizedW", "resizedH", "padLeft", "padTop", "padRight", "padBottom", "padByte"];

function diff(a, b) {
  if (a.length !== b.length) return { comparable: false, lengthShipped: a.length, lengthReference: b.length };
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
    sum += d;
    if (d) n += 1;
  }
  return { comparable: true, maxAbs: max, meanAbs: sum / a.length, fractionDiffering: n / a.length };
}

function rgbaOf(rgb, w, h) {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i += 1, j += 4) {
    rgba[j] = rgb[i * 3];
    rgba[j + 1] = rgb[i * 3 + 1];
    rgba[j + 2] = rgb[i * 3 + 2];
    rgba[j + 3] = 255;
  }
  return rgba;
}

const rows = [];
for (const f of ref.fixtures) {
  const { w, h } = f.source;
  const rgba = rgbaOf(readFileSync(join(GEN, `${f.name}.decoded.u8`)), w, h);
  const got = P.preprocessToTensor({ width: w, height: h, rgba }, P.HEAD_CONTRACT);
  const g = got.transform;
  const geometryMatches = GEOM.every((k) => g[k] === f.geometry[k]);
  const stages = {};
  for (const s of ["decoded", "resized", "letterboxed"]) stages[s] = sha(got[s]) === f.digests[s];
  stages.tensor =
    sha(new Uint8Array(got.tensor.buffer, got.tensor.byteOffset, got.tensor.byteLength)) === f.digests.tensor;
  const firstDivergence = !geometryMatches
    ? "geometry"
    : (["decoded", "resized", "letterboxed", "tensor"].find((s) => !stages[s]) ?? null);
  let letterboxedDiff = null;
  if (!stages.letterboxed) {
    const d = diff(got.letterboxed, readFileSync(join(GEN, `${f.name}.letterboxed.u8`)));
    // The tensor is letterboxed/255 exactly, so its differences are the byte differences / 255.
    letterboxedDiff = d.comparable ? { ...d, tensorMaxAbs: d.maxAbs / 255, tensorMeanAbs: d.meanAbs / 255 } : d;
  }
  rows.push({
    name: f.name,
    set: f.set,
    source: f.source,
    exactHalf: f.exactHalf,
    geometryMatches,
    shipped: Object.fromEntries(GEOM.slice(0, 4).map((k) => [k, g[k]])),
    reference: Object.fromEntries(GEOM.slice(0, 4).map((k) => [k, f.geometry[k]])),
    stages,
    firstDivergence,
    conformant: firstDivergence === null,
    letterboxedDiff,
  });
}

// Cost of the shipped preprocessing at production sizes, median of 7 runs, in NODE (V8).
// Browser figures come from run-a-browser.mjs. These two are never mixed.
const timing = {};
for (const name of ["cap-1264x800", "cap-1920x1080", "cap-2560x1600"]) {
  const f = ref.fixtures.find((x) => x.name === name);
  if (!f) continue;
  const rgba = rgbaOf(readFileSync(join(GEN, `${f.name}.decoded.u8`)), f.source.w, f.source.h);
  const samples = [];
  for (let i = 0; i < 7; i += 1) {
    const t0 = performance.now();
    P.preprocessToTensor({ width: f.source.w, height: f.source.h, rgba }, P.HEAD_CONTRACT);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  timing[name] = { medianMs: Math.round(samples[3] * 10) / 10, runs: 7, runtime: `node ${process.version}` };
}

const failures = rows.filter((r) => !r.conformant);
const out = {
  experiment: "W1-QG03a / A / node raster conformance",
  label,
  runAt: new Date().toISOString(),
  runtime: { node: process.version, platform: `${process.platform} ${process.arch}` },
  reference: ref.reference,
  historicalCheck: ref.historicalCheck,
  summary: {
    fixtures: rows.length,
    conformant: rows.length - failures.length,
    nonConformant: failures.length,
    nonConformantNames: failures.map((r) => r.name),
    allNonConformantAreExactHalfDisagreements: failures.every(
      (r) => r.firstDivergence === "geometry" && (r.exactHalf.w || r.exactHalf.h)
    ),
  },
  timing,
  rows,
};
mkdirSync(LOGS, { recursive: true });
const path = join(LOGS, `a-raster-node-${label}.json`);
writeFileSync(path, JSON.stringify(out, null, 1));
console.log(`fixtures ${rows.length}, conformant ${out.summary.conformant}, non-conformant ${failures.length}`);
for (const r of failures) {
  console.log(
    `  ${r.name.padEnd(20)} first divergence: ${r.firstDivergence}  shipped ${JSON.stringify(r.shipped)}  ` +
      `reference ${JSON.stringify(r.reference)}  ` +
      (r.letterboxedDiff?.comparable
        ? `letterboxed maxAbs ${r.letterboxedDiff.maxAbs} meanAbs ${r.letterboxedDiff.meanAbs.toFixed(3)} ` +
          `differing ${(r.letterboxedDiff.fractionDiffering * 100).toFixed(1)}%`
        : "")
  );
}
console.log("timing (node):", JSON.stringify(timing));
console.log(`wrote ${path}`);
