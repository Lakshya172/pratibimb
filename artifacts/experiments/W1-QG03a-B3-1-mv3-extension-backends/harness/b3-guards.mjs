/**
 * QG-03a-B3-1 — fail-closed identity and evidence guards.
 *
 * Every check the runner, the native wrapper and the analysis rely on lives here, so it is
 * unit-tested once (packages/perception/test/qg03aB3Harness.test.ts) and cannot drift between
 * scripts. A guard either returns or throws/reports; there is no "probably fine" branch, and a
 * value that was not observed is never read as a pass.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";

export const EXPERIMENT = "W1-QG03a-B3-1-mv3-extension-backends";

export const MODEL = Object.freeze({
  path: "artifacts/models/t1-ui-head/t1-ui-head.onnx",
  bytes: 302960,
  sha256: "ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0",
});
export const ORT_VERSION = "1.29.0";
/** The artifact ORT_PIN (packages/security/src/generated/ortPin.ts) verifies; a test keeps these equal. */
export const ORT_ARTIFACT = Object.freeze({
  name: "ort-wasm-simd-threaded.jsep.wasm",
  bytes: 27797172,
  sha256: "db816fadbab47a755170c08f933961e231412ac17f5981f9a62e519708a44dea",
});
export const INPUT_DIMS = Object.freeze([1, 3, 640, 640]);
export const OUTPUT_DIMS = Object.freeze([1, 12, 6400]);
export const FIXTURE_COUNT = 20;
/** B2's repetition count: one recorded output plus two repeats, all three digests equal. */
export const DETERMINISM_RUNS = 3;
export const REALMS = Object.freeze(["document", "worker"]);
export const BACKENDS = Object.freeze(["wasm", "webgpu"]);
export const WORKSTATION_1 = Object.freeze({ hostname: "LAPTOP-6E14K34L", label: "workstation-1" });
export const DEVELOPMENT_LABEL = "DEVELOPMENT / NON-W1 EVIDENCE";
/** B4 PROPOSED (not approved): reported separately, never silently excluded. */
export const STRESS_ONLY_PROPOSED_PAGES = Object.freeze(["gradients-edges"]);

export class B3GuardError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "B3GuardError";
    this.code = code;
  }
}

export const sha256Hex = (b) => createHash("sha256").update(b).digest("hex");
const sameDims = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";

export function assertModelIdentity(bytes, expected = MODEL) {
  if (!bytes || bytes.length !== expected.bytes) {
    throw new B3GuardError("MODEL_MISMATCH", `${bytes ? bytes.length : "no"} bytes, expected ${expected.bytes}`);
  }
  const s = sha256Hex(bytes);
  if (s !== expected.sha256) throw new B3GuardError("MODEL_MISMATCH", `sha256 ${s}, expected ${expected.sha256}`);
  return s;
}

export function assertOrtVersion(found, where) {
  if (found !== ORT_VERSION) {
    throw new B3GuardError("ORT_VERSION_MISMATCH", `${where} reports ${found}, required ${ORT_VERSION}`);
  }
}

/** The 20 lossless captures of W1-QG03b2a. Never regenerated; a wrong count or field refuses. */
export function selectPngFixtures(fixturesJson) {
  const all = fixturesJson && fixturesJson.fixtures;
  if (!Array.isArray(all)) throw new B3GuardError("FIXTURES_MISSING", "fixtures.json has no fixtures array");
  const png = all.filter((f) => f.encoding === "capture-png");
  if (png.length !== FIXTURE_COUNT) {
    throw new B3GuardError("FIXTURE_COUNT", `${png.length} capture-png fixtures, required ${FIXTURE_COUNT}`);
  }
  if (new Set(png.map((f) => f.source)).size !== png.length) throw new B3GuardError("FIXTURE_DUPLICATE", "duplicate fixture source");
  return png.map((f) => {
    for (const k of ["source", "page", "file", "encodedSha256", "captureSize", "viewportCss", "decodedSize"]) {
      if (f[k] === undefined || f[k] === null) throw new B3GuardError("FIXTURE_FIELD", `${f.source ?? "?"}: missing ${k}`);
    }
    if (!/^[0-9a-f]{64}$/.test((f.digests && f.digests.tensor) || "")) {
      throw new B3GuardError("FIXTURE_FIELD", `${f.source}: missing reference tensor digest`);
    }
    return {
      name: f.source,
      page: f.page,
      display: f.display,
      file: f.file,
      mime: f.mime,
      encodedSha256: f.encodedSha256,
      encodedBytes: f.encodedBytes,
      decodedSize: f.decodedSize,
      captureSize: f.captureSize,
      viewportCss: f.viewportCss,
      dpr: f.dpr,
      tensorSha256: f.digests.tensor,
      stressOnlyProposed: STRESS_ONLY_PROPOSED_PAGES.includes(f.page),
    };
  });
}

