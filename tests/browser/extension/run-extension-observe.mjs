#!/usr/bin/env node
/**
 * M1 step one — OBSERVE a real page through the real extension, and compare it with the demo.
 *
 * WHAT IT PROVES. That `offscreen document → service worker → content script → back` carries a real
 * observation of a real page, and that the element graph the core realm receives is the same graph
 * the in-process `PageAdapter` builds from the same document. Until now the transport's evidence was
 * a simulated browser in unit tests; this drives the built MV3 host in Chrome for Testing.
 *
 * WHAT IT DOES NOT PROVE, and the record says so rather than implying otherwise: the product loop
 * does not run here. No orchestrator, no privacy layer, no vault, no reasoner and no egress take
 * part, and nothing is clicked. **EXTENSION E2E remains NOT PROVEN.** This is the observation leg
 * only, which is the leg everything else is built on.
 *
 * WHY THE COMPARISON IS THE POINT. "The transport returned something" is worth very little. The
 * question M1 has to answer is whether the representation the extension produces is the one the
 * orchestrator already knows how to consume — same targets, same roles, same accessible names, same
 * CSS-pixel boxes. A transport that returns a *different* graph would mean the loop has to be
 * rewritten to move into the extension, which is exactly what M1 must not do.
 *
 * NO PAGE VALUE CROSSES. `observePage` returns the transport's own vocabulary: selector, role,
 * accessible name, geometry, visibility. `contracts.ts` has no field for a form value (TR-10,
 * INV-21), and this harness asserts that none of the fixture's synthetic values appears anywhere in
 * the observation it received.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-extension-observe.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, release, tmpdir } from "node:os";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import {
  assertOwnEvidencePath,
  evidenceFileName,
  provenanceOf,
  resolveWorkstation,
} from "../support/workstation.mjs";

const WS = resolveWorkstation();

const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M1-extension-observation", "logs");

/**
 * The fixture's synthetic values. Present here so the harness can assert their ABSENCE from the
 * observation — the only reason this file may name them (SECURITY.md section 2: they are generated,
 * never real, and they live in the fixture).
 */
const FIXTURE_VALUES = ["Ramesh Kumar", "9000000001", "2345 6789 0124", "234567890124", "1998-04-12", "482913"];

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
};

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!existsSync(join(EXT, "manifest.json"))) refuse(`no built host at ${EXT} (run: npm run build -w @pratibimb/extension)`);

const userDataDir = mkdtempSync(join(tmpdir(), "pratibimb-m1-observe-"));

let context = null;
let stopServer = null;
let failure = null;
let observation = null;
let identity = null;
let domTruth = null;

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

  // A real page on loopback, which is the only origin the content script matches.
  const page = await context.newPage();
  await page.goto(fixtureUrl, { waitUntil: "load" });
  await page.waitForSelector("#submit");

  // The content script announces itself; the worker records the browser's attestation of who it is.
  // That is where the tab and frame come from -- never from the harness guessing.
  await page.waitForTimeout(500);
  identity = await worker.evaluate(async () => {
    const h = globalThis.__host;
    await h.ensureOffscreen();
    const last = [...h.hellos].reverse()[0];
    return last ? last.identity : null;
  });
  if (!identity || typeof identity.tabId !== "number" || typeof identity.frameId !== "number") {
    throw new Error("no attested content-script identity was recorded by the service worker");
  }

  // The core realm reads the page through the transport. The worker only relays.
  const reply = await worker.evaluate(
    async ({ tabId, frameId }) =>
      globalThis.__host.toOffscreen({ kind: "TRANSPORT_OBSERVE", tabId, frameId }),
    { tabId: identity.tabId, frameId: identity.frameId }
  );
  if (!reply?.ok) throw new Error(`TRANSPORT_OBSERVE refused: ${reply?.refused ?? "no response"}`);
  observation = reply.observation;

  // What the same document looks like read directly, for comparison. This is the demo's own element
  // set and the same geometry source; it is the control, not a second implementation of the graph.
  domTruth = await page.evaluate(() => {
    const MEASURED = "a, button, input, select, textarea, label, [role]";
    // Mirror page-surface-dom's referenceOf: a bare tag name rarely identifies an element, so a
    // selector matching more than one carries its index. Without this the control collapses every
    // <label> onto one key and compares the first element's box against the last one's.
    const reference = (el) => {
      const selector = el.id ? `#${el.id}` : el.tagName.toLowerCase();
      const matches = Array.from(document.querySelectorAll(selector));
      if (matches.length <= 1) return { selector };
      const index = matches.indexOf(el);
      return index < 0 ? { selector } : { selector, nth: index };
    };
    return Array.from(document.querySelectorAll(MEASURED)).map((el) => {
      const r = el.getBoundingClientRect();
      const ref = reference(el);
      return {
        selector: ref.selector,
        nth: ref.nth,
        box: { x: r.x, y: r.y, w: r.width, h: r.height },
      };
    });
  });
} catch (error) {
  failure = `${error.name}: ${String(error.message).slice(0, 300)}`;
} finally {
  if (context) await context.close();
  if (typeof stopServer === "function") await stopServer();
}

