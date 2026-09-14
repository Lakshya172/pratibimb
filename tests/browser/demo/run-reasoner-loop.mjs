#!/usr/bin/env node
/**
 * THE REAL LOOP, OVER A REAL NETWORK — W2 evidence.
 *
 * Three runs in a real browser against a real HTTP service on 127.0.0.1:
 *
 *   MODEL     the local Qwen2.5-0.5B answers; the plan is validated, granted, rehydrated, clicked
 *             and read back. Expected: CONFIRMED.
 *   REFUSAL   the service answers with a plan containing a value the client holds locally. Expected:
 *             refused at VALIDATE_PLAN, nothing executed, and NO fallback — falling back would hide
 *             a caught event behind a success.
 *   FALLBACK  the model is unavailable. Expected: the deterministic planner answers, through the
 *             same validation, and the loop completes. CONFIRMED.
 *
 * THE PAYLOAD PROOF, and why it is two-sided. The client's egress ledger says *"I sent bytes with
 * digest X"*. The recording front says *"I received these bytes, and their digest is X"*. Both are
 * captured, both are compared, and the received body — the actual HTTP request body, not a
 * reconstruction — is searched for every value the vault holds. A single process printing its own
 * outgoing object would be the same belief twice.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/demo/run-reasoner-loop.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostname, cpus, release, totalmem } from "node:os";
import { execFileSync } from "node:child_process";

import { ROOT, startDemoServer } from "./server.mjs";
import { FRONT_URL, startReasonerService } from "./reasoner-service.mjs";
import { MODEL, MODEL_PATH, RUNTIME } from "../../../artifacts/experiments/LOOP-2-local-reasoner-egress/harness/fetch-model.mjs";

const OUT = join(ROOT, "artifacts", "experiments", "LOOP-2-local-reasoner-egress", "logs");
const ACQUISITION = join(ROOT, "models", "qwen2.5-0.5b-instruct-gguf", "acquisition.json");

const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!existsSync(MODEL_PATH)) refuse("no weights — run artifacts/experiments/LOOP-2-local-reasoner-egress/harness/fetch-model.mjs");
if (!existsSync(join(ROOT, "packages/egress/dist/src/index.js"))) refuse("build first: npm run typecheck");

/** Peak process memory, via the tool Windows already has. No telemetry framework. */
const memoryOf = (image) => {
  try {
    const out = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
    const row = out.split("\n").find((l) => l.includes(image));
    if (!row) return null;
    const kb = Number(row.split('","').pop().replace(/[^0-9]/g, ""));
    return Number.isFinite(kb) ? Math.round(kb / 1024) : null;
  } catch {
    return null;
  }
};

const { server: demoServer, origin } = await startDemoServer(8975);
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e.name)));

await page.goto(`${origin}/`, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.__demo?.run === "function");

/** Drive one run in the page and read back the record, the page's own state, and the egress log. */
const drive = async (request) => {
  await page.evaluate(() => window.__demo.resetPage());
  await page.waitForFunction(() => document.getElementById("page")?.contentWindow?.__fixtureReady === true);
  return page.evaluate(async (req) => {
    const t0 = performance.now();
    const before = window.__demo.egressLog.length;
    const record = await window.__demo.run({ ...req, auto: true });
    const wall = performance.now() - t0;
    const doc = document.getElementById("page").contentDocument;
    return {
      wallMs: Math.round(wall),
      state: record.state,
      path: record.transitions.map((t) => t.to),
      reasonerKind: record.reasonerKind,
      reasonerName: record.response?.received ? record.response.reasoner : null,
      transport: record.response?.received ? record.response.transport : null,
      fallback: record.fallback,
      refusal: record.refusal,
      timings: record.timings,
      planSteps: record.plan?.steps ?? null,
      rehydrated: record.rehydrated,
      verification: record.act?.verification ?? null,
      dispatch: record.act?.result?.status ?? null,
      egress: window.__demo.egressLog.slice(before),
      pageState: {
        confirmMatches:
          doc.getElementById("mobile_confirm").value === doc.getElementById("mobile").value &&
          doc.getElementById("mobile_confirm").value !== "",
        status: doc.getElementById("status").textContent,
        submitDisabled: doc.getElementById("submit").disabled,
        events: (document.getElementById("page").contentWindow.__submitEvents ?? []).length,
      },
    };
  }, request);
};

const runs = {};
const timings = { model: [] };
let serviceStartupMs = null;
let peak = { llamaServerMb: null, nodeMb: null };

