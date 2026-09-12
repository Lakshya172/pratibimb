/**
 * QG-03a-B3-1 — the harness guards, tested on their own.
 *
 * Harness: artifacts/experiments/W1-QG03a-B3-1-mv3-extension-backends/harness/
 *
 * B3-1 exists because workstation 1's earlier evidence cannot be audited after the fact: its
 * reference was a different ORT version and its raw outputs were not kept. So the guards that
 * make a B3-1 cell auditable are themselves tested here: identity, version, fixtures, shapes,
 * the GPU-submit hook, the extension-context assertion, determinism, and every fail-closed path.
 * These tests launch no browser and need no model; they use the committed fixtures and synthetic
 * records.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HARNESS = join(REPO, "artifacts/experiments/W1-QG03a-B3-1-mv3-extension-backends/harness");
const QG = join(REPO, "artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture");
const sha = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");

// Imported by URL so the harness stays plain .mjs outside any tsconfig rootDir.
let G: any;
let C: any;
let PIN: any;
beforeAll(async () => {
  G = await import(pathToFileURL(join(HARNESS, "b3-guards.mjs")).href);
  C = await import(pathToFileURL(join(HARNESS, "b3-criterion.mjs")).href);
  PIN = (await import(pathToFileURL(join(REPO, "packages/security/src/generated/ortPin.ts")).href)).ORT_PIN;
});

const fixturesJson = () => JSON.parse(readFileSync(join(QG, "fixtures.json"), "utf8"));

/** A cell log that passes every guard, so each test can break exactly one thing. */
function validCell(backend: "wasm" | "webgpu", realm: "document" | "worker", fixtures: any[]) {
  const id = "a".repeat(32);
  const origin = `chrome-extension://${id}`;
  return {
    experiment: "W1-QG03a-B3-1-mv3-extension-backends",
    cell: `chromium-${realm}-${backend}`,
    realm,
    backend,
    collectorOrigin: "http://127.0.0.1:8971",
    extension: { id, serviceWorkerUrl: `${origin}/background.js`, offscreenContexts: [{ contextType: "OFFSCREEN_DOCUMENT", documentUrl: `${origin}/offscreen.html` }] },
    context: {
      origin,
      href: realm === "worker" ? `${origin}/b3-worker.js` : `${origin}/offscreen.html`,
      realmKind: realm === "worker" ? "dedicated-worker" : "document",
      isDedicatedWorker: realm === "worker",
    },
    runtime: {
      ortPackageVersion: "1.29.0",
      ortEnvVersions: { common: "1.29.0", web: "1.29.0" },
      numThreads: 1,
      proxy: false,
      pin: { artifact: G.ORT_ARTIFACT.name, sha256: G.ORT_ARTIFACT.sha256, bytes: G.ORT_ARTIFACT.bytes },
    },
    model: { sha256SeenInRealm: G.MODEL.sha256, bytes: G.MODEL.bytes },
    gpu: {
      hookInstalled: true,
      hookError: null,
      submitsTotal: backend === "webgpu" ? 180 : 0,
      submitsDuringInference: backend === "webgpu" ? 180 : 0,
      adapterFromRequestAdapter: backend === "webgpu" ? { returned: true, vendor: "intel", architecture: "gen-12lp", identified: true } : null,
    },
    network: { observed: true, nonSelf: [{ kind: "fetch", origin: "http://127.0.0.1:8971" }] },
    rows: fixtures.map((f) => ({
      name: f.name,
      pngSha256: f.encodedSha256,
      decodedSize: f.decodedSize,
      tensorSha256: f.tensorSha256,
      inputDims: [1, 3, 640, 640],
      dims: [1, 12, 6400],
      nonFinite: 0,
      outputSha256: "b".repeat(64),
      repeatSha256: ["b".repeat(64), "b".repeat(64)],
      deterministic: true,
      dumpVerified: true,
      inferMs: [9, 9, 9],
      submits: backend === "webgpu" ? [9, 9, 9] : [0, 0, 0],
    })),
    error: null,
  };
}

