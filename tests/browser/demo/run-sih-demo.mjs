#!/usr/bin/env node
/**
 * THE SIH DEMO — one command that starts everything, rehearses all three acts, and judges itself.
 *
 * A presenter gets five minutes and one attempt. This script exists so that what happens in front of
 * judges has already happened, unattended, on this machine, with every assertion checked — and so
 * that a presenter who has to restart mid-demo is one command away from a working system.
 *
 *   npm run demo             rehearse all three acts headless, write the evidence, print a verdict
 *   npm run demo -- --rehearse 3    the same, three times over, for the reliability table
 *   npm run demo:present     start everything and hand a headful browser to a human
 *
 * WHAT IT DRIVES. `window.__demo.runAct(id)` — the exact function the on-screen buttons call, with
 * the exact act definitions the UI renders from (`apps/demo/src/demoScript.ts`, imported below from
 * the built output so there is literally one definition). The runner cannot take a path the presenter
 * cannot, and it has no privileged entry point into the security layers.
 *
 * THE THREE SERVICES, all on 127.0.0.1 and all real:
 *
 *   8975  the Planning View, the fixture, and the built packages
 *   8978  the honest reasoner front → llama-server on 8977 → Qwen2.5-0.5B
 *   8979  the compromised reasoner front — answers with a value the client holds locally
 *   8989  nothing at all, which is how the outage act gets a genuinely refused connection
 *
 * The honest and hostile fronts listen simultaneously so the presenter can move between acts without
 * restarting anything. Neither knows which act is running; the client chooses an address.
 *
 * WHAT THIS IS NOT. Not a benchmark. The timings are DEMO REHEARSAL MEASUREMENTS from a handful of
 * runs on one machine with one fixture, recorded so a presenter knows what "normal" looks like and
 * can tell a slow model from a broken one. Nothing here supports a claim about performance.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostname, cpus, release, totalmem } from "node:os";
import { execFileSync } from "node:child_process";

import { ROOT, startDemoServer } from "./server.mjs";
import { FRONT_URL, HOSTILE_PORT, HOSTILE_URL, OUTAGE_URL, startReasonerService } from "./reasoner-service.mjs";
import { MODEL, MODEL_PATH, RUNTIME } from "../../../artifacts/experiments/LOOP-2-local-reasoner-egress/harness/fetch-model.mjs";
import { ACTS, RUNNING_ORDER, RESET_CONTRACT, isLoopbackUrl } from "../../../apps/demo/dist/src/demoScript.js";

const OUT = join(ROOT, "artifacts", "experiments", "DEMO-1-sih-rehearsal", "logs");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  // `argv` is already sliced, so a flag in first position is at index 0 — `> 0` would silently
  // ignore `--rehearse 3` and quietly rehearse once, which is exactly the kind of "it said it did"
  // this runner exists to prevent.
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};

const PRESENT = flag("present");
const HEADLESS = !PRESENT && !flag("headed");
const ROUNDS = Math.max(1, Number(value("rehearse", "1")));

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
};

// ── 1. prerequisites, checked before anything is started ────────────────────────────────────
const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;

const prerequisites = [
  ["Chrome for Testing", Boolean(executablePath) && existsSync(executablePath), "set CHROME_PATH to the Chrome for Testing binary"],
  ["model weights", existsSync(MODEL_PATH), "run artifacts/experiments/LOOP-2-local-reasoner-egress/harness/fetch-model.mjs"],
  ["built packages", existsSync(join(ROOT, "packages/egress/dist/src/index.js")), "run npm run typecheck"],
  ["built demo", existsSync(join(ROOT, "apps/demo/dist/src/demoScript.js")), "run npm run typecheck"],
];
for (const [what, ok, how] of prerequisites) if (!ok) refuse(`${what} — ${how}`);

// Every address the demo can send to is on this machine. The egress guard enforces this too; the
// runner states it as well so a config edit cannot quietly point the demo somewhere else.
for (const [name, url] of Object.entries({ model: FRONT_URL, hostile: HOSTILE_URL, outage: OUTAGE_URL })) {
  if (!isLoopbackUrl(url)) refuse(`the ${name} endpoint is not loopback: ${url}`);
}

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

const shutdown = [];
const stopEverything = async () => {
  for (const stop of shutdown.reverse()) {
    try {
      await stop();
    } catch {
      /* a service that is already gone is not a failure */
    }
  }
  shutdown.length = 0;
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void stopEverything().then(() => process.exit(130));
  });
}

