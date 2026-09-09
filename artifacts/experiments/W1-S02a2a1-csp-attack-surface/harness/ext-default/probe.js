/*
 * S-02a-2a-1 — what does 'wasm-unsafe-eval' actually enable, where may WASM bytes come
 * from, and can they be hash-pinned?
 *
 * THROWAWAY SPIKE CODE. Not product code. Loopback only. Synthetic fixtures only.
 *
 * S-02a-2b-1 established that 'wasm-unsafe-eval' is the ONLY token Chrome MV3 accepts for
 * WebAssembly — 'wasm-eval' and 'unsafe-eval' stop the extension loading entirely. So the
 * CSP ADR (S-02a-2a) has no narrower privilege to choose. What it still has to justify is
 * the directive itself, and that needs three facts this probe measures:
 *
 *   Q1  ATTACK SURFACE   Does 'wasm-unsafe-eval' also unlock JavaScript eval /
 *                        new Function / string setTimeout? INV-15 and INV-16 forbid
 *                        arbitrary JS execution and eval, so if the token widened those
 *                        the directive would conflict with a frozen invariant.
 *   Q2  PROVENANCE       May WASM bytes come from the NETWORK, or only from the packaged
 *                        extension? This is the same manifest that pins connect-src for
 *                        Invariant E, so the two interact.
 *   Q3  INTEGRITY        Can the bytes be hash-pinned before instantiation, the way the
 *                        egress payload is pinned under INV-02/INV-03 — and does the pin
 *                        actually REFUSE a tampered module?
 *
 * One file, loaded verbatim into all three MV3 contexts, so any difference is
 * attributable to the context and not to the code.
 */

/* eslint-disable no-undef */

// SHA-256 of fixtures/add.wasm, computed at fixture-generation time and pinned here.
// Q3's whole point is that this constant is compared against the bytes actually loaded.
const PINNED_SHA256 =
  "f61fd62f57c41269c3c23f360eeaf1090b1db9c38651106674d48bc65dba88ba";

function errObj(e) {
  if (!e) return null;
  return {
    name: (e && e.name) || typeof e,
    message: String((e && e.message) || e).slice(0, 300)
  };
}

