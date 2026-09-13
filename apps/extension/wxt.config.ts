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

import { buildExtensionPagesCsp } from "../../packages/security/src/csp";
import { ORT_PIN } from "../../packages/security/src/generated/ortPin";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

/**
 * The ONE pinned network origin (ADR-0001 §7.2): a loopback collector used by host evidence runs.
 * Loopback only; there is no server client in this host.
 */
export const HOST_COLLECTOR_ORIGIN = "http://127.0.0.1:8995";

const ORT_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist");
const MODEL = join(ROOT, "artifacts", "models", "t1-ui-head", "t1-ui-head.onnx");

export default defineConfig({
  entrypointsDir: "host",
  manifest: {
    name: "PratiBimb minimal MV3 host (experiment — not the product)",
    version: "0.0.0",
    minimum_chrome_version: "116",
    permissions: ["offscreen", "sidePanel"],
    host_permissions: ["http://127.0.0.1/*"],
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
    },
  },
});