// ── 2. the services ─────────────────────────────────────────────────────────────────────────
console.log("starting services on 127.0.0.1 …");
const { server: demoServer, origin } = await startDemoServer(8975);
shutdown.push(() => demoServer.close());

const modelReadyT0 = Date.now();
const honest = await startReasonerService({ mode: "forward" });
const modelReadyMs = Date.now() - modelReadyT0;
shutdown.push(() => honest.stop());
console.log(`  model ready in ${modelReadyMs} ms · ${honest.url}`);

// ── 3. the browser and the Planning View ────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: HEADLESS, executablePath, args: PRESENT ? ["--start-maximized"] : [] });
shutdown.push(() => browser.close());
// Presenting uses the real window, so the viewport is left to the browser; `deviceScaleFactor`
// cannot be combined with a null viewport, and pinning it only matters for the recorded runs.
const page = await browser.newPage(PRESENT ? { viewport: null } : { viewport: { width: 1600, height: 1400 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e.name)));

await page.goto(`${origin}/`, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.__demo?.runAct === "function");
await page.waitForFunction(() => document.getElementById("page")?.contentWindow?.__fixtureReady === true);
console.log(`  Planning View at ${origin}/`);

/**
 * The values the page holds, read from the page.
 *
 * Needed twice: the hostile service has to be handed one (nothing in the request contains a value,
 * which is the claim), and the sweep needs all of them to assert their absence. They stay in this
 * process's memory and are never written to the artifact.
 */
const secrets = await page.evaluate(() => {
  const doc = document.getElementById("page").contentDocument;
  return ["#name", "#mobile", "#aadhaar", "#dob", "#otp"].map((s) => doc.querySelector(s)?.value ?? "").filter((v) => v !== "");
});
const registered = await page.evaluate(() => document.getElementById("page").contentDocument.getElementById("mobile").value);

const hostile = await startReasonerService({ mode: "hostile", port: HOSTILE_PORT, literal: registered });
shutdown.push(() => hostile.stop());
console.log(`  compromised reasoner at ${hostile.url}`);

// ── the presenter mode stops here and hands over ────────────────────────────────────────────
if (PRESENT) {
  console.log("\n  READY — the browser is yours.");
  console.log(`  ${origin}/`);
  console.log("\n  Run the task        the local model plans it, you authorise, it completes");
  console.log("  Compromised reasoner  the service answers with the secret — the client refuses");
  console.log("  Model outage          a real refused connection — the deterministic planner finishes");
  console.log("  Reset                 between every act\n");
  console.log("  Ctrl-C stops the services.");
  await new Promise(() => {});
}

/** Reset, then run one act, and read back everything needed to judge it. */
const runAct = async (actId) => {
  await page.evaluate(() => window.__demo.resetDemo());
  await page.waitForFunction(() => document.getElementById("page")?.contentWindow?.__fixtureReady === true);

  // RESET is checked before every act, not just once: a reset that silently stopped working would
  // otherwise contaminate act two with act one and nobody would see it until the demo.
  const afterReset = await page.evaluate(() => {
    const doc = document.getElementById("page").contentDocument;
    const win = document.getElementById("page").contentWindow;
    return {
      confirmEmpty: doc.getElementById("mobile_confirm").value === "",
      notSubmitted: doc.getElementById("status").textContent === "Not submitted",
      submitEnabled: doc.getElementById("submit").disabled === false,
      noEvents: (win.__submitEvents ?? []).length === 0,
      viewCleared: document.getElementById("pane-egress").textContent.includes("Nothing recorded"),
      egressLogEmpty: window.__demo.egressLog.length === 0,
      lastCleared: window.__demo.last === null,
    };
  });

  return page.evaluate(async (id) => {
    const t0 = performance.now();
    const record = await window.__demo.runAct(id, { auto: true });
    const wallMs = Math.round(performance.now() - t0);
    const doc = document.getElementById("page").contentDocument;
    const win = document.getElementById("page").contentWindow;

    // Built by the page's own evidence module — the same projection pane 5 renders — so what the
    // artifact records and what a judge sees on screen are the same object.
    const { egressEvidenceOf, headlineOf, sweep } = await import("/demo/evidence.js");
    const attempts = window.__demo.egressLog.slice();
    const ledger = egressEvidenceOf(record, attempts);

    return {
      wallMs,
      headline: headlineOf(record),
      state: record.state,
      path: record.transitions.map((t) => t.to),
      reasonerKind: record.reasonerKind,
      transport: record.response?.received ? record.response.transport : null,
      fallback: record.fallback,
      refusal: record.refusal,
      timings: record.timings,
      planSteps: record.plan?.steps ?? null,
      rehydrated: record.rehydrated,
      literalsInserted: record.literalsInserted,
      grant: { requested: record.grant.requested, granted: record.grant.decision?.granted ?? null, used: record.grant.useGrant?.used ?? null },
      confirmed: record.confirmation !== null,
      verification: record.act?.verification ?? null,
      dispatch: record.act?.result?.status ?? null,
      ledger,
      handoffBytes: record.handoffSerialized?.length ?? 0,
      // The sweep runs INSIDE the page, where the values are, and returns counts only.
      sweeps: {
        handoff: sweep(record.handoffSerialized ?? "", window.__demoSecrets),
        ledger: sweep(ledger, window.__demoSecrets),
        plan: sweep(record.plan, window.__demoSecrets),
        refusal: sweep(record.refusal, window.__demoSecrets),
        response: sweep(record.response, window.__demoSecrets),
      },
      pageState: {
        confirmMatches:
          doc.getElementById("mobile_confirm").value === doc.getElementById("mobile").value &&
          doc.getElementById("mobile_confirm").value !== "",
        status: doc.getElementById("status").textContent,
        submitDisabled: doc.getElementById("submit").disabled,
        events: (win.__submitEvents ?? []).length,
      },
      afterReset: undefined,
    };
  }, actId).then((result) => ({ ...result, afterReset }));
};

