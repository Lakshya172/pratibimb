#!/usr/bin/env node
/**
 * M1 — THE PRODUCT LOOP, THROUGH THE REAL MV3 EXTENSION.
 *
 * WHAT THIS DRIVES. A real page in a real tab, read by the content script, routed by the service
 * worker, reasoned about in the offscreen document by the shipped orchestrator, privacy layer,
 * planner, reasoner client and egress guard, restored by a one-shot capability, clicked through
 * `guardedAct`, and verified by reading the page back. No iframe, no `PageAdapter`, no mock.
 *
 * THE THREE ACTS DIFFER BY ONE THING: what is listening at the reasoner's address. An honest front
 * proxying a real local model, a hostile front that answers with a value the client never sent, or
 * nothing at all. The address is the same in all three because the manifest pins `connect-src` to
 * one loopback origin. Nothing in the extension is told which act is running.
 *
 * WHAT IT ALSO PROVES, and this is the half that matters more: the value's path. The harness never
 * learns the nonce of a real run -- it cannot, because the core realm mints it and the page collects
 * it -- so the release tests here use the E6 arming hook against the same authority, and check the
 * four ways a capability must fail in a real browser: forged, reused, wrong document, wrong tab.
 * Then it asks the page itself to try, from the page's own world, and watches it fail.
 *
 * WHAT IT DOES NOT PROVE. One run of each act on one machine in one browser cell. That is
 * EXPERIMENTALLY VERIFIED, never PROVEN. And the field values the privacy layer works on are the
 * client's own synthetic details rather than values read from the page -- see the decision record.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-extension-loop.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, release as osRelease, tmpdir } from "node:os";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import { startReasonerService } from "../demo/reasoner-service.mjs";
import {
  assertOwnEvidencePath,
  evidenceFileName,
  provenanceOf,
  resolveWorkstation,
} from "../support/workstation.mjs";

const WS = resolveWorkstation();

const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M1-extension-loop", "logs");

const GOAL = "Submit my application with my registered mobile number.";

/**
 * The reasoner's address. The manifest's one pinned `connect-src` origin, so the offscreen document
 * may reach it at all. The acts share it and differ in what answers there.
 */
const REASONER_PORT = 8995;
const REASONER_URL = `http://127.0.0.1:${REASONER_PORT}/v1/chat/completions`;

/**
 * The fixture's synthetic values, named here so the harness can assert their ABSENCE from everything
 * that left the device and everything that crossed the worker (SECURITY.md §2). The phone number is
 * also what the hostile service is handed, because it cannot obtain it any other way -- which is the
 * evidence, not a weakness.
 */
const REGISTERED = "9000000001";
const FIXTURE_VALUES = [REGISTERED, "Ramesh Kumar", "2345 6789 0124", "234567890124", "1998-04-12", "482913"];

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
};

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!existsSync(join(EXT, "manifest.json"))) refuse(`no built host at ${EXT} (run: npm run build -w @pratibimb/extension)`);

const userDataDir = mkdtempSync(join(tmpdir(), "pratibimb-m1-loop-"));
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** Does any of the synthetic values appear anywhere in this? */
const leaks = (anything) => {
  const text = typeof anything === "string" ? anything : JSON.stringify(anything ?? null);
  return FIXTURE_VALUES.filter((value) => text.includes(value));
};

let context = null;
let stopServer = null;
let service = null;
let failure = null;

const acts = {};
const releaseTests = {};
let pageForgery = null;