export function assertFixtureBytes(fixture, bytes) {
  const s = sha256Hex(bytes);
  if (s !== fixture.encodedSha256) {
    throw new B3GuardError("FIXTURE_HASH_MISMATCH", `${fixture.name}: ${s}, fixtures.json says ${fixture.encodedSha256}`);
  }
  return s;
}

export function assertOutputTensor(dims, data) {
  if (!sameDims(dims, OUTPUT_DIMS)) throw new B3GuardError("OUTPUT_SHAPE_MISMATCH", `${JSON.stringify(dims)}, required ${JSON.stringify(OUTPUT_DIMS)}`);
  const n = OUTPUT_DIMS.reduce((a, b) => a * b, 1);
  if (!data || data.length !== n) throw new B3GuardError("OUTPUT_LENGTH_MISMATCH", `${data ? data.length : "no"} values, required ${n}`);
  let bad = 0;
  for (let i = 0; i < data.length; i += 1) if (!Number.isFinite(data[i])) bad += 1;
  if (bad) throw new B3GuardError("OUTPUT_NON_FINITE", `${bad} non-finite values`);
}

/**
 * Where a run's evidence belongs. Only workstation 1 can produce B3-1 evidence; everything else
 * is labelled development and written under logs/development-<machine>/.
 */
export function evidenceClassFor(hostname) {
  const w1 = hostname === WORKSTATION_1.hostname;
  return {
    hostname,
    workstation1: w1,
    evidenceClass: w1 ? "WORKSTATION-1 CANDIDATE (review required before B3-1 is recorded)" : DEVELOPMENT_LABEL,
    logDir: w1 ? WORKSTATION_1.label : `development-${slug(hostname)}`,
  };
}

export const cellName = (realm, backend, headless = false) => `chromium-${realm}-${backend}${headless ? "-headless" : ""}`;

/** A WebGPU label is an observation only when work was submitted; a WASM zero needs a hook. */
export function gpuProof(backend, gpu) {
  if (!gpu || gpu.hookInstalled !== true) return { verdict: "NOT_OBSERVED", reason: (gpu && gpu.hookError) || "GPUQueue.submit hook not installed" };
  const s = gpu.submitsDuringInference;
  if (!Number.isInteger(s) || !Number.isInteger(gpu.submitsTotal)) return { verdict: "NOT_OBSERVED", reason: "no submit count" };
  if (backend === "webgpu") return s > 0 ? { verdict: "WEBGPU_EXECUTED" } : { verdict: "NO_GPU_WORK", reason: "0 submits on a webgpu cell (silent fallback)" };
  return s === 0 && gpu.submitsTotal === 0
    ? { verdict: "NO_GPU_WORK_AS_EXPECTED" }
    : { verdict: "UNEXPECTED_GPU_WORK", reason: `${gpu.submitsTotal} submits on a wasm cell` };
}

