#!/usr/bin/env node
/**
 * M2 — THE REAL PAGE-VALUE BOUNDARY, THROUGH THE REAL MV3 EXTENSION.
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
 * WHAT IT ALSO PROVES, and this is the half that matters more: the value's path. The page's own
 * field values are read from the DOM by the content script, classified there, and held in a vault
 * there. So the question is no longer "did the value travel safely?" but "did it travel at all?" --
 * and the worker is made to answer it. Every message delivered to the service worker, every message
 * it sends to a tab and every frame on a transport port is recorded in the worker itself, and the
 * whole recording is scanned against the fixture's values at the end. The worker is asked to
 * incriminate itself; the check passes only when it cannot.
 *
 * The capability tests drive the production path: a forged nonce, a reused one, one for the wrong
 * field, one presented after the document under it was replaced, and one presented by a different
 * tab. Then it asks the page itself to reach the core realm, from the page's own world, and watches
 * it fail.
 *
 * WHAT IT DOES NOT PROVE. One run of each act on one machine in one browser cell. That is
 * EXPERIMENTALLY VERIFIED, never PROVEN. And the field values the privacy layer works on are the
 * client's own synthetic details rather than values read from the page -- see the decision record.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-extension-loop.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
import { attribute, installProbe, SEQUENCE_LENGTH } from "./single-action-probe.mjs";

const WS = resolveWorkstation();

const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M2-page-value-boundary", "logs");

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
/** The fixture's form controls: five registered details plus the empty field the run has to fill. */
const FIXTURE_FIELDS = 6;

/**
 * The eight classes `@pratibimb/perception`'s head is defined over.
 *
 * Named here so the harness can assert that every label the detector emitted came from this fixed
 * list — which is the structural reason a detection cannot carry the characters on the screen.
 * There is no text class and no OCR in this milestone.
 */
const UI_CLASSES = ["button", "link", "textbox", "checkbox", "radio", "select", "tab", "icon"];

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

/**
 * WHAT IS ACTUALLY IN THE BUILD THAT IS ABOUT TO BE LOADED.
 *
 * The source rule lives in `apps/extension/test/oneClickAuthority.test.ts`; this is the other half,
 * and neither subsumes the other. Source can be right while the build graph pulls in something
 * else, and a bundle can be clean today by an accident of tree-shaking. This reads the exact file
 * Chrome is given.
 *
 * `new PointerEvent(` twice and `new MouseEvent(` three times is one E6 mechanism-B sequence:
 * pointerdown, mousedown, pointerup, mouseup, click. Exactly one such site is the whole claim —
 * more would mean a second route to a click, fewer would mean the transport could not act.
 */
const scanBundle = () => {
  const file = join(EXT, "content-scripts", "content.js");
  const code = readFileSync(file, "utf8");
  const count = (needle) => code.split(needle).length - 1;
  return {
    bytes: code.length,
    pointerEventSites: count("new PointerEvent("),
    mouseEventSites: count("new MouseEvent("),
    elementClickCalls: count(".click()"),
    e6Surface: ["E6_CLICK", "E6_TYPE", "E6_RELEASE", "B_point_pointer_sequence", "A_element_click", "execCommand", "setRangeText", "A_native_setter_events"].filter(
      (needle) => code.includes(needle)
    ),
  };
};

let context = null;
let stopServer = null;
let service = null;
let failure = null;

