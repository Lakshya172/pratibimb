#!/usr/bin/env node
/**
 * M5 — THE THREE ACTS, ON THE REAL GESTURE STREAM. **HUMAN-IN-THE-LOOP.**
 *
 * M4 verified the capture route: a person's click, an opaque handle, and an `ImageBitmap` in the
 * perception realm. It did not run the product loop on that route — the acts stayed on the degraded
 * worker-frame path and were labelled as such. This is the harness that closes that, and it is the
 * same three acts `run-extension-loop.mjs` runs, differing in one thing: **where the frame comes
 * from**.
 *
 * ONE CLICK PER ACT, and that is Chrome's rule rather than a convenience. `activeTab` is revoked the
 * moment a tab navigates, and each act begins with a fresh document so that no binding, capability
 * or permit from the previous one could still apply. So a person authorises each act separately,
 * which is what a per-invocation grant means.
 *
 * IT RUNS ON THE PRODUCT BUILD and refuses to start on any other: it reads the built manifest and
 * the built worker and stops if `<all_urls>` is present or `captureVisibleTab` appears anywhere.
 * Evidence for the product route taken on the degraded build would look identical in the log.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-gesture-acts.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { cpus, release as osRelease, tmpdir } from "node:os";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import { startReasonerService } from "../demo/reasoner-service.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";
import { attribute, installProbe, SEQUENCE_LENGTH } from "./single-action-probe.mjs";

const WS = resolveWorkstation();
const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M5-gesture-loop", "logs");

const GOAL = "Submit my application with my registered mobile number.";
const REASONER_PORT = 8995;
const REASONER_URL = `http://127.0.0.1:${REASONER_PORT}/v1/chat/completions`;
const REGISTERED = "9000000001";
const FIXTURE_VALUES = [REGISTERED, "Ramesh Kumar", "2345 6789 0124", "234567890124", "1998-04-12", "482913"];
const WAIT_MS = Number(process.env.M5_GESTURE_WAIT_MS ?? 300_000);

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
};

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!existsSync(join(EXT, "manifest.json"))) refuse(`no built host at ${EXT} (run: npm run build -w @pratibimb/extension)`);

const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
const workerSource = readFileSync(join(EXT, "background.js"), "utf8");
const hostPermissions = manifest.host_permissions ?? [];
if (hostPermissions.includes("<all_urls>")) refuse("this build carries <all_urls>; rebuild WITHOUT M3_WORKER_FRAME=1");
if (workerSource.includes("tabs.captureVisibleTab")) refuse("this build contains captureVisibleTab; it is the degraded build");
const buildHash = createHash("sha256").update(workerSource).digest("hex");

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const leaks = (anything) => {
  const text = typeof anything === "string" ? anything : JSON.stringify(anything ?? null);
  return FIXTURE_VALUES.filter((value) => text.includes(value));
};
const carriesPixels = (anything) => {
  const text = typeof anything === "string" ? anything : JSON.stringify(anything ?? null);
  return text.includes("iVBORw0KGgo") || text.includes("data:image") || /[A-Za-z0-9+/]{200,}/.test(text);
};

let context = null;
let stopServer = null;
let service = null;
let failure = null;
const acts = {};
let workerTraffic = null;

try {
  const { server, origin } = await startDemoServer(8975);
  stopServer = () => new Promise((ok) => server.close(ok));
  const fixtureUrl = `${origin}/fixture/`;

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-m5-acts-")), {
    headless: false,
    executablePath,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
  await worker.evaluate(() => globalThis.__host.ensureOffscreen());

  const page = await context.newPage();
  await page.addInitScript(installProbe);
  await page.goto(fixtureUrl, { waitUntil: "load" });
  await page.waitForSelector("#submit");

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
      if ((await worker.evaluate(() => globalThis.__host.hellos.length)) > before) break;
      await wait(250);
    }
    return attestedNow();
  };

  /**
   * Stop, and wait for a person.
   *
   * The reload above revoked whatever grant the previous act had — Chrome does that, and the
   * capture authority mirrors it — so each act is authorised on its own.
   */
  const waitForGesture = async (identity, act) => {
    const before = await worker.evaluate(() => globalThis.__host.captureState().grants.length);
    console.log(`\n  ┌─ ${act} ─────────────────────────────────────────────────────────────┐`);
    console.log("  │  Click the extension's toolbar button on the fixture tab.          │");
    console.log("  │  (Puzzle-piece menu → \"PratiBimb: perceive this tab\" if unpinned.)  │");
    console.log("  └────────────────────────────────────────────────────────────────────┘");
    const started = Date.now();
    while (Date.now() - started < WAIT_MS) {
      const state = await worker.evaluate(() => globalThis.__host.captureState());
      if (state.grants.length > before && state.grants.some((g) => g.tabId === identity.tabId)) {
        console.log(`  ✓ authorised after ${Date.now() - started} ms`);
        return { at: Date.now(), waitedMs: Date.now() - started };
      }
      await wait(500);
    }
    throw new Error(`${act}: no invocation arrived within ${WAIT_MS} ms`);
  };

  const runAct = async (act, identity, endpoint) => {
    const request = {
      tabId: identity.tabId,
      frameId: identity.frameId,
      goal: GOAL,
      act,
      endpoint,
      sessionId: `m5-${act.toLowerCase()}-session`,
      requestId: `m5-${act.toLowerCase()}-request`,
    };
    await worker.evaluate((req) => {
      globalThis.__m5 = null;
      globalThis.__m5error = null;
      void globalThis.__host.runTask(req).then(
        (result) => (globalThis.__m5 = result),
        (error) => (globalThis.__m5error = String(error))
      );
      return true;
    }, request);

    let grantAsked = null;
    let decided = false;
    for (let tick = 0; tick < 600; tick += 1) {
      const state = await worker.evaluate(async () => ({
        settled: globalThis.__m5 !== null || globalThis.__m5error !== null,
        grant: await globalThis.__host.grantPeek(),
      }));
      if (state.grant?.pending && !decided) {
        grantAsked = state.grant.pending;
        decided = true;
        await worker.evaluate(() => globalThis.__host.grantDecide(true));
      }
      if (state.settled) {
        const settled = await worker.evaluate(() => ({ outcome: globalThis.__m5, error: globalThis.__m5error }));
        return { ...settled, grantAsked };
      }
      await wait(250);
    }
    return { outcome: null, error: "TIMED_OUT_AFTER_150s", grantAsked };
  };

  const pageTruth = () =>
    page.evaluate(() => ({
      confirmValue: document.getElementById("mobile_confirm")?.value ?? null,
      submitted: document.getElementById("status")?.dataset.submitted ?? null,
      submitEvents: (window.__submitEvents ?? []).map((e) => `${e.type}@${e.x},${e.y}`),
      probe: window.__probe ?? null,
    }));

  const pageAudit = (identity) =>
    worker.evaluate(({ tabId, frameId }) => globalThis.__host.pageAudit(tabId, frameId), {
      tabId: identity.tabId,
      frameId: identity.frameId,
    });

  console.log(`\nM5 — three acts on the REAL GESTURE STREAM, ${WS.id}. Three clicks, one per act.\n`);

  for (const [act, mode] of [
    ["SUCCESS", "forward"],
    ["REFUSAL", "hostile"],
    ["OUTAGE", null],
  ]) {
    if (mode) service = await startReasonerService({ mode, port: REASONER_PORT, literal: REGISTERED });
    const identity = await freshDocument();
    const gesture = await waitForGesture(identity, act);
    const run = await runAct(act, identity, REASONER_URL);
    acts[act] = {
      ...run,
      gesture,
      page: await pageTruth(),
      audit: await pageAudit(identity),
      served: service?.captures.length ?? 0,
      leaked: leaks(service?.captures ?? []),
    };
    if (service) {
      await service.stop();
      service = null;
    }
    const r = acts[act].outcome?.result;
    const p = r?.ports?.perception?.[0];
    console.log(
      `  ${act}: state=${r?.record?.state} verify=${r?.record?.act?.verification?.verification ?? "—"} ` +
        `route=${p?.route} ${p?.capture?.w}x${p?.capture?.h} ${p?.capture?.format} ` +
        `det=${p?.detector?.detections} rel=${r?.boundary?.releases} wr=${r?.boundary?.writes} ` +
        `ms=${JSON.stringify(p?.ms)}`
    );
  }

  workerTraffic = await worker.evaluate((values) => {
    const seen = globalThis.__host.seen;
    const text = JSON.stringify(seen);
    const kinds = {};
    for (const entry of seen) {
      const kind = `${entry.way}:${entry.message?.kind ?? entry.message?.body?.kind ?? entry.message?.op ?? "?"}`;
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    }
    return {
      messages: seen.length,
      bytes: text.length,
      kinds,
      matchedValueIndexes: values.map((v, i) => (text.includes(v) ? i : -1)).filter((i) => i >= 0),
      pngSignature: text.includes("iVBORw0KGgo"),
      dataImageUrl: text.includes("data:image"),
      longestBase64Run: (text.match(/[A-Za-z0-9+/]{200,}/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0),
    };
  }, FIXTURE_VALUES);
} catch (error) {
  failure = `${error.name}: ${String(error.message).slice(0, 400)}`;
  console.error(`\n  FAILED: ${failure}`);
} finally {
  if (service) await service.stop().catch(() => {});
  if (context) await context.close();
  if (typeof stopServer === "function") await stopServer();
}

