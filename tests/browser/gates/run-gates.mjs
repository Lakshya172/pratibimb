#!/usr/bin/env node
/**
 * ADR-0001 G1 / G2 / G3 — the permanent browser regression suite.
 *
 *   node tests/browser/gates/run-gates.mjs --browser=chromium
 *   node tests/browser/gates/run-gates.mjs --browser=firefox
 *
 * TWO arrival-logged origins:
 *   ALLOWED  127.0.0.1:8920   in connect-src   — serves probe.wasm, collects results
 *   FOREIGN  127.0.0.1:8921   NOT in connect-src — serves the same bytes
 *
 * GROUND TRUTH (the B-02 discipline, and the standing instruction that follows from it):
 * requests are attributed by **method + URL + gate identity**, never by a custom header
 * alone. A CORS preflight carries no custom header, and W1-S02a-2a-3 showed that treating
 * header-absence as "ORT's request" made Firefox look as though it broke a binding it did
 * not break. Preflights are therefore counted separately and excluded from the verdict.
 *
 * A probe that reports "blocked" while the foreign origin logged a GET is a FALSE GREEN
 * and fails the run. "No request observed" is never inferred from an observer that cannot
 * see the request: the ALLOWED origin is a positive control proving the log works.
 */
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const BUILD = join(HERE, "build");
const ALLOWED_PORT = 8920;
const FOREIGN_PORT = 8921;

const arg = (n, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`));
  return m ? m.split("=")[1] : d;
};
const BROWSER = arg("browser", "chromium");
const RUNS = Number(arg("runs", "1"));

/**
 * Resolve a tool from the workspace, falling back to an existing experiment harness.
 *
 * In CI the workspace install provides these. Locally the workspace install of the 28 MB
 * ORT dependency is unreliable on this connection, so the already-installed harness copies
 * are reused rather than blocking the gate on a download it does not need — G1/G2/G3
 * exercise the CSP and require no ORT at all.
 */
function resolveTool(spec) {
  const candidates = [
    join(ROOT, "node_modules"),
    join(ROOT, "artifacts/experiments/W1-S02a2a4-connect-src-provenance/harness/node_modules"),
    join(ROOT, "artifacts/experiments/W1-S02a2a1-csp-attack-surface/harness/node_modules"),
    join(ROOT, "artifacts/experiments/W1-S02a2a3-ort-wasm-hash-pin/harness/node_modules"),
    join(ROOT, "artifacts/experiments/W1-S02a2a2-firefox-csp-tokens/harness/node_modules"),
  ];
  for (const base of candidates) {
    try {
      const req = createRequire(join(base, "noop.js"));
      const resolved = req.resolve(spec);
      return { resolved, base };
    } catch { /* try next */ }
  }
  return null;
}

const PROBE_WASM = readFileSync(join(BUILD, "served", "probe.wasm"));

function makeOrigin(port, label, state) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, x-pratibimb-gate",
  };
  const server = createServer((req, res) => {
    const url = req.url.split("?")[0];
    state.arrivals.push({
      origin: label,
      method: req.method,
      url,
      gate: req.headers["x-pratibimb-gate"] ?? null,
      at: new Date().toISOString(),
    });
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (url === "/probe.wasm") {
      res.writeHead(200, { ...cors, "content-type": "application/wasm", "content-length": PROBE_WASM.length });
      return res.end(PROBE_WASM);
    }
    if (url === "/log") { state.alive = true; res.writeHead(200, cors); return res.end("ok"); }
    if (url === "/done") { state.done = true; res.writeHead(200, cors); return res.end("ok"); }
    if (url === "/sink") {
      try { state.results.push(JSON.parse(new URL(req.url, "http://x").searchParams.get("d"))); } catch {}
      res.writeHead(200, cors); return res.end("ok");
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (url === "/result") {
        try { state.results.push(JSON.parse(body)); } catch { state.results.push({ context: "PARSE_ERROR" }); }
      }
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end("{}");
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}

async function runChromium(state) {
  const pw = resolveTool("playwright");
  if (!pw) throw new Error("playwright not resolvable — run `npm ci` at the workspace root");
  const { chromium } = createRequire(join(pw.base, "noop.js"))("playwright");
  const exe =
    process.env.CHROME_PATH ||
    join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
  const profile = mkdtempSync(join(tmpdir(), "pratibimb-gates-"));
  const ext = join(BUILD, "chrome");
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profile, {
      headless: false, // the headless shell cannot load extensions at all
      ...(existsSync(exe) ? { executablePath: exe } : { channel: "msedge" }),
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-first-run", "--no-default-browser-check"],
    });
    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 30000 });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && !state.done) await new Promise((r) => setTimeout(r, 400));
    await new Promise((r) => setTimeout(r, 2500)); // grace: a late request still counts
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
}

async function runFirefox(state) {
  const we = resolveTool("web-ext/package.json") || resolveTool("web-ext");
  if (!we) throw new Error("web-ext not resolvable — run `npm ci` at the workspace root");
  const bin = join(we.base, "web-ext", "bin", "web-ext.js");
  const ff = process.env.FIREFOX_PATH || "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
  const profile = mkdtempSync(join(tmpdir(), "pratibimb-gates-ff-"));
  const child = spawn(
    process.execPath,
    [bin, "run", "--source-dir", join(BUILD, "firefox"), "--firefox", ff,
     "--start-url", `http://127.0.0.1:${ALLOWED_PORT}/log`, "--firefox-profile", profile,
     "--profile-create-if-missing", "--no-input", "--no-reload",
     "--pref", "extensions.originControls.grantByDefault=true"],
    { cwd: HERE, stdio: ["ignore", "pipe", "pipe"] }
  );
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && !state.done) await new Promise((r) => setTimeout(r, 400));
  await new Promise((r) => setTimeout(r, 2500));
  try { child.kill(); } catch {}
  // web-ext spawns Firefox as a grandchild; without this, instances accumulate.
  try {
    const { execSync } = await import("node:child_process");
    execSync("taskkill /F /IM firefox.exe /T", { stdio: "ignore" });
  } catch {}
  rmSync(profile, { recursive: true, force: true });
  state.driverLog = log.slice(-800);
}