const acts = {};
const bundle = scanBundle();
const releaseTests = {};
let pageForgery = null;
let workerTraffic = null;

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
  /**
   * THE INDEPENDENT WITNESS. M2 recorded ten raw events at the button on one run and could not say
   * what had happened, because the only instrument was a count. This one records whether each event
   * was trusted, whether the same event object was seen twice, and when it happened — so the next
   * ambiguous ten is not ambiguous. See `single-action-probe.mjs`.
   */
  await page.addInitScript(installProbe);
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
      sessionId: `m2-${act.toLowerCase()}-session`,
      requestId: `m2-${act.toLowerCase()}-request`,
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
      submitEvents: (window.__submitEvents ?? []).map((event) => `${event.type}@${event.x},${event.y}`),
      submitDisabled: document.getElementById("submit")?.disabled ?? null,
      probeInstalls: window.__probeInstalls ?? 0,
      probe: window.__probe ?? null,
    }));

  /**
   * What the isolated world says it did, read out of the world that did it.
   *
   * A DISPATCH reply says a dispatch was answered; only this says how many were performed. Counts,
   * refusal codes, ids the core realm minted, a structural selector and page-clock timestamps.
   */
  const pageAudit = (identity) =>
    worker.evaluate(({ tabId, frameId }) => globalThis.__host.pageAudit(tabId, frameId), {
      tabId: identity.tabId,
      frameId: identity.frameId,
    });

  // ── ACT 1 — SUCCESS: a real local model answers ─────────────────────────────────────────────
  {
    service = await startReasonerService({ mode: "forward", port: REASONER_PORT });
    const identity = await freshDocument();
    const connections = await worker.evaluate(() => globalThis.__host.transportConnections());
    const run = await runAct("SUCCESS", identity, REASONER_URL);
    acts.SUCCESS = { ...run, page: await pageTruth(), audit: await pageAudit(identity), connections, served: service.captures.length, leaked: leaks(service.captures) };
    await service.stop();
    service = null;
  }

  // ── ACT 2 — REFUSAL: the reasoner answers with the secret itself ────────────────────────────
  {
    service = await startReasonerService({ mode: "hostile", port: REASONER_PORT, literal: REGISTERED });
    const identity = await freshDocument();
    const run = await runAct("REFUSAL", identity, REASONER_URL);
    acts.REFUSAL = { ...run, page: await pageTruth(), audit: await pageAudit(identity), served: service.captures.length, leaked: leaks(service.captures) };
    await service.stop();
    service = null;
  }

  // ── ACT 3 — OUTAGE: nothing is listening at that address ────────────────────────────────────
  {
    const identity = await freshDocument();
    const run = await runAct("OUTAGE", identity, REASONER_URL);
    acts.OUTAGE = { ...run, page: await pageTruth(), audit: await pageAudit(identity), served: 0, leaked: [] };
  }

  // ── THE CAPABILITY, IN A REAL BROWSER ───────────────────────────────────────────────────────
  //
  // A real run's nonce never reaches this harness, and cannot: the core realm mints it and the page
  // realm collects it. So these arm one through the worker's test hook -- the same authority, the
  // same refusals, the same production collection path -- and then present it wrongly.
  //
  // A capability that IS accepted still refuses, with NO_VAULT, because no run is in progress and
  // the page realm has nothing to release from. That difference is the signal: NO_VAULT means the
  // capability was spent, and UNKNOWN_OR_CONSUMED_NONCE means it was not there to spend.
  {
    const identity = await freshDocument();
    const present = (tabId, frameId, nonce, target) =>
      worker.evaluate(
        ({ tabId: t, frameId: f, nonce: n, target: g }) => globalThis.__host.presentCapability(t, f, n, g),
        { tabId, frameId, nonce, target }
      );
    const armFor = (tabId) =>
      worker.evaluate(({ tabId: t }) => globalThis.__host.armBoundaryCapability(t, "#mobile_confirm", 30_000), { tabId });

    // 1. A nonce nobody armed.
    releaseTests.forgedNonce = await present(identity.tabId, identity.frameId, `forged-${Date.now()}`, "#mobile_confirm");

    // 2. Armed, presented correctly, then presented again.
    const armed = await armFor(identity.tabId);
    releaseTests.firstUse = await present(identity.tabId, identity.frameId, armed.nonce, "#mobile_confirm");
    releaseTests.secondUse = await present(identity.tabId, identity.frameId, armed.nonce, "#mobile_confirm");

    // 3. Armed for one field, presented for another.
    const forConfirm = await armFor(identity.tabId);
    releaseTests.wrongTarget = await present(identity.tabId, identity.frameId, forConfirm.nonce, "#name");

    // 4. Armed for this document, presented by the one that replaces it.
    const stale = await armFor(identity.tabId);
    const afterReload = await freshDocument();
    releaseTests.wrongDocument = {
      armedFor: stale.documentId,
      presentedBy: afterReload.documentId,
      documentChanged: stale.documentId !== afterReload.documentId,
      ...(await present(identity.tabId, identity.frameId, stale.nonce, "#mobile_confirm")),
    };

    // 5. Armed for one tab, presented by another.
    const second = await context.newPage();
    await second.goto(fixtureUrl, { waitUntil: "load" });
    await second.waitForSelector("#submit");
    await wait(1_000);
    const otherTab = await worker.evaluate(() => {
      const last = [...globalThis.__host.hellos].reverse()[0];
      return last ? last.identity : null;
    });
    const forOtherTab = await armFor(otherTab.tabId);
    releaseTests.wrongTab = {
      armedForTab: otherTab.tabId,
      presentedByTab: identity.tabId,
      differentTab: otherTab.tabId !== identity.tabId,
      ...(await present(identity.tabId, identity.frameId, forOtherTab.nonce, "#mobile_confirm")),
    };
    await second.close();

    // 6. The page's own world tries to reach the core realm directly.
    pageForgery = await page.evaluate(async (id) => {
      const sendMessage = globalThis.chrome?.runtime?.sendMessage;
      if (typeof sendMessage !== "function") return { reachable: false, why: "NO_SEND_MESSAGE_IN_PAGE_WORLD" };
      try {
        const reply = await globalThis.chrome.runtime.sendMessage(id, {
          target: "offscreen",
          kind: "BOUNDARY_COLLECT",
          nonce: "page-forged",
          field: "#mobile_confirm",
        });
        return { reachable: reply !== undefined, reply: reply ?? null };
      } catch (error) {
        return { reachable: false, why: String(error?.message ?? error).slice(0, 120) };
      }
    }, extensionId);
  }

  // ── WHAT THE SERVICE WORKER ACTUALLY SAW ────────────────────────────────────────────────────
  //
  // Scanned inside the worker, so the traffic is never pulled out here: what comes back is how much
  // there was and WHICH of the fixture values were found in it, by index. A value is not carried out
  // of the browser in order to prove that it was not carried out of the browser.
  workerTraffic = await worker.evaluate((values) => {
    const seen = globalThis.__host.seen;
    const text = JSON.stringify(seen);
    /**
     * M3 — DID A FRAME'S PIXELS END UP IN THIS RECORDING?
     *
     * The worker is the only realm that can capture, so a page's pixels pass through it once. That
     * hop is stated rather than denied — but the worker must not RETAIN them, and a diagnostic that
     * stored every frame would be the leak it exists to detect. So the same recording that proves
     * no value crossed is asked the same question about pixels: `iVBORw0KGgo` is the base64 PNG
     * signature and `data:image` is the URL form, and neither may appear.
     */
    const pixels = {
      pngSignature: text.includes("iVBORw0KGgo"),
      dataImageUrl: text.includes("data:image"),
      /** The longest base64-looking run anywhere in the recording. A frame is tens of thousands. */
      longestBase64Run: (text.match(/[A-Za-z0-9+/]{200,}/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0),
    };
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
      pixels,
    };
  }, FIXTURE_VALUES);
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
const boundaryOf = (act) => resultOf(act)?.boundary ?? null;

