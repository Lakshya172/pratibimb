/**
 * QG-03 Chromium runner.
 *
 *   BACKEND=wasm   node .../run-qg03b2-chrome.mjs
 *   BACKEND=webgpu node .../run-qg03b2-chrome.mjs
 *
 * ONE BACKEND PER BROWSER LAUNCH, deliberately. S-04a measured that running two backends
 * in one realm leaves the second inheriting an arena the first already grew, which makes
 * its memory figure meaningless — the cell would report the cost of being second, not the
 * cost of the model. A fresh profile and a fresh process per cell is the only way the
 * "after session create" delta means what the matrix says it means.
 *
 * Branded Chrome is NOT usable here: Chrome 152 refuses --load-extension outright and does
 * so with a warning on stderr the harness never sees, so the extension is simply absent and
 * the run looks like "the capability is missing in extension contexts". That false negative
 * cost two runs during S-01. Playwright's unbranded Chromium still honours the switch, and
 * the run aborts below if the service worker never appears.
 *
 * Throwaway spike code. Loopback only.
 */
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8916;
const EXT = join(HERE, "ext-chrome");
const BACKEND = process.env.BACKEND || "wasm";
const RUNS = Number(process.env.RUNS || 3);
const WARM = Number(process.env.WARM_RUNS || 30);
const CHROME = process.env.CHROME_PATH;
const LABEL = process.env.PLATFORM_LABEL || "windows";

if (!CHROME) {
  console.error("CHROME_PATH must point at an unbranded Chromium — branded Chrome ignores --load-extension.");
  process.exit(1);
}

function startCollector() {
  const received = [];
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/result") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          received.push(...(j.contexts || [j]));
        } catch {
          /* a malformed report is recorded by its absence, not papered over */
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r(server)));
}

async function oneRun({ headless, run }) {
  const udd = mkdtempSync(join(tmpdir(), "pratibimb-qg03b2-"));
  const out = { headless, run, backend: BACKEND, extensionLoaded: false };
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(udd, {
      headless,
      executablePath: CHROME,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
    });
    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 60000 });
    out.extensionLoaded = true;

    out.browserVersion = ctx.browser()?.version() ?? (await ctx.pages()[0]?.evaluate(() => navigator.userAgent)) ?? null;

    out.result = await sw
      .evaluate((c) => globalThis.__qg03b2_run(c), { backend: BACKEND, warmRuns: WARM })
      .catch((e) => ({ context: "evaluate-failed", error: { message: String(e).slice(0, 400) } }));
  } catch (e) {
    out.runError = String(e).slice(0, 400);
  } finally {
    try {
      await ctx?.close();
    } catch {
      /* the profile is disposable; a close failure is not a measurement */
    }
    try {
      rmSync(udd, { recursive: true, force: true });
    } catch {
      /* Windows sometimes holds the profile briefly; harmless */
    }
  }
  return out;
}

const server = await startCollector();
const out = {
  experiment: "W1-QG03b2-capture-format-conformance",
  browser: "chromium",
  backend: BACKEND,
  platform: LABEL,
  chromePath: CHROME,
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
    const res = r.result || {};
    process.stderr.write(
      `chromium ${BACKEND} ${headless ? "headless" : "headful "} run ${run}  loaded=${r.extensionLoaded}  ` +
        `${String(res.conclusion || r.runError || "no result").slice(0, 110)}\n`
    );
  }
}

out.finishedAt = new Date().toISOString();
const path = join(HERE, "..", "logs", `results-conformance-chromium-${BACKEND}-${LABEL}.json`);
writeFileSync(path, JSON.stringify(out, null, 2));
server.close();
process.stderr.write(`\nwrote ${path}\n`);
process.exit(0);
