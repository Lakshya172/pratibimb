/**
 * QG-03a-B3-1 instrumentation. MUST load before ONNX Runtime Web, in every realm (the offscreen
 * document and its dedicated worker). Adapted from W1-QG03-t1-detector-runtime's
 * qg03-instrument.js: independent observers, none of which asks ORT to describe itself.
 *
 *   GPU      GPUQueue.prototype.submit is counted, so a "webgpu" cell is an OBSERVATION. If the
 *            hook cannot be installed, hookInstalled stays false and a WASM cell's zero is
 *            NOT_OBSERVED rather than zero.
 *   ADAPTER  navigator.gpu.requestAdapter is wrapped so the adapter's own info (vendor,
 *            architecture, device, description) is recorded from the adapter ORT receives.
 *   NETWORK  fetch, XMLHttpRequest and importScripts arrivals are logged with their origin, so
 *            "no network dependency" is a measurement.
 *
 * Throwaway harness code. Never shipped.
 */
(function install(g) {
  if (g.__b3) return;
  const state = {
    installedAt: Date.now(),
    selfOrigin: "unknown",
    gpu: { hookInstalled: false, hookError: null, submits: 0, computePipelines: 0, requestAdapterCalls: 0, adapter: null },
    network: { observed: false, hookErrors: [], arrivals: [] },
  };
  g.__b3 = state;
  // The realm's own location.origin, which is what the guards compare arrivals against. The URL
  // fallback is for a realm that does not expose it; for an opaque origin it yields "null", and
  // the guards then reject the cell rather than reading it as the extension origin.
  try {
    state.selfOrigin = (g.location && g.location.origin) || new URL(g.location.href).origin;
  } catch (e) {
    /* stays "unknown", which the guards reject */
  }

  function note(kind, url) {
    let origin = "unparseable";
    try {
      origin = new URL(String(url), g.location ? g.location.href : undefined).origin;
    } catch (e) {
      /* an unparseable URL is itself worth reporting */
    }
    state.network.arrivals.push({ kind: kind, url: String(url).slice(0, 200), origin: origin });
  }

  try {
    const nativeFetch = g.fetch;
    if (typeof nativeFetch === "function") {
      g.fetch = function (input, init) {
        note("fetch", typeof input === "string" ? input : (input && input.url) || String(input));
        return nativeFetch.call(this, input, init);
      };
      state.network.observed = true;
    }
  } catch (e) {
    state.network.hookErrors.push("fetch: " + String(e).slice(0, 200));
  }
  try {
    if (typeof g.XMLHttpRequest === "function") {
      const open = g.XMLHttpRequest.prototype.open;
      g.XMLHttpRequest.prototype.open = function (method, url) {
        note("xhr", url);
        return open.apply(this, arguments);
      };
    }
  } catch (e) {
    state.network.hookErrors.push("xhr: " + String(e).slice(0, 200));
  }
  try {
    if (typeof g.importScripts === "function") {
      const nativeImport = g.importScripts;
      g.importScripts = function () {
        for (let i = 0; i < arguments.length; i += 1) note("importScripts", arguments[i]);
        return nativeImport.apply(this, arguments);
      };
    }
  } catch (e) {
    state.network.hookErrors.push("importScripts: " + String(e).slice(0, 200));
  }

  function describeAdapter(a, requested) {
    if (!a) return { returned: false, identified: false, requestedOptions: requested || null };
    const info = a.info || null;
    const pick = (k) => (info && info[k] !== undefined && info[k] !== "" ? info[k] : null);
    const r = {
      returned: true,
      vendor: pick("vendor"),
      architecture: pick("architecture"),
      device: pick("device"),
      description: pick("description"),
      isFallbackAdapter: a.isFallbackAdapter !== undefined ? a.isFallbackAdapter : pick("isFallbackAdapter"),
      requestedOptions: requested || null,
    };
    r.identified = !!(r.vendor || r.architecture || r.device || r.description);
    return r;
  }
  g.__b3_describeAdapter = describeAdapter;

  try {
    if (typeof g.GPUQueue === "function") {
      const submit = g.GPUQueue.prototype.submit;
      g.GPUQueue.prototype.submit = function (buffers) {
        state.gpu.submits += 1;
        return submit.call(this, buffers);
      };
      state.gpu.hookInstalled = true;
    } else {
      state.gpu.hookError = "GPUQueue is not defined in this realm";
    }
    if (typeof g.GPUDevice === "function") {
      const ccp = g.GPUDevice.prototype.createComputePipeline;
      g.GPUDevice.prototype.createComputePipeline = function (desc) {
        state.gpu.computePipelines += 1;
        return ccp.call(this, desc);
      };
    }
    const gpu = g.navigator && g.navigator.gpu;
    if (gpu && typeof gpu.requestAdapter === "function") {
      const ra = gpu.requestAdapter.bind(gpu);
      gpu.requestAdapter = async function (o) {
        state.gpu.requestAdapterCalls += 1;
        const a = await ra(o);
        state.gpu.adapter = describeAdapter(a, o);
        return a;
      };
    }
  } catch (e) {
    state.gpu.hookInstalled = false;
    state.gpu.hookError = String(e).slice(0, 200);
  }
})(typeof globalThis !== "undefined" ? globalThis : self);