const resultOf = (act) => acts[act]?.outcome?.result ?? null;
const recordOf = (act) => resultOf(act)?.record ?? null;
const perceptionOf = (act) => resultOf(act)?.ports?.perception ?? [];
const seenBy = (act) => attribute(acts[act]?.page?.probe, acts[act]?.audit?.transport?.fires ?? []);
const routesSeen = [...new Set(["SUCCESS", "REFUSAL", "OUTAGE"].flatMap((a) => perceptionOf(a).map((p) => p.route).filter(Boolean)))];
const routeCategory = routesSeen.length > 0 && routesSeen.every((r) => r === "GESTURE_STREAM") ? "REAL_GESTURE_STREAM" : "MIXED_OR_DEGRADED";

const checks = {
  everyActWasAuthorisedByAPerson: ["SUCCESS", "REFUSAL", "OUTAGE"].every((a) => typeof acts[a]?.gesture?.at === "number"),
  everyCaptureUsedTheStreamRoute: routeCategory === "REAL_GESTURE_STREAM",
  noFrameWasEverEncoded: ["SUCCESS", "REFUSAL", "OUTAGE"].every((a) =>
    perceptionOf(a).every((p) => !p.ran || (p.ms.encode === 0 && p.capture?.format === "live-bitmap"))
  ),

  successReachedTheEnd: recordOf("SUCCESS")?.state === "DONE",
  successWasConfirmed: recordOf("SUCCESS")?.act?.verification?.verification === "CONFIRMED",
  successDidNotFallBack: recordOf("SUCCESS")?.fallback?.fellBack !== true,
  successReleasedOnce: resultOf("SUCCESS")?.boundary?.releases === 1 && resultOf("SUCCESS")?.boundary?.writes === 1,
  successClickedOnce:
    acts.SUCCESS?.audit?.transport?.firesStarted === 1 && (acts.SUCCESS?.page?.submitEvents?.length ?? -1) === SEQUENCE_LENGTH,
  successRestoredTheRightValue: acts.SUCCESS?.page?.confirmValue === REGISTERED,
  successPerceivedVisually: (perceptionOf("SUCCESS")[0]?.detector?.detections ?? 0) > 0,

  refusalWasRefused: recordOf("REFUSAL")?.state === "REFUSED",
  refusalBlockedAtTheLiteral: recordOf("REFUSAL")?.refusal?.stage === "VALIDATE_PLAN",
  refusalNeverAskedAHuman: acts.REFUSAL?.grantAsked == null,
  refusalReleasedNothing: resultOf("REFUSAL")?.boundary?.releases === 0 && resultOf("REFUSAL")?.boundary?.writes === 0,
  refusalClickedNothing: (acts.REFUSAL?.audit?.transport?.firesStarted ?? -1) === 0 && (acts.REFUSAL?.page?.submitEvents?.length ?? -1) === 0,
  refusalDidNotFallBack: recordOf("REFUSAL")?.fallback?.fellBack !== true,

  outageReachedTheEnd: recordOf("OUTAGE")?.state === "DONE",
  outageWasConfirmed: recordOf("OUTAGE")?.act?.verification?.verification === "CONFIRMED",
  outageFellBack: recordOf("OUTAGE")?.fallback?.fellBack === true,
  outageReleasedOnce: resultOf("OUTAGE")?.boundary?.releases === 1 && resultOf("OUTAGE")?.boundary?.writes === 1,
  outageClickedOnce: acts.OUTAGE?.audit?.transport?.firesStarted === 1,

  everyObservedEventIsOurs: ["SUCCESS", "OUTAGE"].every(
    (a) => seenBy(a).untrusted === SEQUENCE_LENGTH && seenBy(a).trusted === 0 && seenBy(a).unattributed === 0
  ),

  noValueInAnyWorkerMessage: workerTraffic?.matchedValueIndexes?.length === 0,
  noPixelsInAnyWorkerMessage:
    workerTraffic?.pngSignature === false && workerTraffic?.dataImageUrl === false && (workerTraffic?.longestBase64Run ?? 1) < 200,
  noValueInTheHandoffThatWasSent: ["SUCCESS", "REFUSAL", "OUTAGE"].every((a) => leaks(recordOf(a)?.handoffSerialized ?? "").length === 0),
  noPixelsInTheHandoffThatWasSent: ["SUCCESS", "REFUSAL", "OUTAGE"].every((a) => !carriesPixels(recordOf(a)?.handoffSerialized ?? "")),
  nothingLeakedToTheReasoner: (acts.SUCCESS?.leaked?.length ?? 1) === 0 && (acts.REFUSAL?.leaked?.length ?? 1) === 0,
  noPixelsInTheRunRecords: ["SUCCESS", "REFUSAL", "OUTAGE"].every((a) => !carriesPixels(resultOf(a))),
  theTextTierReportedItsAbsence: ["SUCCESS", "OUTAGE"].every((a) =>
    perceptionOf(a).every((p) => !p.ran || p.text?.available === false)
  ),
};

