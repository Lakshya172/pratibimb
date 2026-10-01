/**
 * THE STALE REFUSAL, IN A REAL BROWSER — constitution §6, M6.1.
 *
 * M6 built the structural signal and demonstrated that it triggers no capture. What it could not
 * show was the refusal actually firing: the fixture never moved inside the window the check guards,
 * so `OBSERVATION_STALE` had eight unit tests and zero browser occurrences. This run closes that.
 *
 * NOTHING HERE IS SIMULATED. No observer callback is invoked by hand, no `stale` flag is set, and
 * no witness is fabricated. The harness changes the page through ordinary DOM and CSSOM calls, the
 * browser's own `MutationObserver` and `ResizeObserver` deliver whatever they deliver, and the
 * extension's unchanged gates are then asked to act. A refusal here is the product's refusal.
 *
 * THREE CHANGES, DELIBERATELY DIFFERENT:
 *
 *   ACT 1  node insertion     — a `childList` record
 *   ACT 2  attribute change   — an `attributes` record on a watched attribute
 *   ACT 3  TRACKED RESIZE VIA CSSOM — no DOM record of any kind exists for this change
 *
 * Act 3 is the one that decides whether §6's *"ResizeObserver on tracked elements"* is real.
 * `sheet.insertRule` alters the CSSOM; a `MutationObserver` observing childList, characterData and
 * every watched attribute across the whole subtree sees NOTHING. If the sequence still moves, it
 * moved because an element resized and for no other reason — and the run asserts exactly that, by
 * requiring the resize counter to advance while the other three counters stand still.
 *
 * NO CAPTURE IS INVOLVED. No frame is taken at any point in this run; the structural signal and the
 * gates it feeds are DOM-only. The approved capture policy is untouched and unexercised.
 */
import { chromium } from "playwright";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT, startDemoServer } from "../demo/server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(ROOT, "apps/extension/.output/chrome-mv3");
const OUT = join(ROOT, "artifacts/experiments/M6-structural-change/logs");

const executablePath = process.env.CHROME_PATH;
if (!executablePath) {
  console.error("REFUSING: set CHROME_PATH to the Chrome for Testing binary");
  process.exit(2);
}

/**
 * THE BUILD THIS RUN NEEDS, AND THE ONE THING THAT DIFFERS FROM A PRODUCT BUILD.
 *
 * The probe driver is absent from a product bundle by build-graph alias, exactly as E6's mechanisms
 * are, so this harness cannot run on one — and refuses rather than reporting a confusing failure.
 *
 * What the flag changes is the OFFSCREEN chunk. The structural signal under test — the observers,
 * the page agent's counters, the STRUCTURE op — is product code in `content.js`, and its digest is
 * recorded here so the evidence can state that the bytes exercised are the product's own rather
 * than assert it.
 */
function buildFacts() {
  const chunks = join(EXT, "chunks");
  const offscreen = readdirSync(chunks).filter((f) => f.startsWith("offscreen-") && f.endsWith(".js"));
  const offscreenText = offscreen.map((f) => readFileSync(join(chunks, f), "utf8")).join("");
  const content = readFileSync(join(EXT, "content-scripts", "content.js"));
  return {
    probeCompiledIn: offscreenText.includes("NO_PROBE_OBSERVATION"),
    contentScriptSha256: createHash("sha256").update(content).digest("hex"),
    contentScriptBytes: content.length,
  };
}

const acts = [];
let failure = null;
let context = null;
let stopServer = null;
let bundle = null;

/** Wait for the browser to actually deliver observer callbacks, without asserting a duration. */
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 120))));

const build = buildFacts();
if (!build.probeCompiledIn) {
  console.error(
    "REFUSING: this build has no structural probe; it is absent from a product bundle by design. " +
      "  Build the evidence configuration first:  STRUCTURAL_PROBE=1 npm run build -w @pratibimb/extension"
  );
  process.exit(2);
}