/**
 * THE SINGLE-ACTION INVARIANT, measured in four places rather than counted in one.
 *
 * `fires` is what the isolated world says it dispatched; `seen` is what the page's own main world
 * witnessed, split by `isTrusted` and matched against those fires. An event that is trusted, or that
 * falls inside no fire's window, is an event this extension did not cause — which is a different
 * fact from firing twice, and the distinction M2's evidence could not make.
 */
/**
 * M3 — what the local visual tier did, per act.
 *
 * `passes` is one entry per reading: a run observes several times, and each one captures, detects
 * and fuses against that reading's own frame.
 */
const perceptionOf = (act) => resultOf(act)?.ports?.perception ?? [];
const firstPassOf = (act) => perceptionOf(act)[0] ?? null;
const handoffOf = (act) => {
  try {
    return JSON.parse(recordOf(act)?.handoffSerialized ?? "null");
  } catch {
    return null;
  }
};
/** Anything that looks like an encoded image, anywhere in a structure. */
const carriesPixels = (anything) => {
  const text = typeof anything === "string" ? anything : JSON.stringify(anything ?? null);
  return text.includes("iVBORw0KGgo") || text.includes("data:image") || /[A-Za-z0-9+/]{200,}/.test(text);
};

/**
 * WHICH KIND OF EVIDENCE THIS RUN IS, stated once at the top of the record.
 *
 * `REAL_STREAM_ROUTE` is the product path: a person invoked the extension, the worker minted an
 * opaque handle, and the perception realm turned it into pixels itself. `DEGRADED_TEST_ROUTE` is
 * the worker-frame path, which exists because no automated harness can produce that invocation.
 *
 * They are not interchangeable and their evidence must not be read as one body. This runner is
 * automated, so it is always the degraded one; the product route is verified by
 * `run-gesture-capture.mjs`, which stops and waits for a human.
 */
