#!/usr/bin/env node
/**
 * M8.2 — run probe launches in Firefox 155.0.1 through web-ext 8.3.0, one fresh profile per
 * launch. Works on Windows and, unchanged, inside W1's WSL2 Ubuntu guest (the Firefox WASM (Linux)
 * cell). W1-QG03's method: the probe runs in the MV3 event page and reports to a loopback
 * collector, over fetch or chunked tab beacons.
 *
 * One pref only: extensions.originControls.grantByDefault=true (report delivery, W1-QG03's reason).
 * dom.webgpu.enabled is NOT touched (S-02a's rule).
 *
 *   --candidate TR-01|TR-02  --mode cell|teardown|coexist|bench  --backend wasm|webgpu
 *   --headless true|false    --launches N                         --label <results file stem>
 *
 * Env: FIREFOX_PATH, WEB_EXT (path to web-ext.js), PLATFORM_LABEL (windows|linux-wsl2).
 */
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = dirname(HERE);
const PORT = 8913;
const FIREFOX = process.env.FIREFOX_PATH;
const WEB_EXT = process.env.WEB_EXT;
const PLATFORM = process.env.PLATFORM_LABEL || process.platform;
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
for (const [w, p] of [["FIREFOX_PATH", FIREFOX], ["WEB_EXT", WEB_EXT]]) {
  if (!p || !existsSync(p)) {
    console.error(`REFUSING: set ${w} (${p})`);
    process.exit(1);
  }
}
const readFirefoxVersion = () => {
  try {
    return execFileSync(FIREFOX, ["--version"], { encoding: "utf8", timeout: 60000 }).trim();
  } catch (e) {
    return `unavailable: ${String(e).slice(0, 80)}`;
  }
};
const firefoxVersion = readFirefoxVersion();

