/**
 * MVP-0 — DOM sufficiency, and what vision adds, on a LOCAL controlled page.
 *
 *   node artifacts/experiments/MVP-0-dom-sufficiency/harness/run-mvp0.mjs
 *
 * WHAT THIS IS, AND — more importantly — WHAT IT IS NOT
 *
 * This is NOT the PratiBimb agent loop. The loop is OBSERVE → PERCEIVE → SANITIZE → VERIFY →
 * REASON → PLAN → VALIDATE → REFRESH → RE-HYDRATE → ACT → VERIFY RESULT, and **nine of those
 * eleven stages have no implementation in this repository** (see AUDIT-0005). There is no
 * vault, no PII detector, no redaction engine, no verifier, no egress module, no action
 * validator, no executor, no server, and no MV3 extension — not even a manifest.json.
 *
 * So this harness measures the two stages that DO exist, on a page we host ourselves:
 *
 *   OBSERVE    a local loopback page, screenshotted through the browser
 *   PERCEIVE   (a) the DOM path: what actionable semantics the document exposes
 *              (b) the vision path: the real detector artifact, used EXPERIMENTALLY
 *
 * and then, for the DOM-poor page only, it drives the widget from each path's coordinates to
 * see whether the grounding is good enough to act on. That last step is **ACT from grounding**
 * and nothing more: no value was sanitised, no context was sent anywhere, no plan was
 * validated, nothing was re-hydrated from a vault, because none of those exist. It is not
 * "task success" in the product sense and is not reported as such.
 *
 * AUTHORISATION: both pages are served from 127.0.0.1 by this script. Mode A is the repo's own
 * QG-02 fixture; Mode B is generated locally from fabricated strings. No external site is
 * contacted, no security control is bypassed, no credential or real datum exists.
 *
 * The detector is used as an experimental component. No weight, threshold, NMS or decode
 * change is made.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hostname } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const ROOT = join(HERE, "..", "..", "..", "..");
const LOGS = join(EXP, "logs");
const PORT = 8981;
const refuse = (m) => { console.error(`REFUSING: ${m}`); process.exit(2); };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v);

/** The model under test. Experimental use only; never modified. */
const MODEL = {
  modelId: "pratibimb-t1-ui-head",
  revision: "ba6d9e93695b",
  sha256: "ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0",
  bytes: 302960,
  path: "artifacts/models/t1-ui-head/t1-ui-head.onnx",
};
const OPERATING_POINT = 0.55;
const VIEWPORT = { w: 1024, h: 768 };

/** Fabricated values. No real person's data. Nothing here is a credential. */
const SYNTHETIC = {
  fullName: "Asha Example",
  email: "asha@example.invalid",
  dob: "1990-01-02",
  phone: "9000000001",
  address: "12 Test Lane, Example City",
  pin: "4321",
};

for (const p of ["packages/perception/dist/src/index.js"]) {
  if (!existsSync(join(ROOT, p))) refuse(`missing ${p} (run: npm run typecheck)`);
}
const P = await import(pathToFileURL(join(ROOT, "packages/perception/dist/src/index.js")).href);
if (P.PROVISIONAL_THRESHOLDS.score !== 0.25 || P.PROVISIONAL_THRESHOLDS.nmsIou !== 0.5) {
  refuse("PROVISIONAL_THRESHOLDS has been changed — this harness must not run against a retuned decode");
}

const MODE_A = join(ROOT, "tests/browser/qg02/fixture/form.html");
const MODE_B = join(HERE, "fixture", "mode-b-canvas-form.html");
for (const f of [MODE_A, MODE_B]) if (!existsSync(f)) refuse(`missing fixture ${f}`);