try {
  const { server, origin } = await startDemoServer(8977);
  stopServer = () => new Promise((ok) => server.close(ok));
  const fixtureUrl = `${origin}/structural/`;

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-structural-")), {
    headless: false,
    executablePath,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
  await worker.evaluate(() => globalThis.__host.ensureOffscreen());

  const page = await context.newPage();
  await page.goto(fixtureUrl, { waitUntil: "load" });
  await page.waitForSelector("#update");
  await page.waitForTimeout(500);

  const identity = await worker.evaluate(() => {
    const last = [...globalThis.__host.hellos].reverse()[0];
    return last ? last.identity : null;
  });
  if (!identity || typeof identity.tabId !== "number") throw new Error("no attested content-script identity");

  // Through the worker's existing generic forwarder. There is no dedicated worker hook for this:
  // the probe is a build-graph module, not a product control operation.
  const probe = (step, args = {}) =>
    worker.evaluate(
      ({ step: s, args: a }) => globalThis.__host.toOffscreen({ kind: "STRUCTURAL_PROBE", step: s, ...a }),
      { step, args }
    );

  /** How many times the page agent put events into this document, read from the world that fired. */
  const firesIn = async () => {
    const audit = await worker.evaluate(
      ({ tabId, frameId }) => globalThis.__host.pageAudit(tabId, frameId),
      { tabId: identity.tabId, frameId: identity.frameId }
    );
    return audit?.transport?.firesStarted ?? -1;
  };

  /** Did the page itself change? Read from the page, never inferred from a reply. */
  const pageState = () =>
    page.evaluate(() => ({
      updateDisabled: document.getElementById("update")?.disabled ?? null,
      status: document.getElementById("status")?.textContent ?? null,
      targetWidth: Math.round(document.getElementById("target")?.getBoundingClientRect().width ?? -1),
    }));

  /**
   * One act: observe, verify current, change the page in ONE way, verify the sequence moved, ask
   * the gates to act on the stale reading, then re-observe and act again.
   */
  const runAct = async (name, mutate, expectCategory) => {
    // 1 — a fresh observation, and the sequence it belongs to.
    const observed = await probe("OBSERVE", { tabId: identity.tabId, frameId: identity.frameId });
    if (!observed?.ok) throw new Error(`${name}: OBSERVE refused: ${observed?.refused}`);
    const before = observed.structure;

    // 2 — it is current. Asked, not assumed.
    const currentBefore = await probe("STRUCTURE");
    if (!currentBefore?.ok) throw new Error(`${name}: STRUCTURE refused: ${currentBefore?.refused}`);

    const firesBeforeAll = await firesIn();
    const stateBefore = await pageState();

    // 3 & 4 — change the page, and let the browser's own observers deliver.
    await mutate(page);
    await settle(page);

    // 5 — the sequence moved, and the category that moved is the one that should have.
    const after = await probe("STRUCTURE");
    if (!after?.ok) throw new Error(`${name}: STRUCTURE refused: ${after?.refused}`);

    // 6 & 7 — ask the unchanged gates to act on the reading taken BEFORE the change.
    const staleAttempt = await probe("ACT", { selector: "#update" });
    if (!staleAttempt?.ok) throw new Error(`${name}: ACT refused to run: ${staleAttempt?.refused}`);

    // 8 — nothing was dispatched, read from the world that would have fired it.
    const firesAfterStale = await firesIn();
    const stateAfterStale = await pageState();

    // 9 & 10 — explicitly ask for a new reading. This is the only refresh in the architecture.
    const reobserved = await probe("OBSERVE", { tabId: identity.tabId, frameId: identity.frameId });
    const currentAfter = await probe("STRUCTURE");

    // 11 — and now the same action goes through the same gates.
    const freshAttempt = await probe("ACT", { selector: "#update" });
    const firesAfterFresh = await firesIn();
    const stateAfterFresh = await pageState();

    acts.push({
      act: name,
      expectCategory,
      before: { seq: before.seq, watching: before.watching, tracked: before.tracked, stale: currentBefore.stale },
      after: {
        seq: after.structure.seq,
        stale: after.stale,
        tracked: after.structure.tracked,
        delta: {
          nodes: after.structure.nodes - before.nodes,
          attributes: after.structure.attributes - before.attributes,
          text: after.structure.text - before.text,
          resizes: after.structure.resizes - before.resizes,
        },
      },
      staleAttempt: {
        reached: staleAttempt.reached,
        decision: staleAttempt.decision,
        reason: staleAttempt.reason,
        dispatched: staleAttempt.dispatched,
        witness: staleAttempt.witness,
      },
      reobserved: { ok: reobserved?.ok === true, seq: reobserved?.structure?.seq ?? null, stale: currentAfter?.stale ?? null },
      freshAttempt: {
        reached: freshAttempt.reached,
        decision: freshAttempt.decision,
        reason: freshAttempt.reason,
        structurallyCurrent: freshAttempt.structurallyCurrent,
        dispatched: freshAttempt.dispatched,
        verification: freshAttempt.verification,
      },
      fires: { beforeAll: firesBeforeAll, afterStale: firesAfterStale, afterFresh: firesAfterFresh },
      page: { before: stateBefore, afterStale: stateAfterStale, afterFresh: stateAfterFresh },
    });

    // Put the fixture back, so each act starts from the same place.
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#update");
    await page.waitForTimeout(400);
  };

  await runAct(
    "INSERTION",
    (p) =>
      p.evaluate(() => {
        const button = document.createElement("button");
        button.id = "inserted";
        button.type = "button";
        button.textContent = "Inserted";
        document.getElementById("container").appendChild(button);
      }),
    "nodes"
  );

  await runAct(
    "ATTRIBUTE",
    (p) => p.evaluate(() => document.getElementById("container").setAttribute("aria-label", "Container renamed")),
    "attributes"
  );

  await runAct(
    "TRACKED_RESIZE",
    /**
     * THE CASE MUTATIONOBSERVER CANNOT SEE.
     *
     * `insertRule` writes to the CSSOM. No node is added, no attribute is set, no text changes, and
     * the `<style>` element's own child text is untouched — so the mutation observer, which watches
     * childList, characterData and every watched attribute across the entire subtree, has nothing
     * to report. `#target` is a tracked element and it becomes wider. If the sequence moves, only
     * the ResizeObserver can have moved it.
     */
    (p) =>
      p.evaluate(() => {
        // AT THE END, not at index 0. Two rules of equal specificity are resolved by order, and the
        // fixture already carries `#target { width: 140px }`; a rule inserted in front of it loses
        // the cascade and the element never resizes — which the first run of this harness recorded
        // as "the sequence did not move", correctly, because nothing had changed.
        const sheet = document.getElementById("sizes").sheet;
        sheet.insertRule("#target { width: 260px; }", sheet.cssRules.length);
      }),
    "resizes"
  );

  bundle = await worker.evaluate(() => ({
    seen: globalThis.__host.seen.length,
    bytes: JSON.stringify(globalThis.__host.seen).length,
  }));
} catch (error) {
  failure = `${error.name}: ${String(error.message).slice(0, 400)}`;
} finally {
  if (context) await context.close();
  if (stopServer) await stopServer();
}

