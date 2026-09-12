/**
 * Track B — render the 24 cells: NAT, GEOM and APPR at eight values of k.
 *
 *   node artifacts/experiments/W1-TrackB-geometry-appearance/harness/render-trackb.mjs [--cell=geo200]
 *
 * The substrate is arm B's, deliberately and without modification: one fixed 960x640 CSS
 * content block at the viewport origin, inside an `overflow:hidden` iframe so its internal
 * layout cannot reflow, with labels read from the rendered document via getBoundingClientRect
 * and never from the generator. Only the CAPTURE PATH differs between families.
 *
 * NAT(k)   viewport k*640 wide at DPR 1. Arm B's cell, unchanged.
 * GEOM(k)  the SAME viewport and content at DPR 1/k, so Chromium lays out at k*640 CSS px and
 *          rasterises at 640 device px. Same model-space extent as NAT(k), reached without a
 *          resample.
 * APPR(k)  the k=1.5 viewport at DPR 1. The detail degradation is NOT applied here — it is a
 *          deterministic image-space step in apply-appearance.py, so it is auditable as pixels
 *          on disk rather than as something a browser did.
 *
 * Visibility is judged against the TILE intersected with the viewport, not the viewport alone.
 * That is arm B's correction and it is kept: the iframe is `overflow:hidden`, so an element
 * overflowing the block is never drawn even though getBoundingClientRect still reports it.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CELLS, CONTENT_BLOCK, EXPERIMENT, SAMPLES_PER_CELL,
  assertCellGeometry, assertFamilyContract, cssPerModelOf, modelExtentUnit,
} from "./trackb-guards.mjs";
import {
  PLACEHOLDER_EXTENT, PLACEHOLDER_FRAME, PLACEHOLDER_SEED_BASE, PLACEHOLDER_SPLITS,
  assertWritablePath, seedFor, sha256Hex, specIdFor,
} from "../../W1-detector-precision-scale/harness/w1-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const GEN = join(HERE, "generated");
const PORT = 8993;
const refuse = (m) => { console.error(`REFUSING: ${m}`); process.exit(2); };

const pre = CELLS.flatMap((c) => assertCellGeometry(c)).concat(assertFamilyContract(CELLS));
if (pre.length) { for (const f of pre) console.error(`  ${f}`); refuse("cell definitions failed their own guards"); }

const EVAL_DIST = join(ROOT, "packages/evaluation/dist/src/index.js");
if (!existsSync(EVAL_DIST)) refuse(`compiled evaluation package missing at ${EVAL_DIST} (run: npm run typecheck)`);
const E = await import(pathToFileURL(EVAL_DIST).href);

const only = (process.argv.find((a) => a.startsWith("--cell=")) || "").slice(7) || null;
const cells = only ? CELLS.filter((c) => c.id === only) : CELLS;
if (!cells.length) refuse(`unknown cell ${only}`);

/** One spec per seed, shared by every cell, pinned to the content block so layout is identical. */
const specs = new Map();
for (let i = 0; i < SAMPLES_PER_CELL; i += 1) {
  const base = E.makeSpec(specIdFor(i), seedFor(i));
  specs.set(specIdFor(i), { ...base, viewport: { ...CONTENT_BLOCK } });
}

const shellFor = (specId) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>` +
  `html,body{margin:0;padding:0;background:#ffffff}` +
  `iframe.t{position:absolute;left:0;top:0;width:${CONTENT_BLOCK.w}px;height:${CONTENT_BLOCK.h}px;border:0;overflow:hidden}` +
  `</style></head><body><iframe class="t" src="/content/${specId}"></iframe></body></html>`;

const server = createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = u.pathname.split("/").filter(Boolean);
  if (p[0] === "content" && specs.has(p[1])) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(E.specToHtml(specs.get(p[1])));
  }
  if (p[0] === "shell" && specs.has(p[1])) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(shellFor(p[1]));
  }
  res.writeHead(404);
  res.end("not found");
});
server.listen(PORT, "127.0.0.1");

const require2 = createRequire(join(ROOT, "node_modules", "noop.js"));
let chromium;
try { ({ chromium } = require2("playwright")); } catch { refuse("playwright not resolvable (run: npm ci)"); }
const exe = process.env.CHROME_PATH || chromium.executablePath();
if (!existsSync(exe)) refuse(`no Chromium at ${exe} (set CHROME_PATH)`);

assertWritablePath(ROOT, GEN);
const browser = await chromium.launch({ headless: true, executablePath: exe });
let rendered = 0;

