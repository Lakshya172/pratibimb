/**
 * E8 (click half) — do local postconditions confirm clicks, and does CONFIRMED mean the intended effect?
 *
 * Each action runs on a fresh page, 10 times, through `main`'s `guardedAct` (VALIDATE → HIT-TEST → ACT →
 * VERIFY RESULT) with Playwright bridges: a trusted `page.mouse.click` for dispatch — the same mechanism
 * MVP-1 and MVP-2 used, NOT an extension's (that is experiment E6) — and a raw `elementFromPoint` hit
 * test with MVP-2's templates. No retries. No model. Local synthetic fixture on 127.0.0.1.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hostname } from "node:os";

import { ACTIONS, LOCAL_RULE, RUNS_PER_ACTION, VIEWPORT } from "./cases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const PORT = 8997;
const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};
const lfSha = (p) => createHash("sha256").update(readFileSync(p, "utf8").replace(/\r\n/g, "\n")).digest("hex");

const P = await import(pathToFileURL(join(ROOT, "packages/perception/dist/src/index.js")).href);
const A = await import(pathToFileURL(join(ROOT, "packages/agent/dist/src/index.js")).href);
if (typeof A.validateAndAct !== "function") refuse("this harness measures main (eb4604b); rebuild dist from main");

const FIXTURE = readFileSync(join(HERE, "fixture", "e8.html"));
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(FIXTURE);
});
await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const exe = process.env.CHROME_PATH || chromium.executablePath();
if (!existsSync(exe)) refuse(`no Chromium at ${exe}`);
const browser = await chromium.launch({ headless: true, executablePath: exe });

// Templates copied verbatim from the MVP-2 harness (workstation 1).
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
  const active = document.activeElement;
  const focused = (!active || active === document.body || active === document.documentElement) ? null : sel(active);
  return {
    viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight, origin: location.origin },
    focusedSelector: focused,
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

/** The effect oracle: the harness's knowledge of its own fixture. Never available to the product. */
const effectProbe = (effect) => `(() => {
  const [kind, sel] = ${JSON.stringify(effect)}.split(":");
  const el = document.querySelector(sel);
  if (kind === "focused") return document.activeElement === el;
  if (kind === "checked") return Boolean(el && el.checked);
  if (kind === "visible") { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  if (kind === "hash") return location.hash === sel;
  return null;
})()`;

let frameCounter = 0;
const observe = async (page) => {
  const probe = await page.evaluate(DOM_PROBE);
  frameCounter += 1;
  const fid = P.frameId(`e8-${frameCounter}`);
  const geometry = { dpr: 1, zoom: 1, viewportCss: { w: probe.viewport.w, h: probe.viewport.h }, captureSize: { w: probe.viewport.w, h: probe.viewport.h }, scroll: { x: 0, y: 0 }, origin: probe.viewport.origin };
  return { graph: P.buildElementGraph(probe.elements, geometry, fid), focusedSelector: probe.focusedSelector, fid };
};

const rows = [];
for (const action of ACTIONS) {
  for (let run = 0; run < RUNS_PER_ACTION; run += 1) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__ready === true);
    const before = await observe(page);
    const node = before.graph.nodes.find((n) => n.domRef.selector === action.selector);
    if (!node || (node.evidence.kind !== "OBSERVED" && node.evidence.kind !== "CLIPPED")) refuse(`${action.id}: target not observable`);
    const expect = { kind: LOCAL_RULE[node.role] ?? "FOCUS_ON_TARGET" };
    const bridges = {
      action: { frameId: before.fid, async clickAtCssPoint(p) { await page.mouse.click(p.x, p.y); } },
      hitTest: { frameId: before.fid, async topmostAtCssPoint(p) { const t = await page.evaluate(hitProbe(p.x, p.y)); return t === null ? null : { ...t, frameId: before.fid }; } },
    };
    const claim = { nodeId: node.id, role: node.role, name: node.name, frameId: before.fid, viewportBox: node.evidence.viewportBox };
    const outcome = await A.guardedAct(before.graph, { kind: "click", target: claim }, bridges, {
      verify: { expect, observe: async () => { const o = await observe(page); return { graph: o.graph, focusedSelector: o.focusedSelector }; } },
    });
    const effect = await page.evaluate(effectProbe(action.effect));
    await page.close();
    rows.push({
      action: action.id,
      run,
      role: node.role,
      postcondition: expect.kind,
      reached: outcome.reached,
      actStatus: outcome.result?.status ?? null,
      actCause: outcome.result?.cause ?? null,
      verification: outcome.verification?.verification ?? null,
      verificationCause: outcome.verification?.cause ?? null,
      effectHappened: effect,
    });
  }
}
await browser.close();
server.close();

