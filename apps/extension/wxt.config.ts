/**
 * MINIMAL MV3 HOST — WXT configuration. NOT the product extension.
 *
 * Purpose: prove the runtime architecture physically runs in MV3 (loads, offscreen lifecycle,
 * service-worker termination, ORT in the offscreen document, message latency, sender identity,
 * CSP). No sanitizer, no verifier, no production vault, no server client, no real site.
 *
 * `entrypointsDir` is `host/` so the existing `entrypoints/ortRuntime.ts` (the sanctioned ORT
 * bootstrap, not a WXT entrypoint) keeps its path and meaning.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { buildExtensionPagesCsp } from "../../packages/security/src/csp";
import { ORT_PIN } from "../../packages/security/src/generated/ortPin";
import { TR01_PACKAGE } from "./host-lib/tr01-pin";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

/**
 * The ONE pinned network origin (ADR-0001 §7.2): a loopback collector used by host evidence runs.
 * Loopback only; there is no server client in this host.
 */
export const HOST_COLLECTOR_ORIGIN = "http://127.0.0.1:8995";

/**
 * WHETHER THIS BUILD CARRIES E6's MECHANISMS. It does not, unless something asks for them.
 *
 * `e6/probe.ts` holds a pointer/mouse sequence and three text-insertion mechanisms that consult no
 * permit, no hit test, no plan and no binding — E6 asked what a content script can do at all, which
 * is the opposite of an authority. Shipping them behind a message kind made the extension have two
 * execution paths and one of them ungated, so the alias below resolves to a stub containing no
 * mechanism unless `E6_PROBE=1` is set. The only caller that sets it is E6's own harness.
 *
 * This is a build-graph decision, not a runtime flag: the code is absent from the bundle rather
 * than present and refused.
 */
const E6_PROBE = process.env.E6_PROBE === "1";

/**
 * THE STRUCTURAL PROBE FOLLOWS THE SAME RULE, AND FOR THE SAME REASON.
 *
 * `probe/structural.ts` drives constitution §6's stale-observation path a step at a time so an
 * evidence run can change the page between a reading and an action. It adds no authority — it
 * composes the unchanged gates — but it is a test-only control operation, and M6.1 shipped it in
 * the product bundle. "Harmless" is an argument about consequences rather than about what belongs
 * in a product, so the alias below resolves to a stub containing no driver unless
 * `STRUCTURAL_PROBE=1` is set. The only caller that sets it is `run-structural-stale.mjs`.
 *
 * The signal it drives is product code and is unaffected: a build with this flag and a build
 * without it produce a byte-identical `content.js`.
 */
const STRUCTURAL_PROBE = process.env.STRUCTURAL_PROBE === "1";

/**
 * HOW M3's CAPTURE GETS ITS PERMISSION, AND WHY THERE ARE TWO ANSWERS.
 *
 * `chrome.tabs.captureVisibleTab` requires `activeTab` or `<all_urls>` — MEASURED on W1, not read
 * off a doc page: with only `http://127.0.0.1/*` the call refuses with
 * "Either the '<all_urls>' or 'activeTab' permission is required."
 *
 * `activeTab` is the right product permission and the one the default build declares: an agent acts
 * on the tab a person invoked it on, and the grant arrives with that invocation. But `activeTab` is
 * granted by a USER GESTURE — a toolbar click, a context menu, a command — and a Playwright harness
 * cannot produce one. So the evidence harness builds with `M3_CAPTURE_WITHOUT_GESTURE=1`, which
 * substitutes `<all_urls>` for the gesture and changes nothing else: the same capture call, the same
 * transfer, the same perception realm, the same everything downstream.
 *
 * The default build does NOT carry `<all_urls>`, and a test asserts that. Widening a manifest to
 * every origin is exactly the kind of thing that arrives quietly in a privacy milestone, so it is a
 * flag with a name that says what it is.
 */
/**
 * THE DEGRADED CAPTURE PATH, off unless a build asks for it by name.
 *
 * The product path is `getMediaStreamId` under an `activeTab` grant a person produced: the worker
 * mints an opaque handle and the offscreen document redeems it for pixels itself. No automated
 * harness can produce that invocation -- measured on W1, `<all_urls>` does not substitute for it,
 * a click inside an extension page does not, and a CDP keyboard command does not reach Chrome's
 * accelerator table -- so an evidence run cannot exercise it.
 *
 * `M3_WORKER_FRAME=1` compiles in the path where `captureVisibleTab` runs in the worker and the
 * worker therefore holds the frame. It brings `<all_urls>` with it because that is the permission
 * it needs, and it is one flag rather than two so the two cannot drift apart. Both the flag and
 * the route it enables are named in every record that mentions them.
 */
const WORKER_FRAME = process.env.M3_WORKER_FRAME === "1";

/**
 * M10.4 — THE TR-01 PROBE AND ITS INSTRUMENT FOLLOW THE SAME RULE.
 *
 * `probe/tr01.ts` drives the detector worker from the offscreen document step by step, and
 * `probe/tr01-instrument.ts` reads the worker's WASM linear memory and network arrivals. Both are
 * measurement and test control, so both resolve to empty stubs unless `TR01_PROBE=1` is set. The
 * only caller that sets it is `tests/browser/extension/run-tr01-worker.mjs`.
 */
