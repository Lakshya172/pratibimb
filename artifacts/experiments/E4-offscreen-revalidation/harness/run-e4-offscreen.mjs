/**
 * E4-offscreen — re-validate the E4 leak instrument with the MV3 offscreen document as the emitter.
 *
 * Pre-registered in ../README.md, committed before this file existed. Read that first.
 *
 * NOTHING HERE RE-IMPLEMENTS E4. The canary generator, variants, near misses, blind-spot probes,
 * request construction (`send`, `sendSplit`), seeded shuffle, per-request matching and scanning, the
 * per-run record and the totals / pass computation are loaded VERBATIM from the E4 runner blob at
 * b027fc5 — the revision that produced the committed attempt-2 PASS — after its SHA-256 is checked.
 * (`run-e4.mjs` on main does not parse since c497aee; see the pre-registration.) The scanner and the
 * collector are the committed files, identity-checked on LF-normalised content.
 *
 * What this file adds, and nothing else:
 *   1. PHASE A — a Node control that must reproduce the committed per-run records exactly;
 *   2. PHASE B — the same verbatim code, with the global `fetch` those functions call replaced by a
 *      relay to the host's E4_EMIT handler, so the same request bytes leave from the MV3 offscreen
 *      document of a real loaded extension;
 *   3. live sentinels, offscreen instanceId and emitter checks, arrival-side evidence;
 *   4. the log and the pre-registered verdict.
 *
 * Instrument validation only. Synthetic canaries only. 127.0.0.1 only. NOT a privacy claim.
 *
 * This file deliberately contains no backslash escape sequences: newlines are built with
 * String.fromCharCode, so the class of defect that broke run-e4.mjs in c497aee cannot recur here.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { hostname, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const E4 = join(ROOT, "artifacts", "experiments", "E4-leak-instrument");
const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const LOGS = join(HERE, "..", "logs");
const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");

const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

/** Identities fixed by the pre-registration. The run refuses on any mismatch. */
const IDENTITY = {
  scannerSha256LF: "96979ebde6774f734fa14e4ae94dcabc33c962358874e850148cdccb0f0b6fab",
  collectorSha256LF: "1ff60ed52539d6beb6c1f545aea15283a3cb8563eee4994b2b2b1adc4298ea77",
  runnerCommit: "b027fc54fad51511153689b347bb77bc053a3691",
  runnerPath: "artifacts/experiments/E4-leak-instrument/harness/run-e4.mjs",
  runnerBlobSha256: "21f8e2aba754df59956bc9d8c11e4d456c58e470a5626747654bd311c9b2a226",
};
const COLLECTOR_PORT = 8995;
const COLLECTOR_ORIGIN = `http://127.0.0.1:${COLLECTOR_PORT}`;
const SENTINEL_IDS = ["e4-sentinel-a", "e4-sentinel-z"];

const sha = (b) => createHash("sha256").update(b).digest("hex");
const lfSha = (p) => sha(Buffer.from(readFileSync(p, "utf8").split(CRLF).join(NL), "utf8"));
const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};
const tryRun = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};
const pct = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 100) / 100;
};

// ── Preconditions — refuse rather than measure the wrong thing ────────────────────────────────
const scannerPath = join(E4, "harness", "scanner.mjs");
const collectorPath = join(E4, "harness", "collector.cjs");
if (lfSha(scannerPath) !== IDENTITY.scannerSha256LF) refuse("scanner identity differs from e4-scanner-2 (96979ebd…)");
if (lfSha(collectorPath) !== IDENTITY.collectorSha256LF) refuse("collector identity differs from the E4 collector (1ff60ed5…)");

const runnerBlob = execFileSync("git", ["-C", ROOT, "show", `${IDENTITY.runnerCommit}:${IDENTITY.runnerPath}`]);
if (sha(runnerBlob) !== IDENTITY.runnerBlobSha256) refuse("the b027fc5 runner blob does not have the pre-registered SHA-256");

