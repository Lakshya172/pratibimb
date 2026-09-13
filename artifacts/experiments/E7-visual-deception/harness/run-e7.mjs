/**
 * E7 — do deterministic browser checks already cover the cases where vision might look useful as a
 * safety signal?
 *
 * Three tables, never merged:
 *   A. EXISTING PIPELINE  — VALIDATE → confirmation tier → HIT-TEST, exactly as on `main` (no dispatch
 *                           is performed; only the gate's verdict is recorded).
 *   B. CANDIDATE CHECKS   — deterministic, in-page, listed in cases.mjs. An experiment, not production.
 *   C. DETECTOR           — the T1 artifact, experimental, frozen operating point 0.55, observed ONLY as
 *                           a diagnostic: does any detection overlap #target at IoU ≥ 0.5?
 *
 * Local synthetic fixture on 127.0.0.1. No click, no navigation, no value, no real site.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hostname, tmpdir } from "node:os";

import { CANDIDATE_CHECKS, CASES, RUNS_PER_VIEWPORT, VIEWPORTS } from "./cases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const LOGS = join(HERE, "..", "logs");
const TMP = process.env.E7_TMP || join(tmpdir(), "pratibimb-e7");
const PORT = 8996;
const OPERATING_POINT = 0.55;
const FUSION_IOU = 0.5;
const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};
const sha = (b) => createHash("sha256").update(b).digest("hex");

const MODEL = {
  path: "artifacts/models/t1-ui-head/t1-ui-head.onnx",
  sha256: "ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0",
  bytes: 302960,
};

for (const p of ["packages/perception/dist/src/index.js", "packages/agent/dist/src/index.js"]) {
  if (!existsSync(join(ROOT, p))) refuse(`missing ${p} (run: npm run typecheck)`);
}
const P = await import(pathToFileURL(join(ROOT, "packages/perception/dist/src/index.js")).href);
const A = await import(pathToFileURL(join(ROOT, "packages/agent/dist/src/index.js")).href);
if (P.PROVISIONAL_THRESHOLDS.score !== 0.25 || P.PROVISIONAL_THRESHOLDS.nmsIou !== 0.5) refuse("PROVISIONAL_THRESHOLDS changed");
if (typeof A.validateAndAct !== "function" || typeof A.establishHitAgreement !== "function") {
  refuse("this harness measures the pipeline as it is on main (eb4604b): validateActionFreshness + tier + establishHitAgreement");
}

const modelBytes = readFileSync(join(ROOT, MODEL.path));
if (sha(modelBytes) !== MODEL.sha256 || modelBytes.length !== MODEL.bytes) refuse("detector artifact identity mismatch");
const ortMod = await import("onnxruntime-web");
const ort = ortMod.default ?? ortMod;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.logLevel = "error";
const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
const DECODE_PNG = join(ROOT, "artifacts/experiments/MVP-0-dom-sufficiency/harness/decode-png.py");

const FIXTURE = readFileSync(join(HERE, "fixture", "e7.html"));
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(FIXTURE);
});
await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const exe = process.env.CHROME_PATH || chromium.executablePath();
if (!existsSync(exe)) refuse(`no Chromium at ${exe} (set CHROME_PATH)`);
const browser = await chromium.launch({ headless: true, executablePath: exe });
mkdirSync(TMP, { recursive: true });

// Role and name templates copied VERBATIM from the MVP-2 harness (workstation 1), so identity here is
// derived by the same rules the existing hit-test evidence used.
const ROLE_FN = `(el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const t = el.tagName;
    if (t === "INPUT") return (el.type === "checkbox" || el.type === "radio") ? el.type : "textbox";
    if (t === "TEXTAREA") return "textbox";
    if (t === "SELECT") return "listbox";
    if (t === "BUTTON") return "button";
    if (t === "A") return "link";
    if (t === "LABEL") return "label";
    return "generic";
  }`;
const NAME_FN = `(el) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 60)`;

const DOM_PROBE = `(() => {
  const role = ${ROLE_FN};
  const name = ${NAME_FN};
  const sel = (el) => (el.id ? "#" + el.id : el.tagName.toLowerCase());
  const nodes = Array.from(document.querySelectorAll("a, button, input, select, textarea, label, [role]"));
  return {
    viewport: { dpr: window.devicePixelRatio, w: document.documentElement.clientWidth, h: document.documentElement.clientHeight, sx: window.scrollX, sy: window.scrollY, origin: location.origin },
    elements: nodes.map((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { selector: sel(el), role: role(el), name: name(el), rect: { x: r.x, y: r.y, w: r.width, h: r.height },
               enabled: !el.disabled, cssHidden: s.display === "none" || s.visibility === "hidden" || r.width === 0 || r.height === 0, parentIndex: -1 };
    }),
  };
})()`;

const hitProbe = (x, y) => `(() => {
  const role = ${ROLE_FN};
  const name = ${NAME_FN};
  const el = document.elementFromPoint(${x}, ${y});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { selector: el.id ? "#" + el.id : el.tagName.toLowerCase(), role: role(el), name: name(el), box: { x: r.x, y: r.y, w: r.width, h: r.height } };
})()`;

/** Candidate deterministic checks, evaluated in the page for #target. Returns flags and raw measurements. */
const CANDIDATE_PROBE = (px, py) => `(() => {
  const el = document.getElementById("target");
  if (!el) return { flags: ["NO_TARGET"], raw: {} };
  const flags = [];
  const raw = {};
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim().toLowerCase();
  raw.checkVisibilityAvailable = typeof el.checkVisibility === "function";
  if (raw.checkVisibilityAvailable) {
    raw.checkVisibility = el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
    if (raw.checkVisibility === false) flags.push("CHECKVISIBILITY_FALSE");
  }
  let op = 1, fop = 1;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const s = getComputedStyle(n);
    op *= parseFloat(s.opacity);
    const m = /opacity\\(([0-9.]+)(%?)\\)/.exec(s.filter || "");
    if (m) fop *= m[2] === "%" ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  }
  raw.opacityProduct = op;
  raw.filterOpacityProduct = fop;
  if (op < 0.1) flags.push("OPACITY_PRODUCT_LOW");
  if (fop < 0.1) flags.push("FILTER_OPACITY_LOW");
  const r = el.getBoundingClientRect();
  const pts = [[${px}, ${py}], [r.x + r.width * 0.25, r.y + r.height * 0.25], [r.x + r.width * 0.75, r.y + r.height * 0.25],
               [r.x + r.width * 0.25, r.y + r.height * 0.75], [r.x + r.width * 0.75, r.y + r.height * 0.75]];
  raw.hitPoints = pts.map(([x, y]) => {
    const h = document.elementFromPoint(x, y);
    return h ? (h === el || el.contains(h) ? "TARGET" : (h.id ? "#" + h.id : h.tagName.toLowerCase())) : null;
  });
  if (raw.hitPoints.some((h) => h !== "TARGET")) flags.push("HIT_POINT_NOT_TARGET");
  const aria = el.getAttribute("aria-label");
  const text = (el.textContent || "").trim();
  const name = (aria || text || "").trim();
  if (aria && text && !norm(text).includes(norm(aria)) && !norm(aria).includes(norm(text))) flags.push("NAME_TEXT_MISMATCH");
  const pseudo = ["::before", "::after"].map((p) => getComputedStyle(el, p).content).map((c) => (c && c !== "none" && c !== "normal") ? c.replace(/^["']|["']$/g, "") : "");
  raw.pseudoContent = pseudo;
  if (pseudo.some((c) => /[A-Za-z0-9]/.test(c) && !norm(name).includes(norm(c)))) flags.push("PSEUDO_TEXT_NOT_IN_NAME");
  if (aria && !text && el.querySelector("canvas, img, svg")) flags.push("LABEL_UNVERIFIABLE");
  return { flags, raw };
})()`;