try {
  for (const cell of cells) {
    const samples = [];
    const digests = [];
    for (let i = 0; i < SAMPLES_PER_CELL; i += 1) {
      const id = `tb-${cell.id}-${String(i).padStart(4, "0")}`;
      const specId = specIdFor(i);
      const ctx = await browser.newContext({
        viewport: { width: cell.viewport.w, height: cell.viewport.h },
        deviceScaleFactor: cell.dpr,
      });
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/shell/${specId}`, { waitUntil: "load" });

      const frame = page.frames().find((f) => f !== page.mainFrame());
      if (!frame) refuse(`${id}: content iframe missing`);
      const m = await frame.evaluate(() => window.__measure());
      const outer = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));

      if (outer.w !== cell.viewport.w || outer.h !== cell.viewport.h) {
        refuse(`${id}: CSS viewport ${outer.w}x${outer.h} is not ${cell.viewport.w}x${cell.viewport.h}`);
      }
      // 1e-6, not 1e-9: devicePixelRatio round-trips through float32, so 1/1.5 comes back as
      // 0.6666666865... against the double 0.6666666666... That is a representation artefact of
      // about 2e-8, not a wrong scale factor. The tolerance is still four orders of magnitude
      // tighter than the smallest gap between any two declared DPRs (0.25 vs 0.2857).
      if (Math.abs(outer.dpr - cell.dpr) > 1e-6) refuse(`${id}: dpr ${outer.dpr} is not the declared ${cell.dpr}`);
      if (m.viewport.w !== CONTENT_BLOCK.w || m.viewport.h !== CONTENT_BLOCK.h) {
        refuse(`${id}: content block measured ${m.viewport.w}x${m.viewport.h}, expected ${CONTENT_BLOCK.w}x${CONTENT_BLOCK.h}`);
      }

      const png = await page.screenshot({ type: "png" });
      await ctx.close();

      const dir = join(GEN, cell.id, "frames");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}.png`), png);
      rendered += 1;

      // Annotations are CSS-space, identical for NAT(k) and GEOM(k) because the viewport and
      // content are identical; the capture differs, not the layout.
      const annotations = [];
      let dropped = 0;
      for (const e of m.elements) {
        const clipX2 = Math.min(CONTENT_BLOCK.w, outer.w);
        const clipY2 = Math.min(CONTENT_BLOCK.h, outer.h);
        const ix1 = Math.max(e.x, 0);
        const iy1 = Math.max(e.y, 0);
        const ix2 = Math.min(e.x + e.w, clipX2);
        const iy2 = Math.min(e.y + e.h, clipY2);
        // FULLY drawn or dropped, never CLIPPED. The iframe is `overflow:hidden`, so a partly
        // overflowing element is partly not painted; calling it CLIPPED would put it in the
        // ground truth with a box the detector could never match, and would drag the recall
        // ceiling below 1.0 — which pre-registered sanity check 5 forbids. Arm B drops them for
        // the same reason, and the dropped set is identical across cells by construction.
        const fullyDrawn = ix2 > ix1 && iy2 > iy1
          && Math.abs(ix1 - e.x) < 1e-9 && Math.abs(iy1 - e.y) < 1e-9
          && Math.abs(ix2 - (e.x + e.w)) < 1e-9 && Math.abs(iy2 - (e.y + e.h)) < 1e-9;
        if (!fullyDrawn) { dropped += 1; continue; }
        annotations.push({
          id: `${id}-a${annotations.length}`,
          cls: e.cls,
          box: { x: e.x, y: e.y, w: e.w, h: e.h },
          visibility: "VISIBLE",
        });
      }

      samples.push({
        id,
        split: "dev",
        provenance: { kind: "SYNTHETIC", generator: "t1-ui-renderer@1.0.0", seed: seedFor(i) },
        viewportCss: { w: outer.w, h: outer.h },
        dpr: 1,
        zoom: 1.0,
        captureSize: { w: cell.capture.w, h: cell.capture.h },
        scroll: { x: 0, y: 0 },
        annotations,
        framePath: join("frames", `${id}.png`).replace(/\\/g, "/"),
      });
      digests.push({ id, specId, frameSha256: sha256Hex(png), pngBytes: png.length, droppedNotDrawn: dropped });
    }

    // The frozen validator refuses an empty split, so each cell carries one never-rendered
    // placeholder per non-dev split, exactly as arm B does. They are never evaluated.
    for (const sp of PLACEHOLDER_SPLITS) {
      const extent = PLACEHOLDER_EXTENT[sp];
      samples.push({
        id: `tb-${cell.id}-placeholder-${sp}`,
        split: sp,
        provenance: { kind: "SYNTHETIC", generator: "t1-ui-renderer@1.0.0", seed: PLACEHOLDER_SEED_BASE + PLACEHOLDER_SPLITS.indexOf(sp) + 1 },
        viewportCss: { w: cell.viewport.w, h: cell.viewport.h },
        dpr: 1,
        zoom: 1.0,
        captureSize: { w: cell.capture.w, h: cell.capture.h },
        scroll: { x: 0, y: 0 },
        annotations: [{ id: `tb-${cell.id}-placeholder-${sp}-a0`, cls: "button", box: { x: 0, y: 0, w: extent, h: extent }, visibility: "VISIBLE" }],
        framePath: PLACEHOLDER_FRAME,
      });
    }

    const ds = E.sealDataset({
      name: `trackb-${cell.id}`,
      version: "1.0.0",
      createdAt: "2026-09-12T00:00:00.000Z",
      samples,
    });
    E.validateDataset(ds);

    const cellDir = join(GEN, cell.id);
    writeFileSync(join(cellDir, "manifest.json"), `${JSON.stringify(ds, null, 1)}\n`);
    writeFileSync(join(cellDir, "cell.json"), `${JSON.stringify({
      experiment: EXPERIMENT,
      cell,
      cssPerModel: cssPerModelOf(cell),
      modelExtentUnit: modelExtentUnit(cell),
      appearanceApplied: false,
      digests,
    }, null, 1)}\n`);

    const dev = ds.samples.filter((s) => s.split === "dev");
    const ann = dev.reduce((a, s) => a + s.annotations.length, 0);
    const clipped = dev.reduce((a, s) => a + s.annotations.filter((x) => x.visibility !== "VISIBLE").length, 0);
    console.log(`${cell.id.padEnd(7)} ${cell.family.padEnd(5)} k=${String(cell.k).padEnd(5)} vp ${String(cell.viewport.w).padStart(4)}x${String(cell.viewport.h).padStart(4)} dpr ${cell.dpr.toFixed(4)} cap ${String(cell.capture.w).padStart(4)}x${String(cell.capture.h).padStart(4)}  ${dev.length} samples, ${ann} annotations, ${clipped} clipped, hash ${ds.hash}`);
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`\nrendered ${rendered} frames under ${GEN}`);
