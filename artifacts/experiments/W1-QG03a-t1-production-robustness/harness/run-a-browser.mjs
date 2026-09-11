/**
 * QG-03a-A — the production path in a REAL browser: native PNG decode, then the SHIPPED
 * preprocessToTensor, compared stage by stage with the Pillow reference.
 *
 *   node .../harness/run-a-browser.mjs --browser=chrome|firefox --label=<before|after>
 *
 * The decode is createImageBitmap → canvas at native size → getImageData, character for
 * character the one the QG-03b probe used and measured bitwise on workstation 1.
 *
 * It launches the INSTALLED browser on a plain http://127.0.0.1 page, with a throwaway
 * profile, no extension and no flags. Results come back by POST to the same loopback server,
 * and the browser is then closed by matching its profile path. Nothing leaves the machine.
 *
 * This is NOT an MV3 extension context. It measures whether the browser's JS engine and PNG
 * decoder reproduce the reference bytes. The extension-context cells were measured by
 * QG-03 and QG-03b on workstation 1.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGS = join(HERE, "..", "logs");
const GEN = join(HERE, "generated");
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split("=")[1];
const which = arg("browser", "chrome");
const label = arg("label", "run");

const BROWSERS = {
  chrome: { exe: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", port: 8951 },
  firefox: { exe: "C:\\Program Files\\Mozilla Firefox\\firefox.exe", port: 8952 },
};
const B = BROWSERS[which];
if (!B || !existsSync(B.exe)) {
  console.error(`browser ${which} not installed at ${B?.exe}`);
  process.exit(2);
}

const bundle = (
  await build({
    entryPoints: [join(HERE, "browser-entry.mjs")],
    bundle: true,
    format: "iife",
    globalName: "QG03A",
    write: false,
    platform: "browser",
    target: "es2022",
  })
).outputFiles[0].text;

const PAGE = `<!doctype html><meta charset=utf-8><title>qg03a-a</title><pre id=o>running</pre>
<script src="/bundle.js"></script><script>
(async () => {
  const ref = await (await fetch("/reference.json")).json();
  const hex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
  const sha = async (u8) => hex(await crypto.subtle.digest("SHA-256", u8));
  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }
  async function decodeNative(pngBytes) {
    const bmp = await createImageBitmap(new Blob([pngBytes], { type: "image/png" }));
    const canvas = makeCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    if (bmp.close) bmp.close();
    return { width: img.width, height: img.height, rgba: new Uint8Array(img.data.buffer.slice(0)) };
  }
  const GEOM = ["resizedW", "resizedH", "padLeft", "padTop", "padRight", "padBottom", "padByte"];
  const rows = [];
  for (const f of ref.fixtures) {
    const rec = { name: f.name, set: f.set, source: f.source, exactHalf: f.exactHalf };
    try {
      const png = new Uint8Array(await (await fetch("/png/" + f.name + ".png")).arrayBuffer());
      const t0 = performance.now();
      const d = await decodeNative(png);
      const t1 = performance.now();
      const got = QG03A.preprocessToTensor(d, QG03A.HEAD_CONTRACT);
      const t2 = performance.now();
      const g = got.transform;
      rec.decodedSizeMatches = d.width === f.source.w && d.height === f.source.h;
      rec.geometryMatches = GEOM.every((k) => g[k] === f.geometry[k]);
      rec.shipped = { resizedW: g.resizedW, resizedH: g.resizedH, padLeft: g.padLeft, padTop: g.padTop };
      rec.stages = {};
      for (const s of ["decoded", "resized", "letterboxed"]) rec.stages[s] = (await sha(got[s])) === f.digests[s];
      rec.stages.tensor = (await sha(new Uint8Array(got.tensor.buffer))) === f.digests.tensor;
      rec.firstDivergence = !rec.decodedSizeMatches ? "decodedSize" : !rec.geometryMatches ? "geometry"
        : (["decoded", "resized", "letterboxed", "tensor"].find((s) => !rec.stages[s]) ?? null);
      rec.conformant = rec.firstDivergence === null;
      rec.decodeMs = Math.round((t1 - t0) * 10) / 10;
      rec.preprocessMs = Math.round((t2 - t1) * 10) / 10;
    } catch (e) {
      rec.error = String((e && e.message) || e);
      rec.conformant = false;
    }
    rows.push(rec);
    document.getElementById("o").textContent = rows.length + "/" + ref.fixtures.length;
  }
  await fetch("/result", { method: "POST", body: JSON.stringify({ ua: navigator.userAgent, rows }) });
  document.getElementById("o").textContent = "done";
})().catch((e) => fetch("/result", { method: "POST", body: JSON.stringify({ fatal: String((e && e.stack) || e) }) }));
</script>`;

const profile = join(HERE, "profiles", `${which}-${label}`);
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

function closeBrowser() {
  const image = which === "chrome" ? "chrome.exe" : "firefox.exe";
  const marker = profile.replace(/'/g, "''");
  try {
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='${image}'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ]);
  } catch {
    /* best effort; the profile path is unique to this run */
  }
}

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/result") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.end("ok");
      const got = JSON.parse(body);
      const rows = got.rows ?? [];
      const failures = rows.filter((r) => !r.conformant);
      const timing = rows
        .filter((r) => ["cap-1264x800", "cap-1920x1080", "cap-2560x1600"].includes(r.name))
        .map((r) => ({ name: r.name, decodeMs: r.decodeMs, preprocessMs: r.preprocessMs }));
      const out = {
        experiment: "W1-QG03a / A / browser production-path conformance",
        browser: which,
        label,
        userAgent: got.ua,
        fatal: got.fatal ?? null,
        context: "plain http://127.0.0.1 page, installed browser, throwaway profile, headful, no flags, not an extension",
        runAt: new Date().toISOString(),
        summary: {
          fixtures: rows.length,
          conformant: rows.length - failures.length,
          nonConformant: failures.length,
          nonConformantNames: failures.map((r) => r.name),
          firstDivergences: [...new Set(failures.map((r) => r.firstDivergence ?? r.error))],
        },
        timingSingleRunMs: timing,
        rows,
      };
      mkdirSync(LOGS, { recursive: true });
      const path = join(LOGS, `a-browser-${which}-${label}.json`);
      writeFileSync(path, JSON.stringify(out, null, 1));
      console.log(`${which}: ${got.ua}`);
      console.log(`fixtures ${rows.length}, conformant ${out.summary.conformant}, non-conformant ${failures.length}`);
      for (const r of failures) console.log(`  ${r.name.padEnd(20)} ${r.firstDivergence ?? r.error} ${JSON.stringify(r.shipped ?? {})}`);
      if (got.fatal) console.log("FATAL:", got.fatal);
      console.log(`wrote ${path}`);
      closeBrowser();
      setTimeout(() => process.exit(got.fatal ? 1 : 0), 300);
    });
    return;
  }
  if (req.url === "/") {
    res.setHeader("content-type", "text/html");
    return res.end(PAGE);
  }
  if (req.url === "/bundle.js") {
    res.setHeader("content-type", "text/javascript");
    return res.end(bundle);
  }
  if (req.url === "/reference.json") {
    res.setHeader("content-type", "application/json");
    return res.end(readFileSync(join(HERE, "reference.json")));
  }
  const m = /^\/png\/([A-Za-z0-9._-]+)\.png$/.exec(req.url ?? "");
  if (m) {
    res.setHeader("content-type", "image/png");
    return res.end(readFileSync(join(GEN, `${m[1]}.png`)));
  }
  res.statusCode = 404;
  res.end();
});

server.listen(B.port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${B.port}/`;
  const args =
    which === "chrome"
      ? [`--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", url]
      : ["-no-remote", "-profile", profile, url];
  spawn(B.exe, args, { detached: true, stdio: "ignore" }).unref();
  console.log(`launched ${which} on ${url}`);
});
setTimeout(() => {
  console.error("TIMEOUT: no result within 300 s");
  closeBrowser();
  process.exit(3);
}, 300_000);