const CHROME_PATH = process.env.CHROME_PATH;
if (!CHROME_PATH || !existsSync(CHROME_PATH)) refuse("CHROME_PATH must point to the Chrome for Testing executable");
if (!existsSync(join(EXT, "manifest.json"))) refuse(`no built host at ${EXT} (run: cd apps/extension && npm run build)`);
const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
const csp = manifest?.content_security_policy?.extension_pages ?? "";
if (!csp.includes(`connect-src 'self' ${COLLECTOR_ORIGIN}`)) refuse(`the built host's CSP does not pin connect-src to ${COLLECTOR_ORIGIN}`);

const committed = JSON.parse(readFileSync(join(E4, "logs", "e4.json"), "utf8"));
if (committed.verdict !== "PASS" || committed.attempt !== 2) refuse("the committed E4 log is not the attempt-2 PASS");

// ── Load b027fc5's code verbatim: three marked regions, appended glue exports them ──────────────
const src = runnerBlob.toString("utf8");
const once = (needle) => {
  const i = src.indexOf(needle);
  if (i < 0 || src.indexOf(needle, i + 1) >= 0) refuse(`runner marker not found exactly once: ${JSON.stringify(needle)}`);
  return i;
};
const prefixEnd = once(NL + 'const scannerFile = readFileSync(join(HERE, "scanner.mjs"));');
const bodyStart = once("  const seed = BASE_SEED + run;");
const bodyEnd = once(NL + "}" + NL + "server.close();");
const summaryStart = once("const totals = {");
const summaryEnd = once(NL + "const log = {");
if (!(prefixEnd < bodyStart && bodyStart < bodyEnd && bodyEnd < summaryStart && summaryStart < summaryEnd)) refuse("runner regions are out of order");

const regions = {
  prefix: src.slice(0, prefixEnd + 1), // lines 1..247: imports, constants, generators, send, sendSplit, TRANSPORTS
  body: src.slice(bodyStart, bodyEnd + 1), // the per-run loop body
  summary: src.slice(summaryStart, summaryEnd + 1), // totals, blindSpotSummary, pass
};
const glue = [
  regions.prefix,
  "// ── appended by the E4-offscreen harness: bindings the b027fc5 top level declared after line 247 ──",
  "let counter = 0;",
  "const runs = [];",
  "export async function __executeRun(run, arrivals) {",
  regions.body,
  "}",
  "export function __summarise() {",
  regions.summary,
  "  return { totals, blindSpotSummary, pass };",
  "}",
  "export function __reset() {",
  "  counter = 0;",
  "  runs.length = 0;",
  "}",
  "export { runs as __runs, RUNS, BASE_SEED, SCANNER_VERSION, mulberry32, makeCanaries, compileCanaries, scanArrival, send };",
  "",
].join(NL);

const work = mkdtempSync(join(tmpdir(), "pb-e4o-"));
copyFileSync(scannerPath, join(work, "scanner.mjs"));
copyFileSync(collectorPath, join(work, "collector.cjs"));
if (lfSha(join(work, "scanner.mjs")) !== IDENTITY.scannerSha256LF) refuse("scanner copy differs");
const glueFile = join(work, "e4-b027fc5.mjs");
writeFileSync(glueFile, glue);
const gen = await import(pathToFileURL(glueFile).href);

// ── Provenance recorded before anything runs ───────────────────────────────────────────────────
const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const buildFiles = Object.fromEntries(walk(EXT).map((p) => [relative(EXT, p).split(String.fromCharCode(92)).join("/"), sha(readFileSync(p))]));
const provenance = {
  hostname: hostname(),
  gpu: tryRun("nvidia-smi", ["--query-gpu=name,uuid,pci.bus_id,driver_version", "--format=csv,noheader"]),
  node: process.version,
  playwright: require2("playwright/package.json").version,
  chromePath: CHROME_PATH,
  chromeProductVersion: tryRun("powershell", ["-NoProfile", "-Command", `(Get-Item '${CHROME_PATH}').VersionInfo.ProductVersion`]),
  gitHead: tryRun("git", ["-C", ROOT, "rev-parse", "HEAD"]),
  gitStatusPorcelain: tryRun("git", ["-C", ROOT, "status", "--porcelain"]),
  preRegistrationCommit: tryRun("git", ["-C", ROOT, "log", "-1", "--format=%H", "--", "artifacts/experiments/E4-offscreen-revalidation/README.md"]),
};