// The sweep needs the values, in the page, without them ever reaching the artifact.
await page.evaluate((values) => {
  window.__demoSecrets = values;
}, secrets);

// ── 4. the rehearsal ────────────────────────────────────────────────────────────────────────
const rounds = [];
let peak = { llamaServerMb: null, nodeMb: null };

for (let round = 1; round <= ROUNDS; round += 1) {
  const startedAt = Date.now();
  const acts = {};
  for (const actId of RUNNING_ORDER) {
    process.stdout.write(`round ${round} · ${actId} … `);
    acts[actId] = await runAct(actId);
    console.log(`${acts[actId].headline} (${acts[actId].wallMs} ms)`);
  }
  if (round === 1) peak = { llamaServerMb: memoryOf("llama-server.exe"), nodeMb: memoryOf("node.exe") };
  rounds.push({ round, totalMs: Date.now() - startedAt, acts });
}

// ── 5. the payload proof, from the receiving end ────────────────────────────────────────────
const firstBody = honest.captures[0]?.body ?? "";
const firstCapture = honest.captures[0] ?? null;
const lastSuccess = rounds[rounds.length - 1].acts.SUCCESS;
const clientSent = lastSuccess.ledger?.sent ?? null;

const payloadProof = {
  capturedFrom: "the actual HTTP request body received by the loopback service, not a reconstruction by the sender",
  bytes: firstCapture?.receivedBytes ?? 0,
  serverSha256: firstCapture?.receivedSha256 ?? null,
  tokensPresent: [...new Set(firstBody.match(/<PII:[A-Z]+:\d+>/g) ?? [])].sort(),
  vaultValuesPresent: secrets.filter((s) => firstBody.includes(s)).length,
  vaultValuesChecked: secrets.length,
  // The digest the client recorded for the run above, and whether the peer's receipt agreed with it
  // in-page, live, which is what pane 5 shows a judge.
  clientSha256: clientSent?.clientSha256 ?? null,
  peerSha256: clientSent?.peerSha256 ?? null,
  digestsAgreeInPage: clientSent?.digestsAgree ?? null,
  serverTripwire: firstCapture?.tripwire ?? [],
};

// ── 6. the checks ───────────────────────────────────────────────────────────────────────────
const everyRound = (fn) => rounds.every((r) => fn(r.acts));
const matchesExpectation = (act, result) =>
  result.state === act.expect.state &&
  (result.verification?.verification ?? null) === act.expect.verification &&
  (result.fallback?.fellBack ?? false) === act.expect.fellBack &&
  result.rehydrated.length === act.expect.rehydrations &&
  result.pageState.events === act.expect.clicks;