export function verifyNativeLog(log, fixtures) {
  const failures = [];
  const need = (c, m) => { if (!c) failures.push(m); };
  if (!log || typeof log !== "object") return { ok: false, failures: ["native reference log missing"] };
  need(log.ortVersion === ORT_VERSION, `native ORT ${log.ortVersion}, required ${ORT_VERSION}`);
  need(log.ortVersionRequired === ORT_VERSION, "native log does not record the required ORT version (unguarded reference)");
  need(log.model && log.model.sha256 === MODEL.sha256 && log.model.bytes === MODEL.bytes, "native model identity");
  const rows = Array.isArray(log.rows) ? log.rows : [];
  need(rows.length === FIXTURE_COUNT && fixtures.length === FIXTURE_COUNT, `native rows ${rows.length}, required ${FIXTURE_COUNT}`);
  for (const f of fixtures) {
    const r = rows.find((x) => x.name === f.name);
    if (!r) { failures.push(`native ${f.name}: missing`); continue; }
    need(r.pngSha256 === f.encodedSha256, `native ${f.name}: PNG digest`);
    need(r.tensorSha256 === f.tensorSha256, `native ${f.name}: input tensor differs from the reference tensor`);
    need(sameDims(r.dims, OUTPUT_DIMS), `native ${f.name}: output shape`);
    need(r.finite === true, `native ${f.name}: non-finite or unchecked output`);
    need(r.deterministic === true, `native ${f.name}: not deterministic`);
    need(/^[0-9a-f]{64}$/.test(r.outputSha256 || ""), `native ${f.name}: no output digest`);
  }
  return { ok: failures.length === 0, failures };
}

