#!/usr/bin/env node
/**
 * The demo loop against a real browser, on W2 — the section's evidence.
 *
 * TWO RUNS, ONE CODE PATH.
 *
 *   SUCCESS  — the deterministic reasoner returns the reference. The loop observes, sanitizes,
 *              verifies the payload, sends, validates, takes a grant, rehydrates locally, clicks
 *              through `guardedAct`, and reads the page back. Expected: CONFIRMED.
 *   REFUSAL  — the same reasoner returns the phone number itself. Expected: refused at
 *              VALIDATE_PLAN with VAULT_LITERAL_ECHO, and **nothing executed**.
 *
 * The two differ by one argument to `deterministicReasoner`. There is no demo-only branch and no
 * UI-only refusal: both go through the same `validatePlan` → `checkLiteral`.
 *
 * NOTHING ON THE CRITICAL PATH IS MOCKED. The page is a real page in a real frame; the packages are
 * the **built** ones the Planning View imports. Playwright's only job is to open the browser and read
 * the results back — it does not click the button, fill the field, or decide anything. The click is
 * dispatched by the page's own adapter through the audited permit path, and the assertion on
 * `__submitEvents` proves it was E6 mechanism B rather than `el.click()`.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/demo/run-demo-loop.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostname, cpus, release } from "node:os";

import { ROOT, startDemoServer } from "./server.mjs";

const OUT = join(ROOT, "artifacts", "experiments", "LOOP-1-server-orchestrator-planning-view", "logs");
const PORT = 8975;

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
};

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) {
  refuse("set CHROME_PATH to the Chrome for Testing binary (this run records the browser it used)");
}
if (!existsSync(join(ROOT, "packages/orchestrator/dist/src/index.js"))) {
  refuse("built packages not found; run `npm run typecheck` first");
}

const { server, origin } = await startDemoServer(PORT);

const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });

const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error.name)));

await page.goto(`${origin}/`, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.__demo?.run === "function");
await page.waitForFunction(() => document.getElementById("page")?.contentWindow?.__fixtureReady === true);

/**
 * Drive one run and read back both the record and the page's own state.
 *
 * The page state is read from the fixture's DOM, not from the record: the record says what the
 * client believes, and the DOM says what actually happened to the page.
 */
