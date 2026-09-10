#!/usr/bin/env node
/**
 * ADR-0001 G4b (constraint C-2) — derive the ORT runtime pin from the SHIPPED bundle.
 *
 *   node scripts/generate-ort-pin.mjs           regenerate the pin
 *   node scripts/generate-ort-pin.mjs --check    fail if the committed pin has drifted
 *
 * WHAT THIS CAN AND CANNOT DO — stated plainly, because overstating it would defeat the
 * purpose of the gate.
 *
 * It CANNOT statically prove which `.wasm` a minified ORT bundle will fetch at runtime.
 * That mapping was established EXPERIMENTALLY in W1-S02a-2a-3, which measured that
 * `ort.all.min.js` loads `ort-wasm-simd-threaded.jsep.wasm` — and NOT
 * `ort-wasm-simd-threaded.wasm`, which is the file one would naively pin.
 *
 * What it CAN do, and does: hash every input that mapping depends on — the ORT version,
 * the bundle itself, the artifact, and the glue — and FAIL THE BUILD if any of them
 * changes. A changed bundle means the measured mapping is no longer evidence for the
 * shipped code, so the correct response is to re-run the experiment, not to re-hash and
 * carry on. `--check` says exactly that when it fires.
 *
 * C-2 in one line: the pin is bundle-specific, not a universal "ORT pin".
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "packages", "security", "src", "generated", "ortPin.ts");

/**
 * The bundle PratiBimb ships, and the artifact W1-S02a-2a-3 MEASURED it to load.
 * Changing either requires re-running that experiment — see the header.
 */