const checks = {
  // the demo starts and resets
  demoStarted: rounds.length > 0,
  resetRestoredEverything: everyRound((a) => RUNNING_ORDER.every((id) => Object.values(a[id].afterReset).every(Boolean))),

  // the three acts, against their declared expectations
  successMatchedExpectation: everyRound((a) => matchesExpectation(ACTS.SUCCESS, a.SUCCESS)),
  successUsedTheLocalModelOverHttp: everyRound((a) => a.SUCCESS.reasonerKind === "LOCAL_MODEL" && a.SUCCESS.transport === "LOOPBACK_HTTP"),
  refusalMatchedExpectation: everyRound((a) => matchesExpectation(ACTS.REFUSAL, a.REFUSAL)),
  refusalWasALeakageEvent: everyRound(
    (a) => a.REFUSAL.refusal?.stage === "VALIDATE_PLAN" && a.REFUSAL.refusal?.planRefusal?.literalCause === "VAULT_LITERAL_ECHO"
  ),
  refusalDidNotFallBack: everyRound((a) => a.REFUSAL.fallback?.fellBack === false),
  refusalExecutedNothing: everyRound(
    (a) => a.REFUSAL.rehydrated.length === 0 && a.REFUSAL.pageState.events === 0 && a.REFUSAL.pageState.status === "Not submitted"
  ),
  fallbackMatchedExpectation: everyRound((a) => matchesExpectation(ACTS.OUTAGE, a.OUTAGE)),
  fallbackWentThroughTheSameGates: everyRound(
    (a) => a.OUTAGE.path.includes("VALIDATE_PLAN") && a.OUTAGE.path.includes("AWAIT_GRANT") && a.OUTAGE.path.includes("ACT")
  ),

  // the human, and the result
  grantWasAskedAndUsed: everyRound((a) => a.SUCCESS.grant.requested === true && a.SUCCESS.grant.granted === true && a.SUCCESS.grant.used === true),
  confirmationWasRecorded: everyRound((a) => a.SUCCESS.confirmed === true && a.OUTAGE.confirmed === true),
  noConfirmationWithoutAnAction: everyRound((a) => a.REFUSAL.confirmed === false),
  resultCameFromThePage: everyRound((a) => a.SUCCESS.pageState.confirmMatches === true && a.SUCCESS.pageState.status === "Application submitted"),

  // what left
  payloadCarriedTokens: payloadProof.tokensPresent.length > 0,
  payloadCarriedNoVaultValue: payloadProof.vaultValuesPresent === 0,
  clientAndServerDigestsAgree: payloadProof.digestsAgreeInPage === true,
  ledgerRecordedACleanSend: clientSent !== null && clientSent.leakCheck === "CLEAN",

  // nothing presentable contains a value
  noSecretInTheServerRepresentation: everyRound((a) => RUNNING_ORDER.every((id) => a[id].sweeps.handoff.clean)),
  noSecretInTheLedger: everyRound((a) => RUNNING_ORDER.every((id) => a[id].sweeps.ledger.clean)),
  noSecretInThePlanOrRefusal: everyRound((a) =>
    RUNNING_ORDER.every((id) => a[id].sweeps.plan.clean && a[id].sweeps.refusal.clean && a[id].sweeps.response.clean)
  ),

  /**
   * HYGIENE — and the one console error that is supposed to be there.
   *
   * The outage act points the client at a loopback port with nothing behind it, so Chrome logs
   * `ERR_CONNECTION_REFUSED`. That error is the evidence the outage was *real*: a run that forced
   * `MODEL_UNAVAILABLE` with a flag would leave a clean console, and a clean console here would mean
   * the third act had quietly become a simulation. So the assertion is that the connection really was
   * refused, and that nothing else went wrong.
   */
  outageWasARealRefusedConnection: consoleErrors.some((e) => e.includes("ERR_CONNECTION_REFUSED")),
  noUnexpectedConsoleErrors: consoleErrors.every((e) => e.includes("ERR_CONNECTION_REFUSED")),
};
const passed = Object.values(checks).every(Boolean);

// ── 7. demo rehearsal measurements — NOT a benchmark ────────────────────────────────────────
const successWalls = rounds.map((r) => r.acts.SUCCESS.wallMs).sort((a, b) => a - b);
const sendTimes = rounds.map((r) => r.acts.SUCCESS.timings.sendMs).filter((n) => typeof n === "number");
const pct = (list, p) => (list.length ? list[Math.min(list.length - 1, Math.floor((p / 100) * list.length))] : null);

const rehearsalTable = rounds.map((r) => ({
  run: r.round,
  success: r.acts.SUCCESS.headline,
  refusal: r.acts.REFUSAL.headline,
  fallback: r.acts.OUTAGE.headline,
  unexpectedFailure: !(
    matchesExpectation(ACTS.SUCCESS, r.acts.SUCCESS) &&
    matchesExpectation(ACTS.REFUSAL, r.acts.REFUSAL) &&
    matchesExpectation(ACTS.OUTAGE, r.acts.OUTAGE)
  ),
  totalMs: r.totalMs,
}));