const failed = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k);
const passed = failure === null && failed.length === 0;

const record = {
  experiment: "M5-gesture-loop / three acts on the real gesture stream",
  status: passed ? "EXPERIMENTALLY VERIFIED (HUMAN-IN-THE-LOOP)" : "NOT VERIFIED",
  humanInTheLoop: true,
  routeCategory,
  routesSeen,
  invocationMethod:
    "a person clicked the extension's toolbar action once per act; Chrome revokes activeTab on " +
    "navigation and each act begins with a fresh document, so each act was authorised separately",
  claim:
    "the complete product loop — capture, local perception, fusion, sanitization, reasoner, plan, " +
    "validation, human authorization, capability release, local rehydration, one guarded click and " +
    "result verification — on frames a person authorised, obtained through an opaque handle the " +
    "worker could not read",
  notAClaim: [
    "not automated, and not claimed to be",
    "one operator, one click per act, one page, one browser cell",
    "detector numbers remain CONDITIONAL; no accuracy claim",
    "no local text perception: the tier reports its own absence",
    "no claim of production readiness",
  ],
  build: { hostPermissions, backgroundSha256: buildHash },
  recordedAt: new Date().toISOString(),
  provenance: {
    ...provenanceOf(WS),
    os: `${process.platform} ${osRelease()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    node: process.version,
    playwright: require2("playwright/package.json").version,
    browserBinary: executablePath,
    headless: false,
    extensionPath: EXT,
    reasonerAddress: REASONER_URL,
  },
  verdict: passed ? "PASS" : "FAIL",
  failure,
  failedChecks: failed,
  checks,
  acts,
  workerTraffic,
};

mkdirSync(OUT, { recursive: true });
const file = join(OUT, evidenceFileName(WS, "cft153-gesture-acts.json"));
assertOwnEvidencePath(file, WS);
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`\n${passed ? "PASS" : "FAIL"}  three acts on ${routeCategory}  on ${WS.host} (${WS.id})  [HUMAN-IN-THE-LOOP]`);
for (const [name, value] of Object.entries(checks)) console.log(`  ${value === true ? "PASS" : "FAIL"}  ${name}`);
if (workerTraffic) {
  console.log(
    `\n  worker: ${workerTraffic.messages} messages, ${workerTraffic.bytes} bytes, ` +
      `values ${workerTraffic.matchedValueIndexes.length}, png ${workerTraffic.pngSignature}, base64 ${workerTraffic.longestBase64Run}`
  );
}
console.log(`\nwritten: ${file}`);
process.exit(passed ? 0 : 1);
