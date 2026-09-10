/**
 * Render the T1 training set: deterministic spec -> real pixels -> DOM-derived labels.
 *
 *   node tools/dataset/build-dataset.mjs --out=<dir> [--counts=120,40,40] [--seed=20260910]
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * LABELS COME FROM THE RENDERED DOCUMENT, NOT FROM THE GENERATOR
 *
 * The spec decides what to render. The browser decides where it lands. Reading the boxes
 * back with getBoundingClientRect() means the labels are, by construction, where the
 * pixels actually are. Emitting boxes from the same code that emits the CSS is the classic
 * way to train a detector on a lie - a border, a line-height rounding, a font metric, and
 * the labels drift while every self-consistent test still passes.
 *
 * PIXELS ARE NOT COMMITTED. The recipe is: spec version + seed + this script. Rendered
 * PNGs are gitignored, because "reproducible" means the recipe is under version control,
 * not that ten megabytes of decode-once images are.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PORT = 8970;

const arg = (n, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`));
  return m ? m.split("=")[1] : d;
};
const OUT = arg("out", join(ROOT, "artifacts", "datasets", "t1-ui-v1"));
const SEED = Number(arg("seed", "20260910"));
const [nTrain, nDev, nTest] = arg("counts", "120,40,40").split(",").map(Number);
const DATASET_VERSION = "1.0.0";
const DATASET_NAME = "t1-ui-rendered";

const DIST = join(ROOT, "packages/evaluation/dist/src/index.js");
if (!existsSync(DIST)) {
  console.error(`compiled evaluation package missing at ${DIST}. Run: npm run typecheck`);
  process.exit(1);
}
const E = await import(pathToFileURL(DIST).href);

function resolveTool(spec) {
  for (const base of [join(ROOT, "node_modules")]) {
    try {
      createRequire(join(base, "noop.js")).resolve(spec);
      return base;
    } catch { /* next */ }
  }
  return null;
}

/** Split offsets keep the three splits from ever drawing the same seed. */
const OFFSETS = { train: 0, dev: 1_000_000, test: 2_000_000 };

const plan = [];
for (const [split, n] of [["train", nTrain], ["dev", nDev], ["test", nTest]]) {
  for (let i = 0; i < n; i += 1) {
    const id = `${split}-${String(i).padStart(4, "0")}`;
    plan.push({ split, id, seed: SEED + OFFSETS[split] + i });
  }
}

const specs = new Map(plan.map((p) => [p.id, E.makeSpec(p.id, p.seed)]));

const server = createServer((req, res) => {
  const id = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname.slice(1);
  const spec = specs.get(id);
  if (!spec) { res.writeHead(404); return res.end("no such sample"); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(E.specToHtml(spec));
});
server.listen(PORT, "127.0.0.1");

const base = resolveTool("playwright");
if (!base) { console.error("playwright not resolvable - run `npm ci`"); process.exit(1); }
const { chromium } = createRequire(join(base, "noop.js"))("playwright");

function chromeExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const p = join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
  return existsSync(p) ? p : null;
}
const exe = chromeExecutable();

mkdirSync(join(OUT, "frames"), { recursive: true });

// DPR is fixed at 1 for the training set. The letterbox and DPR handling are already
// gated by QG-02 across six configurations; varying DPR here would multiply render cost
// without testing anything the coordinate suite does not already cover.
const DPR = 1;

const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
const samples = [];
let rendered = 0;

try {
  for (const p of plan) {
    const spec = specs.get(p.id);
    const ctx = await browser.newContext({
      viewport: { width: spec.viewport.w, height: spec.viewport.h },
      deviceScaleFactor: DPR,
    });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/${p.id}`, { waitUntil: "load" });

    const m = await page.evaluate(() => window.__measure());
    const png = await page.screenshot({ type: "png" });
    const framePath = `frames/${p.id}.png`;
    writeFileSync(join(OUT, framePath), png);
    await ctx.close();

    const vw = m.viewport.w;
    const vh = m.viewport.h;
    const annotations = m.elements.map((e, i) => {
      const fullyInside = e.x >= 0 && e.y >= 0 && e.x + e.w <= vw && e.y + e.h <= vh;
      const intersects = e.x < vw && e.y < vh && e.x + e.w > 0 && e.y + e.h > 0;
      return {
        id: `${p.id}-a${i}`,
        cls: e.cls,
        box: { x: e.x, y: e.y, w: e.w, h: e.h },
        visibility: fullyInside ? "VISIBLE" : intersects ? "CLIPPED" : "OFFSCREEN",
      };
    });

    samples.push({
      id: p.id,
      split: p.split,
      provenance: { kind: "SYNTHETIC", generator: `t1-ui-renderer@${DATASET_VERSION}`, seed: p.seed },
      viewportCss: { w: vw, h: vh },
      dpr: m.viewport.dpr,
      zoom: 1.0,
      captureSize: { w: Math.round(vw * DPR), h: Math.round(vh * DPR) },
      scroll: { x: 0, y: 0 },
      annotations,
      framePath,
    });

    rendered += 1;
    if (rendered % 20 === 0) process.stdout.write(`  rendered ${rendered}/${plan.length}\n`);
  }
} finally {
  await browser.close();
  server.close();
}

const dataset = E.sealDataset({
  name: DATASET_NAME,
  version: DATASET_VERSION,
  createdAt: "2026-09-10T00:00:00.000Z", // fixed: a live timestamp would change the hash
  samples,
});

// Same validator the evaluator uses. A training set that cannot pass label validation is
// a training set that will teach the model whatever the malformed labels say.
E.validateDataset(dataset);

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(dataset, null, 2));

const byCls = {};
let off = 0;
for (const s of dataset.samples) {
  for (const a of s.annotations) {
    if (a.visibility === "OFFSCREEN") { off += 1; continue; }
    byCls[a.cls] = (byCls[a.cls] ?? 0) + 1;
  }
}

console.log(`\ndataset ${DATASET_NAME}@${DATASET_VERSION}  hash=${dataset.hash}`);
console.log(`  samples: ${dataset.samples.length} (train ${nTrain}, dev ${nDev}, test ${nTest})`);
console.log(`  evaluatable annotations by class:`);
for (const [c, n] of Object.entries(byCls).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${c.padEnd(10)} ${n}`);
}
console.log(`  off-screen (excluded from scoring): ${off}`);
console.log(`  wrote ${join(OUT, "manifest.json")}`);
