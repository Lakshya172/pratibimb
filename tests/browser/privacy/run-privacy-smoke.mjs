#!/usr/bin/env node
/**
 * PRIV-0 smoke — the privacy foundation against a real browser, on W2.
 *
 * WHAT THIS PROVES, and it is deliberately a short list:
 *   1. the synthetic fixture loads in Chrome for Testing and has the elements the demo needs;
 *   2. the Aadhaar value in it is the checksum-valid one, and the deterministic validator agrees;
 *   3. a structural observation of that page — role, accessible name, geometry, and the values a
 *      content script may read — can be sanitized by the shipped package;
 *   4. the resulting verified handoff, and the ledger entry beside it, contain none of the values,
 *      checked exactly and under normalisation.
 *
 * WHAT IT IS NOT: an agent demo. Nothing is planned, nothing is clicked, no extension is loaded, no
 * value is rehydrated and nothing is sent anywhere. Those belong to the next section.
 *
 * It imports the BUILT packages (`dist/`), so it exercises the code that would ship rather than a
 * re-implementation. Run `npm run typecheck` first.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/privacy/run-privacy-smoke.mjs
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hostname, cpus, release } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const PORT = 8971;
const OUT = join(ROOT, "artifacts", "experiments", "PRIV-0-privacy-foundation-reconstruction", "logs");

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
};

const P = await import(pathToFileURL(join(ROOT, "packages/perception/dist/src/index.js")).href);
const V = await import(pathToFileURL(join(ROOT, "packages/privacy/dist/src/index.js")).href);
if (typeof V.sanitize !== "function") refuse("built privacy package not found; run npm run typecheck first");

const FIXTURE = readFileSync(join(HERE, "fixture", "application.html"));
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(FIXTURE);
});
await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));
const ORIGIN = `http://127.0.0.1:${PORT}`;

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) {
  refuse("set CHROME_PATH to the Chrome for Testing binary (this run records the browser it used)");
}

const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
await page.goto(`${ORIGIN}/`, { waitUntil: "load" });
await page.waitForFunction(() => window.__fixtureReady === true);

/**
 * What a content script may read: role, accessible name, geometry, enabled, CSS visibility — and,
 * for form controls, the local value. The value never leaves this process except into the vault.
 */
const probe = await page.evaluate(() => {
  const role = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const t = el.tagName;
    if (t === "INPUT") return el.type === "checkbox" || el.type === "radio" ? el.type : "textbox";
    if (t === "BUTTON") return "button";
    if (t === "LABEL") return "label";
    return "generic";
  };
  const labelFor = (el) => {
    const label = el.labels && el.labels[0];
    return label ? label.textContent.trim() : (el.getAttribute("aria-label") || "").trim();
  };
  const nodes = Array.from(document.querySelectorAll("input, button, [role]"));
  return {
    viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    elements: nodes.map((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
        role: role(el),
        name: labelFor(el) || (el.textContent || "").trim().slice(0, 60),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        enabled: !el.disabled,
        cssHidden: s.display === "none" || s.visibility === "hidden" || r.width === 0 || r.height === 0,
        parentIndex: -1,
        type: el.getAttribute("type") || "",
        autocomplete: el.getAttribute("autocomplete") || "",
        value: typeof el.value === "string" ? el.value : "",
        tag: el.tagName.toLowerCase(),
      };
    }),
    statusText: document.getElementById("status")?.textContent ?? null,
    submitted: document.getElementById("status")?.dataset.submitted ?? null,
  };
});

const bySelector = new Map(probe.elements.map((e) => [e.selector, e]));
const required = ["#name", "#mobile", "#aadhaar", "#dob", "#otp", "#submit", "#status"];
const missing = required.filter((s) => !bySelector.has(s));
if (missing.length) refuse(`fixture is missing ${missing.join(", ")}`);

const aadhaarOnPage = bySelector.get("#aadhaar").value;
const aadhaarValid = V.isAadhaarNumber(aadhaarOnPage);
const invalidVectorAbsent = !FIXTURE.toString("utf8").includes("2345 6789 0123");

const geometry = {
  dpr: 1,
  zoom: 1,
  viewportCss: { w: probe.viewport.w, h: probe.viewport.h },
  captureSize: { w: probe.viewport.w, h: probe.viewport.h },
  scroll: { x: 0, y: 0 },
  origin: ORIGIN,
};
const graph = P.buildElementGraph(
  probe.elements.map(({ selector, role, name, rect, enabled, cssHidden, parentIndex }) => ({
    selector,
    role,
    name,
    rect,
    enabled,
    cssHidden,
    parentIndex,
  })),
  geometry,
  P.frameId("priv0-smoke-1")
);

