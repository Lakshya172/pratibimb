/*
 * S-02a-2a-3 — can PratiBimb's SHA-256 pin be applied to the EXACT ORT Web `.wasm`
 * artifact before it is compiled, and is the pinned byte-set provably the executed one?
 *
 * THROWAWAY SPIKE CODE. Loopback only. Not product code. No production manifest.
 *
 * THE BINDING THIS MUST ESTABLISH:
 *
 *      EXACT BYTES HASHED  ==  EXACT BYTES EXECUTED
 *
 * Hashing a .wasm file proves nothing on its own. Three things together establish it, and
 * all three are measured:
 *
 *   (i)   the .wasm is NOT packaged in the extension — it exists only on an arrival-logged
 *         origin, so any load ORT performs without our buffer MUST appear as an arrival;
 *   (ii)  with `wasmBinary` set, ORT performs ZERO untagged artifact fetches (arrival log,
 *         not a self-report), so it cannot have obtained bytes other than ours;
 *   (iii) handing ORT DELIBERATELY TAMPERED bytes makes session creation FAIL. This is the
 *         decisive control: it proves ORT consumed our buffer rather than ignoring it.
 *         Without (iii), "no arrivals + session works" is equally consistent with ORT
 *         holding a cached or embedded copy.
 *
 * Our fetches carry `x-pratibimb-probe`; ORT's do not. An UNTAGGED artifact request is,
 * by construction, ORT's.
 *
 * ISOLATION REQUIREMENT — learned the hard way. ORT initialises its WebAssembly module
 * once per JS realm and caches it. An earlier version of this harness ran every scenario
 * in one realm and produced a FALSE "binding supported": the tampered session failed, but
 * because of an unrelated missing-glue error, not because of the bytes. Each scenario now
 * runs in a FRESH dedicated worker.
 */

/* eslint-disable no-undef */

const PINNED_SHA256 = "__PINNED_SHA256__";
const WASM_FILE = "__WASM_FILE__";   // the .wasm this bundle actually loads
const MJS_FILE = "__MJS_FILE__";     // Emscripten JS glue, loaded by dynamic import()
const COLLECTOR = "__COLLECTOR__";
const FOREIGN = "__FOREIGN__";

/**
 * ORT resolves its glue with a dynamic `import()`, which MV3 governs through `script-src`,
 * NOT `connect-src`. Under `script-src 'self'` that import can only come from the
 * extension's own origin, so the .mjs MUST be packaged. A relative URL resolved against
 * the current script's own location works in BOTH the offscreen document and a dedicated
 * worker — which matters, because `chrome.runtime.getURL` is undefined inside a dedicated
 * worker (measured in W1-S02a-2a-1).
 */
function packagedMjsUrl() {
  return new URL(MJS_FILE, location.href).href;
}

function errObj(e) {
  if (!e) return null;
  return { name: (e && e.name) || typeof e,
           message: String((e && e.message) || e).slice(0, 400) };
}