async function detectorSees(page, targetRect, tag) {
  const png = join(TMP, `${tag}.png`);
  const rgbaPath = join(TMP, `${tag}.rgba`);
  await page.screenshot({ path: png, type: "png" });
  execFileSync("python", [DECODE_PNG, png, rgbaPath], { stdio: "pipe" });
  const vp = page.viewportSize();
  const rgba = readFileSync(rgbaPath);
  if (rgba.length !== vp.width * vp.height * 4) refuse(`RGBA length ${rgba.length} unexpected for ${vp.width}x${vp.height}`);
  const pre = P.preprocessToTensor({ width: vp.width, height: vp.height, rgba: new Uint8Array(rgba) }, P.HEAD_CONTRACT);
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", pre.tensor, [1, 3, 640, 640]) });
  const o = out[session.outputNames[0]];
  const dec = P.decodeHeadOutput({ data: o.data instanceof Float32Array ? o.data : Float32Array.from(o.data), dims: Array.from(o.dims) });
  if (!dec.ok) return { ok: false, code: dec.code };
  const lb = P.computeLetterbox({ w: vp.width, h: vp.height }, P.HEAD_CONTRACT.inputSize);
  const dets = P.projectToCapture(dec.value, lb).filter((d) => d.score >= OPERATING_POINT);
  const t = { x: targetRect.x, y: targetRect.y, w: targetRect.w, h: targetRect.h };
  let best = 0;
  for (const d of dets) best = Math.max(best, P.iou(d.box, t));
  return { ok: true, detections: dets.length, maxIoU: Math.round(best * 1e4) / 1e4, seesTarget: best >= FUSION_IOU };
}

