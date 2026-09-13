#!/usr/bin/env node
/**
 * Handoff preflight — can THIS machine reproduce the repository's evidence?
 *
 * `npm run verify` answers "is the repository internally consistent". It cannot answer "does this
 * machine have what the evidence needs", because the things the evidence needs most are the ones
 * deliberately absent from Git: the detector artifact, the ORT runtime, the dataset, a browser.
 * A clone that passes `npm run verify` and still cannot build the extension is exactly the trap
 * this script exists to spring early.
 *
 * It is READ-ONLY. It installs nothing, downloads nothing, and writes nothing. Every check either
 * reports a fact or reports that it could not establish one — an unavailable check is never
 * reported as a pass.
 *
 * Deliberately NOT part of `npm run verify`: CI has no detector artifact, and a gate that fails
 * for a reason everyone already knows teaches nothing and trains people to ignore red.
 *
 * Exit code 0 if every REQUIRED check passed, 1 otherwise. OPTIONAL checks never fail the run;
 * they tell you which experiments this machine can and cannot reproduce.
 *
 * See docs/handoff/w1-to-w2/ for what each missing item blocks.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (...p) => join(ROOT, ...p);

/** The identity recorded in artifacts/gates/T1-detector-training/README.md. Quoted, not recomputed. */
const DETECTOR = {
  path: "artifacts/models/t1-ui-head/t1-ui-head.onnx",
  bytes: 302960,
  sha256: "ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0",
};

const results = [];
const record = (level, name, ok, detail) => {
  results.push({ level, name, ok, detail });
  const tag = ok === true ? "  OK  " : ok === false ? " FAIL " : " N/A  ";
  console.log(`[${tag}] ${level === "required" ? "REQ" : "OPT"}  ${name}\n            ${detail}`);
};

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

// ── Node ────────────────────────────────────────────────────────────────────────────────────
{
  const major = Number(process.versions.node.split(".")[0]);
  record(
    "required",
    "Node runtime",
    major >= 20,
    `node ${process.version} (the handoff was verified on v24.19.0; >= 20 expected)`
  );
}

// ── Dependencies installed from the lockfile ────────────────────────────────────────────────
//
// `wxt` is the canary on purpose: it is a workspace devDependency, and an `npm install` that
// leaves it out still looks healthy until the extension build resolves a stray copy from the npm
// cache and fails with a confusing module error. That happened on W1.
{
  const nm = existsSync(rel("node_modules"));
  const wxt = existsSync(rel("node_modules", "wxt"));
  const ort = existsSync(rel("node_modules", "onnxruntime-web"));
  const ok = nm && wxt && ort;
  record(
    "required",
    "dependencies installed from package-lock.json",
    ok,
    ok
      ? "node_modules present, including wxt and onnxruntime-web"
      : `missing: ${[!nm && "node_modules", !wxt && "wxt", !ort && "onnxruntime-web"].filter(Boolean).join(", ")}` +
        " -> run `npm ci` (NOT `npm install`)"
  );
}

// ── The ORT runtime artifact the pin enforces ───────────────────────────────────────────────
{
  const pinFile = rel("packages", "security", "src", "generated", "ortPin.ts");
  if (!existsSync(pinFile)) {
    record("required", "ORT pin", false, "packages/security/src/generated/ortPin.ts is missing");
  } else {
    const src = readFileSync(pinFile, "utf8");
    const artifact = /artifact:\s*\{[^}]*?name:\s*"([^"]+)"[^}]*?bytes:\s*(\d+)[^}]*?sha256:\s*"([0-9a-f]{64})"/s.exec(src);
    if (!artifact) {
      record("required", "ORT pin", false, "could not parse the artifact pin — do not hand-edit this generated file");
    } else {
      const [, name, bytes, hash] = artifact;
      const dist = rel("node_modules", "onnxruntime-web", "dist", name);
      if (!existsSync(dist)) {
        record("required", "ORT runtime artifact", false, `${name} not found in node_modules -> run \`npm ci\``);
      } else {
        const actualBytes = statSync(dist).size;
        const actualHash = sha256(dist);
        const ok = actualBytes === Number(bytes) && actualHash === hash;
        record(
          "required",
          "ORT runtime artifact matches the pin",
          ok,
          ok ? `${name} ${actualBytes} B sha256 ${hash.slice(0, 16)}…` : `DRIFT: ${actualBytes} B sha256 ${actualHash.slice(0, 16)}… != pinned ${hash.slice(0, 16)}…`
        );
      }
    }
  }
}