describe("QG-03a-B3-1 harness — identity guards", () => {
  it("the model guard refuses a wrong size or digest, and states the documented artifact", () => {
    expect(G.MODEL.sha256).toBe("ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0");
    expect(G.MODEL.bytes).toBe(302960);
    const bytes = Buffer.alloc(16, 7);
    expect(G.assertModelIdentity(bytes, { bytes: 16, sha256: sha(bytes) })).toBe(sha(bytes));
    expect(() => G.assertModelIdentity(Buffer.alloc(15), { bytes: 16, sha256: sha(bytes) })).toThrow(/MODEL_MISMATCH/);
    expect(() => G.assertModelIdentity(Buffer.alloc(16, 8), { bytes: 16, sha256: sha(bytes) })).toThrow(/MODEL_MISMATCH/);
  });

  it("the ORT version guard accepts only 1.29.0, and matches the shipped pin", () => {
    expect(() => G.assertOrtVersion("1.29.0", "test")).not.toThrow();
    expect(() => G.assertOrtVersion("1.20.1", "test")).toThrow(/ORT_VERSION_MISMATCH/);
    expect(G.ORT_VERSION).toBe(PIN.version);
    expect(G.ORT_ARTIFACT).toEqual({ name: PIN.artifact.name, bytes: PIN.artifact.bytes, sha256: PIN.artifact.sha256 });
  });

  it("the fixture guard selects exactly the 20 committed PNGs and verifies their bytes", () => {
    const fx = G.selectPngFixtures(fixturesJson());
    expect(fx).toHaveLength(20);
    expect(fx.filter((f: any) => f.stressOnlyProposed).map((f: any) => f.name).sort()).toEqual(["gradients-edges.headful", "gradients-edges.headless"]);
    for (const f of fx) expect(G.assertFixtureBytes(f, readFileSync(join(QG, "harness", "captured", f.file)))).toBe(f.encodedSha256);
    const f0 = fx[0];
    const original = readFileSync(join(QG, "harness", "captured", f0.file));
    const lastByte = original.at(-1) ?? 0;
    const tampered = Buffer.concat([original.subarray(0, original.length - 1), Buffer.from([lastByte ^ 1])]);
    expect(() => G.assertFixtureBytes(f0, tampered)).toThrow(/FIXTURE_HASH_MISMATCH/);
  });

  it("the fixture guard refuses a wrong count or a missing reference tensor digest", () => {
    const j = fixturesJson();
    expect(() => G.selectPngFixtures({ fixtures: j.fixtures.filter((f: any) => f.encoding === "capture-png").slice(0, 19) })).toThrow(/FIXTURE_COUNT/);
    const noDigest = j.fixtures.filter((f: any) => f.encoding === "capture-png").map((f: any, i: number) => (i === 0 ? { ...f, digests: {} } : f));
    expect(() => G.selectPngFixtures({ fixtures: noDigest })).toThrow(/FIXTURE_FIELD/);
    expect(() => G.selectPngFixtures({})).toThrow(/FIXTURES_MISSING/);
  });

  it("the output guard refuses a wrong shape, a wrong length or a non-finite value", () => {
    const ok = new Float32Array(1 * 12 * 6400);
    expect(() => G.assertOutputTensor([1, 12, 6400], ok)).not.toThrow();
    expect(() => G.assertOutputTensor([1, 12, 6399], ok)).toThrow(/OUTPUT_SHAPE_MISMATCH/);
    expect(() => G.assertOutputTensor([1, 12, 6400], new Float32Array(10))).toThrow(/OUTPUT_LENGTH_MISMATCH/);
    const nan = new Float32Array(ok.length);
    nan[5] = Number.NaN;
    expect(() => G.assertOutputTensor([1, 12, 6400], nan)).toThrow(/OUTPUT_NON_FINITE/);
  });
});

