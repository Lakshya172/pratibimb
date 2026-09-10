/**
 * W1-S05-rate runner. THROWAWAY SPIKE CODE. The artifact is the deliverable.
 *
 *   node run-s05rate.mjs                  Chromium
 *   node run-s05rate.mjs --browser=firefox
 *
 * Serves the QG-02 fixture as the page under capture — reused deliberately rather than
 * inventing another one, so the frame being captured is the same realistic form the
 * coordinate gate already measures.
 *
 * Loads a probe extension, lets it run a BOUNDED schedule set, and collects the raw
 * per-attempt records over loopback. The extension's self-report is the measurement here
 * (the API result is exactly what we are characterizing), but the collector independently
 * timestamps arrival, so a harness stall is visible rather than being attributed to the
 * browser — the B-02 lesson applied to the one place it still bites.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = dirname(HERE);
const ROOT = join(HERE, "..", "..", "..", "..");
const PORT = 8940;

const arg = (n, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`));
  return m ? m.split("=")[1] : d;
};
const BROWSER = arg("browser", "chromium");

function resolveTool(spec) {
  for (const base of [
    join(ROOT, "node_modules"),
    join(ROOT, "artifacts/experiments/W1-S02a2a4-connect-src-provenance/harness/node_modules"),
    join(ROOT, "artifacts/experiments/W1-S02a2a1-csp-attack-surface/harness/node_modules"),
    join(ROOT, "artifacts/experiments/W1-S02a2a3-ort-wasm-hash-pin/harness/node_modules"),
    join(ROOT, "artifacts/experiments/W1-S02a2a2-firefox-csp-tokens/harness/node_modules"),
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

/** Collector: serves the fixture, receives chunked results, timestamps every arrival. */
function startCollector(state) {
  const fixture = readFileSync(join(ROOT, "tests/browser/qg02/fixture/form.html"));
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    state.arrivals.push({ at: Date.now(), method: req.method, path: url.pathname });

    if (url.pathname === "/done") {
      state.done = true;
      res.writeHead(200, cors);
      return res.end("ok");
    }
    if (url.pathname === "/result") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        state.parts.set(Number(url.searchParams.get("part")), body);
        state.expectedParts = Number(url.searchParams.get("of"));
        res.writeHead(200, cors);
        res.end("ok");
      });
      return;
    }
    res.writeHead(200, { ...cors, "content-type": "text/html; charset=utf-8" });
    res.end(fixture);
  });
  server.listen(PORT, "127.0.0.1");
  return server;
}

function chromeExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const local = process.env.LOCALAPPDATA || "";
  for (const p of [
    join(local, "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe"),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function runChromium(state) {
  const base = resolveTool("playwright");
  if (!base) throw new Error("playwright not resolvable — run `npm ci` at the workspace root");
  const { chromium } = createRequire(join(base, "noop.js"))("playwright");
  const exe = chromeExecutable();
  const ext = join(HERE, "ext-chrome");
  const profile = mkdtempSync(join(tmpdir(), "s05rate-"));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profile, {
      headless: false, // an extension cannot load in the headless shell
      ...(exe ? { executablePath: exe } : { channel: "msedge" }),
      args: [
        `--disable-extensions-except=${ext}`,
        `--load-extension=${ext}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    // The captured tab must be the fixture, not the new-tab page.
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    await page.bringToFront();

    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 30000 });
    state.workerUrl = sw.url();
    state.browserVersion = ctx.browser()?.version?.() ?? "persistent-context";

    const deadline = Date.now() + 420000; // bounded: schedules total well under this
    while (Date.now() < deadline && !state.done) await new Promise((r) => setTimeout(r, 500));
    await new Promise((r) => setTimeout(r, 1500));
  } finally {
    try { await ctx?.close(); } catch { /* ignore */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function runFirefox(state) {
  const base = resolveTool("web-ext/package.json") || resolveTool("web-ext");
  if (!base) throw new Error("web-ext not resolvable");
  const bin = join(base, "web-ext", "bin", "web-ext.js");
  const ff = process.env.FIREFOX_PATH || "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
  const profile = mkdtempSync(join(tmpdir(), "s05rate-ff-"));
  const child = spawn(
    process.execPath,
    [
      bin, "run",
      "--source-dir", join(HERE, "ext-firefox"),
      "--firefox", ff,
      "--start-url", `http://127.0.0.1:${PORT}/`,
      "--firefox-profile", profile,
      "--profile-create-if-missing",
      "--no-input",
      "--no-reload",
      "--pref", "extensions.originControls.grantByDefault=true",
    ],
    { cwd: HERE, stdio: ["ignore", "pipe", "pipe"] }
  );
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  const deadline = Date.now() + 420000;
  while (Date.now() < deadline && !state.done) await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => setTimeout(r, 1500));
  try { child.kill(); } catch { /* ignore */ }
  // web-ext spawns Firefox as a grandchild; without this, instances accumulate.
  try { execSync("taskkill /F /IM firefox.exe /T", { stdio: "ignore" }); } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  state.driverLog = log.slice(-1500);
}

// ─────────────────────────────── analysis ───────────────────────────────
//
// Descriptive only. This summarises what was observed; it does NOT convert an observation
// into a policy constant. That decision is made in the write-up, deliberately by a human
// reading the numbers, not by this function.

function summarise(payload) {
  const bySchedule = new Map();
  for (const r of payload.allRecords ?? []) {
    const key = r.rung ? `${r.schedule}@${r.rung}Hz` : r.schedule;
    const s = bySchedule.get(key) ?? { key, n: 0, ok: 0, fail: 0, errors: new Map(), intervals: [], elapsed: [] };
    s.n += 1;
    if (r.ok) s.ok += 1;
    else {
      s.fail += 1;
      const e = `${r.errName}: ${r.errMessage}`;
      s.errors.set(e, (s.errors.get(e) ?? 0) + 1);
    }
    if (r.actualIntervalMs !== null) s.intervals.push(r.actualIntervalMs);
    s.elapsed.push(r.elapsedMs);
    bySchedule.set(key, s);
  }

  const med = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    return Math.round(s[Math.floor(s.length / 2)]);
  };

  return [...bySchedule.values()].map((s) => ({
    schedule: s.key,
    attempts: s.n,
    ok: s.ok,
    fail: s.fail,
    successRate: Number((s.ok / s.n).toFixed(3)),
    medianActualIntervalMs: med(s.intervals),
    medianElapsedMs: med(s.elapsed),
    distinctErrors: [...s.errors.entries()].map(([e, n]) => ({ error: e, count: n })),
  }));
}