const collector = require2(collectorPath);
const { server, arrivals } = await collector.start(COLLECTOR_PORT);
const realFetch = globalThis.fetch;

const originOf = (a) => {
  for (let i = 0; i < a.rawHeaders.length; i += 2) if (a.rawHeaders[i].toLowerCase() === "origin") return a.rawHeaders[i + 1];
  return "(none)";
};
const countBy = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});

// ── PHASE A — Node control: must reproduce the committed attempt-2 per-run records ─────────────
console.log("== PHASE A — Node control (E4's own emitter) ==");
gen.__reset();
for (let run = 0; run < gen.RUNS; run += 1) await gen.__executeRun(run, arrivals);
const control = gen.__summarise();
const controlRuns = structuredClone(gen.__runs);
const phaseAArrivals = arrivals.length;
const phaseA = {
  reproducesCommittedRunRecords: isDeepStrictEqual(controlRuns, committed.runs),
  totalsEqualCommitted: isDeepStrictEqual(control.totals, committed.totals),
  blindSpotSummaryEqualCommitted: isDeepStrictEqual(control.blindSpotSummary, committed.blindSpotSummary),
  pass: control.pass,
  totals: control.totals,
  blindSpotSummary: control.blindSpotSummary,
  arrivals: phaseAArrivals,
  originHeaders: countBy(arrivals.slice(0, phaseAArrivals), originOf),
};
console.log(`PHASE A reproduces committed per-run records: ${phaseA.reproducesCommittedRunRecords}`);

