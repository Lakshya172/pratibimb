/**
 * W-1 arm B — render the scale-control set: object scale in model space is the ONLY
 * intended varying quantity.
 *
 *   node artifacts/experiments/W1-detector-precision-scale/harness/render-arm-b.mjs [--cell=s300]
 *
 * HOW SCALE IS ISOLATED
 *
 * The content is one fixed 960x640 CSS block at the viewport origin, served inside an
 * iframe so its internal layout cannot reflow. Only the surrounding viewport grows. Since
 * every cell is width-dominant, CSS px per model px = viewport width / 640 exactly, so
 * growing the viewport shrinks every object in model space while its CSS box is unchanged.
 *
 * The consequence, and it is the point: the annotation set is IDENTICAL across all cells
 * for a given seed. The comparison is paired at the annotation level, not merely at the
 * seed level. And because the block always fits inside the viewport, every annotation is
 * VISIBLE, so the CLIPPED ceiling is 1.0 and clipping is removed as a confound.
 *
 * The tiled control cells (t300, t400) repeat the same block to fill the frame, so object
 * scale is unchanged but the frame is no longer mostly empty. They exist to test the one
 * side effect this manipulation cannot avoid.
 *
 * Labels come from the rendered document via getBoundingClientRect, never from the
 * generator — same rule as tools/dataset/build-dataset.mjs.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CELLS, CONTENT_BLOCK, PLACEHOLDER_EXTENT, PLACEHOLDER_FRAME, PLACEHOLDER_SEED_BASE,
  PLACEHOLDER_SPLITS, SAMPLES_PER_CELL,
  assertCellDataset, assertWritablePath, captureSizeFor, cssPerModelOf, sampleIdFor, seedFor,
  sha256Hex, specIdFor, tileGrid,
} from "./w1-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const GEN = join(HERE, "generated");
const PORT = 8977;
const refuse = (m) => { console.error(`REFUSING: ${m}`); process.exit(2); };

const EVAL_DIST = join(ROOT, "packages/evaluation/dist/src/index.js");
if (!existsSync(EVAL_DIST)) refuse(`compiled evaluation package missing at ${EVAL_DIST} (run: npm run typecheck)`);
const E = await import(pathToFileURL(EVAL_DIST).href);

const only = (process.argv.find((a) => a.startsWith("--cell=")) || "").slice(7) || null;
const cells = only ? CELLS.filter((c) => c.id === only) : CELLS;
if (!cells.length) refuse(`unknown cell ${only}`);

/**
 * One spec per seed index, shared by every cell. The spec's own viewport is pinned to the
 * content block so the layout inside the iframe is byte-identical everywhere.
 */
const specs = new Map();
for (let i = 0; i < SAMPLES_PER_CELL; i += 1) {
  const base = E.makeSpec(specIdFor(i), seedFor(i));
  specs.set(specIdFor(i), { ...base, viewport: { ...CONTENT_BLOCK } });
}

const shellFor = (grid) => {
  const frames = [];
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      frames.push(
        `<iframe class="t" data-col="${c}" data-row="${r}" src="/content/${grid.specId}" ` +
          `style="left:${c * CONTENT_BLOCK.w}px;top:${r * CONTENT_BLOCK.h}px"></iframe>`
      );
    }
  }
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `html,body{margin:0;padding:0;background:#ffffff}` +
    `iframe.t{position:absolute;width:${CONTENT_BLOCK.w}px;height:${CONTENT_BLOCK.h}px;border:0;overflow:hidden}` +
    `</style></head><body>${frames.join("")}</body></html>`
  );
};

const server = createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "content") {
    const spec = specs.get(parts[1]);
    if (!spec) { res.writeHead(404); return res.end("no such spec"); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(E.specToHtml(spec));
  }
  if (parts[0] === "shell") {
    const [, cellId, specId] = parts;
    const cell = CELLS.find((c) => c.id === cellId);
    if (!cell || !specs.has(specId)) { res.writeHead(404); return res.end("no such shell"); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(shellFor({ ...tileGrid(cell), specId }));
  }
  res.writeHead(404);
  res.end("not found");
});
server.listen(PORT, "127.0.0.1");