/** Turn one run's raw observations into explicit G1/G2/G3 verdicts. */
function evaluate(state) {
  const foreignGets = state.arrivals.filter(
    (a) => a.origin === "foreign" && a.method === "GET" && a.url === "/probe.wasm"
  );
  const foreignPreflights = state.arrivals.filter(
    (a) => a.origin === "foreign" && a.method === "OPTIONS"
  );
  const allowedGets = state.arrivals.filter(
    (a) => a.origin === "allowed" && a.method === "GET" && a.url === "/probe.wasm"
  );

  const contexts = state.results.filter((r) => r.context && !r.fatal);
  const findings = [];

  // Observer sanity. Without this a "0 foreign GETs" result is meaningless.
  if (allowedGets.length === 0) {
    findings.push("OBSERVER: the allowed origin logged no GET — the arrival log cannot be trusted this run");
  }
  if (contexts.length === 0) {
    findings.push("NO CONTEXTS REPORTED — extension did not run; alive=" + state.alive);
  }

  const g1 = contexts.every((c) => c.g1_wasm_capability?.allowed === true) && contexts.length > 0;
  const g1Validate = contexts.every((c) => c.g1_validate_never_called === true);

  const probeSaysForeignBlocked =
    contexts.length > 0 &&
    contexts.every(
      (c) => c.g2_foreign_origin?.allowed === false && c.g2_foreign_streaming?.allowed === false
    );
  const g2 = probeSaysForeignBlocked && foreignGets.length === 0;
  if (probeSaysForeignBlocked && foreignGets.length > 0) {
    findings.push(`FALSE GREEN: probe reported blocked but the foreign origin logged ${foreignGets.length} GET(s)`);
  }

  const g3 = contexts.every(
    (c) =>
      c.g3_js_sinks?.eval.allowed === false &&
      c.g3_js_sinks?.newFunction.allowed === false &&
      c.g3_js_sinks?.setTimeoutString.allowed === false
  ) && contexts.length > 0;

  return {
    contexts: contexts.map((c) => c.context),
    G1_wasm_compiles: g1,
    G1_validate_never_called: g1Validate,
    G2_foreign_origin_blocked: g2,
    G3_js_sinks_blocked: g3,
    groundTruth: {
      allowedOriginGETs: allowedGets.length,
      foreignOriginGETs: foreignGets.length,
      foreignOriginPreflights: foreignPreflights.length,
      note: "Verdict uses GETs only. Preflights carry no custom header and must not be counted as real requests.",
    },
    findings,
  };
}

(async () => {
  const all = [];
  for (let i = 1; i <= RUNS; i++) {
    const state = { arrivals: [], results: [], done: false, alive: false };
    const a = makeOrigin(ALLOWED_PORT, "allowed", state);
    const f = makeOrigin(FOREIGN_PORT, "foreign", state);
    try {
      if (BROWSER === "firefox") await runFirefox(state);
      else await runChromium(state);
    } finally {
      a.close(); f.close();
    }
    const verdict = evaluate(state);
    all.push({ run: i, browser: BROWSER, verdict, results: state.results, arrivals: state.arrivals });
    console.log(`\n[${BROWSER} run ${i}] contexts=${verdict.contexts.length}`);
    console.log(`  G1 wasm compiles           : ${verdict.G1_wasm_compiles ? "PASS" : "FAIL"}`);
    console.log(`  G1 validate never called   : ${verdict.G1_validate_never_called ? "PASS" : "FAIL"}`);
    console.log(`  G2 foreign origin blocked  : ${verdict.G2_foreign_origin_blocked ? "PASS" : "FAIL"}` +
      `   (allowed GETs=${verdict.groundTruth.allowedOriginGETs}, foreign GETs=${verdict.groundTruth.foreignOriginGETs}, preflights=${verdict.groundTruth.foreignOriginPreflights})`);
    console.log(`  G3 js sinks blocked        : ${verdict.G3_js_sinks_blocked ? "PASS" : "FAIL"}`);
    for (const f2 of verdict.findings) console.log(`  !! ${f2}`);
  }

  mkdirSync(join(HERE, "results"), { recursive: true });
  const out = join(HERE, "results", `gates-${BROWSER}.json`);
  writeFileSync(out, JSON.stringify({ browser: BROWSER, runs: RUNS, collectedAt: new Date().toISOString(), records: all }, null, 2));
  console.log(`\nwrote ${out}`);

  const failed = all.some(
    (r) =>
      !r.verdict.G1_wasm_compiles ||
      !r.verdict.G1_validate_never_called ||
      !r.verdict.G2_foreign_origin_blocked ||
      !r.verdict.G3_js_sinks_blocked ||
      r.verdict.findings.length > 0
  );
  process.exit(failed ? 1 : 0);
})();
