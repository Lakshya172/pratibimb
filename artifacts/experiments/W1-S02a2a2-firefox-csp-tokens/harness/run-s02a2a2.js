/**
 * S-02a-2a-2 runner — Firefox MV3 CSP token vocabulary. THROWAWAY SPIKE CODE.
 *
 * Reuses the W1-S02a-2 Firefox pattern verbatim: web-ext to install a temporary MV3
 * add-on into a throwaway profile, a loopback collector, and a BELT-AND-BRACES report
 * path (fetch, falling back to a tab navigation) because Firefox MV3 gates
 * host_permissions behind origin controls.
 *
 * The /alive beacon is the liveness signal. It is what separates:
 *   - "the extension did not load / the event page never ran"   (no alive beacon)
 *   - "it ran and the token blocked everything"                 (alive beacon, blocked probes)
 * Those are completely different results, and Chrome already showed that two of these
 * four tokens stop an extension loading entirely. Never infer one from the other.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const PORT = 8909;
const RUNS = Number(process.env.RUNS || 3);
const FIREFOX = process.env.FIREFOX_PATH ||
  "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
const PLATFORM = process.env.PLATFORM_LABEL || "windows-ws1";
const HERE = __dirname;
const OUT = path.join(HERE, "..");

const VARIANTS = ["ext-default", "ext-wasm-unsafe-eval", "ext-wasm-eval", "ext-unsafe-eval"];

function startCollector() {
  const events = [];
  const server = http.createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Headers": "content-type" });
      res.end(body || "{}");
    };
    if (req.method === "OPTIONS") return send(204);

    if (req.url.startsWith("/alive")) {
      const u = new URL(req.url, "http://127.0.0.1");
      events.push({ context: "__alive__", variant: u.searchParams.get("variant"),
                    at: new Date().toISOString() });
      return send(200, "alive");
    }
    if (req.url.startsWith("/sink")) {
      try {
        const u = new URL(req.url, "http://127.0.0.1");
        const p = JSON.parse(u.searchParams.get("d"));
        p.__via = "tabs-beacon";
        events.push(p);
      } catch (e) { events.push({ context: "__sink_parse_error__" }); }
      return send(200, "ok");
    }
    if (req.method === "POST" && req.url.startsWith("/result")) {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          const p = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          p.__via = "fetch";
          events.push(p);
        } catch (e) { events.push({ context: "__result_parse_error__" }); }
        send(200);
      });
      return;
    }
    send(200, "<!doctype html>ok");
  });
  server.listen(PORT, "127.0.0.1");
  return { server, events };
}

function oneRun(variant, run, events) {
  return new Promise((resolve) => {
    const before = events.length;
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pratibimb-s02a2a2-ff-"));
    const args = [
      path.join(HERE, "node_modules", "web-ext", "bin", "web-ext.js"), "run",
      "--source-dir", path.join(HERE, variant),
      "--firefox", FIREFOX,
      "--start-url", `http://127.0.0.1:${PORT}/control`,
      "--firefox-profile", profileDir,
      "--profile-create-if-missing",
      "--no-input", "--no-reload",
      // Reporting only: Firefox MV3 gates host_permissions behind origin controls.
      "--pref", "extensions.originControls.grantByDefault=true"
    ];
    const child = spawn(process.execPath, args, { cwd: HERE, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => { log += d.toString(); });
    child.stderr.on("data", (d) => { log += d.toString(); });

    const realCount = () =>
      events.slice(before).filter((e) => e.context && e.context !== "__alive__").length;
    const deadline = Date.now() + 90000;
    const tick = setInterval(() => {
      if (realCount() >= 2 || Date.now() > deadline) {
        clearInterval(tick);
        try { child.kill(); } catch (_) {}
        setTimeout(() => {
          const reported = events.slice(before);
          try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
          resolve({
            variant, run,
            aliveBeacon: reported.some((e) => e.context === "__alive__"),
            contexts: reported.filter((e) => e.context && e.context !== "__alive__"),
            // web-ext prints manifest validation errors here; a token Firefox rejects
            // should surface as an install failure rather than silently.
            webExtLogTail: log.slice(-1500)
          });
        }, 2000);
      }
    }, 500);
  });
}

(async () => {
  const c = startCollector();
  console.log(`Firefox: ${FIREFOX}`);
  const records = [];
  for (let i = 1; i <= RUNS; i++) {
    for (const v of VARIANTS) {
      process.stdout.write(`[run ${i}] ${v.padEnd(22)} ... `);
      const r = await oneRun(v, i, c.events);
      const ep = r.contexts.find((x) => x.context === "firefox-mv3-event-page");
      console.log(`loaded=${r.aliveBeacon} contexts=${r.contexts.length}` +
        (ep ? ` | eval=${ep.js && ep.js.eval.allowed} wasm=${ep.wasm && ep.wasm.compile && ep.wasm.compile.allowed}` : " | no event-page report"));
      records.push(r);
    }
  }
  c.server.close();
  const outFile = path.join(OUT, "logs", `results-s02a2a2-${PLATFORM}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({
    experiment: "W1-S02a-2a-2", platform: PLATFORM, firefox: FIREFOX,
    runs: RUNS, variants: VARIANTS,
    collectedAt: new Date().toISOString(), records
  }, null, 2));
  console.log(`\nwrote ${outFile}`);
})();
