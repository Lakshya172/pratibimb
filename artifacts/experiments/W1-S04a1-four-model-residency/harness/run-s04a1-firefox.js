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

const PORT = 8908;
const RUNS = Number(process.env.RUNS || 3);
const FIREFOX = process.env.FIREFOX_PATH || "/opt/firefox/firefox";
const PROBE = "";  // S-03 has no ordinary-page control: ORT is only meaningful in the extension context here

const CONTROL_HTML = `<!doctype html><meta charset="utf-8"><title>S-02a control</title>
<body><pre id="o">running ordinary-page control probe...</pre>
<script src="/probe.js"></script>
<script>
(async () => {
  const r = await globalThis.runWasmProbe("ordinary-web-page-CONTROL");
  r.manifestVersion = null; r.backgroundKind = "ordinary page";
  document.getElementById("o").textContent = JSON.stringify(r, null, 1);
  await fetch("/result", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(r) });
})();
</script></body>`;

function startCollector() {
  const results = [];
  const chunks = new Map();
  // maxHeaderSize: Node's default is 16 KB and the beacon payload rides in the REQUEST
  // LINE. A full-lifecycle report is ~80 KB encoded, so the default silently rejects it
  // with HPE_HEADER_OVERFLOW *before the handler ever runs* -- the collector saw nothing
  // and the run looked like a timeout. That was the S-04a Firefox "timeout". See
  // decision.md "Root cause". Chunking below is the real fix; this is defence in depth.
  const server = http.createServer({ maxHeaderSize: 2000000 }, (req, res) => {
    // Chunked report delivery. The parts are concatenated RAW and decoded once, so a
    // percent-escape split across a chunk boundary is harmless. This is why the payload
    // is read straight off req.url instead of through URLSearchParams (which decodes).
    if (req.method === "GET" && req.url.startsWith("/chunk")) {
      const raw = req.url;
      const dAt = raw.indexOf("&d=");
      const meta = new URL(raw.slice(0, dAt < 0 ? raw.length : dAt), "http://127.0.0.1");
      const id = meta.searchParams.get("id");
      const i = Number(meta.searchParams.get("i"));
      const n = Number(meta.searchParams.get("n"));
      const part = dAt < 0 ? "" : raw.slice(dAt + 3);
      if (!chunks.has(id)) chunks.set(id, { n, parts: [] });
      const st = chunks.get(id);
      st.parts[i] = part;
      const have = st.parts.filter((x) => typeof x === "string").length;
      console.log("  chunk " + (i + 1) + "/" + n + " received (" + part.length + " chars)");
      if (have === n) {
        try {
          const j = JSON.parse(decodeURIComponent(st.parts.join("")));
          if (j && Array.isArray(j.contexts)) results.push(...j.contexts); else results.push(j);
        } catch (e) { results.push({ context: "__chunk_parse_error__", message: String(e).slice(0, 200) }); }
        chunks.delete(id);
      }
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<!doctype html>chunk " + i + "/" + n);
    }
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
        const j=JSON.parse(u.searchParams.get("d")); if (j && Array.isArray(j.contexts)) results.push(...j.contexts); else results.push(j);
      } catch (e) { results.push({ context: "__sink_parse_error__" }); }
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<!doctype html>sink");
    }
    if (req.method === "POST" && req.url === "/result") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try { const j=JSON.parse(Buffer.concat(chunks).toString("utf8")); if (j && Array.isArray(j.contexts)) results.push(...j.contexts); else results.push(j); } catch {}
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r({ server, results, chunks })));
}

async function oneRun({ variant, prefs, headless, run, ext }, results) {
  const before = results.length;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pratibimb-s02a-ffprofile-"));
  const args = [
    path.join(__dirname, "node_modules", "web-ext", "bin", "web-ext.js"), "run",
    "--source-dir", path.join(__dirname, "ext-firefox"),
    "--firefox", FIREFOX,
    "--start-url", "about:blank",
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
  const deadline = Date.now() + 900000;  // YuNet at 640x640 x18 inferences is far heavier than the S-04 fixture
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
    timedOut: realCount() < 1,
    webExtLogTail: log.split("\n").filter(Boolean).slice(-6),
  };
}

(async () => {
  const { server, results, chunks } = await startCollector();
  const out = {
    experiment: "W1-S04a1-four-model-residency", browser: "firefox",
    startedAt: new Date().toISOString(),
    firefox: FIREFOX,
    host: "WSL2 Ubuntu 26.04 guest on a Windows 11 host",
    runs: [],
  };

  // ORDER IS FIXED IN ADVANCE. Defaults first; that variant alone decides ACCEPT/REJECT.
  // S-02a-2 measures the WASM substrate, which does not depend on the WebGPU preference.
  // Defaults only, headful and headless. No preference is forced for the measurement.
  const plan = [ { variant: "firefox-mv3-event-page", prefs: [], headless: false } ];

  for (const v of plan) {
    for (let run = 1; run <= RUNS; run++) {
      process.stderr.write(`\n=== ${v.variant} run ${run} ===\n`);
      let r;
      try { r = await oneRun({ ...v, run }, results); }
      catch (e) { r = { ...v, run, fatal: String(e).slice(0, 200) }; }
      out.runs.push(r);
      const summary = (r.reported || []).filter((x) => x.context !== "__alive__").map((x) =>
        `${x.requestedBackend}: ${String(x.conclusion).slice(0,90)}`);
      // An incomplete chunk set is stated explicitly. Reporting silence as "no result"
      // is precisely the failure this experiment already made once.
      const partial = [...chunks.entries()].map(([id, st]) =>
        `${id}: ${st.parts.filter((x) => typeof x === "string").length}/${st.n} chunks`);
      r.incompleteChunkSets = partial;
      process.stderr.write(JSON.stringify({ liveness: r.livenessSeen, timedOut: r.timedOut,
        incompleteChunkSets: partial, summary }, null, 1) + "\n");
    }
  }

  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, `results-s04a1-firefox-${process.env.PLATFORM_LABEL || "unknown"}.json`), JSON.stringify(out, null, 2));
  server.close();
  process.stderr.write("\nwrote results-s04a1-firefox-" + (process.env.PLATFORM_LABEL || "unknown") + ".json\n");
  process.exit(0);
})();
