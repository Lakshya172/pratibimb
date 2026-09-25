#!/usr/bin/env node
/**
 * M8.2 — run probe launches in Chromium (Chrome for Testing 153, unbranded), one fresh profile per
 * launch, with W1-QG03's exact launch arguments. The probe runs in the extension's offscreen
 * document; the service worker only drives it.
 *
 *   --candidate TR-01|TR-02  --mode cell|teardown|coexist  --backend wasm|webgpu
 *   --headless true|false    --launches N                   --label <results file stem>
 *   --plan bench             the interleaved 40-launch benchmark of protocol §7 (both candidates)
 *
 * In coexist mode an ordinary tab records requestAnimationFrame gaps while the round runs — the
 * browser-responsiveness measurement of protocol §6.
 *
 * Usage: CHROME_PATH=<chromium-1243 chrome.exe> node run-chromium.mjs ...
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = dirname(HERE);
const ROOT = join(EXP, "..", "..", "..");
const require2 = createRequire(join(ROOT, "package.json"));
const { chromium } = require2("playwright");
const CHROME = process.env.CHROME_PATH;
if (!CHROME) {
  console.error("REFUSING: set CHROME_PATH to the unbranded Chromium (branded Chrome ignores --load-extension)");
  process.exit(1);
}
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};

function machineState() {
  if (process.platform !== "win32") return null;
  const ps = (cmd) => {
    try {
      return execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8", timeout: 30000 }).trim();
    } catch (e) {
      return `unavailable: ${String(e).slice(0, 80)}`;
    }
  };
  return {
    at: new Date().toISOString(),
    powerScheme: ps("powercfg /getactivescheme"),
    battery: ps("Get-CimInstance Win32_Battery | ForEach-Object { 'BatteryStatus=' + $_.BatteryStatus + ' Charge=' + $_.EstimatedChargeRemaining }"),
  };
}

async function oneLaunch({ candidate, mode, backend, headless, extra = {} }) {
  const ext = join(EXP, "models", "ext", candidate, "chrome");
  const udd = mkdtempSync(join(tmpdir(), "pratibimb-m82-"));
  const rec = { candidate, mode, backend, headless, browser: "chromium", platform: "windows", extensionLoaded: false, startedAt: new Date().toISOString() };
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(udd, {
      headless,
      executablePath: CHROME,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"],
    });
    rec.browserVersion = ctx.browser()?.version() ?? null;
    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 60000 });
    rec.extensionLoaded = true;
    let page = null;
    if (mode === "coexist") {
      page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.setContent("<!doctype html><title>rAF monitor</title><p>responsiveness monitor</p>");
      await page.evaluate(() => {
        window.__gaps = [];
        let last = performance.now();
        const f = (t) => {
          window.__gaps.push(t - last);
          last = t;
          if (!window.__stop) requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      });
    }
    const t0 = Date.now();
    rec.result = await sw
      .evaluate((c) => globalThis.__m82_run(c), { mode, backend, ...extra })
      .catch((e) => ({ conclusion: "evaluate failed", errors: [String(e).slice(0, 400)] }));
    rec.wallMs = Date.now() - t0;
    if (page) {
      rec.responsiveness = await page.evaluate(() => {
        window.__stop = true;
        const g = window.__gaps.slice(1).sort((a, b) => a - b);
        return { frames: g.length, maxGapMs: g.at(-1) ?? null, p99GapMs: g[Math.floor(g.length * 0.99)] ?? null, medianGapMs: g[Math.floor(g.length / 2)] ?? null };
      });
    }
  } catch (e) {
    rec.runError = String(e).slice(0, 400);
  } finally {
    try {
      await ctx?.close();
    } catch {
      /* disposable profile */
    }
    try {
      rmSync(udd, { recursive: true, force: true });
    } catch {
      /* Windows may hold the profile briefly */
    }
  }
  return rec;
}

const out = { experiment: "M8.2-qg03-visual-text-feasibility", runner: "run-chromium.mjs", chromePath: CHROME, startedAt: new Date().toISOString(), machineStateStart: machineState(), launches: [] };
const plan = arg("plan");
let label;
if (plan === "bench") {
  label = arg("label", "bench-chromium-wasm");
  const order = [
    ["TR-01", false],
    ["TR-02", false],
    ["TR-01", true],
    ["TR-02", true],
  ];
  const rounds = Number(arg("rounds", "10"));
  for (let r = 1; r <= rounds; r++) {
    for (const [candidate, headless] of order) {
      const rec = await oneLaunch({ candidate, mode: "bench", backend: "wasm", headless, extra: { warm: 20 } });
      rec.round = r;
      out.launches.push(rec);
      const w = rec.result?.warmMs ?? [];
      const med = w.length ? [...w].sort((a, b) => a - b)[Math.floor(w.length / 2)] : null;
      process.stderr.write(`bench r${r} ${candidate} ${headless ? "headless" : "headful "} warm median ${med?.toFixed(1)} ms  ${rec.result?.conclusion ?? rec.runError}\n`);
    }
  }
} else {
  const candidate = arg("candidate");
  const mode = arg("mode", "cell");
  const backend = arg("backend", "wasm");
  const headless = arg("headless", "false") === "true";
  const launches = Number(arg("launches", "3"));
  label = arg("label", `${candidate.toLowerCase()}-${mode}-chromium-${backend}-${headless ? "headless" : "headful"}`);
  const extra = mode === "teardown" ? { cycles: 5, contextTeardown: true } : mode === "coexist" ? { rounds: 5 } : { warm: 10 };
  for (let i = 1; i <= launches; i++) {
    const rec = await oneLaunch({ candidate, mode, backend, headless, extra });
    rec.launch = i;
    out.launches.push(rec);
    process.stderr.write(`${label} launch ${i}: loaded=${rec.extensionLoaded} ${rec.result?.conclusion ?? rec.runError}\n`);
  }
}
out.machineStateEnd = machineState();
mkdirSync(join(EXP, "results"), { recursive: true });
const file = join(EXP, "results", `${label}.json`);
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`written: ${file}`);
