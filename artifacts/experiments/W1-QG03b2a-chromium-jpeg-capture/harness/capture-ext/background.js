/**
 * The capture side of QG-03b-2a. This file exists to call ONE API for real.
 *
 *     chrome.tabs.captureVisibleTab({ format: "jpeg" })
 *
 * There is deliberately no encoder, no canvas, and no image library anywhere in here. If
 * this file ever grows a `canvas.toDataURL()` the experiment stops being about Chromium's
 * capture encoder and starts being about Chromium's canvas encoder, which is a different
 * component with a different configuration. `assertRealCaptureApi` below fails closed if
 * the binding it is about to call is not the browser's own.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE PERMISSION GATE IS NOT THE ENCODER
 *
 * The dossier's production mechanism is `activeTab`, which Chromium grants only after a
 * user gesture on the extension's own action — a toolbar click Playwright cannot deliver.
 * So this harness holds `<all_urls>` instead, and that difference is recorded rather than
 * hidden. It was also MEASURED: a host permission scoped to the fixture origin alone is
 * refused by Chromium 151 with
 *
 *     "Either the '<all_urls>' or 'activeTab' permission is required."
 *
 * which is the gate declining before any capture happens. The gate decides WHETHER the
 * call runs; it has no path to the bytes it returns. Nothing in this experiment's findings
 * depends on which of the two gates was used, and the product's gate is unchanged.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * PACING
 *
 * Chromium enforces MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND and refuses over it — the
 * quota W1-S05-rate measured and `isThrottleSignature` already recognises. The harness
 * paces itself under the quota and retries a throttle refusal, which the SHIPPED adapter
 * must never do: there, throttling is reported to the tier that owns capture cadence. The
 * retries are counted and reported so a slow run cannot be mistaken for a fast one.
 */
const SETTLE_MS = 1400;
const MAX_RETRIES = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Refuse to run against anything but the browser's own binding.
 *
 * A test-double, a polyfill, or a stray monkey-patch would make every number below a
 * measurement of the double. Native bindings stringify as "function () { [native code] }";
 * a JS replacement cannot fake that without also replacing Function.prototype.toString,
 * which would itself be visible. Cheap, and it fails closed.
 */
function assertRealCaptureApi() {
  const fn = chrome && chrome.tabs && chrome.tabs.captureVisibleTab;
  if (typeof fn !== "function") throw new Error("chrome.tabs.captureVisibleTab is not a function");
  const src = Function.prototype.toString.call(fn);
  if (!/\[native code\]/.test(src)) {
    throw new Error("chrome.tabs.captureVisibleTab is not a native binding: " + src.slice(0, 120));
  }
  return { source: src.replace(/\s+/g, " ").slice(0, 80) };
}

function bytesFromDataUrl(url) {
  const comma = url.indexOf(",");
  const header = url.slice(0, comma);
  const bin = atob(url.slice(comma + 1));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return { header, bytes: u };
}

async function sha256(u) {
  const d = await crypto.subtle.digest("SHA-256", u.buffer.slice(0));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Base64 without spreading a large array across the argument stack. */
function toBase64(u) {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

/** One real capture, with the throttle quota respected rather than fought. */
async function captureOnce(options) {
  let throttled = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      const t0 = performance.now();
      const url = await chrome.tabs.captureVisibleTab(options);
      const elapsed = performance.now() - t0;
      const { header, bytes } = bytesFromDataUrl(url);
      const mime = header.slice(5, header.indexOf(";"));
      return {
        ok: true,
        requested: options,
        mime,
        dataUrlHeader: header,
        bytes: bytes.length,
        sha256: await sha256(bytes),
        magic: Array.from(bytes.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join(" "),
        captureMs: Math.round(elapsed * 10) / 10,
        throttleRetries: throttled,
        b64: toBase64(bytes),
      };
    } catch (e) {
      const message = String((e && e.message) || e);
      // The exact quota string W1-S05-rate measured. Anything else is a real failure and
      // is returned as one rather than retried into.
      if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|exceeds the .* quota/i.test(message) && attempt < MAX_RETRIES) {
        throttled++;
        await sleep(SETTLE_MS);
        continue;
      }
      return { ok: false, requested: options, error: message.slice(0, 240), throttleRetries: throttled };
    }
  }
}

/**
 * Probe what the API will and will not accept.
 *
 * Run once per session, not per fixture. `webp` is included because the perception tier's
 * `CaptureFrame.format` permits it: if Chromium rejects it here, that is the API itself
 * saying the type is wider than the mechanism, which is worth knowing precisely.
 */
async function probeApiSurface() {
  const surface = {};
  for (const [name, options] of [
    ["omitted", {}],
    ["png", { format: "png" }],
    ["jpeg", { format: "jpeg" }],
    ["jpeg-q100", { format: "jpeg", quality: 100 }],
    ["jpeg-q50", { format: "jpeg", quality: 50 }],
    ["png-q50", { format: "png", quality: 50 }],
    ["webp", { format: "webp" }],
  ]) {
    await sleep(SETTLE_MS);
    const r = await captureOnce(options);
    delete r.b64; // the surface probe wants the shape, not the pixels
    surface[name] = r;
  }
  return surface;
}

globalThis.__qg03b2a_capture = async function (config) {
  const out = { startedAt: new Date().toISOString(), userAgent: navigator.userAgent };
  try {
    out.apiBinding = assertRealCaptureApi();
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    out.capturedTabUrl = tabs[0] && tabs[0].url;
    out.permissions = await chrome.permissions.getAll();
    if (config && config.surfaceProbe) out.apiSurface = await probeApiSurface();

    out.captures = [];
    for (const format of config.formats) {
      await sleep(SETTLE_MS);
      // `quality` is passed ONLY when the caller asked for a specific one. Omitting it is
      // what the production adapter does, so the default must be measured, not configured.
      const options = { format };
      if (config.quality != null && format === "jpeg") options.quality = config.quality;
      out.captures.push(await captureOnce(options));
    }
  } catch (e) {
    out.error = String((e && e.message) || e).slice(0, 300);
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