// ── MODEL ───────────────────────────────────────────────────────────────────────────────────
{
  const t0 = Date.now();
  const service = await startReasonerService({ mode: "forward" });
  serviceStartupMs = Date.now() - t0;
  runs.model = await drive({ reasoner: "local-model", endpoint: FRONT_URL });
  peak = { llamaServerMb: memoryOf("llama-server.exe"), nodeMb: memoryOf("node.exe") };

  // Repetitions for a distribution rather than one lucky number. Small sample, labelled as such.
  for (let i = 0; i < 6; i += 1) {
    const again = await drive({ reasoner: "local-model", endpoint: FRONT_URL });
    timings.model.push({ wallMs: again.wallMs, sendMs: again.timings.sendMs, state: again.state, verification: again.verification?.verification ?? null });
  }
  runs.modelCaptures = service.captures.map((c) => ({ receivedBytes: c.receivedBytes, receivedSha256: c.receivedSha256, tripwire: c.tripwire }));
  // The exact body of the first request, for the payload proof below.
  runs.firstBody = service.captures[0]?.body ?? null;
  await service.stop();
}

// ── REFUSAL ─────────────────────────────────────────────────────────────────────────────────
{
  // The hostile server must be handed the value: nothing in the request contains one.
  const literal = await page.evaluate(() => document.getElementById("page").contentDocument.getElementById("mobile").value);
  const service = await startReasonerService({ mode: "hostile", literal });
  runs.refusal = await drive({ reasoner: "local-model", endpoint: FRONT_URL });
  runs.refusalCaptures = service.captures.map((c) => ({ receivedSha256: c.receivedSha256, tripwire: c.tripwire }));
  await service.stop();
}

// ── FALLBACK ────────────────────────────────────────────────────────────────────────────────
runs.fallback = await drive({ reasoner: "unavailable" });

// ── the payload proof ───────────────────────────────────────────────────────────────────────
const secrets = await page.evaluate(() => {
  const doc = document.getElementById("page").contentDocument;
  return ["#name", "#mobile", "#aadhaar", "#dob", "#otp"].map((s) => doc.querySelector(s)?.value ?? "").filter((v) => v !== "");
});
const body = runs.firstBody ?? "";
const clientRecord = runs.model.egress.find((e) => e.record)?.record ?? null;
const payloadProof = {
  capturedFrom: "the actual HTTP request body received by the loopback service",
  bytes: body.length,
  clientSha256: clientRecord?.payloadSha256 ?? null,
  serverSha256: runs.modelCaptures?.[0]?.receivedSha256 ?? null,
  digestsAgree: (clientRecord?.payloadSha256 ?? "x") === (runs.modelCaptures?.[0]?.receivedSha256 ?? "y"),
  tokensPresent: [...new Set(body.match(/<PII:[A-Z]+:\d+>/g) ?? [])].sort(),
  secretsPresent: secrets.filter((s) => body.includes(s)).length,
  secretsChecked: secrets.length,
};

const checks = {
  // model path
  modelWentOverTheNetwork: runs.model.transport === "LOOPBACK_HTTP" && runs.model.reasonerKind === "LOCAL_MODEL",
  modelPlanValidated: runs.model.state === "DONE" || runs.model.state === "REFUSED",
  modelReachedConfirmed: runs.model.verification?.verification === "CONFIRMED",
  modelRestoredTheValue: runs.model.pageState.confirmMatches === true,
  // the payload
  payloadCarriedTokens: payloadProof.tokensPresent.length > 0,
  payloadCarriedNoSecret: payloadProof.secretsPresent === 0,
  clientAndServerDigestsAgree: payloadProof.digestsAgree,
  ledgerRecordedTheSend: clientRecord !== null && clientRecord.leakCheck === "CLEAN" && clientRecord.verified === true,
  // refusal
  refusalStoppedAtValidatePlan: runs.refusal.state === "REFUSED" && runs.refusal.refusal?.stage === "VALIDATE_PLAN",
  refusalWasALeakageEvent: runs.refusal.refusal?.planRefusal?.literalCause === "VAULT_LITERAL_ECHO",
  refusalDidNotFallBack: runs.refusal.fallback?.fellBack === false,
  refusalExecutedNothing:
    runs.refusal.rehydrated.length === 0 && runs.refusal.pageState.events === 0 && runs.refusal.pageState.status === "Not submitted",
  refusalQuotedNothing: !JSON.stringify(runs.refusal.refusal ?? {}).includes(secrets[1] ?? " "),
  // fallback
  fallbackAnswered: runs.fallback.reasonerKind === "DETERMINISTIC_FALLBACK" && runs.fallback.fallback?.fellBack === true,
  fallbackWentThroughValidation: runs.fallback.path.includes("VALIDATE_PLAN") && runs.fallback.path.includes("AWAIT_GRANT"),
  fallbackReachedConfirmed: runs.fallback.verification?.verification === "CONFIRMED",
  // hygiene
  noConsoleErrors: consoleErrors.length === 0,
};
const passed = Object.values(checks).every(Boolean);

const latencies = timings.model.map((t) => t.wallMs).sort((a, b) => a - b);
const pct = (p) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] : null);