try {
  const { server, origin } = await startDemoServer(8975);
  stopServer = () => new Promise((ok) => server.close(ok));
  const fixtureUrl = `${origin}/fixture/`;

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
  await worker.evaluate(() => globalThis.__host.ensureOffscreen());
  const extensionId = await worker.evaluate(() => chrome.runtime.id);

  const page = await context.newPage();
  await page.goto(fixtureUrl, { waitUntil: "load" });
  await page.waitForSelector("#submit");

  /** The browser's attestation of the content script in this tab, after whatever just happened to it. */
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

  /** A fresh document, so no binding, capability or permit from the previous act could still apply. */
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

  /**
   * Run one act, answering the approval when it is asked for.
   *
   * The run is started without waiting, because it parks on the human and would otherwise deadlock
   * the evaluate that started it. The operator's answer goes in through the worker's control plane,
   * which is the automated stand-in for a person -- exactly what the demo rehearsal's `auto` mode is,
   * and M1 claims nothing more for it.
   */
  const runAct = async (act, identity, endpoint) => {
    const request = {
      tabId: identity.tabId,
      frameId: identity.frameId,
      goal: GOAL,
      act,
      endpoint,
      sessionId: `m1-${act.toLowerCase()}-session`,
      requestId: `m1-${act.toLowerCase()}-request`,
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
    for (let tick = 0; tick < 600; tick += 1) {
      // Booleans while polling: the record is large and fetching it every 250 ms would be noise.
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
      await wait(250);
    }
    return { outcome: null, error: "TIMED_OUT_AFTER_150s", grantAsked };
  };

  /** What the page itself shows, read directly. The harness's own eyes, not the extension's. */
  const pageTruth = () =>
    page.evaluate(() => ({
      confirmValue: document.getElementById("mobile_confirm")?.value ?? null,
      submitted: document.getElementById("status")?.dataset.submitted ?? null,
      statusText: document.getElementById("status")?.textContent ?? null,
      submitEvents: (window.__submitEvents ?? []).map((event) => event.type),
      submitDisabled: document.getElementById("submit")?.disabled ?? null,
    }));

  // ── ACT 1 — SUCCESS: a real local model answers ─────────────────────────────────────────────
  {
    service = await startReasonerService({ mode: "forward", port: REASONER_PORT });
    const identity = await freshDocument();
    const run = await runAct("SUCCESS", identity, REASONER_URL);
    acts.SUCCESS = { ...run, page: await pageTruth(), served: service.captures.length, leaked: leaks(service.captures) };
    await service.stop();
    service = null;
  }

  // ── ACT 2 — REFUSAL: the reasoner answers with the secret itself ────────────────────────────
  {
    service = await startReasonerService({ mode: "hostile", port: REASONER_PORT, literal: REGISTERED });
    const identity = await freshDocument();
    const run = await runAct("REFUSAL", identity, REASONER_URL);
    acts.REFUSAL = { ...run, page: await pageTruth(), served: service.captures.length, leaked: leaks(service.captures) };
    await service.stop();
    service = null;
  }

  // ── ACT 3 — OUTAGE: nothing is listening at that address ────────────────────────────────────
  {
    const identity = await freshDocument();
    const run = await runAct("OUTAGE", identity, REASONER_URL);
    acts.OUTAGE = { ...run, page: await pageTruth(), served: 0, leaked: [] };
  }

  // ── THE CAPABILITY, IN A REAL BROWSER ───────────────────────────────────────────────────────
  //
  // A real run's nonce never reaches this harness, which is the design working. So these use the E6
  // arming hook, which since this milestone goes through the same authority and the same refusals.
  {
    const identity = await freshDocument();
    const rehydrate = (tabId, nonce, target) =>
      worker.evaluate(({ tabId: t, nonce: n, target: g }) => globalThis.__host.toTab(t, { kind: "REHYDRATE", nonce: n, target: g }), {
        tabId,
        nonce,
        target,
      });

    // 1. A nonce nobody armed.
    releaseTests.forgedNonce = await rehydrate(identity.tabId, `forged-${Date.now()}`, "#mobile_confirm");

    // 2. Armed, used, and used again.
    const armed = await worker.evaluate(({ tabId }) => globalThis.__host.e6Arm(tabId, 30_000, "#mobile_confirm"), {
      tabId: identity.tabId,
    });
    releaseTests.firstUse = await rehydrate(identity.tabId, armed.nonce, "#mobile_confirm");
    releaseTests.secondUse = await rehydrate(identity.tabId, armed.nonce, "#mobile_confirm");

    // 3. Armed for this document, presented by the one that replaces it.
    const stale = await worker.evaluate(({ tabId }) => globalThis.__host.e6Arm(tabId, 30_000, "#mobile_confirm"), {
      tabId: identity.tabId,
    });
    const afterReload = await freshDocument();
    releaseTests.wrongDocument = {
      armedFor: stale.documentId,
      presentedBy: afterReload.documentId,
      documentChanged: stale.documentId !== afterReload.documentId,
      ...(await rehydrate(identity.tabId, stale.nonce, "#mobile_confirm")),
    };

    // 4. Armed for this tab, presented by another one.
    const second = await context.newPage();
    await second.goto(fixtureUrl, { waitUntil: "load" });
    await second.waitForSelector("#submit");
    await wait(1_000);
    const otherTab = await worker.evaluate(() => {
      const last = [...globalThis.__host.hellos].reverse()[0];
      return last ? last.identity : null;
    });
    // Armed for the second tab, then presented by the first: a different tab entirely.
    const forOtherTab = await worker.evaluate(({ tabId }) => globalThis.__host.e6Arm(tabId, 30_000, "#mobile_confirm"), {
      tabId: otherTab.tabId,
    });
    releaseTests.wrongTab = {
      armedForTab: otherTab.tabId,
      presentedByTab: identity.tabId,
      differentTab: otherTab.tabId !== identity.tabId,
      ...(await rehydrate(identity.tabId, forOtherTab.nonce, "#mobile_confirm")),
    };
    await second.close();

    // 5. The page's own world tries to ask the core realm directly.
    pageForgery = await page.evaluate(async (id) => {
      const sendMessage = globalThis.chrome?.runtime?.sendMessage;
      if (typeof sendMessage !== "function") return { reachable: false, why: "NO_SEND_MESSAGE_IN_PAGE_WORLD" };
      try {
        const reply = await globalThis.chrome.runtime.sendMessage(id, {
          target: "offscreen",
          kind: "VALUE_RELEASE",
          nonce: "page-forged",
          field: "#mobile_confirm",
        });
        return { reachable: reply !== undefined, reply: reply ?? null };
      } catch (error) {
        return { reachable: false, why: String(error?.message ?? error).slice(0, 120) };
      }
    }, extensionId);
  }
} catch (error) {
  failure = `${error.name}: ${String(error.message).slice(0, 400)}`;
} finally {
  if (service) await service.stop().catch(() => {});
  if (context) await context.close();
  if (typeof stopServer === "function") await stopServer();
}

// ── what the run is allowed to claim ────────────────────────────────────────────────────────

const recordOf = (act) => acts[act]?.outcome?.result?.record ?? null;
const resultOf = (act) => acts[act]?.outcome?.result ?? null;
const verificationOf = (act) => recordOf(act)?.act?.verification?.verification ?? null;
const submitEventsOf = (act) => acts[act]?.page?.submitEvents?.length ?? -1;

/**
 * Everything that CROSSED A BOUNDARY, which is not the same as everything the harness saw.
 *
 * The harness reads the page directly, as a person watching the screen does, and after a successful
 * restoration the field on screen holds the number — that is the run working, not a leak. What must
 * contain no value is what left the core realm: the run's record, the approval a human was shown,
 * and every answer the release path gave.
 */
const everythingThatCrossed = JSON.stringify({
  runResults: Object.fromEntries(Object.entries(acts).map(([id, a]) => [id, { outcome: a.outcome, error: a.error, grantAsked: a.grantAsked }])),
  releaseTests,
  pageForgery,
});

const checks = {
  // The loop ran where M1 says it must, over the path the observation leg proved.
  successReachedTheEnd: recordOf("SUCCESS")?.state === "DONE",
  successWasConfirmed: verificationOf("SUCCESS") === "CONFIRMED",
  successDidNotFallBack: recordOf("SUCCESS")?.fallback?.fellBack !== true,
  successAskedAHuman: acts.SUCCESS?.grantAsked != null,
  successRestoredOneValue: recordOf("SUCCESS")?.rehydrated?.length === 1 && recordOf("SUCCESS")?.rehydrated?.[0]?.inserted === true,
  successClickedOnce: submitEventsOf("SUCCESS") === 5,
  successSubmittedThePage: acts.SUCCESS?.page?.submitted === "true",
  successRestoredTheRightValue: acts.SUCCESS?.page?.confirmValue === REGISTERED,

  // The refusal: blocked before a human was asked, with nothing released and nothing clicked.
  // Refused, and refused for the RIGHT reason. An earlier stage failing would refuse too, and would
  // prove nothing about the literal check that act two exists to demonstrate.
  refusalWasRefused: recordOf("REFUSAL")?.state === "REFUSED",
  refusalWasBlockedAtTheLiteral:
    recordOf("REFUSAL")?.refusal?.stage === "VALIDATE_PLAN" &&
    recordOf("REFUSAL")?.validation?.refusal?.literalSeverity === "LEAKAGE_EVENT",
  refusalSanitizedAndSent: (recordOf("REFUSAL")?.handoffSerialized?.length ?? 0) > 0,
  refusalNeverAskedAHuman: acts.REFUSAL?.grantAsked == null,
  refusalArmedNothing: resultOf("REFUSAL")?.ports?.armed === 0,
  refusalRestoredNothing: (recordOf("REFUSAL")?.rehydrated?.length ?? -1) === 0,
  refusalClickedNothing: submitEventsOf("REFUSAL") === 0,
  refusalLeftTheFieldEmpty: acts.REFUSAL?.page?.confirmValue === "",
  refusalDidNotFallBack: recordOf("REFUSAL")?.fallback?.fellBack !== true,

  // The outage: the same gates, a different planner, the same ending.
  outageReachedTheEnd: recordOf("OUTAGE")?.state === "DONE",
  outageWasConfirmed: verificationOf("OUTAGE") === "CONFIRMED",
  outageFellBack: recordOf("OUTAGE")?.fallback?.fellBack === true,
  outageAskedAHuman: acts.OUTAGE?.grantAsked != null,
  outageRestoredOneValue: recordOf("OUTAGE")?.rehydrated?.length === 1,
  outageSubmittedThePage: acts.OUTAGE?.page?.submitted === "true",

  // The capability, in a real browser.
  forgedNonceRefused: releaseTests.forgedNonce?.written === false && releaseTests.forgedNonce?.refused === "UNKNOWN_OR_CONSUMED_NONCE",
  armedCapabilityWorksOnce: releaseTests.firstUse?.written === true,
  reusedNonceRefused: releaseTests.secondUse?.written === false && releaseTests.secondUse?.refused === "UNKNOWN_OR_CONSUMED_NONCE",
  wrongDocumentRefused:
    releaseTests.wrongDocument?.documentChanged === true &&
    releaseTests.wrongDocument?.written === false &&
    releaseTests.wrongDocument?.refused === "SENDER_DOCUMENT_MISMATCH",
  wrongTabRefused:
    releaseTests.wrongTab?.differentTab === true &&
    releaseTests.wrongTab?.written === false &&
    releaseTests.wrongTab?.refused === "SENDER_DOCUMENT_MISMATCH",
  pageCannotReachTheCoreRealm: pageForgery?.reachable === false,

  // The value's path, end to end.
  noValueInAnythingTheHarnessSaw: leaks(everythingThatCrossed).length === 0,
  nothingLeakedToTheReasoner: (acts.SUCCESS?.leaked?.length ?? 1) === 0 && (acts.REFUSAL?.leaked?.length ?? 1) === 0,
};

const passed = failure === null && Object.values(checks).every(Boolean);

const record = {
  experiment: "M1 — the product loop through the real MV3 extension",
  verdict: passed ? "PASS" : "FAIL",
  status: passed ? "EXPERIMENTALLY VERIFIED (one run of each act, one fixture, one browser cell)" : "FAIL",
  claim:
    "a real page in a real tab is observed, sanitized, reasoned about, validated, approved by a human, " +
    "rehydrated through a one-shot capability and clicked through guardedAct, entirely inside the MV3 " +
    "extension, with the value never present in a service-worker message",
  notAClaim: [
    "the field values the privacy layer works on are the client's own synthetic details, NOT values read from the page — see decision.md",
    "the human's answer comes from the harness through the worker's control plane, exactly as the demo rehearsal's auto mode does; no human-facing grant surface was built in M1",
    "one run of each act on one machine in one browser cell is not a benchmark and not a reliability claim",
    "no visual perception, capture, detector, OCR or pixel redaction took part",
  ],
  loopExercisedThroughExtension: true,
  checks,
  failure,
  acts,
  releaseTests,
  pageForgery,
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
};

mkdirSync(OUT, { recursive: true });
const target = assertOwnEvidencePath(join(OUT, evidenceFileName(WS, "cft153-extension-loop.json")), WS);
writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`\n${record.verdict}  the product loop through the extension  on ${record.provenance.host} (${WS.id})`);
for (const [name, ok] of Object.entries(checks)) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
if (failure) console.log(`  failure: ${failure}`);
for (const act of ["SUCCESS", "REFUSAL", "OUTAGE"]) {
  const run = recordOf(act);
  console.log(`  ${act}: state=${run?.state ?? "—"} verify=${verificationOf(act) ?? "—"} clicks=${submitEventsOf(act)} rehydrated=${run?.rehydrated?.length ?? "—"}`);
}
console.log(`written: ${target}`);
process.exit(passed ? 0 : 1);
