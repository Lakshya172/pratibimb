/**
 * QG-05 T1 evaluation — against a REAL browser-rendered fixture.
 *
 * The unit suite validates the evaluator against synthetic geometry it generated itself.
 * That proves the arithmetic. It cannot prove the harness works on labels derived from a
 * browser's own layout, at a real DPR, with a real screenshot's dimensions — which is
 * where the coordinate contract actually earns its keep.
 *
 * So this gate:
 *   renders the T1 fixture, measures it, and DERIVES ground truth from the DOM
 *   runs the empty / perfect / shifted baselines against that ground truth
 *   asserts the evaluator behaves as the unit suite says it should, on real data
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * NONE OF THIS IS DETECTOR PERFORMANCE
 *
 * There is no detector. The perfect baseline copies the ground truth and scores 1.0 by
 * construction. These numbers describe the EVALUATOR. The `UIElementDetector` is asserted
 * to still refuse with MODEL_ASSET_UNAVAILABLE, and that refusal is part of the gate.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const PORT = 8960;

const arg = (n, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`));
  return m ? m.split("=")[1] : d;
};
const BROWSER = arg("browser", "chromium");

function resolveTool(spec) {
  for (const base of [
    join(ROOT, "node_modules"),
    join(ROOT, "artifacts/experiments/W1-S02a2a4-connect-src-provenance/harness/node_modules"),
  ]) {
    try {
      createRequire(join(base, "noop.js")).resolve(spec);
      return base;
    } catch {
      /* next */
    }
  }
  return null;
}

for (const [name, p] of [
  ["perception", join(ROOT, "packages/perception/dist/src/index.js")],
  ["evaluation", join(ROOT, "packages/evaluation/dist/src/index.js")],
]) {
  if (!existsSync(p)) {
    console.error(`QG-05: compiled ${name} package missing at\n  ${p}\nRun \`npm run typecheck\`.`);
    process.exit(1);
  }
}
const P = await import(`file://${join(ROOT, "packages/perception/dist/src/index.js").replace(/\\/g, "/")}`);
const E = await import(`file://${join(ROOT, "packages/evaluation/dist/src/index.js").replace(/\\/g, "/")}`);

/** Reuses the T1 fixture — it already contains every hard case the evaluator needs. */
function serve() {
  const html = readFileSync(join(ROOT, "tests/browser/t1/fixture/controls.html"));
  const s = createServer((_q, r) => {
    r.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    r.end(html);
  });
  s.listen(PORT, "127.0.0.1");
  return s;
}

const pngSize = (bytes) => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
};

function chromeExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const p = join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
  return existsSync(p) ? p : null;
}

const findings = [];
const check = (cond, label) => {
  if (!cond) findings.push(label);
  return cond;
};

/** DOM roles the evaluator scores. `label` and `generic` are not detection targets. */
const SCORED = new Set(["button", "link", "textbox", "checkbox", "radio", "select", "tab", "icon"]);

