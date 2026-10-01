#!/usr/bin/env node
/**
 * M2-EXEC — ONE APPROVED TASK, ONE BROWSER ACTION. FIFTY TIMES.
 *
 * WHY THIS EXISTS. The M2 evidence run saw, once in five, ten raw events at the fixture's submit
 * button where one pointer/mouse sequence was expected — while the transport recorded one dispatch,
 * one delivery id and zero refusals. The M2 record called a measurement artefact the "best
 * explanation" and said plainly that this was a hypothesis. A hypothesis is not a finding, and
 * "could not reproduce" is not a root cause. This harness exists to replace both with data.
 *
 * WHAT MAKES IT DIFFERENT FROM `run-extension-loop.mjs`. That runner reads the fixture's own event
 * log and counts entries. Counting entries cannot tell these five things apart:
 *
 *   A. two logical dispatches      — the core realm asked twice
 *   B. two transport deliveries    — the worker carried the same ask twice
 *   C. two browser actions         — the isolated world put events into the document twice
 *   D. two observations of one     — the page recorded a single sequence twice
 *   E. an event from somewhere else — a real user click, or another extension
 *
 * So each of the five is measured separately, at the place it would happen:
 *
 *   A  the run record's own cycle report (one `cycleId`, one `deliveryId`, refusal codes)
 *   B  the service worker's recording of every port frame it carried
 *   C  **the page agent's own fire counter**, read out of the isolated world that fired — a DISPATCH
 *      reply says a dispatch was answered, and only this says how many were performed
 *   D  an independent main-world probe that holds each Event OBJECT in a WeakSet, so the same event
 *      seen twice is a different observation from two events
 *   E  `isTrusted`, which no dispatched event can set, and the page-clock correlation between an
 *      event's `timeOrigin + timeStamp` and the fire note's `at`
 *
 * The fixture is not modified and the existing five-event expectation is not loosened: the probe is
 * installed by this harness, in the page's main world, beside the fixture's own recorder.
 *
 * NO PAGE VALUES ANYWHERE. What is read back is counts, refusal codes, ids minted by the core realm,
 * structural selectors and timestamps. The confirm field is checked by comparing it to the
 * registered one INSIDE the page and reporting a boolean.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-dispatch-stress.mjs [--runs 50]
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, release as osRelease, tmpdir } from "node:os";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import { startReasonerService } from "../demo/reasoner-service.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";
import { attribute, installProbe, SEQUENCE_LENGTH } from "./single-action-probe.mjs";

const WS = resolveWorkstation();
const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M2-EXEC-single-action", "logs");

const GOAL = "Submit my application with my registered mobile number.";
const REASONER_PORT = 8995;
const REASONER_URL = `http://127.0.0.1:${REASONER_PORT}/v1/chat/completions`;

/** How many complete SUCCESS acts. The brief's floor is 50. */
const argRuns = Number(process.argv[process.argv.indexOf("--runs") + 1]);
const RUNS = Number.isFinite(argRuns) && argRuns > 0 ? argRuns : 50;

/**
 * WARM or COLD, and why the difference matters more than the count.
 *
 * WARM reuses one browser and one tab across every iteration, reloading the document each time. It
 * stresses everything that could accumulate: listeners, ports, cycles, delivery ids, instances.
 *
 * COLD launches a fresh browser with a fresh profile for every iteration and runs exactly one act in
 * it. That is the condition the symptom was actually seen under — **the first run of the harness**,
 * in a window that had just opened — and no number of warm iterations re-tests it. Repeating a state
 * a bug does not live in is not reproduction, however many times it is repeated.
 */
const COLD = process.argv.includes("--cold");

/**
 * THE NEGATIVE CONTROL, and why a sweep without one proves nothing.
 *
 * Fifty runs that all say "exactly one action" are worth exactly as much as the instrument's ability
 * to say something else. So this mode dispatches a **real second pointer sequence** at the button
 * after the act finishes — from the page's own main world, which the extension cannot do and does
 * not do — and then requires every run to be reported as BROKEN.
 *
 * It is the same code path, the same checks and the same thresholds as a normal run; only the
 * expected verdict is inverted. A negative control that passed would mean the fifty green runs above
 * were measuring nothing.
 */