const record = {
  experiment: "DEMO-1 — SIH internal/inter-level selection demo, rehearsed",
  verdict: passed ? "PASS" : "FAIL",
  recordedAt: new Date().toISOString(),
  provenance: {
    workstation: "W2",
    host: hostname(),
    os: `${process.platform} ${release()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    totalMemMb: Math.round(totalmem() / 1e6),
    gpu: "NOT USED — the llama.cpp CPU x64 build was chosen deliberately",
    node: process.version,
    playwright: require2("playwright/package.json").version,
    browser: `Chromium ${browser.version()}`,
    browserBinary: executablePath,
    headless: HEADLESS,
    extension: "NOT LOADED — this is the direct/in-process path, not the extension path",
    demoOrigin: origin,
    endpoints: { model: FRONT_URL, hostile: HOSTILE_URL, outage: OUTAGE_URL },
  },
  model: {
    repo: MODEL.repo,
    revision: MODEL.revision,
    quantisation: MODEL.quantisation,
    runtime: `llama.cpp ${RUNTIME.build} ${RUNTIME.asset} (${RUNTIME.licence})`,
    status: "PINNED, not ADOPTED — MODEL_PATH = EXPERIMENTAL, FALLBACK_PATH = VERIFIED",
    committed: false,
  },
  resetContract: RESET_CONTRACT,
  acts: Object.fromEntries(RUNNING_ORDER.map((id) => [id, { label: ACTS[id].label, expect: ACTS[id].expect }])),
  payloadProof,
  checks,
  rehearsal: {
    note: "DEMO REHEARSAL MEASUREMENTS — not benchmark results. One machine, one fixture, one goal, a handful of runs.",
    rounds: ROUNDS,
    table: rehearsalTable,
    serviceStartupIncludingModelLoadMs: modelReadyMs,
    successWallMs: successWalls,
    successP50Ms: pct(successWalls, 50),
    successP95Ms: pct(successWalls, 95),
    successMaxMs: successWalls[successWalls.length - 1] ?? null,
    warmReasonerSendMs: sendTimes,
    perStageLastSuccess: lastSuccess.timings,
  },
  resource: {
    note: "peak RSS via tasklist, sampled once after the first round. Indicative, not profiled.",
    llamaServerMb: peak.llamaServerMb,
    nodeMb: peak.nodeMb,
    gpuMemoryMb: "not used by this run",
  },
  runs: rounds,
  consoleErrors: {
    note: "ERR_CONNECTION_REFUSED is expected once per outage act — it is how that act proves the connection was really refused rather than simulated.",
    all: consoleErrors,
    unexpected: consoleErrors.filter((e) => !e.includes("ERR_CONNECTION_REFUSED")),
  },
  limits: [
    "EXTENSION E2E = NOT PROVEN — apps/demo drives a same-origin frame through its own PageAdapter; no content script, service worker, offscreen document or side panel took part",
    "one machine, one fixture, one goal, one quantisation, CPU only",
    "the compromised service is handed the value by the harness, because nothing in the request contains one",
    "synthetic data throughout; no claim of general PII recall",
  ],
};

mkdirSync(OUT, { recursive: true });
const target = join(OUT, "w2-cft153-sih-rehearsal.json");
writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");

await stopEverything();

// ── 8. the final status ─────────────────────────────────────────────────────────────────────
console.log(`\n${record.verdict}  Chromium ${record.provenance.browser.split(" ")[1]} on ${record.provenance.host} (W2)`);
for (const row of rehearsalTable) {
  console.log(
    `  run ${row.run}: success=${row.success}  refusal=${row.refusal}  fallback=${row.fallback}  unexpected=${row.unexpectedFailure}  ${row.totalMs} ms`
  );
}
console.log(`  payload : ${payloadProof.bytes} B · tokens ${payloadProof.tokensPresent.join(" ")} · values ${payloadProof.vaultValuesPresent}/${payloadProof.vaultValuesChecked}`);
console.log(`  digests : client ${String(payloadProof.clientSha256).slice(0, 16)}… peer ${String(payloadProof.peerSha256).slice(0, 16)}… agree=${payloadProof.digestsAgreeInPage}`);
console.log(`  startup : ${modelReadyMs} ms to model ready · success p50 ${record.rehearsal.successP50Ms} ms`);
console.log(`written: ${target}`);

if (!passed) {
  console.error("\nfailed checks:");
  console.error(JSON.stringify(Object.fromEntries(Object.entries(checks).filter(([, v]) => !v)), null, 2));
  process.exit(1);
}