export function verifyCellLog(log, fixtures) {
  const failures = [];
  const need = (c, m) => { if (!c) failures.push(m); };
  if (!log || typeof log !== "object") return { ok: false, failures: ["cell log missing"] };
  need(!log.error, `cell error: ${String(log.error).slice(0, 200)}`);
  need(REALMS.includes(log.realm), `unknown realm ${log.realm}`);
  need(BACKENDS.includes(log.backend), `unknown backend ${log.backend}`);

  // The extension context, from three independent places: the runner (service worker URL),
  // the service worker (getContexts) and the inference realm itself (its own location).
  const ext = log.extension || {};
  const id = ext.id || "";
  const origin = `chrome-extension://${id}`;
  need(/^[a-p]{32}$/.test(id), "no MV3 extension id: the extension was not loaded");
  need(ext.serviceWorkerUrl === `${origin}/background.js`, "service worker is not this extension's background.js");
  const offs = Array.isArray(ext.offscreenContexts) ? ext.offscreenContexts : [];
  need(offs.length === 1 && offs[0].documentUrl === `${origin}/offscreen.html`, "chrome.runtime.getContexts did not report exactly one offscreen document");
  const ctx = log.context || {};
  need(ctx.origin === origin, `inference realm origin ${ctx.origin} is not the extension origin`);
  if (log.realm === "document") need(ctx.realmKind === "document" && ctx.href === `${origin}/offscreen.html`, "document realm is not the offscreen document");
  if (log.realm === "worker") {
    need(ctx.realmKind === "dedicated-worker" && ctx.isDedicatedWorker === true && ctx.href === `${origin}/b3-worker.js`, "worker realm is not the offscreen document's dedicated worker");
  }

  const rt = log.runtime || {};
  need(rt.ortPackageVersion === ORT_VERSION, `ORT package ${rt.ortPackageVersion}, required ${ORT_VERSION}`);
  need(rt.ortEnvVersions && rt.ortEnvVersions.web === ORT_VERSION, `ORT in the realm reports ${JSON.stringify(rt.ortEnvVersions || null)}`);
  need(rt.numThreads === 1 && rt.proxy === false, "realm settings differ from bootstrapOrtRealm (numThreads 1, proxy false)");
  need(rt.pin && rt.pin.artifact === ORT_ARTIFACT.name && rt.pin.sha256 === ORT_ARTIFACT.sha256 && rt.pin.bytes === ORT_ARTIFACT.bytes, "pinned ORT artifact not verified in the realm");
  need(log.model && log.model.sha256SeenInRealm === MODEL.sha256 && log.model.bytes === MODEL.bytes, "model identity in the realm");

  const proof = gpuProof(log.backend, log.gpu);
  const want = log.backend === "webgpu" ? "WEBGPU_EXECUTED" : "NO_GPU_WORK_AS_EXPECTED";
  need(proof.verdict === want, `backend proof: ${proof.verdict}${proof.reason ? ` (${proof.reason})` : ""}`);
  if (log.backend === "webgpu") {
    const a = log.gpu && log.gpu.adapterFromRequestAdapter;
    need(a && a.identified === true, "WebGPU adapter identity not recorded (never inferred from the OS GPU list)");
  }

  const net = log.network || {};
  need(net.observed === true, "network observer not installed");
  const unexpected = (Array.isArray(net.nonSelf) ? net.nonSelf : []).filter((a) => a.origin !== log.collectorOrigin);
  need(unexpected.length === 0, `unexpected network arrivals: ${JSON.stringify(unexpected.slice(0, 3))}`);

  const rows = Array.isArray(log.rows) ? log.rows : [];
  need(rows.length === FIXTURE_COUNT && fixtures.length === FIXTURE_COUNT, `rows ${rows.length}, fixtures ${fixtures.length}, required ${FIXTURE_COUNT}`);
  for (const f of fixtures) {
    const r = rows.find((x) => x.name === f.name);
    if (!r) { failures.push(`${f.name}: missing`); continue; }
    const t = f.name;
    need(!r.error, `${t}: ${r.error}`);
    need(r.pngSha256 === f.encodedSha256, `${t}: PNG digest`);
    need(r.decodedSize && r.decodedSize.w === f.decodedSize.w && r.decodedSize.h === f.decodedSize.h, `${t}: decoded size`);
    need(r.tensorSha256 === f.tensorSha256, `${t}: input tensor differs from the reference tensor`);
    need(sameDims(r.inputDims, INPUT_DIMS), `${t}: input shape`);
    need(sameDims(r.dims, OUTPUT_DIMS), `${t}: output shape ${JSON.stringify(r.dims)}`);
    need(r.nonFinite === 0, `${t}: non-finite outputs`);
    need(
      Array.isArray(r.repeatSha256) && r.repeatSha256.length === DETERMINISM_RUNS - 1 && r.repeatSha256.every((s) => s === r.outputSha256) && r.deterministic === true,
      `${t}: not deterministic over ${DETERMINISM_RUNS} runs`
    );
    need(r.dumpVerified === true, `${t}: raw output dump missing or unverified`);
    need(Array.isArray(r.inferMs) && r.inferMs.length === DETERMINISM_RUNS, `${t}: timings`);
    if (log.backend === "webgpu") need(Array.isArray(r.submits) && r.submits.length === DETERMINISM_RUNS && r.submits.every((s) => s > 0), `${t}: a run without GPU work`);
    else need(Array.isArray(r.submits) && r.submits.length === DETERMINISM_RUNS && r.submits.every((s) => s === 0), `${t}: GPU work on a wasm cell`);
  }
  for (const r of rows) if (!fixtures.some((f) => f.name === r.name)) failures.push(`${r.name}: not a B3-1 fixture`);
  return { ok: failures.length === 0, failures };
}

/** What the OS says is installed. Not evidence of which GPU ran a cell: the adapter record is. */
export function machineInfo() {
  const cpus = os.cpus();
  const info = {
    hostname: os.hostname(),
    platform: process.platform,
    osRelease: os.release(),
    osVersion: typeof os.version === "function" ? os.version() : null,
    cpu: cpus[0] ? cpus[0].model.trim() : null,
    logicalCpus: cpus.length,
    ramBytes: os.totalmem(),
    node: process.version,
    gpusNote: "OS inventory only; it does not say which GPU executed a cell (the adapter record does)",
  };
  if (process.platform === "win32") {
    try {
      const out = execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + '|' + $_.DriverVersion }"], { encoding: "utf8" });
      info.gpusReportedByOs = out.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
        const [name, driver] = l.split("|");
        return { name: name.trim(), driver: (driver || "").trim() };
      });
    } catch (e) {
      info.gpusReportedByOsError = String(e).slice(0, 200);
    }
  }
  return info;
}