describe("QG-03a-B3-1 harness — backend proof", () => {
  it("counts real GPUQueue submits and records the adapter, installed before ORT exists", () => {
    const ctx: any = {
      GPUQueue: class { submit() { return "native"; } },
      GPUDevice: class { createComputePipeline() { return "pipeline"; } },
      navigator: { gpu: { requestAdapter: async () => ({ info: { vendor: "intel", architecture: "gen-12lp", device: "", description: "Intel(R) Graphics" } }) } },
      location: { href: "chrome-extension://aaaa/offscreen.html", origin: "chrome-extension://aaaa" },
      URL,
      fetch: async () => ({ ok: true }),
    };
    vm.createContext(ctx);
    vm.runInContext(readFileSync(join(HARNESS, "b3-instrument.js"), "utf8"), ctx);
    expect(ctx.__b3.gpu.hookInstalled).toBe(true);
    const q = new ctx.GPUQueue();
    expect(q.submit([])).toBe("native"); // the wrapper forwards
    q.submit([]);
    expect(ctx.__b3.gpu.submits).toBe(2);
    expect(ctx.__b3.network.observed).toBe(true);
    expect(ctx.__b3.selfOrigin).toBe("chrome-extension://aaaa");
    return ctx.navigator.gpu.requestAdapter({ powerPreference: "high-performance" }).then(() => {
      expect(ctx.__b3.gpu.adapter).toMatchObject({ returned: true, vendor: "intel", architecture: "gen-12lp", identified: true });
      expect(ctx.__b3.gpu.requestAdapterCalls).toBe(1);
    });
  });

  it("a realm without GPUQueue reports a hook error, so a WASM zero is NOT_OBSERVED", () => {
    const ctx: any = { location: { href: "chrome-extension://aaaa/b3-worker.js", origin: "chrome-extension://aaaa" }, URL, fetch: async () => ({ ok: true }) };
    vm.createContext(ctx);
    vm.runInContext(readFileSync(join(HARNESS, "b3-instrument.js"), "utf8"), ctx);
    expect(ctx.__b3.gpu.hookInstalled).toBe(false);
    expect(ctx.__b3.gpu.hookError).toMatch(/GPUQueue/);
    expect(G.gpuProof("wasm", { hookInstalled: false, hookError: ctx.__b3.gpu.hookError }).verdict).toBe("NOT_OBSERVED");
  });

  it("classifies submit counts: a webgpu cell must submit, a wasm cell must not", () => {
    expect(G.gpuProof("webgpu", { hookInstalled: true, submitsTotal: 180, submitsDuringInference: 180 }).verdict).toBe("WEBGPU_EXECUTED");
    expect(G.gpuProof("webgpu", { hookInstalled: true, submitsTotal: 0, submitsDuringInference: 0 }).verdict).toBe("NO_GPU_WORK");
    expect(G.gpuProof("wasm", { hookInstalled: true, submitsTotal: 0, submitsDuringInference: 0 }).verdict).toBe("NO_GPU_WORK_AS_EXPECTED");
    expect(G.gpuProof("wasm", { hookInstalled: true, submitsTotal: 3, submitsDuringInference: 3 }).verdict).toBe("UNEXPECTED_GPU_WORK");
  });
});