async function run() {
  const base = resolveTool("playwright");
  if (!base) throw new Error("playwright not resolvable — run `npm ci`");
  const pw = createRequire(join(base, "noop.js"))("playwright");
  const type = BROWSER === "firefox" ? pw.firefox : pw.chromium;
  const exe = BROWSER === "firefox" ? null : chromeExecutable();

  const browser = await type.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
  try {
    const page = await (
      await browser.newContext({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 2 })
    ).newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });

    const raw = await page.evaluate(() => window.__measure());
    // A page cannot read its own browser zoom; devicePixelRatio folds it in.
    const measured = { ...raw, viewport: { ...raw.viewport, zoom: 1.0 } };

    const shot = await page.screenshot({ type: "png" });
    const size = pngSize(new Uint8Array(shot));
    const geometry = P.geometryFrom(measured.viewport, size.width, size.height);
    const frame = {
      id: P.frameId("qg05-frame-1"),
      capturedAt: Date.now(),
      pixels: new Uint8Array(shot),
      format: "png",
      geometry,
    };
    const graph = P.buildElementGraph(measured.elements, geometry, frame.id);

    // ── ground truth DERIVED FROM THE BROWSER'S OWN LAYOUT ─────────────────────────
    const annotations = [];
    for (const node of graph.nodes) {
      if (!SCORED.has(node.role)) continue;
      const ev = node.evidence;
      let box;
      let visibility;
      if (ev.kind === "OBSERVED") {
        box = ev.viewportBox;
        visibility = "VISIBLE";
      } else if (ev.kind === "CLIPPED") {
        box = ev.viewportBox;
        visibility = "CLIPPED";
      } else if (ev.kind === "OFFSCREEN") {
        // Document space, converted back to viewport space for storage in the canonical
        // space. It stays OFFSCREEN, so the evaluator excludes it from scoring.
        box = P.documentToCss(ev.documentBox, geometry);
        visibility = "OFFSCREEN";
      } else {
        continue; // UNOBSERVED: not rendered at all, not a detection target
      }
      annotations.push({ id: node.id, cls: node.role, box, visibility });
    }

    const sample = {
      id: `browser-${BROWSER}-0001`,
      split: "test",
      provenance: { kind: "REAL_LABELLED", source: "tests/browser/t1/fixture/controls.html", annotator: "dom-derived" },
      viewportCss: geometry.viewportCss,
      dpr: geometry.dpr,
      zoom: geometry.zoom,
      captureSize: geometry.captureSize,
      scroll: geometry.scroll,
      annotations,
    };

    // The dataset needs all three splits populated, so the browser sample is the test
    // split and two synthetic samples fill train and dev. Marked SYNTHETIC, as always.
    const synth = (id, split, seed) => E.generateSample(id, split, seed, {
      viewportCss: geometry.viewportCss,
      dpr: geometry.dpr,
      zoom: geometry.zoom,
      scrollY: 0,
      density: "normal",
    });
    const dataset = E.sealDataset({
      name: "qg05-browser-t1",
      version: "1.0.0",
      createdAt: "2026-09-10T00:00:00.000Z",
      samples: [synth("train-0000", "train", 1), synth("dev-0000", "dev", 2), sample],
    });

    // Labels derived from a real browser must pass the same validator as synthetic ones.
    let labelsValid = true;
    let labelError = null;
    try {
      E.validateDataset(dataset);
    } catch (e) {
      labelsValid = false;
      labelError = String(e.message);
    }

    const ctx = {
      modelId: "baseline",
      modelRevision: "evaluator-validation",
      backend: "none",
      browser: `${BROWSER}`,
      preprocessing: "letterbox-640",
      evaluatedAt: new Date().toISOString(),
    };

    const perfect = E.evaluate(dataset, E.perfectBaseline(dataset, "test"), "test", ctx);
    const empty = E.evaluate(dataset, E.emptyBaseline(), "test", ctx);
    const shift10 = E.evaluate(dataset, E.shiftedBaseline(dataset, "test", 10), "test", ctx);
    const shift400 = E.evaluate(dataset, E.shiftedBaseline(dataset, "test", 400), "test", ctx);

    // ── the detector must still refuse ──────────────────────────────────────────────
    const detector = P.createUiElementDetector(null);
    const attempt = await detector.detect(frame, "wasm");

    // ── assertions ──────────────────────────────────────────────────────────────────
    check(labelsValid, `DOM-derived labels failed validation: ${labelError}`);
    check(annotations.length > 5, `only ${annotations.length} scored annotations derived`);
    check(
      annotations.some((a) => a.visibility === "OFFSCREEN"),
      "no OFFSCREEN annotation derived — the fixture's below-fold target is missing"
    );
    check(
      annotations.some((a) => a.visibility === "CLIPPED"),
      "no CLIPPED annotation derived — the fold-straddling control is missing"
    );

    check(Math.abs(perfect.mAP50.value - 1) < 1e-9, `perfect mAP was ${perfect.mAP50.value}, expected 1`);
    check(Math.abs(perfect.elementRecall.value - 1) < 1e-9, `perfect recall was ${perfect.elementRecall.value}`);
    check(perfect.totals.excludedOffscreen > 0, "off-screen elements were not excluded from scoring");

    check(empty.elementRecall.value === 0, `empty recall was ${empty.elementRecall.value}, expected 0`);
    check(Number.isNaN(empty.groundingAccuracy.value), "empty grounding accuracy should be NaN, not 0");

    check(shift10.elementRecall.value > shift400.elementRecall.value,
      "a larger shift did not degrade recall");
    check(shift400.elementRecall.value < 0.2, `400px shift left recall at ${shift400.elementRecall.value}`);

    check(attempt.ok === false && attempt.code === "MODEL_ASSET_UNAVAILABLE",
      `detector should refuse; got ${attempt.ok ? "ok" : attempt.code}`);

    check(perfect.context.datasetHash === dataset.hash, "result does not record the dataset hash");
    check([perfect.mAP50, perfect.elementRecall].every((f) => f.status === "measured"),
      "a figure is not labelled measured/projected");

    return {
      browser: BROWSER,
      geometry: {
        viewportCss: geometry.viewportCss,
        captureSize: geometry.captureSize,
        dpr: geometry.dpr,
        zoom: geometry.zoom,
      },
      dataset: { name: dataset.name, version: dataset.version, hash: dataset.hash, samples: dataset.samples.length },
      labelsValid,
      annotations: {
        total: annotations.length,
        visible: annotations.filter((a) => a.visibility === "VISIBLE").length,
        clipped: annotations.filter((a) => a.visibility === "CLIPPED").length,
        offscreen: annotations.filter((a) => a.visibility === "OFFSCREEN").length,
      },
      detector: attempt.ok ? { ok: true } : { code: attempt.code },
      baselines: {
        perfect: { mAP50: perfect.mAP50.value, recall: perfect.elementRecall.value, grounding: perfect.groundingAccuracy.value },
        empty: { mAP50: empty.mAP50.value, recall: empty.elementRecall.value, grounding: empty.groundingAccuracy.value },
        shift10: { mAP50: shift10.mAP50.value, recall: shift10.elementRecall.value },
        shift400: { mAP50: shift400.mAP50.value, recall: shift400.elementRecall.value },
      },
      excludedOffscreen: perfect.totals.excludedOffscreen,
      evaluatable: perfect.totals.evaluatable,
    };
  } finally {
    await browser.close();
  }
}