const runOnce = async (mode) => {
  await page.evaluate(() => window.__demo.resetPage());
  await page.waitForFunction(() => document.getElementById("page")?.contentWindow?.__fixtureReady === true);
  return page.evaluate(async (m) => {
    const record = await window.__demo.run({ mode: m, auto: true });
    const frame = document.getElementById("page");
    const doc = frame.contentDocument;
    const paneText = (id) => document.getElementById(id).innerText;
    return {
      record: {
        state: record.state,
        path: record.transitions.map((t) => t.to),
        refusal: record.refusal,
        timings: record.timings,
        reasoner: record.response?.received ? record.response.reasoner : null,
        transport: record.response?.received ? record.response.transport : null,
        responseHasRawBytes: record.response !== null && "raw" in record.response,
        planSteps: record.plan?.steps ?? null,
        validationOk: record.validation?.ok ?? null,
        grant: {
          requested: record.grant.requested,
          granted: record.grant.decision?.granted ?? null,
          oneShotUsed: record.grant.useGrant?.used ?? null,
          boundTo: record.grant.useGrant
            ? {
                ref: record.grant.useGrant.ref,
                fingerprint: record.grant.useGrant.fingerprint,
                origin: record.grant.useGrant.origin,
                sessionId: record.grant.useGrant.sessionId,
              }
            : null,
        },
        rehydrated: record.rehydrated,
        confirmationSubject: record.confirmation?.subject ?? null,
        act: record.act
          ? {
              reached: record.act.reached,
              hit: record.act.hit?.agreement ?? null,
              dispatch: record.act.result?.status ?? null,
              point: record.act.result?.target?.point ?? null,
              verification: record.act.verification,
            }
          : null,
        handoffBytes: record.handoffSerialized?.length ?? null,
        ledger: record.ledgerEntry
          ? {
              payloadSha256: record.ledgerEntry.payloadSha256,
              payloadBytes: record.ledgerEntry.payloadBytes,
              references: record.ledgerEntry.references.map((r) => r.token),
              maskedWithoutReference: record.ledgerEntry.maskedWithoutReference,
              leakCheck: record.ledgerEntry.leakCheck,
              destination: record.ledgerEntry.destination,
              note: record.ledgerEntry.note,
            }
          : null,
      },
      // What the page itself shows, independent of what the client believes.
      pageState: {
        confirmFieldFilled: doc.getElementById("mobile_confirm").value !== "",
        confirmMatchesRegistered:
          doc.getElementById("mobile_confirm").value === doc.getElementById("mobile").value &&
          doc.getElementById("mobile_confirm").value !== "",
        status: doc.getElementById("status").textContent,
        submitted: doc.getElementById("status").dataset.submitted,
        submitDisabled: doc.getElementById("submit").disabled,
        eventSequence: (frame.contentWindow.__submitEvents ?? []).map((e) => e.type),
        eventPoints: (frame.contentWindow.__submitEvents ?? []).map((e) => ({ x: e.x, y: e.y })),
      },
      // The secrets, and where they are and are not. Read in the page so the values never leave it.
      leaks: (() => {
        const secrets = ["#name", "#mobile", "#aadhaar", "#dob", "#otp"]
          .map((selector) => doc.querySelector(selector)?.value ?? "")
          .filter((v) => v !== "");
        const surfaces = {
          handoff: record.handoffSerialized ?? "",
          ledger: JSON.stringify(record.ledgerEntry ?? {}),
          plan: JSON.stringify(record.plan ?? {}),
          refusal: JSON.stringify(record.refusal ?? {}),
          grant: JSON.stringify(record.grant ?? {}),
          paneServer: paneText("pane-server"),
          paneePlan: paneText("pane-plan"),
          paneEgress: paneText("pane-egress"),
        };
        const found = [];
        for (const [name, text] of Object.entries(surfaces)) {
          for (const secret of secrets) if (text.includes(secret)) found.push(name);
        }
        return { secretsOnPage: secrets.length, surfacesContainingASecret: [...new Set(found)] };
      })(),
      /**
       * What the panes render.
       *
       * Captured as text so the checks are about what a judge would read, not about the objects
       * behind it — a pane that silently stopped rendering passes a leak check and fails these.
       *
       * **The local pane's text is deliberately NOT captured.** It contains the values, by design,
       * and this record is written to a file in the repository. So the local pane is checked *here*,
       * inside the page, and only the booleans travel out (SECURITY.md §2 — an artifact must not
       * carry the values either).
       */
      panes: {
        goal: paneText("pane-goal"),
        page: "(not captured: the local pane shows the values by design; see localPane checks)",
        server: paneText("pane-server"),
        plan: paneText("pane-plan"),
        egress: paneText("pane-egress"),
        wall: document.getElementById("wall").innerText,
        verdict: document.getElementById("wall-verdict").innerText,
      },
      localPane: {
        showsTheRegisteredValue: paneText("pane-page").includes(doc.getElementById("mobile").value),
        showsObservedStructure: paneText("pane-page").includes("Confirm mobile number"),
        showsSensitivityClasses:
          paneText("pane-page").includes("PHONE · PERSONAL") && paneText("pane-page").includes("AADHAAR · SENSITIVE"),
        saysValuesStayLocal: paneText("pane-page").includes("never leave this machine"),
      },
    };
  }, mode);
};

const success = await runOnce("reference");
const refusal = await runOnce("literal-echo");

