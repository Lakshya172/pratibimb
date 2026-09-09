/*
 * S-02a-2a-2 — Firefox's CSP token vocabulary, measured in real MV3 extension contexts.
 *
 * THROWAWAY SPIKE CODE. Loopback only. Synthetic fixtures only. Not product code.
 *
 * Chrome's answer (S-02a-2b-1 + S-02a-2a-1) was:
 *   'wasm-eval' and 'unsafe-eval'   -> extension DOES NOT LOAD at all
 *   'wasm-unsafe-eval'              -> loads; permits WASM compilation ONLY
 *                                      (eval / new Function / setTimeout-string stay blocked)
 * This measures whether Firefox agrees, or needs a browser-specific policy.
 *
 * REUSED from W1-S02a-2a-1 verbatim: errObj, globalKind, attempt, sha256Hex, and — most
 * importantly — the setTimeout-string check that verifies the string actually EXECUTED.
 * A CSP violation there does not throw, so "did it throw" reports a blocked sink as open.
 *
 * REUSED from W1-S02a-2 (Firefox): the WASM bytes are INLINE rather than fetched, so the
 * result cannot be confounded by Firefox MV3 gating host_permissions behind origin
 * controls. This isolates the CSP question from the network question.
 */

/* eslint-disable no-undef */

// Byte-identical to artifacts/experiments/W1-S02a2a1-csp-attack-surface/harness/fixtures/add.wasm
// (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
const WASM_BYTES = new Uint8Array([
  0x00,0x61,0x73,0x6d, 0x01,0x00,0x00,0x00,
  0x01,0x07,0x01,0x60,0x02,0x7f,0x7f,0x01,0x7f,
  0x03,0x02,0x01,0x00,
  0x07,0x07,0x01,0x03,0x61,0x64,0x64,0x00,0x00,
  0x0a,0x09,0x01,0x07,0x00,0x20,0x00,0x20,0x01,0x6a,0x0b
]);
const PINNED_SHA256 =
  "f61fd62f57c41269c3c23f360eeaf1090b1db9c38651106674d48bc65dba88ba";

function errObj(e) {
  if (!e) return null;
  return { name: (e && e.name) || typeof e,
           message: String((e && e.message) || e).slice(0, 300) };
}

function globalKind() {
  try {
    if (typeof DedicatedWorkerGlobalScope !== "undefined" &&
        self instanceof DedicatedWorkerGlobalScope) return "DedicatedWorkerGlobalScope";
    if (typeof window !== "undefined") return "Window";
  } catch (_) { /* ignore */ }
  return "unknown";
}

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function attempt(fn) {
  try { return { allowed: true, value: await fn(), error: null }; }
  catch (e) { return { allowed: false, value: null, error: errObj(e) }; }
}

globalThis.runTokenProbe = async function runTokenProbe(contextName, declaredCsp) {
  const r = {
    context: contextName,
    globalKind: globalKind(),
    declaredCsp: declaredCsp || null,
    href: (typeof location !== "undefined" && location.href) || null,
    userAgent: (typeof navigator !== "undefined" && navigator.userAgent) || null,
    startedAt: new Date().toISOString()
  };

  // --- JavaScript execution sinks -------------------------------------------
  r.js = {
    eval: await attempt(() => {
      // eslint-disable-next-line no-eval
      const v = eval("1+1");
      if (v !== 2) throw new Error("eval returned " + v);
      return v;
    }),
    newFunction: await attempt(() => {
      const v = new Function("return 1+1")();
      if (v !== 2) throw new Error("Function returned " + v);
      return v;
    }),
    // A CSP violation here does NOT throw; the string silently never runs. Check that it
    // actually executed, or a blocked sink is reported as open.
    setTimeoutString: await attempt(async () => {
      if (typeof setTimeout !== "function") throw new Error("no setTimeout here");
      globalThis.__pratibimbStringTimeout = false;
      setTimeout("globalThis.__pratibimbStringTimeout = true", 0);
      await new Promise((res) => setTimeout(res, 150));
      if (globalThis.__pratibimbStringTimeout !== true) {
        throw new Error("string body did not execute (blocked, silently)");
      }
      return "string body EXECUTED";
    })
  };

  // --- WebAssembly ----------------------------------------------------------
  r.wasm = {
    present: typeof WebAssembly !== "undefined",
    digest: null,
    compile: null,
    instantiate: null,
    validate: null
  };
  if (r.wasm.present) {
    r.wasm.digest = await sha256Hex(WASM_BYTES);
    r.wasm.digestMatchesPin = r.wasm.digest === PINNED_SHA256;
    // validate() does not compile to machine code and may be permitted where compile is
    // not; measured separately rather than assumed equivalent.
    r.wasm.validate = await attempt(() => WebAssembly.validate(WASM_BYTES));
    const compiled = await attempt(() => WebAssembly.compile(WASM_BYTES));
    r.wasm.compile = { allowed: compiled.allowed, error: compiled.error };
    if (compiled.allowed) {
      r.wasm.instantiate = await attempt(async () => {
        const i = await WebAssembly.instantiate(compiled.value);
        const v = i.exports.add(2, 3);
        if (v !== 5) throw new Error("add(2,3) = " + v);
        return v;
      });
    } else {
      r.wasm.instantiate = { allowed: null, value: null, error: null,
                             note: "not attempted - compile failed" };
    }
  }

  r.conclusion =
    !r.wasm.present ? "WebAssembly ABSENT"
    : r.wasm.compile.allowed ? "WASM compiles in this context"
    : "WASM compilation BLOCKED in this context";
  r.finishedAt = new Date().toISOString();
  return r;
};
