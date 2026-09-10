/*
 * ADR-0001 gates G1, G2 and G3 — executed in a real browser, against the PRODUCTION CSP.
 *
 * This is not a spike harness. It is the permanent regression suite the ADR requires:
 * "G2 and G3 are regression guards, not one-off checks: they belong in the permanent
 * suite." The extensions it loads declare the policy produced by
 * `buildExtensionPagesCsp()` — the same function the shipped manifest uses — so a change
 * to the policy is caught here rather than in production.
 *
 * Loaded verbatim into every context, so a difference is attributable to the context.
 *
 *   G1  the CSP actually PERMITS WebAssembly compilation here.
 *       Uses WebAssembly.compile(), NEVER validate(): validate() succeeds in every
 *       Firefox variant including the default CSP where compilation is blocked, so a
 *       check built on it reports the tier healthy while it is dead.
 *
 *   G2  connect-src BLOCKS execution-capable WASM from a foreign origin.
 *       The page's own report is NOT the evidence. The foreign origin keeps an
 *       independent arrival log, and the runner cross-checks the two — a probe that
 *       says "blocked" while the far end received the request is a FALSE GREEN and is
 *       asserted against explicitly.
 *
 *   G3  eval, new Function and string-setTimeout remain BLOCKED under the directive.
 *       Regression guard on INV-15/INV-16. The setTimeout case checks the string
 *       actually EXECUTED, not that the call threw — a CSP violation there does not
 *       throw, so "did it throw" reports a blocked sink as open.
 */

/* eslint-disable no-undef */

const CFG = self.PRATIBIMB_GATE_CFG;

function errObj(e) {
  if (!e) return null;
  return { name: (e && e.name) || typeof e, message: String((e && e.message) || e).slice(0, 300) };
}

async function attempt(fn) {
  try { return { allowed: true, value: await fn(), error: null }; }
  catch (e) { return { allowed: false, value: null, error: errObj(e) }; }
}

function globalKind() {
  try {
    if (typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope)
      return "ServiceWorkerGlobalScope";
    if (typeof DedicatedWorkerGlobalScope !== "undefined" && self instanceof DedicatedWorkerGlobalScope)
      return "DedicatedWorkerGlobalScope";
    if (typeof window !== "undefined") return "Window";
  } catch (_) { /* ignore */ }
  return "unknown";
}

/** The 41-byte probe module: (module (func (export "add") (i32,i32)->i32 add)). */
const PROBE_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);

self.runGateProbe = async function runGateProbe(context) {
  const r = {
    context,
    globalKind: globalKind(),
    csp: CFG.csp,
    startedAt: new Date().toISOString(),
  };

  // ── G1 ────────────────────────────────────────────────────────────────────
  // validateCalled proves the negative: the capability check must never fall back to
  // WebAssembly.validate(). We shadow it and assert it stays untouched.
  let validateCalled = false;
  const realValidate = WebAssembly.validate;
  WebAssembly.validate = function (...args) { validateCalled = true; return realValidate.apply(this, args); };

  r.g1_wasm_capability = await attempt(async () => {
    const mod = await WebAssembly.compile(PROBE_WASM);
    const inst = await WebAssembly.instantiate(mod);
    const v = inst.exports.add(2, 3);
    if (v !== 5) throw new Error("add(2,3) = " + v);
    return "compiled, instantiated, add(2,3)=5";
  });
  WebAssembly.validate = realValidate;
  r.g1_validate_never_called = validateCalled === false;

  // ── G3 ────────────────────────────────────────────────────────────────────
  r.g3_js_sinks = {
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
    setTimeoutString: await attempt(async () => {
      if (typeof setTimeout !== "function") throw new Error("no setTimeout here");
      globalThis.__gateStringTimeout = false;
      setTimeout("globalThis.__gateStringTimeout = true", 0);
      await new Promise((res) => setTimeout(res, 150));
      if (globalThis.__gateStringTimeout !== true) {
        throw new Error("string body did not execute (blocked, silently)");
      }
      return "string body EXECUTED";
    }),
  };

  // ── G2 ────────────────────────────────────────────────────────────────────
  // Allowed origin first: it is the positive control proving the harness can reach a
  // permitted origin at all. Without it, a blocked foreign fetch is uninterpretable.
  r.g2_allowed_origin = await attempt(async () => {
    const res = await fetch(CFG.allowedOrigin + "/probe.wasm", {
      headers: { "x-pratibimb-gate": context + "::allowed" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const bytes = await res.arrayBuffer();
    const inst = await WebAssembly.instantiate(await WebAssembly.compile(bytes));
    return { byteLength: bytes.byteLength, add: inst.exports.add(2, 3) };
  });

  r.g2_foreign_origin = await attempt(async () => {
    const res = await fetch(CFG.foreignOrigin + "/probe.wasm", {
      headers: { "x-pratibimb-gate": context + "::foreign" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const bytes = await res.arrayBuffer();
    const inst = await WebAssembly.instantiate(await WebAssembly.compile(bytes));
    return { byteLength: bytes.byteLength, add: inst.exports.add(2, 3) };
  });

  // The streaming API is a different code path and could have a different enforcement
  // point; measured rather than assumed equivalent.
  r.g2_foreign_streaming = await attempt(async () => {
    const { instance } = await WebAssembly.instantiateStreaming(
      fetch(CFG.foreignOrigin + "/probe.wasm", {
        headers: { "x-pratibimb-gate": context + "::foreign-streaming" },
      })
    );
    return instance.exports.add(2, 3);
  });

  r.finishedAt = new Date().toISOString();
  return r;
};

self.reportGate = async function reportGate(context) {
  let payload;
  try { payload = await self.runGateProbe(context); }
  catch (e) { payload = { context, fatal: errObj(e) }; }
  try {
    await fetch(CFG.allowedOrigin + "/result", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pratibimb-gate": context + "::result" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // Firefox MV3 gates host_permissions behind origin controls; a tab navigation is not
    // gated the same way, so the FULL payload survives even if fetch is refused.
    try { await self.gateBeacon("/sink?d=" + encodeURIComponent(JSON.stringify(payload))); }
    catch (_) { /* nothing further available */ }
  }
  return payload;
};