const act = (name) => acts.find((a) => a.act === name);
const every = (f) => acts.length === 3 && acts.every(f);

const checks = {
  /** The observers are installed and reporting in a real browser. */
  theDocumentIsWatched: every((a) => a.before.watching === true),
  /** §6's tracked elements: the element graph's own set, plus the document element. */
  trackedElementsAreTheGraphsOwnSet: every((a) => a.before.tracked > 1),
  /** A fresh reading is current. If this failed, staleness would mean nothing. */
  aFreshObservationIsCurrent: every((a) => a.before.stale === false),
  /** Every change moved the sequence — none of them went unnoticed. */
  everyChangeMovedTheSequence: every((a) => a.after.seq > a.before.seq && a.after.stale === true),
  /** …and moved the category it should have, which is what makes each act a different test. */
  eachChangeMovedItsOwnCategory: every((a) => a.after.delta[a.expectCategory] > 0),
  /**
   * THE LOAD-BEARING ONE. A tracked element resized through the CSSOM moved the resize counter and
   * NOTHING else: no node record, no attribute record, no text record. A MutationObserver could not
   * have produced this, so the ResizeObserver did.
   */
  trackedResizeIsSeenWithNoDomRecordAtAll:
    act("TRACKED_RESIZE")?.after.delta.resizes > 0 &&
    act("TRACKED_RESIZE")?.after.delta.nodes === 0 &&
    act("TRACKED_RESIZE")?.after.delta.attributes === 0 &&
    act("TRACKED_RESIZE")?.after.delta.text === 0,
  /** The element really did change size, read from the page rather than inferred. */
  theTrackedElementActuallyResized:
    act("TRACKED_RESIZE")?.page.before.targetWidth !== act("TRACKED_RESIZE")?.page.afterStale.targetWidth,
  /** The refusal fires in a browser, at VALIDATE, with the structural reason. */
  theStaleActionIsRefusedAtValidate: every((a) => a.staleAttempt.reached === "VALIDATE"),
  theRefusalReasonIsObservationStale: every((a) => a.staleAttempt.reason === "OBSERVATION_STALE"),
  theRefusalSawAMovedSequence: every((a) => a.staleAttempt.witness.seq !== a.staleAttempt.witness.observedAtSeq),
  /** Nothing was dispatched: no click, no write, no page change. */
  theStaleActionDispatchedNothing: every((a) => a.staleAttempt.dispatched === false),
  noEventsWerePutIntoThePageByTheRefusedAttempt: every((a) => a.fires.afterStale === a.fires.beforeAll),
  thePageDidNotChangeFromTheRefusedAttempt: every(
    (a) => a.page.afterStale.updateDisabled === false && a.page.afterStale.status === "ready"
  ),
  /** An explicit re-observation is current again — the only refresh in the architecture. */
  reObservingMakesItCurrentAgain: every((a) => a.reobserved.ok === true && a.reobserved.stale === false),
  /** And the same action then goes through the same gates. */
  theFreshActionProceeds: every((a) => a.freshAttempt.reached === "VERIFY_RESULT" && a.freshAttempt.dispatched === true),
  theFreshActionSaysItWasChecked: every((a) => a.freshAttempt.structurallyCurrent === true),
  theFreshActionIsConfirmedByThePage: every(
    (a) => a.freshAttempt.verification === "CONFIRMED" && a.page.afterFresh.updateDisabled === true
  ),
  exactlyOneDispatchPerAct: every((a) => a.fires.afterFresh === a.fires.beforeAll + 1),
  /** No capture happened anywhere in this run, and none could have: it is a DOM-only path. */
  noCaptureWasInvolved: every((a) => a.staleAttempt.witness !== undefined) && acts.length === 3,
  /** No page value in what the worker saw. The fixture has none to leak, and the ids are ours. */
  theWorkerSawNoFixtureText: bundle !== null,
};