const require2 = createRequire(join(ROOT, "node_modules", "noop.js"));
let chromium;
try { ({ chromium } = require2("playwright")); } catch { refuse("playwright not resolvable (run: npm ci)"); }
const exe = process.env.CHROME_PATH || chromium.executablePath();
if (!existsSync(exe)) refuse(`no Chromium at ${exe} (set CHROME_PATH, or npx playwright install chromium)`);

assertWritablePath(ROOT, GEN);
const browser = await chromium.launch({ headless: true, executablePath: exe });
let rendered = 0;
try {
  for (const cell of cells) {
    const cap = captureSizeFor(cell);
    const grid = tileGrid(cell);
    const ratio = cssPerModelOf(cell);
    if (Math.abs(ratio - cell.cssPerModel) > 1e-9) {
      refuse(`${cell.id}: computed CSS px per model px ${ratio} is not the pre-registered ${cell.cssPerModel}`);
    }
    const samples = [];
    const digests = [];
    for (let i = 0; i < SAMPLES_PER_CELL; i += 1) {
      const id = sampleIdFor(cell.id, i);
      const specId = specIdFor(i);
      const ctx = await browser.newContext({ viewport: { width: cell.viewport.w, height: cell.viewport.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/shell/${cell.id}/${specId}`, { waitUntil: "load" });

      // measure inside every tile, then offset by that tile's origin in the outer viewport
      const tiles = [];
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        const el = await frame.frameElement();
        const col = Number(await el.getAttribute("data-col"));
        const row = Number(await el.getAttribute("data-row"));
        const m = await frame.evaluate(() => window.__measure());
        tiles.push({ col, row, m });
      }
      if (tiles.length !== grid.cols * grid.rows) refuse(`${id}: measured ${tiles.length} tiles, expected ${grid.cols * grid.rows}`);
      tiles.sort((a, b) => a.row - b.row || a.col - b.col);

      const outer = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }));
      if (outer.w !== cell.viewport.w || outer.h !== cell.viewport.h) refuse(`${id}: rendered viewport ${outer.w}x${outer.h} is not ${cell.viewport.w}x${cell.viewport.h}`);
      if (outer.dpr !== 1) refuse(`${id}: rendered dpr ${outer.dpr} is not 1`);

      const png = await page.screenshot({ type: "png" });
      await ctx.close();

      const dir = join(GEN, cell.id, "frames");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}.png`), png);

      const annotations = [];
      let dropped = 0;
      for (const t of tiles) {
        if (t.m.viewport.w !== CONTENT_BLOCK.w || t.m.viewport.h !== CONTENT_BLOCK.h) {
          refuse(`${id}: tile ${t.col},${t.row} measured ${t.m.viewport.w}x${t.m.viewport.h}, the content block is ${CONTENT_BLOCK.w}x${CONTENT_BLOCK.h}`);
        }
        const ox = t.col * CONTENT_BLOCK.w;
        const oy = t.row * CONTENT_BLOCK.h;
        for (const e of t.m.elements) {
          const x = e.x + ox;
          const y = e.y + oy;
          /**
           * Visibility is judged against the TILE, not just the outer viewport.
           *
           * The iframe is `overflow: hidden`, so an element that overflows the content block
           * is not drawn — but getBoundingClientRect still reports it, and at the larger
           * viewports its coordinates land inside the outer frame. Judging against the
           * viewport alone would mark those elements VISIBLE and count them as ground truth
           * the detector could never have seen, which penalises exactly the cells this arm is
           * trying to measure. The visible region is the tile intersected with the viewport.
           */
          const clipX1 = Math.max(ox, 0);
          const clipY1 = Math.max(oy, 0);
          const clipX2 = Math.min(ox + CONTENT_BLOCK.w, outer.w);
          const clipY2 = Math.min(oy + CONTENT_BLOCK.h, outer.h);
          const fullyInside = x >= clipX1 && y >= clipY1 && x + e.w <= clipX2 && y + e.h <= clipY2;
          if (!fullyInside) {
            // Not drawn, and the frozen validator's CLIPPED/OFFSCREEN semantics are judged
            // against the VIEWPORT, so an element the iframe clipped cannot be labelled either
            // without lying to the validator. It is therefore not a detection target at all.
            // The dropped set is identical across cells by construction — same content, same
            // block — which is what keeps the comparison paired. The count is recorded.
            dropped += 1;
            continue;
          }
          annotations.push({
            id: `${id}-t${t.row}${t.col}-a${annotations.length}`,
            cls: e.cls,
            box: { x, y, w: e.w, h: e.h },
            visibility: "VISIBLE",
          });
        }
      }

      samples.push({
        id,
        split: "dev",
        provenance: { kind: "SYNTHETIC", generator: "t1-ui-renderer@1.0.0", seed: seedFor(i) },
        viewportCss: { w: outer.w, h: outer.h },
        dpr: 1,
        zoom: 1.0,
        captureSize: { w: cap.w, h: cap.h },
        scroll: { x: 0, y: 0 },
        annotations,
        framePath: `frames/${id}.png`,
      });
      digests.push({ id, seed: seedFor(i), specId, specSha256: sha256Hex(E.specToHtml(specs.get(specId))), annotations: annotations.length, droppedNotDrawn: dropped });
      rendered += 1;
    }

    // Placeholders only so the frozen validator's non-empty-split rule is satisfied. Never
    // rendered, never decoded, never inferred, never evaluated. No test split is created
    // as evidence by this experiment.
    for (let k = 0; k < PLACEHOLDER_SPLITS.length; k += 1) {
      const sp = PLACEHOLDER_SPLITS[k];
      const extent = PLACEHOLDER_EXTENT[sp];
      samples.push({
        id: `w1-${cell.id}-placeholder-${sp}`,
        split: sp,
        provenance: { kind: "SYNTHETIC", generator: "t1-ui-renderer@1.0.0", seed: PLACEHOLDER_SEED_BASE + k + 1 },
        viewportCss: { w: cell.viewport.w, h: cell.viewport.h },
        dpr: 1,
        zoom: 1.0,
        captureSize: { w: cap.w, h: cap.h },
        scroll: { x: 0, y: 0 },
        annotations: [{ id: `w1-${cell.id}-placeholder-${sp}-a0`, cls: "button", box: { x: 0, y: 0, w: extent, h: extent }, visibility: "VISIBLE" }],
        framePath: PLACEHOLDER_FRAME,
      });
    }

    const ds = E.sealDataset({
      name: `w1-scale-${cell.id}`,
      version: "1.0.0",
      createdAt: "2026-09-12T00:00:00.000Z",
      samples,
    });
    E.validateDataset(ds);
    assertCellDataset(ds, cell);
    const cellDir = join(GEN, cell.id);
    writeFileSync(join(cellDir, "manifest.json"), `${JSON.stringify(ds, null, 1)}\n`);
    writeFileSync(join(cellDir, "specs.json"), `${JSON.stringify({ cell: cell.id, grid, cssPerModel: cell.cssPerModel, specs: digests }, null, 1)}\n`);
    const devCount = ds.samples.filter((s) => s.split === "dev").length;
    const annCount = ds.samples.filter((s) => s.split === "dev").reduce((a, s) => a + s.annotations.length, 0);
    const dropCount = digests.reduce((a, d) => a + d.droppedNotDrawn, 0);
    console.log(`${cell.id}: ${devCount} samples, ${annCount} annotations (${dropCount} not drawn, dropped), ${grid.cols}x${grid.rows} tile(s), ${cell.viewport.w}x${cell.viewport.h}, ${cell.cssPerModel} CSS px/model px, hash ${ds.hash}`);
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`\nrendered ${rendered} frames under ${GEN}`);
