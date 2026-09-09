/*
 * S-02a-2a-4 — does a pinned `connect-src` actually stop execution-capable WASM being
 * fetched from a FOREIGN origin, and at which enforcement layer?
 *
 * THROWAWAY SPIKE CODE. Loopback only. Synthetic fixtures only. Not product code.
 *
 * Derived from W1-S02a-2a-1's probe: errObj/globalKind/attempt/sha256Hex and the
 * "check the string actually RAN" discipline are reused verbatim rather than rewritten.
 *
 * WHAT THIS SEPARATES, deliberately:
 *   1. NETWORK RETRIEVAL   did the fetch resolve?  -- and, independently, did the request
 *                          ARRIVE at the far end?  The arrival log on each server is the
 *                          authoritative signal (B-02 discipline). A probe that reports
 *                          "blocked" while the server logged an arrival has NOT been
 *                          blocked at a provenance boundary.
 *   2. WASM COMPILATION    WebAssembly.compile() on bytes we already hold
 *   3. INSTANTIATION       WebAssembly.instantiate() and the computed value
 *
 * Never treat "no error" as "no request", and never treat NOT_OBSERVED as absence.
 * Every fetch carries an x-pratibimb-probe header so the far end can attribute arrivals
 * to a context, and every attempt records BOTH what the page saw and what the server saw.
 */

/* eslint-disable no-undef */

const PINNED_SHA256 =
  "f61fd62f57c41269c3c23f360eeaf1090b1db9c38651106674d48bc65dba88ba";

function errObj(e) {
  if (!e) return null;
  return { name: (e && e.name) || typeof e,
           message: String((e && e.message) || e).slice(0, 300) };
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

async function attempt(fn) {
  try { return { allowed: true, value: await fn(), error: null }; }
  catch (e) { return { allowed: false, value: null, error: errObj(e) }; }
}

/**
 * One origin, fully characterised: retrieval, compilation, instantiation, digest.
 * `tag` is echoed to the server so its arrival log can be matched to this attempt.
 */
async function characteriseOrigin(label, baseUrl, resourcePath, contextName) {
  const url = baseUrl + resourcePath;
  const tag = `${contextName}::${label}`;
  const out = { label, url, tag };

  // --- 1. network retrieval -------------------------------------------------
  const fetched = await attempt(async () => {
    const res = await fetch(url, { headers: { "x-pratibimb-probe": tag } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.arrayBuffer();
  });
  out.networkRetrieval = {
    resolved: fetched.allowed,
    error: fetched.error,
    byteLength: fetched.allowed ? fetched.value.byteLength : null
  };

  if (!fetched.allowed) {
    // Do NOT report compile/instantiate as "blocked" - they were never attempted.
    // Conflating "not attempted" with "blocked" is how a CSP finding gets invented.
    out.wasmCompilation = { attempted: false, allowed: null, error: null,
                            note: "not attempted - retrieval did not resolve" };
    out.instantiation = { attempted: false, allowed: null, error: null,
                          note: "not attempted - retrieval did not resolve" };
    out.digest = null;
    out.digestMatchesPin = null;
    return out;
  }

  // --- 2. digest, BEFORE compiling (application-layer control) --------------
  out.digest = await sha256Hex(fetched.value);
  out.digestMatchesPin = out.digest === PINNED_SHA256;

  // --- 3. compilation -------------------------------------------------------
  const compiled = await attempt(() => WebAssembly.compile(fetched.value));
  out.wasmCompilation = { attempted: true, allowed: compiled.allowed, error: compiled.error };

  // --- 4. instantiation + computed value -----------------------------------
  if (!compiled.allowed) {
    out.instantiation = { attempted: false, allowed: null, error: null,
                          note: "not attempted - compilation failed" };
    return out;
  }
  const inst = await attempt(async () => {
    const i = await WebAssembly.instantiate(compiled.value);
    return i.exports.add(2, 3);
  });
  out.instantiation = { attempted: true, allowed: inst.allowed,
                        computedValue: inst.value, error: inst.error };
  return out;
}

async function pratibimbProvenanceProbe(contextName, cfg) {
  const r = {
    context: contextName,
    globalKind: globalKind(),
    href: (typeof location !== "undefined" && location.href) || null,
    manifestCsp: cfg.manifestCsp || null,
    allowedOrigin: cfg.allowedOrigin,
    foreignOrigin: cfg.foreignOrigin,
    startedAt: new Date().toISOString()
  };

  // A. control - the ALLOWED origin, which connect-src permits in both variants
  r.a_allowedOrigin = await characteriseOrigin(
    "allowed", cfg.allowedOrigin, "/allowed.wasm", contextName);

  // B. the FOREIGN origin - byte-identical module, different origin only
  r.b_foreignOrigin = await characteriseOrigin(
    "foreign", cfg.foreignOrigin, "/foreign.wasm", contextName);

  // B2. streaming path, tested separately: a different API can have a different
  //     enforcement point, and assuming otherwise would be an inference.
  r.b2_foreignStreaming = await attempt(async () => {
    const { instance } = await WebAssembly.instantiateStreaming(
      fetch(cfg.foreignOrigin + "/foreign.wasm",
            { headers: { "x-pratibimb-probe": `${contextName}::foreign-streaming` } }));
    return instance.exports.add(2, 3);
  });

  // C. pin interaction - identical bytes from a different origin. If the foreign fetch
  //    resolved, the digest will MATCH the pin, which is exactly the point: a content
  //    hash cannot distinguish provenance. The two controls are orthogonal.
  r.c_pinInteraction = {
    allowedDigest: r.a_allowedOrigin.digest,
    foreignDigest: r.b_foreignOrigin.digest,
    bytesIdenticalAcrossOrigins:
      r.a_allowedOrigin.digest !== null && r.b_foreignOrigin.digest !== null
        ? r.a_allowedOrigin.digest === r.b_foreignOrigin.digest
        : "foreign bytes never retrieved - cannot compare",
    interpretation:
      "A matching digest proves content integrity, NOT origin. Whether the foreign " +
      "bytes were reachable at all is decided by connect-src, not by the hash."
  };

  // D. negative control - a CSP block on fetch may reject asynchronously. Record the
  //    rejection shape so the analysis can tell a CSP refusal from a network error.
  r.d_blockShape = {
    foreignRetrievalResolved: r.b_foreignOrigin.networkRetrieval.resolved,
    foreignRetrievalError: r.b_foreignOrigin.networkRetrieval.error,
    note: "Authoritative signal is the foreign server's ARRIVAL LOG, not this field."
  };

  r.finishedAt = new Date().toISOString();
  return r;
}

async function reportProbe(cfg, contextName) {
  let payload;
  try { payload = await pratibimbProvenanceProbe(contextName, cfg); }
  catch (e) { payload = { context: contextName, fatal: errObj(e) }; }
  try {
    await fetch(cfg.allowedOrigin + "/result", {
      method: "POST",
      headers: { "Content-Type": "application/json",
                 "x-pratibimb-probe": `${contextName}::result` },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error("[S-02a-2a-4] failed to POST", contextName, e);
  }
  return payload;
}

if (typeof self !== "undefined") {
  self.pratibimbProvenanceProbe = pratibimbProvenanceProbe;
  self.reportProbe = reportProbe;
}