const server = serve();
let result;
try {
  result = await run();
} finally {
  server.close();
}

console.log(`\n[${result.browser}] QG-05 T1 evaluation on a real fixture`);
console.log(`  viewport ${result.geometry.viewportCss.w}x${result.geometry.viewportCss.h} CSS, capture ${result.geometry.captureSize.w}x${result.geometry.captureSize.h}, dpr ${result.geometry.dpr}`);
console.log(`  dataset ${result.dataset.name}@${result.dataset.version} hash=${result.dataset.hash}`);
console.log(`  labels valid              : ${result.labelsValid}`);
console.log(`  annotations               : ${result.annotations.total} (visible ${result.annotations.visible}, clipped ${result.annotations.clipped}, offscreen ${result.annotations.offscreen})`);
console.log(`  detector                  : ${result.detector.code ?? "UNEXPECTEDLY OK"}`);
console.log(`  BASELINE perfect          : mAP@0.5=${result.baselines.perfect.mAP50.toFixed(4)} recall=${result.baselines.perfect.recall.toFixed(4)} grounding=${result.baselines.perfect.grounding.toFixed(4)}`);
console.log(`  BASELINE empty            : mAP@0.5=${result.baselines.empty.mAP50.toFixed(4)} recall=${result.baselines.empty.recall.toFixed(4)} grounding=${result.baselines.empty.grounding}`);
console.log(`  BASELINE shift 10px       : mAP@0.5=${result.baselines.shift10.mAP50.toFixed(4)} recall=${result.baselines.shift10.recall.toFixed(4)}`);
console.log(`  BASELINE shift 400px      : mAP@0.5=${result.baselines.shift400.mAP50.toFixed(4)} recall=${result.baselines.shift400.recall.toFixed(4)}`);
console.log(`  off-screen excluded       : ${result.excludedOffscreen} of ${result.excludedOffscreen + result.evaluatable}`);
console.log(`\n  NOTE: these are EVALUATOR baselines, not detector performance. There is no detector.`);

for (const f of findings) console.log(`  !! ${f}`);

const outDir = join(ROOT, "artifacts", "gates", "QG-05-t1-evaluation");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `qg05-${BROWSER}.json`);
writeFileSync(
  out,
  JSON.stringify(
    {
      gate: "QG-05 (T1 visual-context slice)",
      browser: BROWSER,
      collectedAt: new Date().toISOString(),
      warning:
        "These are EVALUATOR VALIDATION baselines, not detector performance. The perfect " +
        "baseline copies ground truth and scores 1.0 by construction. There is no admissible " +
        "T1 detector; the UIElementDetector refuses with MODEL_ASSET_UNAVAILABLE.",
      scope:
        "QG-05 is the whole evaluation harness (five scored metrics plus task success after " +
        "privacy). This covers ONE slice: visual context (25%) - element mAP@0.5, element " +
        "recall, grounding accuracy. The gate is NOT claimed as passed.",
      findings,
      result,
    },
    null,
    2
  )
);
console.log(`\nwrote ${out}`);
process.exit(findings.length ? 1 : 0);