// ─────────────────────────────── main ───────────────────────────────

const state = { arrivals: [], parts: new Map(), expectedParts: 0, done: false };
const server = startCollector(state);

console.log(`[S-05-rate] ${BROWSER}: bounded schedule set, this takes several minutes...`);
try {
  if (BROWSER === "firefox") await runFirefox(state);
  else await runChromium(state);
} finally {
  server.close();
}

let payload = null;
let parseError = null;
if (state.parts.size > 0) {
  const ordered = [...state.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  try {
    payload = JSON.parse(ordered.join(""));
  } catch (e) {
    parseError = String(e);
  }
}

const outDir = join(EXP, "results");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `s05rate-${BROWSER}.json`);

const record = {
  experiment: "W1-S05-rate",
  question:
    "What observable rate/behaviour does tabs.captureVisibleTab exhibit under realistic " +
    "PratiBimb usage, and what failure semantics must the production adapter preserve?",
  browser: BROWSER,
  collectedAt: new Date().toISOString(),
  harness: {
    workerUrl: state.workerUrl ?? null,
    driverLog: state.driverLog ?? null,
    collectorArrivals: state.arrivals.length,
    partsReceived: state.parts.size,
    partsExpected: state.expectedParts,
    completed: state.done,
    parseError,
  },
  limitations: [
    "activeTab is NOT MEASURED. It grants capture only after a user gesture on the " +
      "extension action, which cannot be driven from this harness. The dossier states " +
      "capture is rate-limited 'particularly under activeTab', so that cell must not be " +
      "assumed to match the host_permissions cell measured here.",
    "Windows only. No Linux or macOS cell.",
    "Error strings are recorded verbatim as OBSERVED BEHAVIOUR. No claim is made about a " +
      "browser-internal mechanism that was not measured.",
  ],
  summary: payload ? summarise(payload) : null,
  raw: payload,
};

writeFileSync(out, JSON.stringify(record, null, 2));

if (!payload) {
  console.error(`\n[S-05-rate] ${BROWSER}: NO RESULT COLLECTED.`);
  console.error(`  parts=${state.parts.size} arrivals=${state.arrivals.length} done=${state.done}`);
  if (parseError) console.error(`  parse error: ${parseError}`);
  if (state.driverLog) console.error(`  driver log tail:\n${state.driverLog}`);
  console.log(`\nwrote ${out}`);
  process.exit(1);
}

console.log(`\n[S-05-rate] ${BROWSER} — ${payload.context}`);
console.log(`  permissions: ${JSON.stringify(payload.permissions)}`);
console.log(`  ${"schedule".padEnd(20)} ${"n".padEnd(4)} ${"ok".padEnd(4)} ${"fail".padEnd(5)} ${"rate".padEnd(7)} medInterval  medElapsed`);
for (const s of record.summary) {
  console.log(
    `  ${s.schedule.padEnd(20)} ${String(s.attempts).padEnd(4)} ${String(s.ok).padEnd(4)} ` +
      `${String(s.fail).padEnd(5)} ${String(s.successRate).padEnd(7)} ` +
      `${String(s.medianActualIntervalMs ?? "-").padEnd(12)} ${s.medianElapsedMs}`
  );
}
const errs = new Set();
for (const s of record.summary) for (const e of s.distinctErrors) errs.add(e.error);
if (errs.size) {
  console.log("\n  distinct errors observed (verbatim):");
  for (const e of errs) console.log(`    ${e}`);
} else {
  console.log("\n  no failures observed in any schedule");
}
const rec = payload.schedules?.find((s) => s.name === "recovery");
if (rec) console.log(`\n  recovery: recoveredAfterMs=${rec.recoveredAfterMs}`);

console.log(`\nwrote ${out}`);