const CONTROL = process.argv.includes("--negative-control");

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
};

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!existsSync(join(EXT, "manifest.json"))) refuse(`no built host at ${EXT} (run: npm run build -w @pratibimb/extension)`);

const userDataDir = mkdtempSync(join(tmpdir(), "pratibimb-m2-stress-"));
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

let context = null;
let stopServer = null;
let service = null;
let failure = null;
const runs = [];

try {
  const { server, origin } = await startDemoServer(8975);
  stopServer = () => new Promise((ok) => server.close(ok));
  const fixtureUrl = `${origin}/fixture/`;

  service = await startReasonerService({ mode: "forward", port: REASONER_PORT });

  /** A browser with the host loaded, the offscreen document up, and the fixture open with the probe. */
  const openBrowser = async () => {
    const dir = mkdtempSync(join(tmpdir(), "pratibimb-m2-stress-"));
    const ctx = await chromium.launchPersistentContext(dir, {
      headless: false,
      executablePath,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 30_000 }));
    await sw.evaluate(() => globalThis.__host.ensureOffscreen());
    const tab = await ctx.newPage();
    await tab.addInitScript(installProbe);
    await tab.goto(fixtureUrl, { waitUntil: "load" });
    await tab.waitForSelector("#submit");
    return { ctx, sw, tab };
  };

  let open = await openBrowser();
  context = open.ctx;
  let worker = open.sw;
  let page = open.tab;

  const attestedNow = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const identity = await worker.evaluate(() => {
        const last = [...globalThis.__host.hellos].reverse()[0];
        return last ? last.identity : null;
      });
      if (identity && typeof identity.tabId === "number" && typeof identity.documentId === "string") return identity;
      await wait(250);
    }
    throw new Error("the service worker never recorded an attested content script");
  };

  const freshDocument = async () => {
    const before = await worker.evaluate(() => globalThis.__host.hellos.length);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#submit");
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const now = await worker.evaluate(() => globalThis.__host.hellos.length);
      if (now > before) break;
      await wait(250);
    }
    return attestedNow();
  };

  /** One SUCCESS act, with the operator's approval answered through the worker's control plane. */
  const runAct = async (identity, index) => {
    const request = {
      tabId: identity.tabId,
      frameId: identity.frameId,
      goal: GOAL,
      act: "SUCCESS",
      endpoint: REASONER_URL,
      sessionId: `m2exec-${index}-session`,
      requestId: `m2exec-${index}-request`,
    };
    await worker.evaluate((req) => {
      globalThis.__m1 = null;
      globalThis.__m1error = null;
      void globalThis.__host.runTask(req).then(
        (result) => (globalThis.__m1 = result),
        (error) => (globalThis.__m1error = String(error))
      );
      return true;
    }, request);

    let grantAsked = null;
    let decided = false;
    for (let tick = 0; tick < 480; tick += 1) {
      const state = await worker.evaluate(async () => ({
        settled: globalThis.__m1 !== null || globalThis.__m1error !== null,
        grant: await globalThis.__host.grantPeek(),
      }));
      if (state.grant?.pending && !decided) {
        grantAsked = state.grant.pending;
        decided = true;
        await worker.evaluate(() => globalThis.__host.grantDecide(true));
      }
      if (state.settled) {
        const settled = await worker.evaluate(() => ({ outcome: globalThis.__m1, error: globalThis.__m1error }));
        return { ...settled, grantAsked };
      }
      await wait(125);
    }
    return { outcome: null, error: "TIMED_OUT", grantAsked };
  };

  /**
   * What the page itself holds. The confirm field is compared INSIDE the page and reported as a
   * boolean, so no value is carried out here either.
   */
  const pageTruth = () =>
    page.evaluate(() => ({
      confirmMatchesRegistered:
        document.getElementById("mobile_confirm").value.trim() !== "" &&
        document.getElementById("mobile_confirm").value.trim() === document.getElementById("mobile").value.trim(),
      submitted: document.getElementById("status")?.dataset.submitted ?? null,
      submitDisabled: document.getElementById("submit")?.disabled ?? null,
      fixtureEvents: (window.__submitEvents ?? []).map((e) => e.type),
      probeInstalls: window.__probeInstalls ?? 0,
      probe: window.__probe ?? null,
    }));

  console.log(`M2-EXEC: ${RUNS} consecutive SUCCESS acts, ${COLD ? "COLD" : "WARM"}${CONTROL ? ", NEGATIVE CONTROL (every run must break)" : ""}, on ${WS.id}\n`);

  for (let index = 1; index <= RUNS; index += 1) {
    if (COLD && index > 1) {
      await context.close();
      open = await openBrowser();
      context = open.ctx;
      worker = open.sw;
      page = open.tab;
    }
    await worker.evaluate(() => globalThis.__host.forgetSeen());
    // COLD acts in the document the browser opened with — the very first document of the profile,
    // which is where the symptom was seen. WARM reloads, so nothing carries between iterations.
    const identity = COLD ? await attestedNow() : await freshDocument();
    const startedAt = Date.now();
    const run = await runAct(identity, index);
    if (CONTROL) {
      // A second complete sequence, dispatched by nobody the extension knows about. Untrusted, so it
      // cannot be caught by `isTrusted` alone — it has to be caught by attribution, which is the
      // part that actually had to be built.
      await page.evaluate(() => {
        const el = document.getElementById("submit");
        const r = el.getBoundingClientRect();
        const init = { bubbles: true, cancelable: true, composed: true, clientX: r.x + 1, clientY: r.y + 1, button: 0 };
        el.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true }));
        el.dispatchEvent(new MouseEvent("mousedown", init));
        el.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse", isPrimary: true }));
        el.dispatchEvent(new MouseEvent("mouseup", init));
        el.dispatchEvent(new MouseEvent("click", init));
      });
    }
    const truth = await pageTruth();
    // Read out of the isolated world that fired: how many times events were actually dispatched.
    const audit = await worker.evaluate(
      ({ tabId, frameId }) => globalThis.__host.pageAudit(tabId, frameId),
      { tabId: identity.tabId, frameId: identity.frameId }
    );
    // What the worker carried on the transport port, counted by op.
    const carried = await worker.evaluate(() => {
      const ops = {};
      for (const entry of globalThis.__host.seen) {
        if (entry.way !== "port") continue;
        const op = entry.message?.op ?? "?";
        ops[op] = (ops[op] ?? 0) + 1;
      }
      return ops;
    });

    // The same shape `run-extension-loop.mjs` reads: the worker's reply wraps the core realm's result,
    // and the result carries the run record, the ports' report and the boundary's counts.
    const result = run.outcome?.result ?? null;
    const record = result?.record ?? null;
    const cycle = result?.ports?.cycle ?? null;
    const boundary = result?.boundary ?? null;
    const fires = audit?.transport?.fires ?? [];
    const seenByThePage = attribute(truth.probe, fires);

    const observed = {
      index,
      ms: Date.now() - startedAt,
      documentId: identity.documentId,
      state: record?.state ?? null,
      verify: record?.act?.verification?.verification ?? null,
      fellBack: record?.fallback?.fellBack === true,
      error: run.error ?? null,
      // A — logical
      cycleId: cycle?.cycleId ?? null,
      deliveryId: cycle?.dispatch?.deliveryId ?? null,
      transportRefusals: cycle?.refusals ?? [],
      // B — delivery
      portOps: carried,
      // C — browser action, from the world that fired
      contentInstances: audit?.instances ?? null,
      e6Clicks: audit?.e6Clicks ?? null,
      dispatchRequests: audit?.transport?.dispatchRequests ?? null,
      firesStarted: audit?.transport?.firesStarted ?? null,
      firesCompleted: audit?.transport?.firesCompleted ?? null,
      agentRefusals: audit?.transport?.refusals ?? [],
      firedAt: fires.map((f) => f.to),
      /**
       * The windows the isolated world fired in, and where each observed event fell, both on the
       * page's own clock and relative to the first fire. Kept for every run, not only the ones that
       * break: an attribution that only ever gets looked at when it fails cannot be calibrated.
       */
      fireWindows: fires.map((f) => ({
        prepareMs: Math.round((f.at - f.preparedAt) * 1000) / 1000,
        dispatchMs: Math.round(((f.doneAt ?? f.at) - f.at) * 1000) / 1000,
      })),
      eventOffsets: seenByThePage.offsets,
      // D / E — observation
      fixtureEvents: truth.fixtureEvents.length,
      probeInstalls: truth.probeInstalls,
      probeUntrusted: seenByThePage.untrusted,
      probeTrusted: seenByThePage.trusted,
      objectSeenTwice: seenByThePage.objectSeenTwice,
      listenersOnSubmit: seenByThePage.listenersOnSubmit,
      unattributed: seenByThePage.unattributed,
      // the loop's own postconditions
      releases: boundary?.releases ?? null,
      writes: boundary?.writes ?? null,
      rehydrated: record?.rehydrated?.length ?? null,
      inserts: result?.ports?.inserts ?? null,
      confirmMatchesRegistered: truth.confirmMatchesRegistered,
      submitted: truth.submitted,
      submitDisabled: truth.submitDisabled,
    };

    // ── THE SINGLE-ACTION INVARIANT, checked every run and never relaxed ──────────────────────
    const broke = [];
    if (observed.state !== "DONE") broke.push(`state=${observed.state}`);
    if (observed.verify !== "CONFIRMED") broke.push(`verify=${observed.verify}`);
    if (observed.contentInstances !== 1) broke.push(`contentInstances=${observed.contentInstances}`);
    if (observed.e6Clicks !== 0) broke.push(`e6Clicks=${observed.e6Clicks}`);
    if (observed.dispatchRequests !== 1) broke.push(`dispatchRequests=${observed.dispatchRequests}`);
    if (observed.firesStarted !== 1) broke.push(`firesStarted=${observed.firesStarted}`);
    if (observed.firesCompleted !== 1) broke.push(`firesCompleted=${observed.firesCompleted}`);
    if (observed.agentRefusals.length !== 0) broke.push(`agentRefusals=${observed.agentRefusals.join(",")}`);
    if (observed.transportRefusals.length !== 0) broke.push(`transportRefusals=${observed.transportRefusals.join(",")}`);
    if ((carried.DISPATCH ?? 0) !== 2) broke.push(`portDISPATCH=${carried.DISPATCH ?? 0}`); // the ask and its reply
    if (observed.releases !== 1) broke.push(`releases=${observed.releases}`);
    if (observed.writes !== 1) broke.push(`writes=${observed.writes}`);
    if (observed.inserts !== 0) broke.push(`inserts=${observed.inserts}`);
    if (observed.probeUntrusted !== SEQUENCE_LENGTH) broke.push(`probeUntrusted=${observed.probeUntrusted}`);
    if (observed.fixtureEvents !== SEQUENCE_LENGTH) broke.push(`fixtureEvents=${observed.fixtureEvents}`);
    if (observed.objectSeenTwice !== 0) broke.push(`objectSeenTwice=${observed.objectSeenTwice}`);
    if (observed.listenersOnSubmit !== SEQUENCE_LENGTH + 1) broke.push(`listenersOnSubmit=${observed.listenersOnSubmit}`);
    if (observed.unattributed !== 0) broke.push(`unattributed=${observed.unattributed}`);
    if (observed.probeTrusted !== 0) broke.push(`probeTrusted=${observed.probeTrusted}`);
    if (!observed.confirmMatchesRegistered) broke.push("confirmMismatch");
    if (observed.submitted !== "true") broke.push(`submitted=${observed.submitted}`);
    observed.broke = broke;
    runs.push(observed);

    // In control mode the run is supposed to break, and a run that did not is the failure.
    const asExpected = CONTROL ? broke.length > 0 : broke.length === 0;
    observed.asExpected = asExpected;
    const mark = asExpected ? "ok " : "BAD";
    console.log(
      `  ${String(index).padStart(3)} ${mark} fires=${observed.firesStarted} ` +
        `probe=${observed.probeUntrusted}(+${observed.probeTrusted}T) fixture=${observed.fixtureEvents} ` +
        `rel=${observed.releases} wr=${observed.writes} ${observed.ms}ms` +
        (broke.length ? `  ← ${broke.join(" ")}` : "")
    );
  }
} catch (error) {
  failure = `${error.name}: ${String(error.message).slice(0, 400)}`;
} finally {
  if (service) await service.stop().catch(() => {});
  if (context) await context.close();
  if (typeof stopServer === "function") await stopServer();
}