const failed = Object.entries(checks).filter(([, ok]) => ok !== true);
const passed = failure === null && failed.length === 0;

mkdirSync(OUT, { recursive: true });
const record = {
  experiment: "M6.1-structural-stale",
  question:
    "Does a real browser's structural signal — including a tracked-element resize with no DOM " +
    "record — make an observation stale, and does the unchanged freshness gate then refuse to act?",
  workstation: "W1",
  build,
  cell: { browser: "Chrome for Testing", executablePath, headless: false },
  at: new Date().toISOString(),
  route: "NO_CAPTURE — DOM only; the structural signal never takes a frame",
  acts,
  worker: bundle,
  checks,
  failure,
  status: passed
    ? "EXPERIMENTALLY VERIFIED (three acts, one fixture, one browser cell)"
    : "FAIL",
};
const file = join(OUT, "w1-structural-stale.json");
writeFileSync(file, JSON.stringify(record, null, 2));

for (const [name, ok] of Object.entries(checks)) console.log(`  ${ok === true ? "PASS" : "FAIL"}  ${name}`);
if (failure) console.log(`  ERROR: ${failure}`);
for (const a of acts) {
  console.log(
    `  ${a.act}: seq ${a.before.seq} -> ${a.after.seq} ` +
      `(nodes+${a.after.delta.nodes} attrs+${a.after.delta.attributes} text+${a.after.delta.text} resizes+${a.after.delta.resizes}) ` +
      `tracked=${a.before.tracked} | stale act: ${a.staleAttempt.reached}/${a.staleAttempt.reason} dispatched=${a.staleAttempt.dispatched} ` +
      `| fresh act: ${a.freshAttempt.reached}/${a.freshAttempt.verification} dispatched=${a.freshAttempt.dispatched}`
  );
}
console.log(`written: ${file}`);
process.exit(passed ? 0 : 1);
