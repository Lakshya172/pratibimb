/**
 * S-02a — the pre-registered S-02 protocol, executed on LINUX (WSL2 Ubuntu 26.04).
 *
 * The acceptance criteria are the ones fixed before any data existed, in
 * artifacts/experiments/W1-S02-firefox-webgpu-context/README.md. They are NOT re-opened
 * here. In particular:
 *
 *   "A result that needs an about:config change on the release channel is CONDITIONAL,
 *    never ACCEPT, because the judging machine will not have that change."
 *
 * So the run order matters and is fixed in advance:
 *   variant 1 "defaults"      -- NO preference touched. This decides ACCEPT / REJECT.
 *   variant 2 "webgpu-forced" -- dom.webgpu.enabled=true. Recorded SEPARATELY, and can
 *                                only ever support a CONDITIONAL, never an ACCEPT.
 *
 * Throwaway spike code. Loopback only. No product code.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const PORT = 8903;
const RUNS = Number(process.env.RUNS || 3);
const FIREFOX = process.env.FIREFOX_PATH || "/opt/firefox/firefox";
const PROBE = fs.readFileSync(path.join(__dirname, "shared", "probe.js"), "utf8");

const CONTROL_HTML = `<!doctype html><meta charset="utf-8"><title>S-02a control</title>
<body><pre id="o">running ordinary-page control probe...</pre>
<script src="/probe.js"></script>
<script>
(async () => {
  const r = await globalThis.runProbe("ordinary-web-page-CONTROL");
  r.manifestVersion = null; r.backgroundKind = "ordinary page";
  document.getElementById("o").textContent = JSON.stringify(r, null, 1);
  await fetch("/result", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(r) });
})();
</script></body>`;

function startCollector() {
  const results = [];
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/probe.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      return res.end(PROBE);
    }
    if (req.method === "GET" && req.url.startsWith("/control")) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(CONTROL_HTML);
    }
    if (req.method === "GET" && req.url.startsWith("/alive")) {
      results.push({ context: "__alive__", url: req.url });
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<!doctype html>alive");
    }
    if (req.method === "GET" && req.url.startsWith("/sink")) {
      try {
        const u = new URL(req.url, "http://127.0.0.1");
        results.push(JSON.parse(u.searchParams.get("d")));
      } catch (e) { results.push({ context: "__sink_parse_error__" }); }
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<!doctype html>sink");
    }
    if (req.method === "POST" && req.url === "/result") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try { results.push(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch {}
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r({ server, results })));
}

async function oneRun({ variant, prefs, headless, run }, results) {
  const before = results.length;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pratibimb-s02a-ffprofile-"));
  const args = [
    path.join(__dirname, "node_modules", "web-ext", "bin", "web-ext.js"), "run",
    "--source-dir", path.join(__dirname, "extension"),
    "--firefox", FIREFOX,
    "--start-url", `http://127.0.0.1:${PORT}/control`,
    "--firefox-profile", profileDir,
    "--profile-create-if-missing",
    "--no-input",
    "--no-reload",
    // Reporting only: Firefox MV3 gates host_permissions behind origin controls.
    "--pref", "extensions.originControls.grantByDefault=true",
  ];
  for (const p of prefs) args.push("--pref", p);
  if (headless) args.push("--arg=--headless");

  const child = spawn(process.execPath, args, { cwd: __dirname, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => { log += d.toString(); });
  child.stderr.on("data", (d) => { log += d.toString(); });

  const realCount = () => results.slice(before).filter((r) => r.context !== "__alive__").length;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && realCount() < 2) await new Promise((r) => setTimeout(r, 500));
  child.kill();
  await new Promise((r) => setTimeout(r, 1500));

  const reported = results.slice(before);
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  return {
    variant, prefs, headless, run,
    reported,
    contextsReported: reported.map((r) => r.context),
    livenessSeen: reported.some((r) => r.context === "__alive__"),
    timedOut: realCount() < 2,
    webExtLogTail: log.split("\n").filter(Boolean).slice(-6),
  };
}

(async () => {
  const { server, results } = await startCollector();
  const out = {
    experiment: "W1-S02a-firefox-linux-webgpu",
    startedAt: new Date().toISOString(),
    firefox: FIREFOX,
    host: "WSL2 Ubuntu 26.04 guest on a Windows 11 host",
    runs: [],
  };

  // ORDER IS FIXED IN ADVANCE. Defaults first; that variant alone decides ACCEPT/REJECT.
  const plan = [
    { variant: "defaults-headful",       prefs: [], headless: false },
    { variant: "defaults-headless",      prefs: [], headless: true },
    { variant: "webgpu-forced-headful",  prefs: ["dom.webgpu.enabled=true"], headless: false },
  ];

  for (const v of plan) {
    for (let run = 1; run <= RUNS; run++) {
      process.stderr.write(`\n=== ${v.variant} run ${run} ===\n`);
      let r;
      try { r = await oneRun({ ...v, run }, results); }
      catch (e) { r = { ...v, run, fatal: String(e).slice(0, 200) }; }
      out.runs.push(r);
      const summary = (r.reported || []).filter((x) => x.context !== "__alive__").map((x) =>
        `${x.context}: gpu=${x.navigatorGpuPresent} adapter=${x.adapterAvailable} device=${x.deviceCreated} correct=${(x.compute||{}).outputCorrect}`);
      process.stderr.write(JSON.stringify({ liveness: r.livenessSeen, timedOut: r.timedOut, summary }, null, 1) + "\n");
    }
  }

  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, "results-linux.json"), JSON.stringify(out, null, 2));
  server.close();
  process.stderr.write("\nwrote results-linux.json\n");
  process.exit(0);
})();