// ── PHASE B — the same code, bytes emitted by the MV3 offscreen document ───────────────────────
const phaseB = { attempted: false };
let verdict;
if (!phaseA.reproducesCommittedRunRecords || !phaseA.totalsEqualCommitted || !control.pass) {
  verdict = "ABORTED_CONTROL_MISMATCH";
} else {
  console.log("== PHASE B — MV3 offscreen document as the emitter ==");
  phaseB.attempted = true;
  const udd = mkdtempSync(join(tmpdir(), "pb-e4o-profile-"));
  const emits = [];
  const perRun = [];
  let ctx;
  let playwrightObserved = 0;
  try {
    ctx = await chromium.launchPersistentContext(udd, {
      headless: false,
      executablePath: CHROME_PATH,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    phaseB.browserVersion = ctx.browser()?.version?.() ?? null;
    // Informational only: what a Playwright context-level observer sees of these requests.
    ctx.on("request", (req) => {
      if (req.url().startsWith(COLLECTOR_ORIGIN)) playwrightObserved += 1;
    });
    const sw =
      ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://")) ??
      (await ctx.waitForEvent("serviceworker", { timeout: 15_000 }));
    const extensionId = sw.url().split("/")[2];
    const expectedEmitter = `chrome-extension://${extensionId}/offscreen.html`;
    phaseB.extensionId = extensionId;
    phaseB.expectedEmitter = expectedEmitter;
    phaseB.offscreenContexts = await sw.evaluate(() => globalThis.__host.ensureOffscreen());
    const state = () => sw.evaluate(() => globalThis.__host.toOffscreen({ kind: "STATE" }));

    const toB64 = (body) =>
      body === undefined || body === null ? null : (typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body)).toString("base64");

    /** The only substitution: E4's own send/sendSplit call this instead of Node's fetch. */
    const relayFetch = async (url, init = {}) => {
      const msg = {
        kind: "E4_EMIT",
        url: String(url),
        method: init.method ?? "GET",
        headers: { ...(init.headers ?? {}) },
        bodyB64: toB64(init.body),
      };
      const r = await sw.evaluate((m) => globalThis.__host.toOffscreen(m), msg);
      emits.push({
        method: msg.method,
        settled: r?.settled ?? null,
        status: r?.status ?? null,
        fetchError: r?.fetchError ?? null,
        emitter: r?.emitter ?? null,
        ms: typeof r?.ms === "number" ? r.ms : null,
        refused: r?.refused ?? null,
      });
      if (r?.refused) throw new Error(`E4_EMIT refused: ${r.refused}`);
      // A rejected offscreen fetch is recorded and NOT thrown: whether bytes reached the wire is
      // decided only by the collector (pre-registered).
      return new Response(null, { status: 200 });
    };

    const sentinel = async (id, canaries, compiled) => {
      const before = arrivals.length;
      const sentHash = await gen.send("POST_JSON", canaries.PHONE, id, 0);
      const arrival = arrivals.slice(before).find((a) => a.correlationId === id);
      if (!arrival) return { id, arrived: false, hashIntegrity: false, detected: [], ok: false };
      const hashIntegrity = arrival.actualHash === sentHash && arrival.hashMatches === true;
      const detected = gen.scanArrival(arrival, compiled);
      return { id, arrived: true, hashIntegrity, detected, ok: hashIntegrity && detected.includes("PHONE") };
    };

    globalThis.fetch = relayFetch;
    gen.__reset();
    try {
      for (let run = 0; run < gen.RUNS; run += 1) {
        const before = await state();
        const canaries = gen.makeCanaries(gen.mulberry32(gen.BASE_SEED + run));
        const compiled = gen.compileCanaries(Object.entries(canaries).map(([cls, value]) => ({ class: cls, value })));
        const sA = await sentinel(SENTINEL_IDS[0], canaries, compiled);
        await gen.__executeRun(run, arrivals);
        const sZ = await sentinel(SENTINEL_IDS[1], canaries, compiled);
        const after = await state();
        perRun.push({
          run,
          seed: gen.BASE_SEED + run,
          instanceIdBefore: before?.instanceId ?? null,
          instanceIdAfter: after?.instanceId ?? null,
          sentinels: [sA, sZ],
        });
      }
    } finally {
      globalThis.fetch = realFetch;
    }

    const cell = gen.__summarise();
    const bArrivals = arrivals.slice(phaseAArrivals);
    const correlated = bArrivals.filter((a) => a.correlationId);
    const sentinels = perRun.flatMap((r) => r.sentinels);
    Object.assign(phaseB, {
      totals: cell.totals,
      blindSpotSummary: cell.blindSpotSummary,
      e4CriterionPass: cell.pass,
      runs: structuredClone(gen.__runs),
      perRun,
      sentinels: { total: sentinels.length, ok: sentinels.filter((s) => s.ok).length },
      instanceIdStable: perRun.every((r) => r.instanceIdBefore !== null && r.instanceIdBefore === r.instanceIdAfter),
      distinctInstanceIds: [...new Set(perRun.flatMap((r) => [r.instanceIdBefore, r.instanceIdAfter]))],
      emits: {
        count: emits.length,
        expected: gen.RUNS * 252 + gen.RUNS * SENTINEL_IDS.length,
        settled: countBy(emits, (e) => String(e.settled)),
        fetchErrors: countBy(emits.filter((e) => e.fetchError), (e) => e.fetchError),
        emitters: countBy(emits, (e) => String(e.emitter)),
        refused: emits.filter((e) => e.refused).length,
        allFromExpectedEmitter: emits.length > 0 && emits.every((e) => e.emitter === expectedEmitter && !e.refused),
        msP50: pct(emits.map((e) => e.ms).filter((x) => x !== null), 50),
        msP95: pct(emits.map((e) => e.ms).filter((x) => x !== null), 95),
      },
      arrivals: {
        total: bArrivals.length,
        correlated: correlated.length,
        uncorrelatedByMethod: countBy(bArrivals.filter((a) => !a.correlationId), (a) => a.method),
        originHeaders: countBy(correlated, originOf),
      },
      playwrightContextObservedCollectorRequests: playwrightObserved,
    });

    const T = cell.totals;
    const counts = T.requests === 2520 && T.positives === 1800 && T.negativeControls === 480;
    if (correlated.length === 0) verdict = "NOT_OBSERVABLE";
    else if (cell.pass && counts && phaseB.sentinels.ok === 20 && phaseB.instanceIdStable && phaseB.emits.allFromExpectedEmitter) verdict = "PASS";
    else verdict = "FAIL";
  } catch (e) {
    phaseB.error = e instanceof Error ? `${e.name}: ${e.message}`.split(NL)[0] : String(e);
    verdict = "ABORTED";
  } finally {
    globalThis.fetch = realFetch;
    if (ctx) await ctx.close().catch(() => undefined);
  }
}
server.close();

const log = {
  experiment: "E4-offscreen-revalidation",
  recordedAt: new Date().toISOString(),
  workstation: "W2",
  cell: `W2 · Chrome for Testing ${provenance.chromeProductVersion ?? "?"} · MV3 offscreen document fetch → ${COLLECTOR_ORIGIN} collector`,
  statement: "Instrument validation only. Synthetic canaries. Not a privacy claim about PratiBimb. B-02 and QG-04 unchanged.",
  provenance,
  instrument: {
    scannerVersion: gen.SCANNER_VERSION,
    scannerSha256LF: IDENTITY.scannerSha256LF,
    collectorSha256LF: IDENTITY.collectorSha256LF,
    runnerCommit: IDENTITY.runnerCommit,
    runnerBlobSha256: IDENTITY.runnerBlobSha256,
    regionSha256: { prefix: sha(regions.prefix), body: sha(regions.body), summary: sha(regions.summary) },
    glueModuleSha256: sha(glue),
  },
  extension: { manifest, buildFileSha256: buildFiles },
  design: {
    runs: gen.RUNS,
    baseSeed: gen.BASE_SEED,
    transports: committed.design.transports,
    classes: committed.design.classes,
    requestsPerRun: 252,
    sentinelsPerRun: SENTINEL_IDS.length,
    scannerLocation: "Node, over the bytes the collector received (as in E4)",
  },
  passCriterion:
    "PHASE A reproduces the committed attempt-2 per-run records and totals exactly; PHASE B meets E4's criterion " +
    "(0 positive misses, 0 extra classes, 0 false positives, 0 empty-canary detections, 0 not arrived, 0 hash failures) " +
    "with 2520 requests / 1800 positives / 480 negative controls; 20/20 sentinels arrived intact and detected as PHONE; " +
    "offscreen instanceId identical before and after every run; every relay reports the extension's offscreen.html as emitter. " +
    "Zero correlated PHASE B arrivals is NOT_OBSERVABLE, never PASS.",
  phaseA,
  phaseB,
  verdict,
};
mkdirSync(LOGS, { recursive: true });
writeFileSync(join(LOGS, "e4-offscreen.json"), JSON.stringify(log, null, 2) + NL);

console.log("");
console.log(`PHASE A: reproduces committed records ${phaseA.reproducesCommittedRunRecords} · totals equal ${phaseA.totalsEqualCommitted}`);
if (phaseB.totals) console.log(`PHASE B TOTALS ${JSON.stringify(phaseB.totals)}`);
if (phaseB.sentinels) console.log(`PHASE B sentinels ${phaseB.sentinels.ok}/${phaseB.sentinels.total} · instanceId stable ${phaseB.instanceIdStable} · emitter ok ${phaseB.emits.allFromExpectedEmitter}`);
if (phaseB.error) console.log(`PHASE B error: ${phaseB.error}`);
console.log(`VERDICT ${verdict}`);
console.log("Instrument validation only — not a privacy claim.");
process.exit(verdict === "PASS" ? 0 : verdict.startsWith("ABORTED") ? 2 : 1);
