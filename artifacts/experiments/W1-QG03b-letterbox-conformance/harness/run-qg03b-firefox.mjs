/**
 * QG-03 Firefox runner.
 *
 *   BACKEND=wasm   node .../run-qg03b-firefox.mjs
 *   BACKEND=webgpu node .../run-qg03b-firefox.mjs
 *
 * RELEASE DEFAULTS ONLY, and that is a pre-registered rule rather than a convenience.
 * S-02a fixed it: "a result requiring an about:config change on the release channel is
 * CONDITIONAL, never ACCEPT, because the judging machine will not have that change."
 * `dom.webgpu.enabled` is therefore NOT touched here. If the Firefox WebGPU cell fails at
 * defaults on this platform, that failure IS the result.
 *
 * The one preference that is set — extensions.originControls.grantByDefault — governs
 * REPORTING, not the measurement: Firefox MV3 gates host_permissions behind user-granted
 * origin controls (S-02a-2), and without it the probe runs fine but cannot deliver its
 * report, which is indistinguishable from a crash. The chunked tab beacon is the fallback
 * for the same reason.
 *
 * Throwaway spike code. Loopback only.
 */
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8914;
const EXT = join(HERE, "ext-firefox");
const BACKEND = process.env.BACKEND || "wasm";
const RUNS = Number(process.env.RUNS || 3);
const WARM = Number(process.env.WARM_RUNS || 30);
const LABEL = process.env.PLATFORM_LABEL || "windows";
const FIREFOX = process.env.FIREFOX_PATH || "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
const WEB_EXT =
  process.env.WEB_EXT ||
  join(HERE, "..", "..", "W1-S02a2a3-ort-wasm-hash-pin", "harness", "node_modules", "web-ext", "bin", "web-ext.js");

for (const [what, p] of [["firefox", FIREFOX], ["web-ext", WEB_EXT], ["extension", EXT]]) {
  if (!existsSync(p)) {
    console.error(`missing ${what}: ${p}`);
    process.exit(1);
  }
}

// The backend is baked into the built extension per run. The build step emits __CONFIG__
// as a placeholder precisely so a cell cannot inherit the previous cell's configuration.
//
// FAIL CLOSED IF THE PLACEHOLDER IS GONE. This already went wrong once: an interrupted run
// died before its restore, leaving `backend: "wasm"` baked in with no placeholder left, so
// `.replace()` became a silent no-op and the NEXT cell — labelled webgpu everywhere in its
// own log — actually measured WASM. A mislabelled cell is worse than a missing one, because
// the matrix is the project's authority on what is proven and nothing downstream would ever
// have questioned it.
const bgPath = join(EXT, "ff-background.js");
const bgTemplate = readFileSync(bgPath, "utf8");
if (!bgTemplate.includes("__CONFIG__")) {
  console.error(
    "REFUSED: ext-firefox/ff-background.js has no __CONFIG__ placeholder, so the backend " +
      "could not be substituted and this run would silently measure whatever the previous " +
      "run left behind.\n  Rebuild first: node " +
      "artifacts/experiments/W1-QG03b-letterbox-conformance/harness/build-qg03b-extension.mjs"
  );
  process.exit(1);
}
writeFileSync(
  bgPath,
  bgTemplate.replace("__CONFIG__", JSON.stringify({ backend: BACKEND, warmRuns: WARM }))
);