async function attempt(fn) {
  try { return { ok: true, value: await fn(), error: null }; }
  catch (e) { return { ok: false, value: null, error: errObj(e) }; }
}

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetch with our marker header, so the collector can tell our requests from ORT's. */
async function fetchTagged(url, tag) {
  const res = await fetch(url, { headers: { "x-pratibimb-probe": tag } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.arrayBuffer();
}

/**
 * The SAME 174-byte model as W1-S03: y = x*2 + 1 over float32[1, 262144], opset 13.
 * Inlined as base64, so the probe performs NO fetch for the model and the only observable
 * artifact request is ORT's WebAssembly.
 */
const MODEL_B64 = "__MODEL_B64__";
const N = 262144;

function b64ToBytes(b64) {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

function baseEnv() {
  ort.env.logLevel = "error";
  ort.env.wasm.numThreads = 1;   // deterministic: no worker-spawn fetch path
  ort.env.wasm.proxy = false;
  try { ort.env.wasm.wasmBinary = undefined; } catch (_) {}
  // The glue always comes from the package. Only the .wasm location is the variable.
  ort.env.wasm.wasmPaths = { mjs: packagedMjsUrl() };
}

/** Create a session, run one inference, verify element-by-element against a CPU reference. */
async function createAndRun(label) {
  const t0 = performance.now();
  const session = await ort.InferenceSession.create(b64ToBytes(MODEL_B64), {
    executionProviders: ["wasm"], graphOptimizationLevel: "disabled"
  });
  const createMs = performance.now() - t0;

  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = i % 1000;
  const out = await session.run({ x: new ort.Tensor("float32", x, [1, N]) });
  const y = out[Object.keys(out)[0]].data;

  let mismatches = 0;
  for (let i = 0; i < N; i++) if (y[i] !== (i % 1000) * 2 + 1) mismatches++;
  await session.release();

  return { label, createMs: Number(createMs.toFixed(1)), elements: N,
           mismatches, correct: mismatches === 0, sample: Array.from(y.slice(0, 3)) };
}

/** ONE scenario per call. The caller MUST supply a FRESH realm for each — see header. */
globalThis.runPinScenario = async function runPinScenario(scenario, contextName) {
  const r = {
    scenario, context: contextName,
    href: (typeof location !== "undefined" && location.href) || null,
    startedAt: new Date().toISOString(),
    pinnedSha256: PINNED_SHA256, artifact: WASM_FILE
  };
  try {
    r.ortVersion = ort.env && ort.env.versions ? ort.env.versions.common : (ort.version || "unknown");
  } catch (e) { r.fatal = errObj(e); return r; }

  const artifactUrl = COLLECTOR + "/" + WASM_FILE;

  try {
    if (scenario === "s1_fetch_and_hash") {
      const got = await attempt(() => fetchTagged(artifactUrl, contextName + "::our-fetch"));
      r.url = artifactUrl;
      r.retrieved = got.ok; r.error = got.error;
      r.byteLength = got.ok ? got.value.byteLength : null;
      r.digest = got.ok ? await sha256Hex(got.value) : null;
      r.matchesPin = r.digest === PINNED_SHA256;

    } else if (scenario === "s2_pinned_wasmBinary") {
      // THE BINDING. Fetch, hash, verify, THEN hand ORT the exact verified buffer.
      // wasmPaths.wasm is ALSO set: if ORT ignored wasmBinary or re-fetched, that request
      // would succeed and appear in the arrival log as an UNTAGGED arrival.
      const got = await attempt(() => fetchTagged(artifactUrl, contextName + "::our-fetch"));
      if (!got.ok) { r.skipped = "artifact not retrieved"; r.error = got.error; return r; }
      r.digest = await sha256Hex(got.value);
      r.matchesPin = r.digest === PINNED_SHA256;
      if (!r.matchesPin) {
        r.refused = true; r.reason = "hash mismatch - fail closed, ORT never invoked"; return r;
      }
      baseEnv();
      ort.env.wasm.wasmPaths = { mjs: packagedMjsUrl(), wasm: artifactUrl };
      ort.env.wasm.wasmBinary = got.value;
      const run = await attempt(() => createAndRun("pinned-wasmBinary"));
      r.hashVerifiedBeforeCompile = true;
      r.sessionCreated = run.ok; r.result = run.value; r.error = run.error;

    } else if (scenario === "s3_tampered_wasmBinary") {
      // DECISIVE negative control: deliberately bypass our own gate and hand ORT corrupt
      // bytes. If the session SUCCEEDS, ORT did not consume our buffer and the binding is
      // disproved. Error text is recorded verbatim so the failure can be attributed.
      const t2 = await attempt(() => fetchTagged(COLLECTOR + "/tampered.wasm",
                                                 contextName + "::our-fetch-tampered"));
      if (!t2.ok) { r.skipped = "tampered artifact not retrieved"; r.error = t2.error; return r; }
      r.digest = await sha256Hex(t2.value);
      r.digestMatchesPin = r.digest === PINNED_SHA256;
      r.pinWouldHaveRefused = !r.digestMatchesPin;
      baseEnv();
      ort.env.wasm.wasmPaths = { mjs: packagedMjsUrl(), wasm: artifactUrl };
      ort.env.wasm.wasmBinary = t2.value;
      const run = await attempt(() => createAndRun("tampered-wasmBinary"));
      r.sessionCreated = run.ok; r.error = run.error;

    } else if (scenario === "s4_ort_owned_fetch") {
      baseEnv();
      ort.env.wasm.wasmPaths = { mjs: packagedMjsUrl(), wasm: artifactUrl };
      const run = await attempt(() => createAndRun("ort-owned-fetch"));
      r.sessionCreated = run.ok; r.result = run.value; r.error = run.error;

    } else if (scenario === "s5_missing_artifact") {
      baseEnv();
      ort.env.wasm.wasmPaths = { mjs: packagedMjsUrl(), wasm: COLLECTOR + "/no-such-file.wasm" };
      const run = await attempt(() => createAndRun("missing-artifact"));
      r.sessionCreated = run.ok; r.error = run.error;
      r.fellBackSilently = run.ok === true;

    } else if (scenario === "s6_foreign_origin") {
      const f = await attempt(() => fetchTagged(FOREIGN + "/" + WASM_FILE,
                                                contextName + "::our-fetch-foreign"));
      r.ourFetchResolved = f.ok; r.ourFetchError = f.error;
      baseEnv();
      ort.env.wasm.wasmPaths = { mjs: packagedMjsUrl(), wasm: FOREIGN + "/" + WASM_FILE };
      const run = await attempt(() => createAndRun("foreign-wasmPaths"));
      r.sessionCreated = run.ok; r.error = run.error;
      r.note = "Authoritative signal is the FOREIGN origin's arrival log.";

    } else if (scenario === "s7_second_load") {
      const got = await attempt(() => fetchTagged(artifactUrl, contextName + "::our-fetch"));
      if (!got.ok) { r.skipped = "artifact not retrieved"; return r; }
      r.digest = await sha256Hex(got.value);
      r.matchesPin = r.digest === PINNED_SHA256;
      baseEnv();
      ort.env.wasm.wasmPaths = { mjs: packagedMjsUrl(), wasm: artifactUrl };
      ort.env.wasm.wasmBinary = got.value;
      const a = await attempt(() => createAndRun("second-load-1"));
      const b = await attempt(() => createAndRun("second-load-2"));
      r.first = { ok: a.ok, result: a.value, error: a.error };
      r.second = { ok: b.ok, result: b.value, error: b.error };

    } else {
      r.fatal = { name: "UnknownScenario", message: scenario };
    }
  } catch (e) {
    r.fatal = errObj(e);
  }
  r.finishedAt = new Date().toISOString();
  return r;
};

globalThis.PIN_SCENARIOS = ["s1_fetch_and_hash", "s2_pinned_wasmBinary",
  "s3_tampered_wasmBinary", "s4_ort_owned_fetch", "s5_missing_artifact",
  "s6_foreign_origin", "s7_second_load"];