const SHIPPED = {
  package: "onnxruntime-web",
  bundle: "ort.all.min.js",
  artifact: "ort-wasm-simd-threaded.jsep.wasm",
  glue: "ort-wasm-simd-threaded.jsep.mjs",
  evidence: "artifacts/experiments/W1-S02a2a3-ort-wasm-hash-pin/README.md",
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * The ORT API the runtime pin is BUILT ON — see packages/security/src/ortRuntimePin.ts.
 *
 * That module types ORT structurally (`OrtLike`) and deliberately does not import it, so
 * the security package stays testable without pulling in a 28 MB dependency. The price of
 * structural typing is that it cannot notice an upstream rename. If `wasmBinary` ever
 * became, say, `wasmBuffer`, our code would go on assigning a property ORT no longer
 * reads. Nothing would throw. ORT would quietly fall back to fetching the artifact over
 * the network via `wasmPaths`, and the pin would degrade into an expensive no-op that
 * still reports success.
 *
 * That is the same failure class C-2 exists to prevent — a check that passes while
 * verifying nothing — so it is gated the same way: assert the declarations are present in
 * the SHIPPED types, and break the build when they are not.
 */
const API_SURFACE = [
  // The pin's entire mechanism: hand ORT the exact buffer we hashed.
  "wasmBinary?: ArrayBufferLike | Uint8Array;",
  // Must stay optional, and must stay ignored while wasmBinary is set. The runtime relies
  // on that precedence for its guarantee that there is no second, unverified fetch path.
  "wasmPaths?: WasmPrefixOrFilePaths;",
];

/** Locate onnxruntime-common's env declarations beside the installed onnxruntime-web. */
function findEnvTypes(dist) {
  const pkgDir = dirname(dist); // .../onnxruntime-web
  const nm = dirname(pkgDir); // .../node_modules
  return [
    join(nm, "onnxruntime-common", "dist", "cjs", "env.d.ts"),
    join(nm, "onnxruntime-common", "dist", "esm", "env.d.ts"),
    join(pkgDir, "node_modules", "onnxruntime-common", "dist", "cjs", "env.d.ts"),
  ].find((c) => existsSync(c)) ?? null;
}

const rel = (p) => p.replace(ROOT + "\\", "").replace(ROOT + "/", "");

function assertOrtApiSurface(dist, version) {
  const envTypes = findEnvTypes(dist);
  if (!envTypes) {
    fail(
      `Cannot find onnxruntime-common's env.d.ts beside ${SHIPPED.package}@${version}.\n` +
        `  The runtime pin's API assumptions cannot be verified here, so the pin cannot be\n` +
        `  trusted. Refusing rather than assuming the API is unchanged.`
    );
  }
  const src = readFileSync(envTypes, "utf8");
  const missing = API_SURFACE.filter((decl) => !src.includes(decl));
  if (missing.length) {
    fail(
      `${SHIPPED.package}@${version} no longer declares the API the runtime pin depends on.\n\n  ` +
        missing.map((m) => `missing: ${m}`).join("\n  ") +
        `\n\n  Checked: ${rel(envTypes)}\n\n` +
        `  packages/security/src/ortRuntimePin.ts types ORT structurally, so a rename here\n` +
        `  does NOT surface as a type error — it produces a pin that silently stops applying\n` +
        `  while still reporting success. Update ortRuntimePin.ts to the new API and\n` +
        `  re-confirm the verified buffer is still the only source of WASM bytes.`
    );
  }
  return envTypes;
}

function resolveDist() {
  const candidates = [
    // ORT_DIST lets the pin be derived from a known-good install when the workspace copy
    // is not yet present. It does NOT weaken the gate: `--check` always resolves the
    // WORKSPACE copy, so a pin generated elsewhere is only accepted if the shipped
    // install is byte-identical to it.
    process.env.ORT_DIST,
    join(ROOT, "apps", "extension", "node_modules", SHIPPED.package, "dist"),
    join(ROOT, "node_modules", SHIPPED.package, "dist"),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  fail(
    `Cannot find ${SHIPPED.package}/dist.\n` +
      `  Looked in:\n    ${candidates.join("\n    ")}\n` +
      `  Run: npm ci`
  );
}

function fail(msg) {
  console.error("\nORT PIN: FAIL\n");
  console.error(msg);
  process.exit(1);
}

function derive() {
  const dist = resolveDist();
  const pkgPath = join(dirname(dist), "package.json");
  const version = JSON.parse(readFileSync(pkgPath, "utf8")).version;

  const files = {};
  for (const key of ["bundle", "artifact", "glue"]) {
    const name = SHIPPED[key];
    const p = join(dist, name);
    if (!existsSync(p)) {
      fail(
        `${SHIPPED.package}@${version} does not contain ${name}.\n` +
          `  The shipped bundle layout has changed, so the artifact mapping measured in\n` +
          `  ${SHIPPED.evidence}\n` +
          `  no longer describes this build. Re-run that experiment before re-pinning.`
      );
    }
    const bytes = readFileSync(p);
    files[key] = { name, bytes: bytes.length, sha256: sha256(bytes) };
  }
  assertOrtApiSurface(dist, version);
  return { version, files };
}

function render({ version, files }) {
  return `// GENERATED by scripts/generate-ort-pin.mjs — DO NOT EDIT BY HAND.
// Regenerate: npm run pin:generate   ·   Verify: npm run pin:check
//
// ADR-0001 constraint C-2: this pin is BUNDLE-SPECIFIC. It is not a universal ORT pin.
// The artifact below is the one \`${files.bundle.name}\` was MEASURED to load in
// W1-S02a-2a-3; a different ORT bundle loads a different artifact, and pinning the wrong
// one produces a check that passes while verifying nothing.

/** Provenance of the pin, so a reviewer can trace it without leaving the file. */
export const ORT_PIN_EVIDENCE =
  "${SHIPPED.evidence}" as const;

export interface OrtArtifactPin {
  /** File name as it appears in the ORT dist directory. */
  readonly name: string;
  readonly bytes: number;
  /** Lowercase hex SHA-256. */
  readonly sha256: string;
}

export const ORT_PIN = {
  package: "${SHIPPED.package}",
  version: "${version}",

  /** The bundle the extension ships. Hashed so a bundle swap breaks the build. */
  bundle: {
    name: "${files.bundle.name}",
    bytes: ${files.bundle.bytes},
    sha256: "${files.bundle.sha256}",
  } satisfies OrtArtifactPin,

  /**
   * The WebAssembly artifact that bundle loads. THIS is what the runtime pin enforces:
   * exact bytes hashed == exact bytes executed.
   */
  artifact: {
    name: "${files.artifact.name}",
    bytes: ${files.artifact.bytes},
    sha256: "${files.artifact.sha256}",
  } satisfies OrtArtifactPin,

  /**
   * ADR-0001 constraint C-3 — the Emscripten glue.
   *
   * Recorded here for provenance and build-time drift detection ONLY. It is deliberately
   * NOT enforced at runtime: the glue is loaded by a dynamic \`import()\`, which MV3
   * governs through \`script-src\` rather than \`connect-src\`, so it can only come from the
   * extension package and cannot be intercepted and hashed before execution.
   *
   * Packaging is the control. This hash is NOT a runtime pin and must not be described as
   * one. C-3 is mitigated, not eliminated.
   */
  glue: {
    name: "${files.glue.name}",
    bytes: ${files.glue.bytes},
    sha256: "${files.glue.sha256}",
  } satisfies OrtArtifactPin,
} as const;

export type OrtPin = typeof ORT_PIN;
`;
}

function extract(source, key) {
  const block = source.match(new RegExp(`${key}: \\{[^}]*\\}`, "s"));
  if (!block) return null;
  const name = block[0].match(/name: "([^"]+)"/)?.[1];
  const hash = block[0].match(/sha256: "([0-9a-f]{64})"/)?.[1];
  return name && hash ? { name, sha256: hash } : null;
}

const check = process.argv.includes("--check");
if (check && process.env.ORT_DIST) {
  delete process.env.ORT_DIST; // the gate verifies what SHIPS, never a convenience copy
}
const derived = derive();
const rendered = render(derived);

if (!check) {
  writeFileSync(OUT, rendered, "utf8");
  console.log(`ORT PIN: written -> ${OUT.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
  console.log(`  ${derived.files.bundle.name}   ${derived.files.bundle.sha256}`);
  console.log(`  ${derived.files.artifact.name}  ${derived.files.artifact.sha256}  <- runtime pin`);
  console.log(`  ${derived.files.glue.name}   ${derived.files.glue.sha256}  <- C-3, packaged not pinned`);
  process.exit(0);
}

if (!existsSync(OUT)) fail(`Pin file missing: ${OUT}\n  Run: npm run pin:generate`);
const committed = readFileSync(OUT, "utf8");

const drift = [];
for (const key of ["bundle", "artifact", "glue"]) {
  const was = extract(committed, key);
  const now = derived.files[key];
  if (!was) { drift.push(`${key}: not present in the committed pin`); continue; }
  if (was.name !== now.name) drift.push(`${key} NAME  committed=${was.name}  installed=${now.name}`);
  else if (was.sha256 !== now.sha256)
    drift.push(`${key} SHA256\n      committed=${was.sha256}\n      installed=${now.sha256}`);
}
const committedVersion = committed.match(/version: "([^"]+)"/)?.[1];
if (committedVersion !== derived.version)
  drift.push(`version  committed=${committedVersion}  installed=${derived.version}`);

if (drift.length) {
  fail(
    `The committed ORT pin does not match the installed runtime.\n\n  ` +
      drift.join("\n  ") +
      `\n\n  ADR-0001 C-2: the pin is bundle-specific. A changed bundle means the artifact\n` +
      `  mapping measured in\n    ${SHIPPED.evidence}\n` +
      `  is no longer evidence for the shipped code.\n\n` +
      `  Do NOT simply re-run \`npm run pin:generate\`. Re-run the experiment first and confirm\n` +
      `  which artifact the new bundle actually loads, then regenerate.`
  );
}

console.log(`ORT PIN: OK  ${derived.files.artifact.name}  ${derived.files.artifact.sha256}`);
console.log(`  ${SHIPPED.package}@${derived.version}, bundle ${derived.files.bundle.name}`);
