#!/usr/bin/env node
/**
 * EXTENSION LOAD SMOKE — and a deliberately narrow claim.
 *
 * WHAT THIS PROVES: that the built MV3 host still loads in Chrome for Testing 153 after this
 * branch's changes, that its service worker boots, and that the shipped manifest is what the
 * repository expects. It is a **regression check on the host**, nothing more.
 *
 * WHAT IT DOES NOT PROVE, and the distinction is the whole reason this file exists: **the product
 * loop does not run through the extension.** `apps/demo` drives a same-origin frame directly through
 * its own `PageAdapter`; it imports no `chrome.*` API and nothing from
 * `@pratibimb/extension-transport`. Running OBSERVE → … → VERIFY RESULT through the real extension
 * path would need a content-script surface, a side-panel host for the Planning View, and a host-side
 * command surface that does not exist (the offscreen control plane is reachable only from inside the
 * offscreen realm). That is integration work, not a test, and it is out of scope here.
 *
 * So this run is recorded as what it is. `loopExercisedThroughExtension` is `false` in the output,
 * and the evidence record says NOT PROVEN.
 *
 * Headed, because MV3 service workers do not start in headless Chrome.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/demo/run-extension-load-smoke.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostname, cpus, release, tmpdir } from "node:os";

import { ROOT } from "./server.mjs";

const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "LOOP-1-server-orchestrator-planning-view", "logs");

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
};

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!existsSync(join(EXT, "manifest.json"))) {
  refuse(`no built host at ${EXT} (run: npm run build -w @pratibimb/extension)`);
}

const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
const userDataDir = mkdtempSync(join(tmpdir(), "pratibimb-extload-"));

let context;
let serviceWorkerUrl = null;
let failure = null;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
  serviceWorkerUrl = worker.url();
} catch (error) {
  failure = `${error.name}: ${String(error.message).slice(0, 200)}`;
} finally {
  if (context) await context.close();
}

const extensionId = serviceWorkerUrl ? serviceWorkerUrl.split("/")[2] : null;

const checks = {
  builtHostPresent: true,
  manifestIsV3: manifest.manifest_version === 3,
  serviceWorkerBooted: serviceWorkerUrl !== null,
  extensionIdResolved: typeof extensionId === "string" && extensionId.length > 0,
  connectSrcStillPinned: String(manifest.content_security_policy?.extension_pages ?? "").includes("http://127.0.0.1:8995"),
  noHostPermissionBeyondLoopback: (manifest.host_permissions ?? []).every((p) => p.startsWith("http://127.0.0.1/")),
};
const passed = Object.values(checks).every(Boolean) && failure === null;

const record = {
  experiment: "LOOP-1 — extension load smoke (host regression only)",
  verdict: passed ? "PASS" : "FAIL",
  claim: "the built MV3 host loads and its service worker boots in Chrome for Testing 153",
  notAClaim: [
    "the product loop does NOT run through the extension: apps/demo drives a same-origin frame through its own PageAdapter",
    "no content script, side panel, offscreen document or extension transport took part in the LOOP-1 evidence",
    "extension end-to-end integration of the loop is NOT PROVEN and needs integration work that is out of scope",
  ],
  loopExercisedThroughExtension: false,
  recordedAt: new Date().toISOString(),
  provenance: {
    workstation: "W2",
    host: hostname(),
    os: `${process.platform} ${release()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    gpu: "not used by this run, so not recorded",
    node: process.version,
    playwright: require2("playwright/package.json").version,
    browserBinary: executablePath,
    launch: "playwright chromium.launchPersistentContext, headed, --disable-extensions-except + --load-extension",
    headless: false,
    extensionLoaded: true,
    extensionPath: EXT,
    extensionId,
    serviceWorkerUrl,
  },
  manifest: {
    manifestVersion: manifest.manifest_version,
    permissions: manifest.permissions ?? [],
    hostPermissions: manifest.host_permissions ?? [],
  },
  checks,
  failure,
};

mkdirSync(OUT, { recursive: true });
const target = join(OUT, "w2-cft153-extension-load.json");
writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`${record.verdict}  extension load smoke  on ${record.provenance.host} (W2)`);
console.log(`  service worker: ${serviceWorkerUrl ?? "did not boot"}`);
console.log(`  the product loop did NOT run through the extension — that remains NOT PROVEN`);
console.log(`written: ${target}`);
if (!passed) {
  console.error(JSON.stringify({ checks, failure }, null, 2));
  process.exit(1);
}
