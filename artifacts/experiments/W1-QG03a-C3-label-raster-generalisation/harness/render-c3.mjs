/**
 * QG-03a-C3 — render the six cells, with labels read from the rendered document.
 *
 *   node artifacts/experiments/W1-QG03a-C3-label-raster-generalisation/harness/render-c3.mjs
 *
 * The generator is the committed one (`makeSpec` / `specToHtml` from @pratibimb/evaluation). The
 * only thing C3 changes is the **viewport**: one spec per seed, rendered at six different sizes, so
 * the cells are paired by seed and the sole varying factor is capture geometry.
 *
 * LABELS COME FROM THE RENDERED DOCUMENT, exactly as tools/dataset/build-dataset.mjs does it: the
 * spec decides what to render, the browser decides where it lands, and getBoundingClientRect is
 * read back. Emitting boxes from the same code that emits the CSS is how a detector gets trained
 * on a lie.
 *
 * Each cell is sealed as its OWN dataset (`t1-ui-c3-<cell>`), validated with the frozen validator.
 * Nothing under artifacts/datasets/ or artifacts/gates/ is read or written. PNGs land in
 * harness/generated/ and are gitignored.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CELLS, DATASET_CREATED_AT, DATASET_VERSION, EXPERIMENT, PLACEHOLDER_FRAME, PLACEHOLDER_SEED_BASE, SAMPLES_PER_CELL,
  assertCellDataset, assertWritablePath, captureSizeFor, datasetNameFor, devSamples, isTrainingGeometry,
  sampleIdFor, seedFor, sha256Hex,
} from "./c3-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const GEN = join(HERE, "generated");
const PORT = 8975;
const refuse = (m) => { console.error(`REFUSING: ${m}`); process.exit(2); };

const EVAL_DIST = join(ROOT, "packages/evaluation/dist/src/index.js");
if (!existsSync(EVAL_DIST)) refuse(`compiled evaluation package missing at ${EVAL_DIST} (run: npm run typecheck)`);
const E = await import(pathToFileURL(EVAL_DIST).href);

// One spec per seed index, shared by every cell: this is what makes the comparison paired.
const specBase = [];
for (let i = 0; i < SAMPLES_PER_CELL; i += 1) specBase.push(E.makeSpec(`c3-seed-${String(i).padStart(4, "0")}`, seedFor(i)));

// sample id -> the spec to serve for it (same content, the cell's viewport)
const plan = [];
const specs = new Map();
for (const cell of CELLS) {
  for (let i = 0; i < SAMPLES_PER_CELL; i += 1) {
    const id = sampleIdFor(cell.id, i);
    const spec = { ...specBase[i], viewport: { ...cell.viewport } };
    specs.set(id, spec);
    plan.push({ cell, i, id, seed: seedFor(i), spec });
  }
}

const server = createServer((req, res) => {
  const id = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname.slice(1);
  const spec = specs.get(id);
  if (!spec) { res.writeHead(404); return res.end("no such sample"); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(E.specToHtml(spec));
});
server.listen(PORT, "127.0.0.1");

const require2 = createRequire(join(ROOT, "node_modules", "noop.js"));
let chromium;
try { ({ chromium } = require2("playwright")); } catch { refuse("playwright not resolvable (run: npm ci)"); }
const exe = process.env.CHROME_PATH || chromium.executablePath();
if (!existsSync(exe)) refuse(`no Chromium at ${exe} (set CHROME_PATH, or npx playwright install chromium)`);

assertWritablePath(ROOT, GEN);
const browser = await chromium.launch({ headless: true, executablePath: exe });
const perCell = new Map(CELLS.map((c) => [c.id, []]));
const specDigests = new Map(CELLS.map((c) => [c.id, []]));
let rendered = 0;
try {
  for (const p of plan) {
    const cap = captureSizeFor(p.cell);
    const ctx = await browser.newContext({ viewport: { width: p.cell.viewport.w, height: p.cell.viewport.h }, deviceScaleFactor: p.cell.dpr });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/${p.id}`, { waitUntil: "load" });
    const m = await page.evaluate(() => window.__measure());
    const png = await page.screenshot({ type: "png" });
    await ctx.close();

    const dir = join(GEN, p.cell.id, "frames");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${p.id}.png`), png);

    const vw = m.viewport.w;
    const vh = m.viewport.h;
    if (vw !== p.cell.viewport.w || vh !== p.cell.viewport.h) refuse(`${p.id}: rendered viewport ${vw}x${vh} is not the cell's ${p.cell.viewport.w}x${p.cell.viewport.h}`);
    if (m.viewport.dpr !== p.cell.dpr) refuse(`${p.id}: rendered dpr ${m.viewport.dpr} is not the cell's ${p.cell.dpr}`);

    const annotations = m.elements.map((e, k) => {
      const fullyInside = e.x >= 0 && e.y >= 0 && e.x + e.w <= vw && e.y + e.h <= vh;
      const intersects = e.x < vw && e.y < vh && e.x + e.w > 0 && e.y + e.h > 0;
      return {
        id: `${p.id}-a${k}`,
        cls: e.cls,
        box: { x: e.x, y: e.y, w: e.w, h: e.h },
        visibility: fullyInside ? "VISIBLE" : intersects ? "CLIPPED" : "OFFSCREEN",
      };
    });

    perCell.get(p.cell.id).push({
      id: p.id,
      split: "dev",
      provenance: { kind: "SYNTHETIC", generator: `t1-ui-renderer@${DATASET_VERSION}`, seed: p.seed },
      viewportCss: { w: vw, h: vh },
      dpr: m.viewport.dpr,
      zoom: 1.0,
      captureSize: { w: cap.w, h: cap.h },
      scroll: { x: 0, y: 0 },
      annotations,
      framePath: `frames/${p.id}.png`,
    });
    specDigests.get(p.cell.id).push({ id: p.id, seed: p.seed, specSha256: sha256Hex(E.specToHtml(p.spec)) });

    rendered += 1;
    if (rendered % 20 === 0) process.stdout.write(`  rendered ${rendered}/${plan.length}\n`);
  }
} finally {
  await browser.close();
  server.close();
}

/**
 * The frozen validator refuses an empty split. These two rows are never rendered, decoded,
 * inferred or evaluated; every later stage iterates the dev split only, and c3-guards pins that.
 */