// ── what the run is allowed to claim ────────────────────────────────────────────────────────
const nodes = observation?.graph?.nodes ?? [];
const serialised = JSON.stringify(observation ?? {});
// The graph keys elements by their DomRef selector; geometry lives on the visual evidence, in
// canonical CSS viewport space (INV-24), and only when the element was actually in frame.
const refKey = (selector, nth) => (nth === undefined || nth === null ? selector : `${selector}[${nth}]`);
const byId = new Map(nodes.map((n) => [refKey(n.domRef?.selector ?? n.id, n.domRef?.nth), n]));
const cssBoxOf = (node) => node?.evidence?.viewportBox ?? null;

/**
 * Do the two sides share a coordinate space? Reported with the worst disagreement, because a check
 * that can only say "no" leaves the next person guessing at exactly the point they need a number.
 */
const boxComparison = (() => {
  if (!domTruth || nodes.length === 0) return { compared: 0, agree: false, worst: null };
  let compared = 0;
  let worst = null;
  for (const truth of domTruth) {
    const b = cssBoxOf(byId.get(refKey(truth.selector, truth.nth)));
    if (!b) continue;
    compared += 1;
    const d = {
      selector: refKey(truth.selector, truth.nth),
      dx: b.x - truth.box.x,
      dy: b.y - truth.box.y,
      dw: b.w - truth.box.w,
      dh: b.h - truth.box.h,
    };
    d.max = Math.max(Math.abs(d.dx), Math.abs(d.dy), Math.abs(d.dw), Math.abs(d.dh));
    if (!worst || d.max > worst.max) worst = d;
  }
  // CSS viewport pixels on both sides (INV-24). A sub-pixel difference is a rounding artefact;
  // anything larger means the two sides do not share a coordinate space.
  return { compared, agree: compared >= 5 && (worst?.max ?? Infinity) <= 0.5, worst };
})();
const boxesAgree = boxComparison.agree;

const checks = {
  serviceWorkerRelayed: identity !== null,
  contentScriptAttested: typeof identity?.documentId === "string" && identity.documentId.length > 0,
  observationReturned: observation !== null,
  graphHasNodes: nodes.length >= 5,
  bindingAttestsDocument: observation?.binding?.document?.documentId === identity?.documentId,
  bindingIsLoopback: String(observation?.binding?.document?.origin ?? "").startsWith("http://127.0.0.1"),
  focusReported: typeof observation?.focus?.state === "string",
  viewportReported: typeof observation?.viewport?.dpr === "number",
  submitTargetPresent: byId.has("#submit"),
  boxesMatchTheLiveDom: boxesAgree,
  noFixtureValueInObservation: FIXTURE_VALUES.every((v) => !serialised.includes(v)),
};
const passed = failure === null && Object.values(checks).every(Boolean);

const record = {
  experiment: "M1 — observation through the real MV3 extension",
  verdict: passed ? "PASS" : "FAIL",
  status: passed ? "EXPERIMENTALLY VERIFIED (single run, one fixture, one browser cell)" : "FAIL",
  claim:
    "offscreen document -> service worker -> content script -> back returns an element graph of a real " +
    "loopback page, in CSS viewport pixels, matching the live DOM, carrying no page value",
  notAClaim: [
    "the product loop does NOT run through the extension: no orchestrator, privacy layer, vault, reasoner or egress took part",
    "nothing was clicked and no action was dispatched in this run",
    "EXTENSION E2E remains NOT PROVEN; this is the observation leg only",
    "one run on one fixture in one browser cell is not a benchmark and not a reliability claim",
  ],
  loopExercisedThroughExtension: false,
  checks,
  failure,
  observed: {
    nodes: nodes.length,
    domElementsCompared: domTruth?.length ?? 0,
    boxComparison,
    focus: observation?.focus?.state ?? null,
    viewport: observation?.viewport ?? null,
    attestedOrigin: observation?.binding?.document?.origin ?? null,
    observationFrameId: observation?.binding?.observationFrameId ?? null,
  },
  recordedAt: new Date().toISOString(),
  provenance: {
    ...provenanceOf(WS),
    os: `${process.platform} ${release()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    node: process.version,
    playwright: require2("playwright/package.json").version,
    browserBinary: executablePath,
    browser: JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8")).minimum_chrome_version
      ? "Chrome for Testing (see browserBinary)"
      : "unknown",
    headless: false,
    extensionPath: EXT,
  },
};

mkdirSync(OUT, { recursive: true });
const target = assertOwnEvidencePath(join(OUT, evidenceFileName(WS, "cft153-extension-observation.json")), WS);
writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`\n${record.verdict}  observation through the extension  on ${record.provenance.host} (${WS.id})`);
for (const [name, ok] of Object.entries(checks)) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
if (failure) console.log(`  failure: ${failure}`);
console.log(`  nodes: ${nodes.length} · dom compared: ${domTruth?.length ?? 0} · origin: ${record.observed.attestedOrigin}`);
console.log(`  the product loop did NOT run through the extension — EXTENSION E2E remains NOT PROVEN`);
console.log(`written: ${target}`);
process.exit(passed ? 0 : 1);