const fields = probe.elements
  .filter((e) => e.tag === "input")
  .map((e) => ({
    id: e.selector,
    value: e.value,
    label: e.name,
    type: e.type,
    autocomplete: e.autocomplete,
    origin: ORIGIN,
  }));

const startedAt = Date.now();
const outcome = await V.sanitize(graph, "Submit my application with my registered mobile number.", {
  sessionId: "priv0-smoke-session",
  requestId: "priv0-smoke-request",
  origin: ORIGIN,
  viewport: { w: probe.viewport.w, h: probe.viewport.h, dpr: 1, zoom: 1, scrollX: 0, scrollY: 0 },
  now: startedAt,
  today: new Date(startedAt),
}, { fields });
const sanitizeMs = Date.now() - startedAt;

if (!outcome.ok) refuse(`sanitize refused: ${outcome.refused}`);

// The leak sweep, over exactly the bytes that would be sent and the record beside them.
const secrets = fields.map((f) => f.value).filter((v) => v !== "");
const serializedHandoff = V.serializeHandoff(outcome.handoff);
const serializedLedger = JSON.stringify(outcome.ledgerEntry);
const leaks = [];
for (const secret of secrets) {
  for (const [label, text] of [["handoff", serializedHandoff], ["ledger", serializedLedger]]) {
    if (text.includes(secret) || V.containsSecret(text, secret)) leaks.push({ label, class: "REDACTED_CLASS_ONLY" });
  }
}

const referenced = outcome.handoff.redactions.filter((r) => r.method === "token_reference");
const masked = outcome.handoff.redactions.filter((r) => r.method === "masked_no_token");
const otpTokenised = referenced.some((r) => r.class === "OTP");

const checks = {
  fixtureLoads: probe.statusText === "Not submitted" && probe.submitted === "false",
  requiredElementsPresent: missing.length === 0,
  aadhaarOnPageIsChecksumValid: aadhaarValid,
  checksumInvalidVectorAbsentFromFixture: invalidVectorAbsent,
  sanitizeProducedVerifiedHandoff: outcome.handoff.verified === true && V.isVerifiedHandoff(outcome.handoff),
  tokenisedClasses: referenced.map((r) => r.class).sort(),
  otpMaskedWithoutReference: masked.length === 1 && masked[0].class === "OTP" && !otpTokenised,
  vaultHoldsLocally: outcome.vault.size === 4,
  noSecretInHandoffOrLedger: leaks.length === 0,
};

const passed =
  checks.fixtureLoads &&
  checks.requiredElementsPresent &&
  checks.aadhaarOnPageIsChecksumValid &&
  checks.checksumInvalidVectorAbsentFromFixture &&
  checks.sanitizeProducedVerifiedHandoff &&
  checks.otpMaskedWithoutReference &&
  checks.vaultHoldsLocally &&
  checks.noSecretInHandoffOrLedger &&
  JSON.stringify(checks.tokenisedClasses) === JSON.stringify(["AADHAAR", "DOB", "NAME", "PHONE"]);

const record = {
  experiment: "PRIV-0 privacy foundation reconstruction — fixture smoke",
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
    launch: "playwright chromium.launch({ headless: true, executablePath }), no extension loaded",
  },
  fixture: { url: `${ORIGIN}/`, elements: probe.elements.length, statusBefore: probe.statusText },
  checks,
  handoff: {
    payloadSha256: outcome.ledgerEntry.payloadSha256,
    payloadBytes: outcome.ledgerEntry.payloadBytes,
    references: outcome.ledgerEntry.references,
    maskedWithoutReference: outcome.ledgerEntry.maskedWithoutReference,
    elements: outcome.handoff.elements.length,
    redactionHints: outcome.handoff.redactions.map((r) => ({ class: r.class, tier: r.tier, hint: r.hint })),
  },
  timings: { sanitizeMs },
  limits: [
    "no extension, no plan, no click, no rehydration and no network client take part in this run",
    "the ledger entry is a privacy-layer record, not evidence of a network send",
    "one browser, one page, one machine: W2 only",
  ],
};

mkdirSync(OUT, { recursive: true });
const target = join(OUT, "w2-cft153-smoke.json");
writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");

await browser.close();
server.close();

console.log(`${record.verdict}  ${record.provenance.browser}  on ${record.provenance.host} (W2)`);
console.log(`written: ${target}`);
if (!passed) {
  console.error(JSON.stringify(checks, null, 2));
  process.exit(1);
}