/** E6 mechanism B, in order. Anything else means the demo stopped using the audited mechanism. */
const MECHANISM_B = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const checks = {
  // ── the success path ──────────────────────────────────────────────────────────────────────
  successWalksEveryState: same(success.record.path, [
    "OBSERVE", "SANITIZE", "VERIFY_PAYLOAD", "SEND", "VALIDATE_PLAN", "AWAIT_GRANT",
    "REHYDRATE", "ACT", "VERIFY_RESULT", "DONE",
  ]),
  successPlanUsedTheReference: success.record.planSteps?.[0]?.ref === "<PII:PHONE:1>",
  successGrantWasExplicitOneShotAndBound:
    success.record.grant.requested === true &&
    success.record.grant.granted === true &&
    success.record.grant.oneShotUsed === true &&
    success.record.grant.boundTo?.origin === origin,
  successRehydratedLocally: success.record.rehydrated.length === 1 && success.record.rehydrated[0].inserted === true,
  successRestoredTheRightValue: success.pageState.confirmMatchesRegistered === true,
  successWentThroughTheAuditedPath:
    success.record.act?.hit === "MATCH" && success.record.act?.dispatch === "EXECUTED",
  successUsedE6MechanismB: same(success.pageState.eventSequence, MECHANISM_B),
  successDispatchedAtTheExactPermittedPoint:
    success.pageState.eventPoints.length === 5 &&
    success.pageState.eventPoints.every(
      (p) => p.x === success.record.act?.point?.x && p.y === success.record.act?.point?.y
    ),
  successConfirmedByTheVerifier: success.record.act?.verification?.verification === "CONFIRMED",
  successPageAgrees: success.pageState.status === "Application submitted" && success.pageState.submitted === "true",

  // ── the refusal path ──────────────────────────────────────────────────────────────────────
  refusalStoppedAtValidatePlan: same(refusal.record.path, [
    "OBSERVE", "SANITIZE", "VERIFY_PAYLOAD", "SEND", "VALIDATE_PLAN", "REFUSED",
  ]),
  refusalCameFromTheLiteralCheck:
    refusal.record.refusal?.planRefusal?.literalCause === "VAULT_LITERAL_ECHO" &&
    refusal.record.refusal?.planRefusal?.literalSeverity === "LEAKAGE_EVENT",
  refusalAskedNoHuman: refusal.record.grant.requested === false,
  refusalRehydratedNothing: refusal.record.rehydrated.length === 0,
  refusalDidNotTouchTheField: refusal.pageState.confirmFieldFilled === false,
  refusalDispatchedNothing: refusal.record.act === null && refusal.pageState.eventSequence.length === 0,
  refusalLeftThePageUnchanged:
    refusal.pageState.status === "Not submitted" && refusal.pageState.submitDisabled === false,
  refusalDidNotQuoteTheSecret: refusal.leaks.surfacesContainingASecret.length === 0,
  refusalKeptOnlyAClassMarker: refusal.record.planSteps?.[0]?.literalMarker === "⟨literal:PHONE⟩",
  refusalDroppedTheRawBytes: refusal.record.responseHasRawBytes === false,

  // ── the privacy claim, on both runs ───────────────────────────────────────────────────────
  noSecretInAnySentOrLoggedSurface:
    success.leaks.surfacesContainingASecret.length === 0 && refusal.leaks.surfacesContainingASecret.length === 0,
  localPaneDoesShowTheValue: success.localPane.showsTheRegisteredValue === true,
  localPaneSaysTheValuesStayLocal: success.localPane.saysValuesStayLocal === true,
  otpNeverReceivedAReference:
    !success.record.ledger?.references.some((t) => t.includes("OTP")) &&
    success.record.ledger?.maskedWithoutReference === 1,
  noConsoleErrors: consoleErrors.length === 0,

  // ── the Planning View shows what actually happened ────────────────────────────────────────
  // Each pane is checked against the run's own facts, so a pane that stopped rendering, or that
  // rendered something the system did not do, fails here rather than looking fine.
  paneGoalShowsTheRealGoalAndState:
    success.panes.goal.includes("Submit my application with my registered mobile number.") &&
    success.panes.goal.includes("DONE"),
  panePageShowsObservedStructureAndSensitivity:
    success.localPane.showsObservedStructure && success.localPane.showsSensitivityClasses,
  paneServerShowsReferencesHintsAndNoValues:
    success.panes.server.includes("<PII:PHONE:1>") &&
    success.panes.server.includes("numeric") &&
    success.panes.server.includes("no reference") &&
    !success.panes.server.includes("<PII:OTP"),
  panePlanShowsThePlanValidationAndGrant:
    success.panes.plan.includes("<PII:PHONE:1>") &&
    success.panes.plan.includes("VALID") &&
    success.panes.plan.includes("GRANTED") &&
    success.panes.plan.includes("REHYDRATED LOCALLY"),
  paneEgressShowsIdentityDigestAndResult:
    success.panes.egress.includes(success.record.ledger?.payloadSha256 ?? " ") &&
    success.panes.egress.includes("CONFIRMED") &&
    success.panes.egress.includes("no egress client"),
  paneWallReflectsTheRunItself:
    success.panes.verdict.includes("CONFIRMED") && refusal.panes.verdict.includes("REFUSED"),
  paneRefusalStateIsShownWithoutTheSecret:
    refusal.panes.plan.includes("LITERAL ECHO") &&
    refusal.panes.plan.includes("⟨literal:PHONE⟩") &&
    refusal.panes.egress.includes("no action was dispatched"),
};

