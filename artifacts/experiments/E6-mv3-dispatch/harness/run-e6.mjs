/**
 * E6 — what can the real MV3 host type and click, without chrome.debugger?
 *
 * Rebuilds the Track G host (with the E6 mechanisms), loads it unpacked in each cell, and for every
 * pre-registered mechanism × fixture runs 10 fresh pages. The PAGE's own main-world logger is the
 * witness for events, trust, React state and hostile-patch observations; the extension reports only
 * booleans and timings. Also tests that a value release armed for one document is refused after a
 * reload. Mechanism C (chrome.debugger) is not run.
 *
 * 127.0.0.1 only. The only "value" is a synthetic 10-digit canary held in the offscreen stub.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname, tmpdir } from "node:os";

import { CELLS, CLICK_FIXTURES, CLICK_MECHANISMS, PREDICTIONS, RUNS, SYNTHETIC_CANARY, TYPE_FIXTURES, TYPE_MECHANISMS } from "./cases.mjs";
import { PAGES } from "./fixture/pages.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const REACT_DIR = process.env.E6_REACT_DIR;
const PORT = 8994;
const RELEASE_TTL_MS = 5_000; // a TEST lifetime for the value-release nonce, not a proposal
const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};
const sha = (b) => createHash("sha256").update(b).digest("hex");

if (!REACT_DIR) refuse("set E6_REACT_DIR to a directory holding react.production.min.js and react-dom.production.min.js (18.3.1)");
const REACT = readFileSync(join(REACT_DIR, "react.production.min.js"));
const REACT_DOM = readFileSync(join(REACT_DIR, "react-dom.production.min.js"));

execSync("npm run build -w @pratibimb/extension", { cwd: ROOT, stdio: "pipe" });
if (!existsSync(join(EXT, "manifest.json"))) refuse("host build failed");

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/vendor/react.production.min.js") return res.writeHead(200, { "content-type": "text/javascript" }), res.end(REACT);
  if (url.pathname === "/vendor/react-dom.production.min.js") return res.writeHead(200, { "content-type": "text/javascript" }), res.end(REACT_DOM);
  const key = url.pathname.slice(1);
  if (!PAGES[key]) return res.writeHead(404), res.end();
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGES[key]);
});
await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const LAUNCH = { "chrome-for-testing-153": { executablePath: process.env.CHROME_PATH }, "edge-branded": { channel: "msedge" } };

async function openFixture(ctx, sw, name) {
  const before = await sw.evaluate(() => globalThis.__host.hellos.length);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/${name}`, { waitUntil: "load" });
  for (let i = 0; i < 60; i += 1) {
    if ((await sw.evaluate(() => globalThis.__host.hellos.length)) > before) break;
    await page.waitForTimeout(50);
  }
  const hello = await sw.evaluate(() => globalThis.__host.hellos.at(-1));
  if (name === "F2_react_controlled") await page.waitForFunction(() => typeof window.__forceRerender === "function");
  return { page, tabId: hello.identity.tabId, documentId: hello.identity.documentId };
}

const pageView = (page) =>
  page.evaluate(() => {
    const el = document.getElementById("t");
    return {
      valueLength: el && "value" in el ? el.value.length : null,
      valueIsCanary: el && "value" in el ? el.value === "9000000001" : null,
      focused: document.activeElement === el,
      reactState: typeof window.__reactValue === "string" ? window.__reactValue === "9000000001" : null,
      mirror: document.getElementById("mirror") ? document.getElementById("mirror").textContent === "9000000001" : null,
      events: window.__events.map((e) => `${e.type}${e.isTrusted ? "+T" : ""}${e.inputType ? "(" + e.inputType + ")" : ""}`),
      stolen: window.__stolen ?? null,
      seenAfterInput: window.__seenAfterInput ?? null,
      effect: window.__effect ?? null,
      overlay: window.__overlay ?? null,
    };
  });

const rows = [];
const staleTests = [];
const cellMeta = {};
for (const cell of CELLS) {
  const udd = mkdtempSync(join(tmpdir(), "pb-e6-"));
  const ctx = await chromium.launchPersistentContext(udd, { headless: false, ...LAUNCH[cell], args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  cellMeta[cell] = { browserVersion: ctx.browser()?.version?.() ?? null };
  let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://")) ?? (await ctx.waitForEvent("serviceworker"));
  await sw.evaluate(() => globalThis.__host.ensureOffscreen());

  for (const mechanism of Object.keys(TYPE_MECHANISMS)) {
    for (const fixture of Object.keys(TYPE_FIXTURES)) {
      for (let run = 0; run < RUNS; run += 1) {
        const { page, tabId } = await openFixture(ctx, sw, fixture);
        const t0 = Date.now();
        const armed = await sw.evaluate(({ tabId, ttl }) => globalThis.__host.e6Arm(tabId, ttl), { tabId, ttl: RELEASE_TTL_MS });
        const ext = await sw.evaluate(({ tabId, m, nonce }) => globalThis.__host.toTab(tabId, { kind: "E6_TYPE", mechanism: m, selector: "#t", nonce }), { tabId, m: mechanism, nonce: armed.nonce });
        const totalMs = Date.now() - t0;
        const view = await pageView(page);
        let afterRerender = null;
        if (fixture === "F2_react_controlled") {
          await page.evaluate(() => window.__forceRerender());
          await page.waitForTimeout(50);
          afterRerender = await pageView(page);
        }
        await page.close();
        rows.push({ cell, kind: "TYPE", mechanism, fixture, run, ext, totalMs, page: view, afterRerender });
      }
    }
  }

  for (const mechanism of Object.keys(CLICK_MECHANISMS)) {
    for (const fixture of Object.keys(CLICK_FIXTURES)) {
      for (let run = 0; run < RUNS; run += 1) {
        const { page, tabId } = await openFixture(ctx, sw, fixture);
        const ext = await sw.evaluate(({ tabId, m }) => globalThis.__host.toTab(tabId, { kind: "E6_CLICK", mechanism: m, selector: "#t" }), { tabId, m: mechanism });
        const view = await pageView(page);
        await page.close();
        rows.push({ cell, kind: "CLICK", mechanism, fixture, run, ext, page: view });
      }
    }
  }

  // A value release armed for one document must be refused after a reload replaces that document.
  for (let run = 0; run < 3; run += 1) {
    const { page, tabId, documentId } = await openFixture(ctx, sw, "F1_plain_tel");
    const armed = await sw.evaluate(({ tabId, ttl }) => globalThis.__host.e6Arm(tabId, ttl), { tabId, ttl: RELEASE_TTL_MS });
    const before = await sw.evaluate(() => globalThis.__host.hellos.length);
    await page.reload({ waitUntil: "load" });
    for (let i = 0; i < 60; i += 1) {
      if ((await sw.evaluate(() => globalThis.__host.hellos.length)) > before) break;
      await page.waitForTimeout(50);
    }
    const newDoc = (await sw.evaluate(() => globalThis.__host.hellos.at(-1))).identity.documentId;
    const ext = await sw.evaluate(({ tabId, nonce }) => globalThis.__host.toTab(tabId, { kind: "E6_TYPE", mechanism: "A_native_setter_events", selector: "#t", nonce }), { tabId, nonce: armed.nonce });
    const view = await pageView(page);
    await page.close();
    staleTests.push({ cell, run, armedFor: documentId, afterReload: newDoc, documentChanged: documentId !== newDoc, ext, pageValueLength: view.valueLength });
  }
  await ctx.close();
}
server.close();

// ── summarise ────────────────────────────────────────────────────────────────────────────────
const groups = {};
for (const r of rows) (groups[`${r.cell}|${r.mechanism}|${r.fixture}`] ??= []).push(r);
const summary = Object.entries(groups).map(([key, rs]) => {
  const [cell, mechanism, fixture] = key.split("|");
  const count = (f) => rs.filter(f).length;
  const s = { cell, mechanism, fixture, runs: rs.length, prediction: PREDICTIONS[`${mechanism}|${fixture}`] ?? null };
  if (rs[0].kind === "TYPE") {
    Object.assign(s, {
      released: count((r) => r.ext?.released === true),
      extError: count((r) => r.ext?.error),
      valueIsCanary: count((r) => r.page.valueIsCanary === true),
      finalLengths: [...new Set(rs.map((r) => r.page.valueLength))],
      focused: count((r) => r.page.focused),
      anyTrustedInput: count((r) => r.page.events.some((e) => /^(input|beforeinput)\+T/.test(e))),
      eventPatterns: [...new Set(rs.map((r) => r.page.events.join(" ")))],
      reactState: fixture === "F2_react_controlled" ? count((r) => r.page.reactState === true) : null,
      survivesRerender: fixture === "F2_react_controlled" ? count((r) => r.afterRerender?.valueIsCanary === true && r.afterRerender?.mirror === true) : null,
      hostilePatchesSawAValue: fixture === "F5_hostile_monkeypatch" ? count((r) => (r.page.stolen ?? []).length > 0) : null,
      pageReadValueAfterInput: fixture === "F5_hostile_monkeypatch" ? count((r) => (r.page.seenAfterInput ?? []).some((n) => n > 0)) : null,
      fetchMsP50: median(rs.map((r) => r.ext?.fetchMs).filter(Number.isFinite)),
      insertMsP50: median(rs.map((r) => r.ext?.insertMs).filter(Number.isFinite)),
    });
  } else {
    Object.assign(s, {
      dispatchedTo: [...new Set(rs.map((r) => r.ext?.dispatchedTo))],
      targetEffect: count((r) => (r.page.effect ?? 0) > 0),
      overlayReceived: fixture === "K2_transparent_overlay" ? count((r) => (r.page.overlay ?? 0) > 0) : null,
      anyTrustedClick: count((r) => r.page.events.some((e) => /^click\+T/.test(e))),
      eventPatterns: [...new Set(rs.map((r) => r.page.events.join(" ")))],
    });
  }
  return s;
});
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)] * 100) / 100;
}

const log = {
  experiment: "E6-mv3-dispatch",
  recordedAt: new Date().toISOString(),
  workstation: "W2",
  hostname: hostname(),
  node: process.version,
  cells: cellMeta,
  host: "apps/extension (Track G) + host-lib/e6-mechanisms.ts; built fresh by this harness",
  mechanismC: "NOT RUN — chrome.debugger requires a new permission, shows an infobar, and needs explicit approval",
  react: { version: "18.3.1", reactSha256: sha(REACT), reactDomSha256: sha(REACT_DOM), source: "npm pack react@18.3.1 react-dom@18.3.1 (UMD production builds), not committed" },
  preRegistration: { commit: "3111459" },
  releaseNonceTtlMs: RELEASE_TTL_MS,
  summary,
  staleTests,
  rows,
};
mkdirSync(join(HERE, "..", "logs"), { recursive: true });
writeFileSync(join(HERE, "..", "logs", "e6.json"), JSON.stringify(log, null, 2) + "\n");
console.log(JSON.stringify({ cells: cellMeta, summary: summary.map(({ eventPatterns, prediction, ...rest }) => rest), staleTests: staleTests.map(({ cell, run, documentChanged, ext, pageValueLength }) => ({ cell, run, documentChanged, released: ext?.released, refused: ext?.refused, pageValueLength })) }, null, 1));