function globalKind() {
  try {
    if (typeof ServiceWorkerGlobalScope !== "undefined" &&
        self instanceof ServiceWorkerGlobalScope) return "ServiceWorkerGlobalScope";
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

/** Run one attempt, recording allowed/blocked plus the error if blocked. */
async function attempt(fn) {
  try {
    const value = await fn();
    return { allowed: true, value, error: null };
  } catch (e) {
    return { allowed: false, value: null, error: errObj(e) };
  }
}

async function pratibimbCspProbe(contextName, collectorBase) {
  const r = {
    context: contextName,
    globalKind: globalKind(),
    href: (typeof location !== "undefined" && location.href) || null,
    isSecureContext: typeof isSecureContext !== "undefined" ? isSecureContext : null,
    startedAt: new Date().toISOString()
  };

  // ── Q1 · attack surface ────────────────────────────────────────────────────
  // Each of these is a DIFFERENT capability. 'wasm-unsafe-eval' is documented to permit
  // only WebAssembly compilation; that is measured here rather than assumed.
  r.q1_attack_surface = {
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
    // NOTE: a CSP violation here does NOT throw - the string simply never executes.
    // An earlier version of this probe tested "did setTimeout throw", which reported
    // ALLOWED for a sink that was in fact blocked. We now check that the string actually
    // RAN, which is the only observation that distinguishes the two.
    setTimeoutString: await attempt(async () => {
      if (typeof setTimeout !== "function") throw new Error("no setTimeout here");
      globalThis.__pratibimbStringTimeout = false;
      setTimeout("globalThis.__pratibimbStringTimeout = true", 0);
      await new Promise((r) => setTimeout(r, 150));
      if (globalThis.__pratibimbStringTimeout !== true) {
        throw new Error("string body did not execute (blocked, silently)");
      }
      return "string body EXECUTED";
    }),
    wasmCompilePackaged: null // filled by Q2 (same call, reported in both places)
  };

  // ── Q2 · provenance ────────────────────────────────────────────────────────
  // `chrome` is NOT exposed inside a dedicated worker, so chrome.runtime.getURL() is
  // unavailable in exactly the context PratiBimb runs inference in. A relative URL
  // resolves against the worker's own chrome-extension:// origin and reaches the same
  // packaged bytes, so provenance is still measurable there.
  const hasChromeApi =
    typeof chrome !== "undefined" && chrome.runtime && !!chrome.runtime.getURL;
  const packagedUrl = hasChromeApi
    ? chrome.runtime.getURL("fixtures/add.wasm")
    : "fixtures/add.wasm";
  const tamperedUrl = hasChromeApi
    ? chrome.runtime.getURL("fixtures/add-tampered.wasm")
    : "fixtures/add-tampered.wasm";
  const networkUrl = collectorBase + "/remote.wasm";

  const packagedBytesAttempt = await attempt(async () => {
    const res = await fetch(packagedUrl);
    return await res.arrayBuffer();
  });

  r.q2_provenance = {
    packagedUrl,
    chromeApiAvailable: hasChromeApi,
    networkUrl,

    // (a) bytes packaged inside the extension
    packagedFetch: { allowed: packagedBytesAttempt.allowed, error: packagedBytesAttempt.error },
    packagedCompile: await attempt(async () => {
      if (!packagedBytesAttempt.allowed) throw new Error("packaged fetch failed");
      const mod = await WebAssembly.compile(packagedBytesAttempt.value);
      const inst = await WebAssembly.instantiate(mod);
      const sum = inst.exports.add(2, 3);
      if (sum !== 5) throw new Error("add(2,3) = " + sum);
      return "instantiated, add(2,3)=5";
    }),

    // (b) bytes fetched over the network (loopback, permitted by host_permissions)
    networkFetch: null,
    networkCompile: null,
    networkInstantiateStreaming: null
  };
  r.q1_attack_surface.wasmCompilePackaged = {
    allowed: r.q2_provenance.packagedCompile.allowed,
    error: r.q2_provenance.packagedCompile.error
  };

  const netBytesAttempt = await attempt(async () => {
    const res = await fetch(networkUrl);
    return await res.arrayBuffer();
  });
  r.q2_provenance.networkFetch = {
    allowed: netBytesAttempt.allowed,
    error: netBytesAttempt.error
  };
  r.q2_provenance.networkCompile = await attempt(async () => {
    if (!netBytesAttempt.allowed) throw new Error("network fetch failed");
    const mod = await WebAssembly.compile(netBytesAttempt.value);
    const inst = await WebAssembly.instantiate(mod);
    const sum = inst.exports.add(2, 3);
    if (sum !== 5) throw new Error("add(2,3) = " + sum);
    return "instantiated from NETWORK bytes, add(2,3)=5";
  });
  r.q2_provenance.networkInstantiateStreaming = await attempt(async () => {
    if (typeof WebAssembly.instantiateStreaming !== "function") {
      throw new Error("instantiateStreaming unavailable");
    }
    const { instance } = await WebAssembly.instantiateStreaming(fetch(networkUrl));
    const sum = instance.exports.add(2, 3);
    if (sum !== 5) throw new Error("add(2,3) = " + sum);
    return "streaming-instantiated from NETWORK, add(2,3)=5";
  });

  // ── Q3 · integrity — can we hash-pin, and does the pin actually refuse? ─────
  r.q3_integrity = { pinnedSha256: PINNED_SHA256 };

  r.q3_integrity.cleanBytes = await attempt(async () => {
    if (!packagedBytesAttempt.allowed) throw new Error("packaged fetch failed");
    const bytes = packagedBytesAttempt.value;
    const digest = await sha256Hex(bytes);
    if (digest !== PINNED_SHA256) throw new Error("pin MISMATCH on clean bytes: " + digest);
    const inst = await WebAssembly.instantiate(await WebAssembly.compile(bytes));
    return { digest, instantiated: true, add: inst.exports.add(2, 3) };
  });

  // Negative case: the pin must REFUSE, and nothing may be instantiated.
  r.q3_integrity.tamperedBytes = await attempt(async () => {
    const res = await fetch(tamperedUrl);
    const bytes = await res.arrayBuffer();
    const digest = await sha256Hex(bytes);
    if (digest === PINNED_SHA256) {
      throw new Error("PIN FAILED TO DETECT TAMPER — digests collided");
    }
    // Fail closed: refuse to compile. Prove the module WOULD otherwise have run, by
    // reporting what it computes only when the pin is deliberately bypassed below.
    let wouldHaveComputed = null;
    try {
      const inst = await WebAssembly.instantiate(await WebAssembly.compile(bytes));
      wouldHaveComputed = inst.exports.add(2, 3); // -1 if the tamper is real
    } catch (e) {
      wouldHaveComputed = "compile blocked: " + errObj(e).message;
    }
    return {
      digest,
      pinRefused: true,
      instantiatedUnderPin: false,
      bypassCheck_wouldHaveComputed: wouldHaveComputed
    };
  });

  r.finishedAt = new Date().toISOString();
  return r;
}

async function reportProbe(collectorBase, contextName) {
  let payload;
  try {
    payload = await pratibimbCspProbe(contextName, collectorBase);
  } catch (e) {
    payload = { context: contextName, fatal: errObj(e) };
  }
  try {
    await fetch(collectorBase + "/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error("[S-02a-2a-1] failed to POST", contextName, e);
  }
  return payload;
}

if (typeof self !== "undefined") {
  self.pratibimbCspProbe = pratibimbCspProbe;
  self.reportProbe = reportProbe;
}