function startCollector() {
  const results = [];
  const chunks = new Map();
  // maxHeaderSize: the beacon payload rides in the REQUEST LINE, and Node's 16 KB default
  // rejects a full report with HPE_HEADER_OVERFLOW before the handler runs — which looked
  // exactly like a timeout in S-04a. Chunking is the real fix; this is defence in depth.
  const server = createServer({ maxHeaderSize: 2000000 }, (req, res) => {
    if (req.method === "GET" && req.url.startsWith("/chunk")) {
      const raw = req.url;
      const dAt = raw.indexOf("&d=");
      const meta = new URL(raw.slice(0, dAt < 0 ? raw.length : dAt), "http://127.0.0.1");
      const id = meta.searchParams.get("id");
      const i = Number(meta.searchParams.get("i"));
      const n = Number(meta.searchParams.get("n"));
      // Parts are concatenated RAW and decoded once, so a percent-escape split across a
      // chunk boundary is harmless.
      const part = dAt < 0 ? "" : raw.slice(dAt + 3);
      if (!chunks.has(id)) chunks.set(id, { n, parts: [] });
      const st = chunks.get(id);
      st.parts[i] = part;
      if (st.parts.filter((x) => typeof x === "string").length === n) {
        try {
          const j = JSON.parse(decodeURIComponent(st.parts.join("")));
          results.push(...(j.contexts || [j]));
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
          const j = JSON.parse(Buffer.concat(buf).toString("utf8"));
          results.push(...(j.contexts || [j]));
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
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r({ server, results, chunks })));
}

const { server, results, chunks } = await startCollector();

async function oneRun({ headless, run }) {
  const before = results.length;
  const profileDir = mkdtempSync(join(tmpdir(), "pratibimb-qg03b-ff-"));
  const args = [
    WEB_EXT,
    "run",
    "--source-dir",
    EXT,
    "--firefox",
    FIREFOX,
    "--start-url",
    "about:blank",
    "--firefox-profile",
    profileDir,
    "--profile-create-if-missing",
    "--no-input",
    "--no-reload",
    // Reporting only. NOT dom.webgpu.enabled — that would turn an ACCEPT into a
    // CONDITIONAL and the rule forbids it.
    "--pref",
    "extensions.originControls.grantByDefault=true",
  ];
  if (headless) args.push("--arg=--headless");

  // web-ext SPAWNS Firefox; killing web-ext does not kill Firefox. Left alone, every run
  // leaks a full browser — 90 processes accumulated across two cells on the first attempt,
  // and a latency figure measured against that much background load is not a measurement of
  // the detector.
  //
  // Reaping BY PROFILE PATH does not work and was tried first: web-ext copies the profile
  // to its own temp directory unless --keep-profile-changes, and Firefox's content
  // processes do not carry the profile in their command line at all. It reported
  // `killed: 0` while fifteen processes were still running, which is worse than no reap
  // because it looks like success.
  //
  // So the reap is a PID-SET DIFFERENCE: snapshot firefox.exe PIDs before launch, kill
  // whatever is new afterwards. It depends on nothing but process identity, and it leaves
  // a Firefox the developer already had open untouched.
  const firefoxPids = () => {
    if (process.platform !== "win32") return [];
    try {
      const out = execFileSync(
        "powershell",
        ["-NoProfile", "-Command", "Get-Process firefox -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }"],
        { encoding: "utf8", timeout: 30000 }
      );
      return String(out).split(/\s+/).filter(Boolean).map(Number);
    } catch {
      return [];
    }
  };
  const pidsBefore = new Set(firefoxPids());

  const reap = () => {
    if (process.platform !== "win32") return { killed: null, note: "windows only" };
    const spawned = firefoxPids().filter((p) => !pidsBefore.has(p));
    if (!spawned.length) return { preExisting: pidsBefore.size, spawned: 0, killed: 0, remaining: 0 };
    try {
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `@(${spawned.join(",")}) | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`,
        ],
        { encoding: "utf8", timeout: 30000 }
      );
    } catch (e) {
      return { spawned: spawned.length, killed: null, reapError: String(e).slice(0, 200) };
    }
    // Verified, not assumed. A reap that reports success while processes survive is the
    // failure mode this replaced.
    const after = firefoxPids().filter((p) => !pidsBefore.has(p));
    return {
      preExisting: pidsBefore.size,
      spawned: spawned.length,
      killed: spawned.length - after.length,
      remaining: after.length,
    };
  };

  const child = spawn(process.execPath, args, { cwd: HERE, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d.toString()));
  child.stderr.on("data", (d) => (log += d.toString()));

  const real = () => results.slice(before).filter((r) => r.context !== "__alive__").length;
  const deadline = Date.now() + 420000;
  while (Date.now() < deadline && real() < 1) await new Promise((r) => setTimeout(r, 500));
  child.kill();
  await new Promise((r) => setTimeout(r, 1500));
  const reaped = reap();
  await new Promise((r) => setTimeout(r, 1000));

  const reported = results.slice(before).filter((r) => r.context !== "__alive__");
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* disposable */
  }
  return {
    headless,
    run,
    backend: BACKEND,
    livenessSeen: results.slice(before).some((r) => r.context === "__alive__"),
    timedOut: reported.length === 0,
    // An incomplete chunk set is stated explicitly. Reporting silence as "no result" is
    // precisely the mistake S-04a already made once.
    incompleteChunkSets: [...chunks.entries()].map(
      ([id, st]) => `${id}: ${st.parts.filter((x) => typeof x === "string").length}/${st.n}`
    ),
    result: reported[0] || null,
    firefoxProcessesReaped: reaped,
    webExtLogTail: log.split("\n").filter(Boolean).slice(-6),
  };
}

const out = {
  experiment: "W1-QG03b-letterbox-conformance",
  browser: "firefox",
  backend: BACKEND,
  platform: LABEL,
  firefoxPath: FIREFOX,
  prefsForced: ["extensions.originControls.grantByDefault=true (reporting only)"],
  webgpuPreferenceTouched: false,
  startedAt: new Date().toISOString(),
  runs: [],
};

for (const headless of [false, true]) {
  for (let run = 1; run <= RUNS; run++) {
    let r;
    try {
      r = await oneRun({ headless, run });
    } catch (e) {
      r = { headless, run, fatal: String(e).slice(0, 300) };
    }
    out.runs.push(r);
    process.stderr.write(
      `firefox ${BACKEND} ${headless ? "headless" : "headful "} run ${run}  alive=${r.livenessSeen}  ` +
        `${String(r.result?.conclusion || (r.timedOut ? "TIMED OUT — no report delivered" : "no result")).slice(0, 110)}\n`
    );
  }
}

out.finishedAt = new Date().toISOString();
const path = join(HERE, "..", "logs", `results-conformance-firefox-${BACKEND}-${LABEL}.json`);
writeFileSync(path, JSON.stringify(out, null, 2));
writeFileSync(bgPath, bgTemplate); // restore the placeholder so the next cell cannot inherit this one
server.close();
process.stderr.write(`\nwrote ${path}\n`);
process.exit(0);