const passed = Object.values(checks).every(Boolean);

const record = {
  experiment: "LOOP-1 — server client → planner → validation → orchestrator → grant → rehydration → guarded click → VERIFY RESULT → Planning View",
  verdict: passed ? "PASS" : "FAIL",
  recordedAt: new Date().toISOString(),
  provenance: {
    workstation: "W2",
    host: hostname(),
    os: `${process.platform} ${release()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    gpu: "not used by this run, so not recorded",
    node: process.version,
    playwright: require2("playwright/package.json").version,
    browser: `Chromium ${browser.version()}`,
    browserBinary: executablePath,
    launch: "playwright chromium.launch({ headless: true, executablePath }); no extension loaded",
    extensionLoaded: false,
    origin,
  },
  whatIsReal: [
    "the page is a real document in a same-origin frame, served from loopback",
    "the packages under test are the BUILT dist/ the Planning View imports, not a re-implementation",
    "observe, sanitize, verify, parse, validate, bind, grant, rehydrate, permit, hit-test, dispatch and VERIFY RESULT are the shipped implementations",
    "playwright opens the browser and reads results back; it does not click, fill or decide",
  ],
  whatIsNot: [
    "the reasoner is a deterministic planner in the same realm: no model, no network request, no egress",
    "the literal-echo run's secret is handed to the reasoner by the page, because nothing in the handoff contains it",
    "no extension, no screen capture, no VLM, no OCR, no detector",
  ],
  checks,
  success,
  refusal,
  consoleErrors,
};

mkdirSync(OUT, { recursive: true });
const target = join(OUT, "w2-cft153-demo-loop.json");
writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");

await browser.close();
server.close();

console.log(`${record.verdict}  ${record.provenance.browser}  on ${record.provenance.host} (W2)`);
console.log(
  `  success: ${success.record.state} · ${success.record.act?.verification?.verification} · ${success.record.timings.totalMs}ms`
);
console.log(`  refusal: ${refusal.record.state} at ${refusal.record.refusal?.stage} · ${refusal.record.refusal?.planRefusal?.literalCause}`);
console.log(`written: ${target}`);
if (!passed) {
  console.error(JSON.stringify(Object.fromEntries(Object.entries(checks).filter(([, v]) => !v)), null, 2));
  process.exit(1);
}