const results = [];
const chunks = new Map();
const server = createServer({ maxHeaderSize: 4000000 }, (req, res) => {
  if (req.method === "GET" && req.url.startsWith("/chunk")) {
    const raw = req.url;
    const dAt = raw.indexOf("&d=");
    const meta = new URL(raw.slice(0, dAt < 0 ? raw.length : dAt), "http://127.0.0.1");
    const id = meta.searchParams.get("id");
    const i = Number(meta.searchParams.get("i"));
    const n = Number(meta.searchParams.get("n"));
    if (!chunks.has(id)) chunks.set(id, { n, parts: [] });
    const st = chunks.get(id);
    st.parts[i] = dAt < 0 ? "" : raw.slice(dAt + 3);
    if (st.parts.filter((x) => typeof x === "string").length === n) {
      try {
        results.push(JSON.parse(decodeURIComponent(st.parts.join(""))));
      } catch (e) {
        results.push({ context: "__chunk_parse_error__", message: String(e).slice(0, 200) });
      }
      chunks.delete(id);
    }
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<!doctype html>ok");
  }
  if (req.method === "GET" && req.url.startsWith("/alive")) {
    results.push({ context: "__alive__" });
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<!doctype html>alive");
  }
  if (req.method === "POST" && req.url === "/result") {
    const buf = [];
    req.on("data", (c) => buf.push(c));
    req.on("end", () => {
      try {
        results.push(JSON.parse(Buffer.concat(buf).toString("utf8")));
      } catch {
        /* recorded by absence */
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));

/**
 * Firefox processes started for THIS launch only: matched by the launch's own temporary profile
 * directory on the command line, so a person's own Firefox is never touched.
 */
function launchPids(profile) {
  try {
    if (process.platform === "win32") {
      const needle = profile.replace(/'/g, "''");
      const o = execFileSync(
        "powershell",
        ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='firefox.exe'" | Where-Object { $_.CommandLine -like '*${needle}*' } | ForEach-Object { $_.ProcessId }`],
        { encoding: "utf8", timeout: 30000 }
      );
      return String(o).split(/\s+/).filter(Boolean).map(Number);
    }
    const o = execFileSync("pgrep", ["-f", profile], { encoding: "utf8" });
    return String(o).split(/\s+/).filter(Boolean).map(Number).filter((p) => p !== process.pid);
  } catch {
    return [];
  }
}

async function oneLaunch({ candidate, mode, backend, headless, config, extraPrefs = [], deadlineMs = 900000 }) {
  const ext = join(EXP, "models", "ext", candidate, "firefox");
  writeFileSync(join(ext, "m82-config.js"), `globalThis.M82_CONFIG = ${JSON.stringify({ mode, backend, ...config })};\n`);
  const before = results.length;
  const profile = mkdtempSync(join(tmpdir(), "pratibimb-m82-ff-"));
  const args = [WEB_EXT, "run", "--source-dir", ext, "--firefox", FIREFOX, "--start-url", "about:blank", "--firefox-profile", profile, "--profile-create-if-missing", "--no-input", "--no-reload", "--pref", "extensions.originControls.grantByDefault=true"];
  for (const p of extraPrefs) args.push("--pref", p);
  if (headless) args.push("--arg=--headless");
  const child = spawn(process.execPath, args, { cwd: HERE, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d.toString()));
  child.stderr.on("data", (d) => (log += d.toString()));
  const t0 = Date.now();
  const real = () => results.slice(before).filter((r) => r.context !== "__alive__");
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline && real().length < 1) await new Promise((r) => setTimeout(r, 500));
  const wallMs = Date.now() - t0;
  child.kill();
  await new Promise((r) => setTimeout(r, 1500));
  const spawned = launchPids(profile);
  for (const p of spawned) {
    try {
      process.kill(p, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
  // RECORDING ONLY (added for M8.2a): the prefs web-ext wrote into this launch's temporary profile,
  // so a run can prove which prefs differed from another. The profile is still deleted below.
  let profilePrefs = null;
  try {
    const lines = readFileSync(join(profile, "user.js"), "utf8").split(/\r?\n/).filter((l) => l.startsWith("user_pref(")).sort();
    profilePrefs = { count: lines.length, sha256: createHash("sha256").update(lines.join("\n")).digest("hex"), lines };
  } catch {
    profilePrefs = { unavailable: true };
  }
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* disposable */
  }
  return {
    candidate,
    mode,
    backend,
    headless,
    browser: "firefox",
    platform: PLATFORM,
    browserVersion: firefoxVersion,
    livenessSeen: results.slice(before).some((r) => r.context === "__alive__"),
    timedOut: real().length === 0,
    wallMs,
    result: real()[0] ?? null,
    firefoxProcessesReaped: spawned.length,
    extraPrefs,
    deadlineMs,
    webExtArgs: args.slice(1).map((a) => (a === ext ? "<ext>" : a === FIREFOX ? "<firefox>" : a === profile ? "<profile>" : a)),
    profilePrefs,
    webExtLogTail: log.split("\n").filter(Boolean).slice(-4),
  };
}

const candidate = arg("candidate");
const mode = arg("mode", "cell");
const backend = arg("backend", "wasm");
const headless = arg("headless", "false") === "true";
const launches = Number(arg("launches", "3"));
const label = arg("label", `${candidate.toLowerCase()}-${mode}-firefox-${PLATFORM}-${backend}-${headless ? "headless" : "headful"}`);
const config = mode === "teardown" ? { cycles: 5 } : mode === "coexist" ? { rounds: 5 } : mode === "bench" ? { warm: 20 } : { warm: 10 };
// DIAGNOSTIC-ONLY overrides, added after the recorded run to investigate two launches that never
// reported (README, "Diagnostic"). The recorded cells used none of them; diag-* files are never
// read by aggregate.mjs. M8.2a uses exactly one of them, --pref, as its pre-registered harness
// amendment (artifacts/experiments/M8.2a-firefox-wasm-rerun/protocol.md), with --out-dir so its
// records never enter M8.2's results.
if (arg("warm")) config.warm = Number(arg("warm"));
const extraPrefs = process.argv.flatMap((a, i) => (a === "--pref" ? [process.argv[i + 1]] : []));
const deadlineMs = Number(arg("deadline-ms", "900000"));
const outDir = arg("out-dir", join(EXP, "results"));
const out = { experiment: arg("experiment", "M8.2-qg03-visual-text-feasibility"), runner: "run-firefox.mjs", platform: PLATFORM, firefoxPath: FIREFOX, firefoxVersion, startedAt: new Date().toISOString(), launches: [] };
for (let i = 1; i <= launches; i++) {
  const rec = await oneLaunch({ candidate, mode, backend, headless, config, extraPrefs, deadlineMs });
  rec.launch = i;
  out.launches.push(rec);
  process.stderr.write(`${label} launch ${i}: alive=${rec.livenessSeen} timedOut=${rec.timedOut} ${rec.result?.conclusion ?? ""}\n`);
}
server.close();
out.firefoxVersionAfter = readFirefoxVersion();
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${label}.json`);
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`written: ${file}`);
process.exit(0);