function placeholders(cell) {
  const cap = captureSizeFor(cell);
  const mk = (split, n, extent) => ({
    id: `c3-${cell.id}-placeholder-${split}`,
    split,
    provenance: { kind: "SYNTHETIC", generator: `t1-ui-renderer@${DATASET_VERSION}`, seed: PLACEHOLDER_SEED_BASE + n },
    viewportCss: { ...cell.viewport },
    dpr: cell.dpr,
    zoom: 1.0,
    captureSize: { w: cap.w, h: cap.h },
    scroll: { x: 0, y: 0 },
    annotations: [{ id: `c3-${cell.id}-placeholder-${split}-a0`, cls: "button", box: { x: 0, y: 0, w: extent, h: extent }, visibility: "VISIBLE" }],
    framePath: PLACEHOLDER_FRAME,
  });
  return [mk("train", 1, 10), mk("test", 2, 12)];
}

const summary = [];
for (const cell of CELLS) {
  const samples = [...perCell.get(cell.id), ...placeholders(cell)];
  const ds = E.sealDataset({ name: datasetNameFor(cell.id), version: DATASET_VERSION, createdAt: DATASET_CREATED_AT, samples });
  E.validateDataset(ds); // the frozen validator, unmodified
  assertCellDataset(ds, cell);
  const dir = join(GEN, cell.id);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(ds, null, 1));
  writeFileSync(join(dir, "specs.json"), JSON.stringify({ cell: cell.id, specs: specDigests.get(cell.id) }, null, 1));
  const dev = devSamples(ds); // the placeholders are not evidence and are not counted
  const ann = dev.reduce((n, s) => n + s.annotations.length, 0);
  const off = dev.reduce((n, s) => n + s.annotations.filter((a) => a.visibility === "OFFSCREEN").length, 0);
  const clp = dev.reduce((n, s) => n + s.annotations.filter((a) => a.visibility === "CLIPPED").length, 0);
  summary.push({ cell: cell.id, kind: cell.kind, viewport: cell.viewport, dpr: cell.dpr, capture: captureSizeFor(cell), trainingGeometry: isTrainingGeometry(cell), datasetHash: ds.hash, devSamples: dev.length, placeholders: ds.samples.length - dev.length, annotations: ann, clipped: clp, offscreen: off });
  console.log(`${cell.id} [${cell.kind}] ${cell.viewport.w}x${cell.viewport.h} @${cell.dpr} -> capture ${captureSizeFor(cell).w}x${captureSizeFor(cell).h} | dataset ${ds.name}@${ds.hash} | ${dev.length} dev samples + ${ds.samples.length - dev.length} unrendered placeholders, ${ann} annotations (${clp} clipped, ${off} offscreen) | trainingGeometry=${isTrainingGeometry(cell)}`);
}
writeFileSync(join(GEN, "render-summary.json"), JSON.stringify({ experiment: EXPERIMENT, renderedAt: new Date().toISOString(), chromium: exe, cells: summary }, null, 1));
console.log(`\nrendered ${rendered} samples across ${CELLS.length} cells; manifests sealed and validated`);