describe("QG-03a-B3-1 harness — a cell is accepted only on full evidence", () => {
  it("accepts a complete cell in either realm", () => {
    const fx = G.selectPngFixtures(fixturesJson());
    for (const realm of ["document", "worker"] as const) {
      for (const backend of ["wasm", "webgpu"] as const) {
        const v = G.verifyCellLog(validCell(backend, realm, fx), fx);
        expect(v.failures, `${realm}/${backend}`).toEqual([]);
        expect(v.ok).toBe(true);
      }
    }
  });

  it("fails closed on every missing or wrong piece of evidence", () => {
    const fx = G.selectPngFixtures(fixturesJson());
    const broken: [string, (c: any) => void, RegExp][] = [
      ["a plain page instead of the extension", (c) => { c.context.origin = "http://127.0.0.1:8971"; }, /not the extension origin/],
      ["no extension loaded", (c) => { c.extension.id = null; }, /extension was not loaded/],
      ["no offscreen document", (c) => { c.extension.offscreenContexts = []; }, /offscreen document/],
      ["the worker realm running in the document", (c) => { c.realm = "worker"; c.context.realmKind = "document"; c.context.isDedicatedWorker = false; }, /dedicated worker/],
      ["a different ORT version in the realm", (c) => { c.runtime.ortEnvVersions.web = "1.20.1"; }, /ORT in the realm/],
      ["threads or proxy not as bootstrapOrtRealm sets them", (c) => { c.runtime.numThreads = 4; }, /numThreads 1, proxy false/],
      ["an unverified ORT artifact", (c) => { c.runtime.pin.sha256 = "0".repeat(64); }, /pinned ORT artifact/],
      ["a different model", (c) => { c.model.sha256SeenInRealm = "0".repeat(64); }, /model identity/],
      ["a webgpu cell with no GPU work", (c) => { c.gpu.submitsDuringInference = 0; c.gpu.submitsTotal = 0; }, /backend proof: NO_GPU_WORK/],
      ["a webgpu cell with no adapter identity", (c) => { c.gpu.adapterFromRequestAdapter = { returned: true, identified: false }; }, /adapter identity not recorded/],
      ["no network observer", (c) => { c.network.observed = false; }, /network observer/],
      ["an unexpected network arrival", (c) => { c.network.nonSelf.push({ kind: "fetch", origin: "https://example.invalid" }); }, /unexpected network arrivals/],
      ["a missing fixture", (c) => { c.rows.pop(); }, /rows 19/],
      ["a foreign fixture", (c) => { c.rows[0].name = "not-a-fixture"; }, /not a B3-1 fixture/],
      ["a different input tensor", (c) => { c.rows[0].tensorSha256 = "0".repeat(64); }, /input tensor differs/],
      ["a wrong output shape", (c) => { c.rows[0].dims = [1, 12, 6399]; }, /output shape/],
      ["non-finite outputs", (c) => { c.rows[0].nonFinite = 2; }, /non-finite/],
      ["a non-deterministic fixture", (c) => { c.rows[0].repeatSha256 = ["c".repeat(64), "b".repeat(64)]; c.rows[0].deterministic = false; }, /not deterministic/],
      ["a missing raw dump", (c) => { c.rows[0].dumpVerified = false; }, /raw output dump/],
      ["a cell-level error", (c) => { c.error = "no result reached the collector"; }, /cell error/],
    ];
    for (const [what, breakIt, expected] of broken) {
      const c = validCell("webgpu", "document", fx);
      breakIt(c);
      const v = G.verifyCellLog(c, fx);
      expect(v.ok, what).toBe(false);
      expect(v.failures.join(" | "), what).toMatch(expected);
    }
  });

  it("rejects a native reference at any version but 1.29.0, and an unguarded one", () => {
    const fx = G.selectPngFixtures(fixturesJson());
    const native = {
      ortVersion: "1.29.0",
      ortVersionRequired: "1.29.0",
      model: { sha256: G.MODEL.sha256, bytes: G.MODEL.bytes },
      rows: fx.map((f: any) => ({ name: f.name, pngSha256: f.encodedSha256, tensorSha256: f.tensorSha256, dims: [1, 12, 6400], finite: true, deterministic: true, outputSha256: "d".repeat(64) })),
    };
    expect(G.verifyNativeLog(native, fx)).toEqual({ ok: true, failures: [] });
    expect(G.verifyNativeLog({ ...native, ortVersion: "1.20.1" }, fx).failures.join(" ")).toMatch(/native ORT 1\.20\.1/);
    expect(G.verifyNativeLog({ ...native, ortVersionRequired: undefined }, fx).failures.join(" ")).toMatch(/unguarded reference/);
    expect(G.verifyNativeLog(null, fx).ok).toBe(false);
  });

  it("only workstation 1 can carry B3-1 evidence; everything else is labelled development", () => {
    expect(G.evidenceClassFor("LAPTOP-6E14K34L")).toMatchObject({ workstation1: true, logDir: "workstation-1" });
    const dev = G.evidenceClassFor("LAPTOP-SRCINK2B");
    expect(dev.workstation1).toBe(false);
    expect(dev.evidenceClass).toBe("DEVELOPMENT / NON-W1 EVIDENCE");
    expect(dev.logDir).toBe("development-laptop-srcink2b");
  });
});