const server = createServer((req, res) => {
  const p = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
  const file = p === "/mode-a" ? MODE_A : p === "/mode-b" ? MODE_B : null;
  if (!file) { res.writeHead(404); return res.end("no such page"); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(readFileSync(file));
});
server.listen(PORT, "127.0.0.1");

const require2 = createRequire(join(ROOT, "node_modules", "noop.js"));
let chromium;
try { ({ chromium } = require2("playwright")); } catch { refuse("playwright not resolvable (run: npm ci)"); }
const exe = process.env.CHROME_PATH || chromium.executablePath();
if (!existsSync(exe)) refuse(`no Chromium at ${exe} (set CHROME_PATH)`);

/**
 * The DOM perception probe, run INSIDE the page. It reads only what a content script could:
 * roles, accessible names, labels, enabled/visible state and geometry. It must never read the
 * fixture's ground truth, and the harness asserts that below.
 */
const DOM_PROBE = () => {
  const actionable = [];
  const sel = "input, select, textarea, button, a[href], [role], [contenteditable='true']";
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const labelEl = el.labels && el.labels[0];
    actionable.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      role: el.getAttribute("role"),
      name:
        el.getAttribute("aria-label") ||
        (labelEl && labelEl.textContent.trim()) ||
        el.getAttribute("name") ||
        el.getAttribute("placeholder") ||
        (el.tagName === "BUTTON" || el.tagName === "A" ? el.textContent.trim() : "") ||
        "",
      enabled: !el.disabled,
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
    });
  }
  return { actionable, totalNodes: document.querySelectorAll("*").length };
};

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const i = (x2 - x1) * (y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i);
};
/** A target is GROUNDED if some candidate overlaps it at IoU >= 0.5 — the frozen fusion rule. */
const groundedBy = (target, candidates) => {
  let best = 0;
  for (const c of candidates) best = Math.max(best, iou(target, c.box ?? c));
  return { grounded: best >= 0.5, bestIou: r4(best) };
};

mkdirSync(LOGS, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: exe });
const out = { pages: {}, act: {} };
let ort, session, modelSha;