const summary = ACTIONS.map((a) => {
  const rs = rows.filter((r) => r.action === a.id);
  const tally = (f) => rs.reduce((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
  const states = tally((r) => `${r.verification}${r.verificationCause ? ":" + r.verificationCause : ""}`);
  const effects = tally((r) => String(r.effectHappened));
  const confirmedWithoutEffect = rs.filter((r) => r.verification === "CONFIRMED" && r.effectHappened === false).length;
  const notConfirmedWithEffect = rs.filter((r) => r.verification !== "CONFIRMED" && r.effectHappened === true).length;
  const matchesPrediction = rs.every((r) => r.verification === a.predict && (a.predictCause === undefined || r.verificationCause === a.predictCause) && r.effectHappened === a.predictEffect);
  return {
    action: a.id,
    intent: a.intent,
    role: rs[0]?.role,
    postcondition: rs[0]?.postcondition,
    verificationStates: states,
    effectOracle: effects,
    confirmedWithoutEffect,
    notConfirmedWithEffect,
    predicted: `${a.predict}${a.predictCause ? ":" + a.predictCause : ""} / effect ${a.predictEffect}`,
    matchesPrediction,
  };
});

const dispatched = rows.filter((r) => r.actStatus === "EXECUTED");
const totals = {
  actions: ACTIONS.length,
  runs: rows.length,
  dispatched: dispatched.length,
  confirmed: rows.filter((r) => r.verification === "CONFIRMED").length,
  notConfirmed: rows.filter((r) => r.verification === "NOT_CONFIRMED").length,
  unknown: rows.filter((r) => r.verification === "UNKNOWN").length,
  confirmedButEffectAbsent: rows.filter((r) => r.verification === "CONFIRMED" && r.effectHappened === false).length,
  effectHappenedButNotConfirmed: rows.filter((r) => r.verification !== "CONFIRMED" && r.effectHappened === true).length,
  predictionsMatched: summary.filter((s) => s.matchesPrediction).length,
};

const log = {
  experiment: "E8-click-postconditions",
  recordedAt: new Date().toISOString(),
  workstation: "W2",
  hostname: hostname(),
  node: process.version,
  browser: { executable: exe.split(/[\\/]/).pop(), fromChromePathEnv: Boolean(process.env.CHROME_PATH) },
  dispatchMechanism: "Playwright page.mouse.click (trusted CDP input) — the MVP-1/MVP-2 mechanism, NOT an extension's",
  pipelineUnderTest: "main eb4604b guardedAct: VALIDATE → HIT-TEST → ACT → VERIFY RESULT; no retries",
  preRegistration: { commit: "0009184", casesSha256LF: lfSha(join(HERE, "cases.mjs")), fixtureSha256LF: lfSha(join(HERE, "fixture", "e8.html")) },
  totals,
  summary,
  rows,
};
mkdirSync(join(HERE, "..", "logs"), { recursive: true });
writeFileSync(join(HERE, "..", "logs", "e8.json"), JSON.stringify(log, null, 2) + "\n");
console.log(JSON.stringify({ totals, summary: summary.map(({ action, postcondition, verificationStates, effectOracle, predicted, matchesPrediction }) => ({ action, postcondition, verificationStates, effectOracle, predicted, matchesPrediction })) }, null, 2));