const rows = [];
let frame = 0;
for (const vp of VIEWPORTS) {
  for (let run = 0; run < RUNS_PER_VIEWPORT; run += 1) {
    for (const c of CASES) {
      const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
      await page.goto(`http://127.0.0.1:${PORT}/?case=${c.id}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__ready === true);
      const probe = await page.evaluate(DOM_PROBE);
      frame += 1;
      const fid = P.frameId(`e7-${frame}`);
      const geometry = { dpr: 1, zoom: 1, viewportCss: { w: probe.viewport.w, h: probe.viewport.h }, captureSize: { w: probe.viewport.w, h: probe.viewport.h }, scroll: { x: 0, y: 0 }, origin: probe.viewport.origin };
      const graph = P.buildElementGraph(probe.elements, geometry, fid);
      const node = graph.nodes.find((n) => n.domRef.selector === "#target");
      const rect = probe.elements.find((e) => e.selector === "#target")?.rect;

      // ── A. existing pipeline ──
      let pipeline;
      if (!node || !rect) {
        pipeline = { verdict: "REFUSE", stage: "NO_TARGET", cause: "target not in DOM probe" };
      } else {
        const claim = { nodeId: node.id, role: node.role, name: node.name, frameId: fid, viewportBox: rect };
        const decision = A.validateActionFreshness(graph, { kind: "click", target: claim });
        if (decision.decision !== "ALLOW") {
          pipeline = { verdict: "REFUSE", stage: "VALIDATE", cause: decision.reason };
        } else if (A.confirmationTierOf(node) === "CONFIRM_REQUIRED") {
          pipeline = { verdict: "REFUSE", stage: "TIER", cause: "HUMAN_CONFIRMATION_REQUIRED" };
        } else {
          const bridge = { frameId: fid, async topmostAtCssPoint(p) { const t = await page.evaluate(hitProbe(p.x, p.y)); return t === null ? null : { ...t, frameId: fid }; } };
          const hit = await A.establishHitAgreement(decision, bridge);
          pipeline = A.agreesForDispatch(hit)
            ? { verdict: "ALLOW", stage: "HIT_TEST", cause: "MATCH" }
            : { verdict: "REFUSE", stage: "HIT_TEST", cause: `${hit.agreement}:${hit.cause}` };
        }
      }
      // ── B. candidate deterministic checks ──
      const px = rect ? rect.x + rect.w / 2 : 0;
      const py = rect ? rect.y + rect.h / 2 : 0;
      const candidate = await page.evaluate(CANDIDATE_PROBE(px, py));
      // ── C. detector, diagnostic only ──
      const detector = rect ? await detectorSees(page, rect, `${c.id}-${vp.width}x${vp.height}-r${run}`) : { ok: false, code: "NO_TARGET" };
      await page.close();
      rows.push({ case: c.id, expect: c.expect, viewport: `${vp.width}x${vp.height}`, run, pipeline, candidate, detector });
    }
  }
  console.log(`viewport ${vp.width}x${vp.height}: done`);
}
await browser.close();
server.close();

// ── aggregate ────────────────────────────────────────────────────────────────────────────────
const CORE = CANDIDATE_CHECKS.filter((k) => k !== "LABEL_UNVERIFIABLE");
const summary = CASES.map((c) => {
  const rs = rows.filter((r) => r.case === c.id);
  const n = rs.length;
  const pipelineRefused = rs.filter((r) => r.pipeline.verdict === "REFUSE").length;
  const flagCounts = Object.fromEntries(CANDIDATE_CHECKS.map((k) => [k, rs.filter((r) => r.candidate.flags.includes(k)).length]));
  const coreRefused = rs.filter((r) => r.candidate.flags.some((f) => CORE.includes(f))).length;
  const allRefused = rs.filter((r) => r.candidate.flags.length > 0).length;
  const combinedCore = rs.filter((r) => r.pipeline.verdict === "REFUSE" || r.candidate.flags.some((f) => CORE.includes(f))).length;
  const combinedAll = rs.filter((r) => r.pipeline.verdict === "REFUSE" || r.candidate.flags.length > 0).length;
  const detectorSees = rs.filter((r) => r.detector.ok && r.detector.seesTarget).length;
  const pipelineCauses = [...new Set(rs.map((r) => `${r.pipeline.stage}:${r.pipeline.cause}`))];
  return { case: c.id, expect: c.expect, runs: n, pipelineRefused, pipelineCauses, flagCounts, coreChecksRefused: coreRefused, allChecksRefused: allRefused, combinedCoreRefused: combinedCore, combinedAllRefused: combinedAll, detectorSeesTarget: detectorSees };
});

const legit = summary.filter((s) => s.expect === "ALLOW");
const decep = summary.filter((s) => s.expect === "REFUSE");
const conclusions = {
  existingPipeline: {
    deceptionsCaughtEveryRun: decep.filter((s) => s.pipelineRefused === s.runs).map((s) => s.case),
    deceptionsMissedSomeRun: decep.filter((s) => s.pipelineRefused < s.runs).map((s) => s.case),
    legitimateFalseRefusals: legit.filter((s) => s.pipelineRefused > 0).map((s) => ({ case: s.case, refusedRuns: s.pipelineRefused, causes: s.pipelineCauses })),
  },
  pipelinePlusCoreChecks: {
    deceptionsCaughtEveryRun: decep.filter((s) => s.combinedCoreRefused === s.runs).map((s) => s.case),
    deceptionsMissedSomeRun: decep.filter((s) => s.combinedCoreRefused < s.runs).map((s) => s.case),
    legitimateFalseRefusals: legit.filter((s) => s.combinedCoreRefused > 0).map((s) => s.case),
  },
  pipelinePlusAllChecks: {
    deceptionsCaughtEveryRun: decep.filter((s) => s.combinedAllRefused === s.runs).map((s) => s.case),
    deceptionsMissedSomeRun: decep.filter((s) => s.combinedAllRefused < s.runs).map((s) => s.case),
    legitimateFalseRefusals: legit.filter((s) => s.combinedAllRefused > 0).map((s) => s.case),
  },
  detectorDiagnostic: {
    note: "diagnostic only; 'sees' = a detection at score >= 0.55 overlapping #target's DOM box at IoU >= 0.5",
    deceptionsNotSeenEveryRun: decep.filter((s) => s.detectorSeesTarget === 0).map((s) => s.case),
    legitimateNotSeenSomeRun: legit.filter((s) => s.detectorSeesTarget < s.runs).map((s) => ({ case: s.case, seenRuns: s.detectorSeesTarget, runs: s.runs })),
  },
};

const log = {
  experiment: "E7-visual-deception",
  recordedAt: new Date().toISOString(),
  workstation: "W2",
  hostname: hostname(),
  node: process.version,
  browser: { executable: exe.split(/[\\/]/).pop(), version: browser.version ? "see run" : "n/a", fromChromePathEnv: Boolean(process.env.CHROME_PATH) },
  pipelineUnderTest: "main eb4604b: validateActionFreshness → confirmationTierOf → establishHitAgreement (raw elementFromPoint bridge, MVP-2 templates)",
  detector: { artifactSha256: MODEL.sha256, operatingPoint: OPERATING_POINT, fusionIoU: FUSION_IOU, role: "DIAGNOSTIC ONLY" },
  preRegistration: { commit: "7948136", casesSha256LF: sha(readFileSync(join(HERE, "cases.mjs"), "utf8").replace(/\r\n/g, "\n")), fixtureSha256LF: sha(readFileSync(join(HERE, "fixture", "e7.html"), "utf8").replace(/\r\n/g, "\n")) },
  design: { viewports: VIEWPORTS, runsPerViewport: RUNS_PER_VIEWPORT, cases: CASES.length, candidateChecks: CANDIDATE_CHECKS, coreChecks: CORE },
  summary,
  conclusions,
  rows,
};
mkdirSync(LOGS, { recursive: true });
writeFileSync(join(LOGS, "e7.json"), JSON.stringify(log, null, 2) + "\n");
console.log(JSON.stringify(conclusions, null, 2));