const acquisition = JSON.parse(readFileSync(ACQUISITION, "utf8"));
const record = {
  experiment: "LOOP-2 — local model, real loopback network, egress choke point, deterministic fallback",
  verdict: passed ? "PASS" : "FAIL",
  recordedAt: new Date().toISOString(),
  provenance: {
    workstation: "W2",
    host: hostname(),
    os: `${process.platform} ${release()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    totalMemMb: Math.round(totalmem() / 1e6),
    gpu: "NOT USED — the llama.cpp CPU x64 build was chosen deliberately; no CUDA runtime was downloaded",
    node: process.version,
    playwright: require2("playwright/package.json").version,
    browser: `Chromium ${browser.version()}`,
    browserBinary: executablePath,
    launch: "playwright chromium.launch({ headless: true, executablePath }); no extension loaded",
    demoOrigin: origin,
    reasonerEndpoint: FRONT_URL,
  },
  model: {
    repo: MODEL.repo,
    revision: MODEL.revision,
    file: MODEL.file,
    quantisation: MODEL.quantisation,
    licence: acquisition.licence,
    weightsBytes: acquisition.weights.bytes,
    weightsSha256: acquisition.weights.sha256,
    downloadMs: acquisition.downloadMs,
    runtime: `llama.cpp ${RUNTIME.build} ${RUNTIME.asset} (${RUNTIME.licence})`,
    committed: false,
  },
  payloadProof,
  checks,
  runs: { model: runs.model, refusal: runs.refusal, fallback: runs.fallback },
  captures: { model: runs.modelCaptures, refusal: runs.refusalCaptures },
  latency: {
    note: "SMALL SAMPLE — 6 warm repetitions on one machine. Not a benchmark and not a generalisable distribution.",
    serviceStartupMsIncludingModelLoad: serviceStartupMs,
    coldRunWallMs: runs.model.wallMs,
    warmRunsWallMs: latencies,
    p50: pct(50),
    p95: pct(95),
    max: latencies[latencies.length - 1] ?? null,
    perStageCold: runs.model.timings,
  },
  resource: {
    note: "peak RSS via tasklist, sampled once after the first model run. Indicative, not profiled.",
    llamaServerMb: peak.llamaServerMb,
    nodeMb: peak.nodeMb,
    gpuMemoryMb: "not used by this run",
  },
  consoleErrors,
  limits: [
    "the loop did NOT run through the browser extension: apps/demo drives a same-origin frame directly",
    "one machine, one fixture, one goal, one quantisation, CPU only",
    "the hostile server is handed the value by the harness because nothing in the request contains one",
  ],
};

mkdirSync(OUT, { recursive: true });

/**
 * The exact outbound body, committed as evidence — but only if it is provably safe to commit.
 *
 * The working captures live under `logs/captures/`, which `.gitignore` excludes (that rule exists to
 * keep screen captures out of the repository, and is not one to route around). So one representative
 * body is written here instead, and **this file refuses to write it unless the value check passed**.
 * An artifact that guards itself is worth more than a promise in a README.
 */
if (payloadProof.secretsPresent === 0 && body !== "") {
  writeFileSync(
    join(OUT, "w2-outbound-payload.json"),
    `${JSON.stringify(
      {
        note: "The EXACT body received by the loopback reasoner service, as bytes on the wire. Written only because the value check below passed.",
        capturedBy: "tests/browser/demo/reasoner-service.mjs (the receiving end, not the sender)",
        bytes: payloadProof.bytes,
        sha256: payloadProof.serverSha256,
        clientSha256: payloadProof.clientSha256,
        digestsAgree: payloadProof.digestsAgree,
        vaultValuesPresent: payloadProof.secretsPresent,
        vaultValuesChecked: payloadProof.secretsChecked,
        referencesPresent: payloadProof.tokensPresent,
        body: JSON.parse(body),
      },
      null,
      2
    )}
`,
    "utf8"
  );
} else if (body !== "") {
  console.error("REFUSING to write the payload artifact: the value check did not pass.");
}

const target = join(OUT, "w2-cft153-reasoner-loop.json");
writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");

await browser.close();
demoServer.close();

console.log(`${record.verdict}  Chromium ${browser.version()} on ${record.provenance.host} (W2)`);
console.log(`  model    : ${runs.model.state} · ${runs.model.verification?.verification} · ${runs.model.wallMs} ms`);
console.log(`  refusal  : ${runs.refusal.state} at ${runs.refusal.refusal?.stage} · fellBack=${runs.refusal.fallback?.fellBack}`);
console.log(`  fallback : ${runs.fallback.state} · ${runs.fallback.verification?.verification} · ${runs.fallback.reasonerKind}`);
console.log(`  payload  : ${payloadProof.bytes} B · tokens ${payloadProof.tokensPresent.join(" ")} · secrets ${payloadProof.secretsPresent}/${payloadProof.secretsChecked}`);
console.log(`  digests  : client ${String(payloadProof.clientSha256).slice(0, 16)}… server ${String(payloadProof.serverSha256).slice(0, 16)}… agree=${payloadProof.digestsAgree}`);
console.log(`written: ${target}`);
if (!passed) {
  console.error(JSON.stringify(Object.fromEntries(Object.entries(checks).filter(([, v]) => !v)), null, 2));
  process.exit(1);
}