const TR01_PROBE = process.env.TR01_PROBE === "1";
const HOST_PERMISSIONS = WORKER_FRAME ? ["http://127.0.0.1/*", "<all_urls>"] : ["http://127.0.0.1/*"];

const ORT_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist");
const MODEL = join(ROOT, "artifacts", "models", "t1-ui-head", "t1-ui-head.onnx");
const TR01_MODEL = join(ROOT, TR01_PACKAGE.modelPath);

export default defineConfig({
  entrypointsDir: "host",
  /** Resolved for both the bundler and the generated tsconfig. See `E6_PROBE` above. */
  alias: {
    "#e6-probe": E6_PROBE ? "e6/probe.ts" : "e6/absent.ts",
    "#structural-probe": STRUCTURAL_PROBE ? "probe/structural.ts" : "probe/structural-absent.ts",
    "#tr01-probe": TR01_PROBE ? "probe/tr01.ts" : "probe/tr01-absent.ts",
    "#tr01-instrument": TR01_PROBE ? "probe/tr01-instrument.ts" : "probe/tr01-instrument-absent.ts",
  },
  /**
   * Workspace packages are bundled from TypeScript source rather than from `dist/`, so a host build
   * cannot silently ship a stale compile of the agent core. `npm run typecheck` still type-checks
   * those packages; this only decides what the bundler reads.
   */
  vite: () => ({
    // Substituted at build time so the degraded path is absent from a product bundle rather than
    // present behind a runtime check, the same rule `#e6-probe` follows.
    define: { __M3_WORKER_FRAME__: JSON.stringify(WORKER_FRAME) },
    resolve: {
      alias: {
        "@pratibimb/agent": join(ROOT, "packages", "agent", "src", "index.ts"),
        "@pratibimb/perception": join(ROOT, "packages", "perception", "src", "index.ts"),
        "@pratibimb/security": join(ROOT, "packages", "security", "src", "index.ts"),
        "@pratibimb/extension-transport": join(ROOT, "packages", "extension-transport", "src", "index.ts"),
        // M1: the product authorities, so the loop the demo already runs can run in the offscreen
        // realm instead of being reimplemented for it. Source, not `dist/`, for the same reason as
        // above: a host build must not ship a stale compile of a security layer.
        "@pratibimb/privacy": join(ROOT, "packages", "privacy", "src", "index.ts"),
        "@pratibimb/plan": join(ROOT, "packages", "plan", "src", "index.ts"),
        "@pratibimb/reasoner": join(ROOT, "packages", "reasoner", "src", "index.ts"),
        "@pratibimb/egress": join(ROOT, "packages", "egress", "src", "index.ts"),
        "@pratibimb/orchestrator": join(ROOT, "packages", "orchestrator", "src", "index.ts"),
      },
    },
  }),
  manifest: {
    name: "PratiBimb minimal MV3 host (experiment — not the product)",
    version: "0.0.0",
    minimum_chrome_version: "116",
    permissions: ["offscreen", "sidePanel", "activeTab", "tabCapture"],
    action: { default_title: "PratiBimb: perceive this tab" },
    commands: {
      _execute_action: { suggested_key: { default: "Alt+Shift+P" }, description: "Perceive this tab" },
    },
    host_permissions: HOST_PERMISSIONS,
    content_security_policy: { extension_pages: buildExtensionPagesCsp(HOST_COLLECTOR_ORIGIN) },
    side_panel: { default_path: "sidepanel.html" },
  },
  hooks: {
    // ORT's pinned files and the T1 artifact are copied from node_modules / artifacts at build time,
    // never committed. The runtime pin (ortRuntime.ts) re-hashes the WASM before any session exists.
    "build:publicAssets": (_wxt, assets) => {
      for (const name of [ORT_PIN.bundle.name, ORT_PIN.artifact.name, ORT_PIN.glue.name]) {
        const src = join(ORT_DIST, name);
        if (!existsSync(src)) throw new Error(`missing ${src} (run: npm ci)`);
        assets.push({ absoluteSrc: src, relativeDest: name });
      }
      if (!existsSync(MODEL)) throw new Error(`missing ${MODEL}`);
      assets.push({ absoluteSrc: MODEL, relativeDest: "t1-ui-head.onnx" });
      // M10.4: TR-01, git-ignored like the UI head, and REFUSED at build time unless its bytes are
      // exactly the pinned artifact. The worker hashes it again at runtime before any session.
      if (!existsSync(TR01_MODEL)) {
        throw new Error(`missing ${TR01_MODEL} (provision it from M8.1's converted artifact; see ${TR01_PACKAGE.evidence})`);
      }
      const tr01 = readFileSync(TR01_MODEL);
      const tr01Sha = createHash("sha256").update(tr01).digest("hex");
      if (tr01Sha !== TR01_PACKAGE.onnx.sha256 || tr01.length !== TR01_PACKAGE.onnx.bytes) {
        throw new Error(
          `TR-01 model mismatch at ${TR01_MODEL}: expected ${TR01_PACKAGE.onnx.sha256} (${TR01_PACKAGE.onnx.bytes} B), ` +
            `got ${tr01Sha} (${tr01.length} B). Refusing to package it.`
        );
      }
      assets.push({ absoluteSrc: TR01_MODEL, relativeDest: TR01_PACKAGE.onnx.name });
    },
  },
});