try {
  /* ── OBSERVE + PERCEIVE(DOM) on both pages ──────────────────────────────────────────── */
  for (const mode of ["mode-a", "mode-b"]) {
    const ctx = await browser.newContext({ viewport: { width: VIEWPORT.w, height: VIEWPORT.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/${mode}`, { waitUntil: "load" });
    const dom = await page.evaluate(DOM_PROBE);
    const png = await page.screenshot({ type: "png" });
    const truth = mode === "mode-b" ? await page.evaluate(() => window.__probeGroundTruth()) : null;
    await ctx.close();

    out.pages[mode] = {
      url: `http://127.0.0.1:${PORT}/${mode}`,
      viewport: VIEWPORT,
      dpr: 1,
      pngBytes: png.length,
      pngSha256: sha(png),
      domTotalNodes: dom.totalNodes,
      domActionableCount: dom.actionable.length,
      domActionable: dom.actionable.map((a) => ({ tag: a.tag, type: a.type, role: a.role, name: a.name, box: a.box })),
      domNamedCount: dom.actionable.filter((a) => a.name).length,
    };
    if (mode === "mode-b") {
      writeFileSync(join(LOGS, "mode-b.png"), png);
      out.modeBTruth = { fields: truth.fields, submit: truth.submit };
      // Can the DOM alone ground the seven targets the task needs?
      const targets = [...truth.fields, truth.submit];
      out.pages[mode].domGrounding = targets.map((t) => ({
        key: t.key,
        ...groundedBy(t, dom.actionable),
      }));
      out.pages[mode].domGroundedCount = out.pages[mode].domGrounding.filter((g) => g.grounded).length;
    } else {
      // Mode A: does the DOM name the things a registration task would need?
      out.pages[mode].domGroundedCount = dom.actionable.filter((a) => a.name).length;
    }
  }

  /* ── PERCEIVE(vision) on mode B — the real artifact, experimental use ───────────────── */
  const modelBytes = readFileSync(join(ROOT, MODEL.path));
  modelSha = sha(modelBytes);
  if (modelSha !== MODEL.sha256 || modelBytes.length !== MODEL.bytes) refuse("model identity mismatch");

  const ortMod = await import("onnxruntime-web");
  ort = ortMod.default ?? ortMod;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = "error";
  session = await ort.InferenceSession.create(modelBytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });

  // decode the PNG we just captured, the same way every prior harness does
  const { execFileSync } = await import("node:child_process");
  const rgbaPath = join(LOGS, "mode-b.rgba");
  execFileSync("python", [join(HERE, "decode-png.py"), join(LOGS, "mode-b.png"), rgbaPath], { stdio: "inherit" });
  const rgba = readFileSync(rgbaPath);
  if (rgba.length !== VIEWPORT.w * VIEWPORT.h * 4) refuse(`RGBA length ${rgba.length} unexpected`);

  const t0 = Date.now();
  const pre = P.preprocessToTensor({ width: VIEWPORT.w, height: VIEWPORT.h, rgba: new Uint8Array(rgba) }, P.HEAD_CONTRACT);
  const tPre = Date.now() - t0;
  const t1 = Date.now();
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", pre.tensor, [1, 3, 640, 640]) });
  const tInfer = Date.now() - t1;
  const o = res[session.outputNames[0]];
  const data = o.data instanceof Float32Array ? o.data : Float32Array.from(o.data);
  const t2 = Date.now();
  const dec = P.decodeHeadOutput({ data, dims: Array.from(o.dims) });
  if (!dec.ok) refuse(`the shipped decode refused: ${dec.code}`);
  const lb = P.computeLetterbox({ w: VIEWPORT.w, h: VIEWPORT.h }, P.HEAD_CONTRACT.inputSize);
  const vision = P.projectToCapture(dec.value, lb)
    .filter((d) => d.score >= OPERATING_POINT)
    .map((d) => ({ cls: d.label, score: r4(d.score), box: { x: r4(d.box.x), y: r4(d.box.y), w: r4(d.box.w), h: r4(d.box.h) } }));
  const tDecode = Date.now() - t2;

  const targets = [...out.modeBTruth.fields, out.modeBTruth.submit];
  out.pages["mode-b"].visionCandidateCount = vision.length;
  out.pages["mode-b"].visionGrounding = targets.map((t) => ({ key: t.key, ...groundedBy(t, vision) }));
  out.pages["mode-b"].visionGroundedCount = out.pages["mode-b"].visionGrounding.filter((g) => g.grounded).length;
  out.pages["mode-b"].visionCandidates = vision;
  out.detectorLatencyMs = { preprocess: tPre, inference: tInfer, decodeAndProject: tDecode };

  /* ── ACT from grounding, on mode B only ─────────────────────────────────────────────── */
  // Drives the widget from each path's coordinates. This is ACT-from-grounding, NOT the
  // product loop: nothing was sanitised, sent, validated or re-hydrated, because none of
  // those stages exist.
  for (const [pathName, candidates] of [["dom-only", out.pages["mode-b"].domActionable], ["vision", vision]]) {
    const ctx = await browser.newContext({ viewport: { width: VIEWPORT.w, height: VIEWPORT.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/mode-b`, { waitUntil: "load" });
    const truth = await page.evaluate(() => window.__probeGroundTruth());
    const attempts = [];
    const start = Date.now();
    for (const f of truth.fields) {
      // pick the candidate that best overlaps this field; refuse rather than guess below 0.5
      let best = null;
      let bestIou = 0;
      for (const c of candidates) {
        const v = iou(f, c.box);
        if (v > bestIou) { bestIou = v; best = c; }
      }
      if (!best || bestIou < 0.5) {
        attempts.push({ field: f.key, acted: false, reason: "NO_CANDIDATE_AT_IOU_0.5", bestIou: r4(bestIou) });
        continue;
      }
      await page.mouse.click(best.box.x + best.box.w / 2, best.box.y + best.box.h / 2);
      await page.keyboard.type(SYNTHETIC[f.key] ?? "x");
      attempts.push({ field: f.key, acted: true, bestIou: r4(bestIou) });
    }
    // submit, only if a candidate grounds it
    let submitted = false;
    let bestSubmit = 0;
    let submitCand = null;
    for (const c of candidates) {
      const v = iou(truth.submit, c.box);
      if (v > bestSubmit) { bestSubmit = v; submitCand = c; }
    }
    if (submitCand && bestSubmit >= 0.5) {
      await page.mouse.click(submitCand.box.x + submitCand.box.w / 2, submitCand.box.y + submitCand.box.h / 2);
      submitted = true;
    }
    const receipt = await page.evaluate(() => {
      const el = document.getElementById("receipt");
      return { hidden: el.hidden, text: el.textContent, accepted: el.getAttribute("data-accepted") === "1" };
    });
    out.act[pathName] = {
      candidates: candidates.length,
      attempts,
      fieldsActedOn: attempts.filter((a) => a.acted).length,
      submitGroundedIou: r4(bestSubmit),
      submitted,
      endState: receipt,
      elapsedMs: Date.now() - start,
    };
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

const log = {
  experiment: "MVP-0-dom-sufficiency",
  runAt: new Date().toISOString(),
  machine: { workstation: "W2", hostname: hostname(), node: process.version },
  authorisation: "both pages served from 127.0.0.1 by this harness; mode A is the repo's own QG-02 fixture, mode B is generated locally from fabricated strings; no external site contacted",
  whatThisIsNot: [
    "NOT the PratiBimb agent loop: 9 of its 11 stages have no implementation (see AUDIT-0005).",
    "No SANITIZE, VERIFY, REASON, PLAN, VALIDATE, REFRESH or RE-HYDRATE stage ran, because none exists.",
    "No value was sanitised, no context was transmitted, no server was contacted, no vault was read.",
    "'ACT from grounding' is a Playwright click/type driven by perceived coordinates. It is NOT task success in the product sense and NOT safe-task-success.",
    "The detector is used EXPERIMENTALLY. No weight, threshold, NMS or decode change was made.",
  ],
  model: { ...MODEL, sha256Verified: modelSha },
  ort: { version: ort && ort.env.versions && ort.env.versions.web, backend: "wasm" },
  operatingPoint: OPERATING_POINT,
  shippedConstants: { ...P.PROVISIONAL_THRESHOLDS },
  syntheticValuesUsed: SYNTHETIC,
  realDataCollected: false,
  realPiiCollected: false,
  ...out,
};
writeFileSync(join(LOGS, "mvp0.json"), `${JSON.stringify(log, null, 1)}\n`);

const A = out.pages["mode-a"];
const B = out.pages["mode-b"];
console.log(`\nMODE A (DOM-rich)  nodes ${A.domTotalNodes}  actionable ${A.domActionableCount}  with an accessible name ${A.domNamedCount}`);
console.log(`MODE B (DOM-poor)  nodes ${B.domTotalNodes}  actionable ${B.domActionableCount}  with an accessible name ${B.domNamedCount}`);
console.log(`\nMODE B grounding of the 7 task targets, at the frozen IoU 0.5 fusion rule:`);
console.log(`  DOM-only : ${B.domGroundedCount}/7`);
console.log(`  vision   : ${B.visionGroundedCount}/7   (${B.visionCandidateCount} candidates at ${OPERATING_POINT})`);
for (const g of B.visionGrounding) {
  const d = B.domGrounding.find((x) => x.key === g.key);
  console.log(`    ${g.key.padEnd(9)} dom ${d.grounded ? "Y" : "n"} (iou ${d.bestIou})   vision ${g.grounded ? "Y" : "n"} (iou ${g.bestIou})`);
}
console.log(`\nACT from grounding (NOT the product loop):`);
for (const k of ["dom-only", "vision"]) {
  const a = out.act[k];
  console.log(`  ${k.padEnd(9)} fields acted ${a.fieldsActedOn}/6  submit iou ${a.submitGroundedIou}  submitted ${a.submitted}  accepted ${a.endState.accepted}`);
  console.log(`            end state: ${a.endState.hidden ? "(no receipt)" : a.endState.text}`);
}
if (out.detectorLatencyMs) console.log(`\ndetector latency ms: ${JSON.stringify(out.detectorLatencyMs)}`);
console.log(`\nwrote ${join(LOGS, "mvp0.json")}`);