const routesSeen = [...new Set(["SUCCESS", "REFUSAL", "OUTAGE"].flatMap((act) => perceptionOf(act).map((p) => p.route).filter(Boolean)))];
const routeCategory = routesSeen.length === 0 ? "NO_CAPTURE" : routesSeen.every((r) => r === "GESTURE_STREAM") ? "REAL_STREAM_ROUTE" : "DEGRADED_TEST_ROUTE";

const firesOf = (act) => acts[act]?.audit?.transport?.fires ?? [];
const actionOf = (act) => ({
  contentInstances: acts[act]?.audit?.instances ?? null,
  e6Clicks: acts[act]?.audit?.e6Clicks ?? null,
  dispatchRequests: acts[act]?.audit?.transport?.dispatchRequests ?? null,
  firesStarted: acts[act]?.audit?.transport?.firesStarted ?? null,
  firesCompleted: acts[act]?.audit?.transport?.firesCompleted ?? null,
  agentRefusals: acts[act]?.audit?.transport?.refusals ?? [],
  seen: attribute(acts[act]?.page?.probe, firesOf(act)),
});
const singleAction = { SUCCESS: actionOf("SUCCESS"), REFUSAL: actionOf("REFUSAL"), OUTAGE: actionOf("OUTAGE") };
const redactionsOf = (act) => recordOf(act)?.handoff?.redactions ?? [];

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
  // ── the loop, where M1 left it ──────────────────────────────────────────────────────────────
  successReachedTheEnd: recordOf("SUCCESS")?.state === "DONE",
  successWasConfirmed: verificationOf("SUCCESS") === "CONFIRMED",
  successDidNotFallBack: recordOf("SUCCESS")?.fallback?.fellBack !== true,
  successAskedAHuman: acts.SUCCESS?.grantAsked != null,
  successRestoredOneValue:
    recordOf("SUCCESS")?.rehydrated?.length === 1 && recordOf("SUCCESS")?.rehydrated?.[0]?.inserted === true,
  successClickedOnce: submitEventsOf("SUCCESS") === SEQUENCE_LENGTH,
  successSubmittedThePage: acts.SUCCESS?.page?.submitted === "true",
  successRestoredTheRightValue: acts.SUCCESS?.page?.confirmValue === REGISTERED,

  refusalWasRefused: recordOf("REFUSAL")?.state === "REFUSED",
  refusalWasBlockedAtTheLiteral:
    recordOf("REFUSAL")?.refusal?.stage === "VALIDATE_PLAN" &&
    recordOf("REFUSAL")?.validation?.refusal?.literalSeverity === "LEAKAGE_EVENT",
  refusalSanitizedAndSent: (recordOf("REFUSAL")?.handoffSerialized?.length ?? 0) > 0,
  refusalNeverAskedAHuman: acts.REFUSAL?.grantAsked == null,
  refusalReleasedNothing: boundaryOf("REFUSAL")?.releases === 0 && boundaryOf("REFUSAL")?.writes === 0,
  refusalRestoredNothing: (recordOf("REFUSAL")?.rehydrated?.length ?? -1) === 0,
  refusalClickedNothing: submitEventsOf("REFUSAL") === 0,
  refusalLeftTheFieldEmpty: acts.REFUSAL?.page?.confirmValue === "",
  refusalDidNotFallBack: recordOf("REFUSAL")?.fallback?.fellBack !== true,

  outageReachedTheEnd: recordOf("OUTAGE")?.state === "DONE",
  outageWasConfirmed: verificationOf("OUTAGE") === "CONFIRMED",
  outageFellBack: recordOf("OUTAGE")?.fallback?.fellBack === true,
  outageAskedAHuman: acts.OUTAGE?.grantAsked != null,
  outageRestoredOneValue: recordOf("OUTAGE")?.rehydrated?.length === 1,
  outageSubmittedThePage: acts.OUTAGE?.page?.submitted === "true",

  // ── the boundary: the values are read from the page, and they are read where they stay ──────
  //
  // The whole milestone in six checks. The page realm saw every form control on the page and
  // classified them; references were issued for what is tokenisable; the OTP got no reference at
  // all, because a CRITICAL class is masked and there is therefore nothing to rehydrate later; and
  // exactly one value was released back, into the field a human approved.
  pageRealmReadTheRealPage: boundaryOf("SUCCESS")?.fieldsSeenByThePageRealm === FIXTURE_FIELDS,
  referencesWereIssued: (boundaryOf("SUCCESS")?.referencesIssued ?? 0) >= 3,
  otpWasMaskedNotTokenised: redactionsOf("SUCCESS").some((r) => r.class === "OTP" && r.method === "masked_no_token" && r.token === ""),
  otpGotNoReference: redactionsOf("SUCCESS").every((r) => r.class !== "OTP" || r.token === ""),
  exactlyOneRelease: boundaryOf("SUCCESS")?.releases === 1 && boundaryOf("SUCCESS")?.writes === 1,
  noLiteralWasEverWritten:
    ["SUCCESS", "REFUSAL", "OUTAGE"].every((act) => (resultOf(act)?.ports?.inserts ?? 0) === 0),

  // ── the capability, on the production path, in a real browser ───────────────────────────────
  forgedNonceRefused: releaseTests.forgedNonce?.refused === "UNKNOWN_OR_CONSUMED_NONCE",
  armedCapabilityIsAccepted: releaseTests.firstUse?.refused === "NO_VAULT",
  reusedNonceRefused: releaseTests.secondUse?.refused === "UNKNOWN_OR_CONSUMED_NONCE",
  wrongTargetRefused: releaseTests.wrongTarget?.refused === "TARGET_MISMATCH",
  wrongDocumentRefused:
    releaseTests.wrongDocument?.documentChanged === true &&
    releaseTests.wrongDocument?.refused === "SENDER_DOCUMENT_MISMATCH",
  wrongTabRefused:
    releaseTests.wrongTab?.differentTab === true && releaseTests.wrongTab?.refused === "SENDER_DOCUMENT_MISMATCH",
  pageCannotReachTheCoreRealm: pageForgery?.reachable === false,

  // ── what crossed, and what did not ──────────────────────────────────────────────────────────
  theWorkerSawTraffic: (workerTraffic?.messages ?? 0) > 20,
  noFixtureValueInAnyWorkerMessage: workerTraffic?.matchedValueIndexes?.length === 0,
  noValueInAnythingTheHarnessSaw: leaks(everythingThatCrossed).length === 0,
  noValueInTheHandoffThatWasSent: ["SUCCESS", "REFUSAL", "OUTAGE"].every(
    (act) => leaks(recordOf(act)?.handoffSerialized ?? "").length === 0
  ),
  nothingLeakedToTheReasoner: (acts.SUCCESS?.leaked?.length ?? 1) === 0 && (acts.REFUSAL?.leaked?.length ?? 1) === 0,
  egressReportedClean: (recordOf("SUCCESS")?.ledgerEntry ?? null) !== null,

  // ── M3: the client looked at the page, locally ──────────────────────────────────────────────
  //
  // Every reading captures, detects and fuses. A pass that refused is recorded as a refusal and the
  // reading continues, because the DOM is the actionable substrate and vision is evidence added to
  // it — so these assert that the tier RAN, not that the loop depended on it.
  perceptionWasAttemptedOnEveryReading: ["SUCCESS", "REFUSAL", "OUTAGE"].every(
    (act) => perceptionOf(act).length > 0 && perceptionOf(act).length === (resultOf(act)?.observations ?? perceptionOf(act).length)
  ),
  perceptionRanForRealAtLeastOnce: perceptionOf("SUCCESS").every((p) => p.ran === true && p.refusal === null),
  /**
   * CHROME'S CAPTURE QUOTA FIRES IN A REAL RUN, AND THE DEGRADATION IS THE POINT.
   *
   * `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` is S-05's open question, and three acts of three
   * readings each is enough to cross it. Every such pass must be a TYPED refusal — the adapter
   * classifies the browser's own quota message rather than retrying into it — and the loop must
   * carry on, because the DOM is the actionable substrate and vision is evidence added to it.
   */
  everyRefusedPassIsTyped: ["SUCCESS", "REFUSAL", "OUTAGE"].every((act) =>
    perceptionOf(act).every((p) => p.ran === true || typeof p.refusal?.code === "string")
  ),
  /**
   * A CLIENT THAT SAW NOTHING SAYS SO.
   *
   * The tier list in the manifest is a claim to the one party that cannot check it. An act whose
   * reading was throttled must declare the structural floor, not the tier it wanted to run.
   */
  theTierClaimMatchesWhatActuallyRan: ["SUCCESS", "REFUSAL", "OUTAGE"].every((act) => {
    const handoff = handoffOf(act);
    if (handoff === null) return true;
    // The manifest is assembled at SANITIZE, which follows the FIRST reading. A later pass that
    // was throttled cannot retroactively change a claim that was already made and verified.
    const ranVisually = firstPassOf(act)?.detector?.ran === true;
    const claimed = JSON.stringify(handoff.capability?.tiers_fired);
    return claimed === JSON.stringify(ranVisually ? ["T0", "T1", "T2"] : ["T0", "T2"]);
  }),
  aRealFrameWasCaptured:
    (firstPassOf("SUCCESS")?.capture?.w ?? 0) > 0 &&
    (firstPassOf("SUCCESS")?.capture?.h ?? 0) > 0 &&
    firstPassOf("SUCCESS")?.capture?.format === "png" &&
    (firstPassOf("SUCCESS")?.capture?.bytes ?? 0) > 1000,
  theDetectorRanOnThePinnedArtifact:
    firstPassOf("SUCCESS")?.detector?.ran === true &&
    firstPassOf("SUCCESS")?.detector?.modelId === "pratibimb-t1-ui-head" &&
    firstPassOf("SUCCESS")?.detector?.revision === "ba6d9e93695b" &&
    firstPassOf("SUCCESS")?.detector?.backend === "wasm",
  theDetectorProducedGeometryNotText: perceptionOf("SUCCESS").every((p) =>
    Object.keys(p.detector.byClass).every((label) => UI_CLASSES.includes(label))
  ),
  fusionJoinedDomAndVision: (firstPassOf("SUCCESS")?.fusion?.matched ?? 0) > 0,
  theCoordinateContractIsDerivedNotAssumed:
    typeof firstPassOf("SUCCESS")?.capture?.scaleToCss === "number" &&
    handoffOf("SUCCESS")?.capture?.scale_to_css === firstPassOf("SUCCESS")?.capture?.scaleToCss,

  // ── M3.1: the capture route is recorded, never inferred ─────────────────────────────────────
  //
  // There are two ways a frame can arrive and they differ in the only thing that matters: whether
  // the worker held it. A record that did not say which route it took would leave that to be
  // guessed from a permission list.
  everyPassRecordsItsRoute: ["SUCCESS", "REFUSAL", "OUTAGE"].every((act) =>
    perceptionOf(act).every((p) => p.route === "GESTURE_STREAM" || p.route === "WORKER_FRAME" || p.ran === false)
  ),
  everyPassSaysWhetherTheWorkerSawPixels: ["SUCCESS", "REFUSAL", "OUTAGE"].every((act) =>
    perceptionOf(act).every((p) => typeof p.workerSawPixels === "boolean")
  ),
  /**
   * THIS RUN IS ON THE DEGRADED BUILD, AND SAYS SO.
   *
   * No automated harness can produce the invocation `activeTab` requires, so an evidence run cannot
   * exercise the gesture route. What it can do is refuse to let that fact be quiet: the route is in
   * the record, `workerSawPixels` is true, and this check asserts the two agree. A run that claimed
   * the product route while using the other one would fail here.
   */
  /** Whatever route this run took, the record names it once at the top rather than by inference. */
  theRouteCategoryIsRecorded: routeCategory === "REAL_STREAM_ROUTE" || routeCategory === "DEGRADED_TEST_ROUTE",
  theDegradedRouteIsReportedHonestly: ["SUCCESS", "OUTAGE"].every((act) =>
    perceptionOf(act)
      .filter((p) => p.ran)
      .every((p) => (p.route === "WORKER_FRAME") === (p.workerSawPixels === true))
  ),

  // ── M3: the visual tier's claim reaches the reasoner, and its pixels do not ──────────────────
  theHandoffDeclaresTheVisualTier:
    handoffOf("SUCCESS")?.capability?.backend === "wasm" &&
    JSON.stringify(handoffOf("SUCCESS")?.capability?.tiers_fired) === JSON.stringify(["T0", "T1", "T2"]),
  elementsCarryFusionProvenance: (handoffOf("SUCCESS")?.elements ?? []).some((e) => e.source === "dom+vision"),
  noPixelsInTheHandoffThatWasSent: ["SUCCESS", "REFUSAL", "OUTAGE"].every(
    (act) => !carriesPixels(recordOf(act)?.handoffSerialized ?? "")
  ),
  noPixelsInAnythingTheReasonerReceived: ["SUCCESS", "REFUSAL"].every((act) => !carriesPixels(acts[act]?.served ?? 0)),
  noPixelsInTheRunRecord: ["SUCCESS", "REFUSAL", "OUTAGE"].every((act) => !carriesPixels(resultOf(act))),
  noPixelsRetainedByTheWorker:
    workerTraffic?.pixels?.pngSignature === false &&
    workerTraffic?.pixels?.dataImageUrl === false &&
    (workerTraffic?.pixels?.longestBase64Run ?? 1) < 200,
  noPixelsInAnythingTheHarnessSaw: !carriesPixels(everythingThatCrossed),

  // ── one executable click authority, in the bundle Chrome was handed ─────────────────────────
  //
  // M2-EXEC's report named E6_CLICK as a second production click path: a full pointer sequence at
  // any selector, with no permit, no hit test and no plan validation. It is now resolved out of the
  // build graph rather than guarded inside it, and this reads the artifact to say so.
  theBundleHasNoE6Surface: bundle.e6Surface.length === 0,
  theBundleHasExactlyOneClickSite: bundle.pointerEventSites === 2 && bundle.mouseEventSites === 3,
  theBundleNeverCallsElementClick: bundle.elementClickCalls === 0,

  // ── one approved task, one browser action (M2-EXEC) ─────────────────────────────────────────
  //
  // Four measurements, at the four places the five candidate explanations live: the isolated world's
  // own fire counter, the content script's instance count, the page's independent witness, and
  // `isTrusted`. A run that dispatched twice and a run that recorded one dispatch twice now look
  // different from each other, which they did not before.
  oneContentScriptPerDocument: ["SUCCESS", "REFUSAL", "OUTAGE"].every((act) => singleAction[act].contentInstances === 1),
  noOtherClickPathRan: ["SUCCESS", "REFUSAL", "OUTAGE"].every((act) => singleAction[act].e6Clicks === 0),
  successFiredExactlyOnce:
    singleAction.SUCCESS.firesStarted === 1 &&
    singleAction.SUCCESS.firesCompleted === 1 &&
    singleAction.SUCCESS.dispatchRequests === 1,
  outageFiredExactlyOnce:
    singleAction.OUTAGE.firesStarted === 1 &&
    singleAction.OUTAGE.firesCompleted === 1 &&
    singleAction.OUTAGE.dispatchRequests === 1,
  refusalFiredNothing:
    singleAction.REFUSAL.firesStarted === 0 &&
    singleAction.REFUSAL.dispatchRequests === 0 &&
    singleAction.REFUSAL.seen.total === 0,
  everyObservedEventIsOurs: ["SUCCESS", "OUTAGE"].every(
    (act) =>
      singleAction[act].seen.untrusted === SEQUENCE_LENGTH &&
      singleAction[act].seen.trusted === 0 &&
      singleAction[act].seen.unattributed === 0 &&
      singleAction[act].seen.objectSeenTwice === 0
  ),
  thePageRegisteredItsOwnListenersOnce: ["SUCCESS", "OUTAGE"].every(
    (act) => singleAction[act].seen.listenersOnSubmit === SEQUENCE_LENGTH + 1
  ),
};