// ── The detector artifact — the one that blocks the extension build ─────────────────────────
{
  const p = rel(DETECTOR.path);
  if (!existsSync(p)) {
    record(
      "optional",
      "detector artifact t1-ui-head.onnx",
      false,
      `ABSENT at ${DETECTOR.path}. It is gitignored by policy and its licence/provenance is ` +
        "recorded as not yet assembled (ADR-0003), so it is NOT shipped in this repository.\n" +
        "            Blocks: the MV3 host build (apps/extension) and every detector-backed harness.\n" +
        `            Obtain it out of band and verify sha256 ${DETECTOR.sha256.slice(0, 16)}…, or retrain — ` +
        "see docs/handoff/w1-to-w2/artifact-manifest.md §A1"
    );
  } else {
    const bytes = statSync(p).size;
    const hash = sha256(p);
    const ok = bytes === DETECTOR.bytes && hash === DETECTOR.sha256;
    record(
      "optional",
      "detector artifact t1-ui-head.onnx",
      ok,
      ok
        ? `present, ${bytes} B, sha256 matches the T1 training gate record`
        : `PRESENT BUT DIFFERENT: ${bytes} B sha256 ${hash.slice(0, 16)}… != recorded ${DETECTOR.sha256.slice(0, 16)}…\n` +
          "            This is a DIFFERENT ARTIFACT. Existing detector evidence does not transfer to it."
    );
  }
}

// ── Dataset — regenerable, so absence is information rather than a failure ──────────────────
{
  const d = rel("artifacts", "datasets");
  const present = existsSync(d);
  record(
    "optional",
    "dataset t1-ui-rendered",
    present,
    present
      ? "artifacts/datasets/ present"
      : "absent (gitignored, deterministic). Regenerate: `node tools/dataset/build-dataset.mjs --counts=120,40,40`"
  );
}

// ── A Chromium for the browser harnesses ────────────────────────────────────────────────────
{
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) {
    record("optional", "Chromium for browser harnesses", true, `CHROME_PATH -> ${fromEnv}`);
  } else {
    let bundled = null;
    try {
      const { chromium } = await import("playwright");
      bundled = chromium.executablePath();
    } catch {
      /* playwright not installed; reported below */
    }
    if (bundled && existsSync(bundled)) {
      record("optional", "Chromium for browser harnesses", true, `Playwright bundled -> ${bundled}`);
    } else {
      record(
        "optional",
        "Chromium for browser harnesses",
        false,
        (bundled ? `Playwright expects ${bundled}, which is absent. ` : "Playwright not resolvable. ") +
          "Run `npx playwright install chromium`, or set CHROME_PATH to an existing Chromium.\n" +
          "            Record which browser actually ran — the version is part of the evidence."
      );
    }
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────────────────────
const required = results.filter((r) => r.level === "required");
const optional = results.filter((r) => r.level === "optional");
const failedRequired = required.filter((r) => r.ok !== true);
const failedOptional = optional.filter((r) => r.ok !== true);

console.log("");
console.log(`required: ${required.length - failedRequired.length}/${required.length} passed`);
console.log(`optional: ${optional.length - failedOptional.length}/${optional.length} available`);
if (failedOptional.length) {
  console.log("");
  console.log("This machine cannot currently reproduce everything:");
  for (const f of failedOptional) console.log(`  - ${f.name}`);
}
console.log("");
console.log(
  failedRequired.length === 0
    ? "PREFLIGHT OK — the repository is installable and pinned on this machine."
    : "PREFLIGHT FAILED — see the REQ lines above."
);
console.log("A passing preflight is not a claim that any experiment was reproduced.");
process.exit(failedRequired.length === 0 ? 0 : 1);