describe("QG-03a-B3-1 harness — the candidate criterion", () => {
  const box = (x: number, y: number, w = 10, h = 10) => ({ x, y, w, h });
  const dets = (n: number) => Array.from({ length: n }, (_, i) => ({ label: "button", score: 0.9, box: box(i * 20, 0) }));

  it("states the pre-registered numbers and where they come from", () => {
    expect(C.CRITERION).toMatchObject({ minMatchedAtIou50: 0.95, maxCountDelta: 2, maxCssDisplacementPx: 2.0, zeroTrueFailures: true });
    expect(C.CRITERION.origin).toMatch(/QG-03b-2/);
    expect(C.CRITERION.status).toMatch(/ARCHITECT APPROVAL REQUIRED/);
  });

  it("identical output passes; a sub-tau move is the same anchor", () => {
    const a = dets(20);
    expect(C.classify(a, a, 0.01)).toMatchObject({ identical: 20, trueFailures: 0, b1Pass: true, countDelta: 0 });
    const moved = a.map((d, i) => (i === 0 ? { ...d, box: box(0.005, 0) } : d));
    expect(C.classify(a, moved, 0.01)).toMatchObject({ sameAnchor: 1, survivorSwap: 0, trueFailures: 0, b1Pass: true });
  });

  it("a survivor swap within 2.0 px passes; beyond it the displacement bound fails", () => {
    const a = dets(20);
    const swap1 = a.map((d, i) => (i === 0 ? { ...d, box: box(1.0, 0) } : d));
    expect(C.classify(a, swap1, 0.01)).toMatchObject({ survivorSwap: 1, trueFailures: 0, b1Pass: true });
    const swap3 = a.map((d, i) => (i === 0 ? { ...d, box: box(2.5, 0) } : d));
    const c = C.classify(a, swap3, 0.01);
    expect(c).toMatchObject({ survivorSwap: 1, trueFailures: 0, preRegisteredPass: false, b1Pass: false });
    expect(c.worstMatchedDispCss).toBeCloseTo(2.5);
  });

  it("true failures fail: a lost element, a class change, and a material count change", () => {
    const a = dets(20);
    expect(C.classify(a, a.slice(0, 19), 0.01)).toMatchObject({ elementLost: 1, trueFailures: 1, b1Pass: false });
    const relabelled = a.map((d, i) => (i === 0 ? { ...d, label: "link" } : d));
    expect(C.classify(a, relabelled, 0.01)).toMatchObject({ classChange: 1, trueFailures: 1, b1Pass: false });
    const extra = [...a, ...dets(3).map((d) => ({ ...d, box: box(d.box.x, 500) }))];
    expect(C.classify(a, extra, 0.01)).toMatchObject({ countDelta: 3, materialCountChange: true, b1Pass: false });
    expect(C.classify(a, [...a, ...dets(2).map((d) => ({ ...d, box: box(d.box.x, 500) }))], 0.01)).toMatchObject({ countDelta: 2, materialCountChange: false, b1Pass: true });
  });

  it("zero-true-failures is stricter than 95% matching alone", () => {
    const a = dets(40);
    const c = C.classify(a, a.slice(0, 39), 0.01);
    expect(c.matchedFraction).toBeGreaterThanOrEqual(0.95);
    expect(c.preRegisteredPass).toBe(true); // 39/40 matched, count delta 1
    expect(c.trueFailures).toBe(1); // but an element was lost
    expect(c.b1Pass).toBe(false);
  });

  it("criterionOver requires every fixture to pass in both views, and names the failures", () => {
    const pass = { name: "a", b1Pass: true, shipped: C.classify(dets(3), dets(3), 0.01), op055: C.classify(dets(3), dets(3), 0.01) };
    const fail = { name: "b", b1Pass: false, shipped: C.classify(dets(3), dets(2), 0.01), op055: C.classify(dets(3), dets(2), 0.01) };
    expect(C.criterionOver([pass])).toMatchObject({ met: true, fixtures: 1, fixturesMeeting: 1, failing: [] });
    expect(C.criterionOver([pass, fail])).toMatchObject({ met: false, fixturesMeeting: 1, failing: ["b"] });
    expect(C.criterionOver([])).toMatchObject({ met: false });
  });

  it("rawDiff separates box from class channels and refuses mismatched lengths", () => {
    const a = new Float32Array(12 * 6400);
    const b = new Float32Array(12 * 6400);
    b[0] = 2e-3; // box channel
    b[5 * 6400] = 1e-5; // class channel
    const d = C.rawDiff(a, b);
    expect(d.boxChannelMaxAbs).toBeCloseTo(2e-3, 9);
    expect(d.classChannelMaxAbs).toBeCloseTo(1e-5, 9);
    expect(d.elementsDiffering).toBe(2);
    expect(() => C.rawDiff(a, new Float32Array(3))).toThrow(/length/);
  });
});

describe("QG-03a-B3-1 harness — the native reference refuses a wrong ORT version", () => {
  const py = ["python", "python3"].find((p) => {
    try { return spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
  });
  const script = join(REPO, "artifacts/experiments/W1-QG03a-B2-real-model-nms/harness/b2_native_reference.py");

  it.skipIf(!py)("exits 3 and writes nothing when onnxruntime is not 1.29.0", () => {
    const stub = mkdtempSync(join(tmpdir(), "b3-ort-stub-"));
    writeFileSync(join(stub, "onnxruntime.py"), '__version__ = "1.20.1"\n');
    const r = spawnSync(py as string, [script], { encoding: "utf8", env: { ...process.env, PYTHONPATH: stub } });
    expect(r.status).toBe(3);
    expect(`${r.stderr}${r.stdout}`).toMatch(/ORT VERSION MISMATCH[\s\S]*1\.20\.1[\s\S]*requires 1\.29\.0/);
  });

  it("the script checks the version before importing anything heavy, so the guard cannot be skipped", () => {
    const src = readFileSync(script, "utf8");
    const guardAt = src.indexOf("require_ort_version(ort.__version__)");
    expect(guardAt).toBeGreaterThan(0);
    for (const later of ["import numpy", "from PIL import", "import qg03b_fixtures"]) {
      expect(src.indexOf(later), later).toBeGreaterThan(guardAt);
    }
    expect(src).toMatch(/REQUIRED_ORT_VERSION = "1\.29\.0"/);
  });
});