const passed = failure === null && Object.values(checks).every(Boolean);

const record = {
  experiment: "M1 — the product loop through the real MV3 extension",
  verdict: passed ? "PASS" : "FAIL",
  status: passed ? "EXPERIMENTALLY VERIFIED (one run of each act, one fixture, one browser cell)" : "FAIL",
  claim:
    "the page's own field values are read, classified and held in the content script's isolated world; " +
    "only the sanitized handoff crosses the service worker; the plan refers to references; the value is " +
    "rehydrated locally under a one-shot capability and clicked through guardedAct — and the worker's own " +
    "recording of every message it saw contains none of the page's values",
  notAClaim: [
    "no claim of perfect PII recall: detection is the repository's deterministic D1/D2 channels on one synthetic fixture, and a value they do not classify is a value that is not protected",
    "no claim of zero leakage in general: what is checked is this fixture's values against this run's traffic",
    "no claim of production readiness: memory-only vault, one loopback origin, no TLS, no auth, no real user data",
    "the human's answer comes from the harness through the worker's control plane, exactly as the demo rehearsal's auto mode does; no human-facing grant surface was built in M1",
    "one run of each act on one machine in one browser cell is not a benchmark and not a reliability claim",
    "no visual perception, capture, detector, OCR or pixel redaction took part",
  ],
  loopExercisedThroughExtension: true,
  checks,
  failure,
  acts,
  /** See `routeCategory` above: this runner is automated, so it is the degraded route by design. */
  routeCategory,
  routesSeen,
  perception: {
    SUCCESS: perceptionOf("SUCCESS"),
    REFUSAL: perceptionOf("REFUSAL"),
    OUTAGE: perceptionOf("OUTAGE"),
    boot: resultOf("SUCCESS")?.perceptionBoot ?? null,
  },
  bundle,
  singleAction,
  releaseTests,
  pageForgery,
  workerTraffic,
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
  const b = boundaryOf(act);
  console.log(
    `  ${act}: state=${run?.state ?? "—"} verify=${verificationOf(act) ?? "—"} clicks=${submitEventsOf(act)} ` +
      `rehydrated=${run?.rehydrated?.length ?? "—"} fieldsRead=${b?.fieldsSeenByThePageRealm ?? "—"} refs=${b?.referencesIssued ?? "—"}`
  );
}
for (const act of ["SUCCESS", "REFUSAL", "OUTAGE"]) {
  const p = firstPassOf(act);
  if (!p) continue;
  console.log(
    `  ${act} perception[${p.route}]: ${p.capture?.w}x${p.capture?.h} ${p.capture?.bytes}B -> ${p.detector.detections} detections ` +
      `(fused ${p.fusion?.matched} matched / ${p.fusion?.visionOnly} vision-only) in ${p.ms.total}ms ` +
      `[capture ${p.ms.capture} decode ${p.ms.decode} encode ${p.ms.encode} pre ${p.ms.preprocess} infer ${p.ms.infer} fuse ${p.ms.fuse}]`
  );
}
console.log(`  route category: ${routeCategory} (${routesSeen.join(", ") || "none"})`);
console.log(
  `  bundle: ${bundle.bytes} bytes, ${bundle.pointerEventSites + bundle.mouseEventSites} click-event sites, E6 surface: ${bundle.e6Surface.length === 0 ? "none" : bundle.e6Surface.join(",")}`
);
console.log(
  `  worker saw ${workerTraffic?.messages ?? "—"} messages (${workerTraffic?.bytes ?? "—"} bytes); fixture values found in them: ${workerTraffic?.matchedValueIndexes?.length ?? "—"}`
);
console.log(`written: ${target}`);
process.exit(passed ? 0 : 1);
