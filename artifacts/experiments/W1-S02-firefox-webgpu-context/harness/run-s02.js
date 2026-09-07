/**
 * S-02 runner — executes the pre-registered protocol in
 * artifacts/experiments/W1-S02-firefox-webgpu-context/README.md.
 *
 * Serves a loopback collector that (a) hosts the ORDINARY-PAGE CONTROL, running the
 * identical probe, and (b) receives results from both contexts. Launches Firefox via
 * web-ext with the MV3 extension installed as a temporary add-on.
 *
 * The acceptance criteria were fixed BEFORE any data existed and are NOT evaluated here
 * — this runner only records. Throwaway spike code. Loopback only.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const PORT = 8903;
const RUNS = Number(process.env.RUNS || 3);
const PROBE = fs.readFileSync(path.join(__dirname, "shared", "probe.js"), "utf8");

const CONTROL_HTML = `<!doctype html><meta charset="utf-8"><title>S-02 control</title>
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
      } catch (e) { results.push({ context: "__sink_parse_error__", url: req.url.slice(0, 300) }); }
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<!doctype html>sink");
    }
    if (req.method === "POST" && req.url === "/result") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try { results.push(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch {}
        res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
        res.end("{}");
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r({ server, results })));
}

(async () => {
  const { server, results } = await startCollector();
  const out = { experiment: "W1-S02-firefox-webgpu-context", startedAt: new Date().toISOString(), runs: [] };

  for (let i = 1; i <= RUNS; i++) {
    const before = results.length;
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), `pratibimb-s02-ffprofile-`));
    process.stderr.write(`\n=== S-02 run ${i} ===\n`);

    const child = spawn(process.execPath, [
      path.join(__dirname, "node_modules", "web-ext", "bin", "web-ext.js"), "run",
      "--source-dir", path.join(__dirname, "extension"),
      "--firefox", "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
      "--start-url", `http://127.0.0.1:${PORT}/control`,
      "--firefox-profile", profileDir,
      "--profile-create-if-missing",
      "--no-input",
          "--no-reload",
      // Firefox MV3 makes host_permissions opt-in ("origin controls"), so an
      // extension cannot reach the loopback collector until the user grants it.
      // Granting by default lets the probe REPORT. It does not change what is
      // being measured (WebGPU availability in the event page).
      "--pref", "extensions.originControls.grantByDefault=true",
    ], { cwd: __dirname, stdio: ["ignore", "pipe", "pipe"] });

    let log = "";
    child.stdout.on("data", (d) => { log += d.toString(); });
    child.stderr.on("data", (d) => { log += d.toString(); });

    // wait for BOTH contexts to report, or time out
    const deadline = Date.now() + 90000;
    const realCount = () => results.slice(before).filter((r) => r.context !== "__alive__").length;
    while (Date.now() < deadline && realCount() < 2) {
      await new Promise((r) => setTimeout(r, 500));
    }
    child.kill();
    await new Promise((r) => setTimeout(r, 1500));

    out.runs.push({
      run: i,
      reported: results.slice(before),
      contextsReported: results.slice(before).map((r) => r.context),
      timedOut: results.slice(before).filter((r) => r.context !== "__alive__").length < 2,
      webExtLogTail: log.split("\n").filter(Boolean).slice(-8),
    });
    process.stderr.write(JSON.stringify({
      contexts: results.slice(before).map((r) => `${r.context}: gpu=${r.navigatorGpuPresent} adapter=${r.adapterAvailable} device=${r.deviceCreated} correct=${r.compute && r.compute.outputCorrect}`),
      timedOut: results.slice(before).filter((r) => r.context !== "__alive__").length < 2,
    }, null, 1) + "\n");

    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }

  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(out, null, 2));
  server.close();
  process.stderr.write("\nwrote results.json\n");
  process.exit(0);
})();