const bad = runs.filter((r) => !r.asExpected);
const passed = failure === null && runs.length === RUNS && bad.length === 0;

const histogram = (key) => {
  const out = {};
  for (const run of runs) out[String(run[key])] = (out[String(run[key])] ?? 0) + 1;
  return out;
};

const record = {
  experiment: "M2-EXEC-single-action",
  mode: `${COLD ? "COLD" : "WARM"}${CONTROL ? "-NEGATIVE-CONTROL" : ""}`,
  claim:
    "one approved task produces exactly one browser action: one logical dispatch, one transport " +
    "delivery, one fire in the isolated world, and one five-event sequence observed at the button — " +
    "measured separately at each of those four places, over consecutive runs",
  notAClaim: [
    "not a reliability claim beyond the run count recorded here, on one machine, in one browser cell",
    "no claim about a page the fixture does not resemble, or about a browser under load this run did not create",
    "no claim of production readiness",
  ],
  recordedAt: new Date().toISOString(),
  provenance: {
    ...provenanceOf(WS),
    os: `${process.platform} ${osRelease()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cpus: cpus().length,
    node: process.version,
    playwright: require2("playwright/package.json").version,
    browserBinary: executablePath,
    headless: false,
    extensionPath: EXT,
    reasonerAddress: REASONER_URL,
  },
  runsRequested: RUNS,
  runsCompleted: runs.length,
  failure,
  verdict: passed ? "PASS" : "FAIL",
  summary: {
    firesStarted: histogram("firesStarted"),
    probeUntrusted: histogram("probeUntrusted"),
    probeTrusted: histogram("probeTrusted"),
    fixtureEvents: histogram("fixtureEvents"),
    contentInstances: histogram("contentInstances"),
    listenersOnSubmit: histogram("listenersOnSubmit"),
    objectSeenTwice: histogram("objectSeenTwice"),
    unattributed: histogram("unattributed"),
    releases: histogram("releases"),
    writes: histogram("writes"),
    verify: histogram("verify"),
  },
  badRuns: bad.map((r) => ({ index: r.index, broke: r.broke })),
  /** In control mode: what each run was caught by. The whole point is that this is never empty. */
  caughtBy: CONTROL ? runs.map((r) => ({ index: r.index, broke: r.broke })) : undefined,
  runs,
};

mkdirSync(OUT, { recursive: true });
const file = join(OUT, evidenceFileName(WS, `cft153-dispatch-stress-${CONTROL ? "control" : COLD ? "cold" : "warm"}.json`));
assertOwnEvidencePath(file, WS);
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(
  `\n${passed ? "PASS" : "FAIL"} — ${runs.length - bad.length}/${runs.length} runs ` +
    (CONTROL ? "were caught by the single-action invariant" : "held the single-action invariant")
);
if (failure) console.log(`  harness failure: ${failure}`);
for (const key of Object.keys(record.summary)) console.log(`  ${key}: ${JSON.stringify(record.summary[key])}`);
console.log(`\nwritten: ${file}`);
process.exit(passed ? 0 : 1);
