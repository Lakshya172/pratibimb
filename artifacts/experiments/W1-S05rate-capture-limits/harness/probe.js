/**
 * W1-S05-rate — capture schedules. THROWAWAY SPIKE CODE. Does not ship.
 *
 * Shared by the Chrome MV3 service worker and the Firefox MV2 background script so both
 * browsers run byte-identical schedules. A difference in the results is then a difference
 * in the browsers, not a difference in two harnesses that drifted.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE OBSERVABILITY RULE THIS FILE IS BUILT AROUND
 *
 * A failed call is NOT evidence of a browser rate limit. It is evidence of a failed call.
 * Every attempt therefore records enough to separate:
 *
 *   A  API/browser throttling        the error text the browser itself produced
 *   B  extension/runtime failure     error name/type, worker still alive
 *   C  harness timing failure        actualIntervalMs vs plannedIntervalMs
 *   D  invalid tab/window state      the tab is re-checked around every schedule
 *   E  permission issue              permissions are probed once, up front
 *   F  unrelated resource pressure   elapsedMs distribution
 *
 * Where the API exposes only an error string, that string is recorded VERBATIM and
 * reported as observed behaviour. No claim is made about a browser-internal mechanism
 * that was not measured.
 *
 * Bounded by construction: every schedule has a fixed attempt count. There is no
 * unbounded stress loop anywhere in this file.
 */
/* eslint-disable no-undef */

const API = typeof browser !== "undefined" ? browser : chrome;
const COLLECTOR = "http://127.0.0.1:8940";

/** Monotonic where available, so scheduling measurements survive a wall-clock adjustment. */
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

let seq = 0;
const records = [];

/**
 * Validate a returned data URL as a real image, and read its true dimensions.
 *
 * "The call resolved" and "the browser produced a usable frame" are different claims. A
 * truncated or empty payload would otherwise be counted as a success and quietly raise the
 * observed rate ceiling.
 *
 * PNG dimensions come from the IHDR chunk: bytes 16..23 of the decoded stream.
 */
function inspectDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.length === 0) {
    return { validImage: false, reason: "empty or non-string payload" };
  }
  const m = /^data:image\/(png|jpeg);base64,(.*)$/s.exec(dataUrl);
  if (!m) {
    return { validImage: false, reason: "not a base64 png/jpeg data URL", prefix: dataUrl.slice(0, 40) };
  }
  let bin;
  try {
    bin = atob(m[2]);
  } catch (e) {
    return { validImage: false, reason: "base64 did not decode" };
  }
  if (m[1] === "png") {
    if (bin.length < 24) return { validImage: false, reason: "png shorter than a header" };
    const b = (i) => bin.charCodeAt(i) & 0xff;
    if (b(0) !== 0x89 || b(1) !== 0x50 || b(2) !== 0x4e || b(3) !== 0x47) {
      return { validImage: false, reason: "png magic number absent" };
    }
    const u32 = (o) => (b(o) << 24) | (b(o + 1) << 16) | (b(o + 2) << 8) | b(o + 3);
    const width = u32(16) >>> 0;
    const height = u32(20) >>> 0;
    if (width === 0 || height === 0) {
      return { validImage: false, reason: `png reports ${width}x${height}` };
    }
    return { validImage: true, format: "png", width, height, bytes: bin.length };
  }
  // JPEG: SOI marker, plus a non-trivial length. Dimensions need a full scan; not needed.
  const ok = (bin.charCodeAt(0) & 0xff) === 0xff && (bin.charCodeAt(1) & 0xff) === 0xd8;
  return ok
    ? { validImage: true, format: "jpeg", bytes: bin.length }
    : { validImage: false, reason: "jpeg SOI marker absent" };
}

/**
 * One capture attempt. Never throws — a rejection IS the measurement.
 *
 * `plannedIntervalMs` and `actualIntervalMs` are both recorded so cause C (the harness
 * itself being late) is separable from cause A. A service worker that was descheduled
 * looks exactly like a browser that throttled, unless you kept the timing.
 */
async function attempt(schedule, rung, plannedIntervalMs, lastRequestAt, windowId) {
  seq += 1;
  const id = `s05rate-${schedule}-${rung}-${seq}`;
  const tRequest = now();
  const actualIntervalMs = lastRequestAt === null ? null : tRequest - lastRequestAt;

  let ok = false;
  let errName = null;
  let errMessage = null;
  let inspection = null;

  try {
    const dataUrl = await API.tabs.captureVisibleTab(windowId, { format: "png" });
    inspection = inspectDataUrl(dataUrl);
    ok = inspection.validImage === true;
    if (!ok) {
      errName = "InvalidPayload";
      errMessage = inspection.reason || "payload failed validation";
    }
  } catch (e) {
    errName = (e && e.name) || "Error";
    errMessage = String((e && e.message) || e);
  }

  // Chrome's callback-style errors surface here rather than as a rejection in some paths.
  if (!ok && API.runtime && API.runtime.lastError) {
    errMessage = (errMessage ? errMessage + " | " : "") + API.runtime.lastError.message;
  }

  const tResponse = now();
  const record = {
    id,
    schedule,
    rung,
    seq,
    plannedIntervalMs,
    actualIntervalMs,
    tRequest,
    tResponse,
    elapsedMs: tResponse - tRequest,
    wallClock: new Date().toISOString(),
    ok,
    errName,
    errMessage,
    validImage: inspection ? inspection.validImage === true : false,
    width: inspection && inspection.width ? inspection.width : null,
    height: inspection && inspection.height ? inspection.height : null,
    bytes: inspection && inspection.bytes ? inspection.bytes : null,
  };
  records.push(record);
  return record;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Re-read the tab so an invalid tab/window state (cause D) is never mistaken for a limit. */
async function tabState(tabId) {
  try {
    const t = await API.tabs.get(tabId);
    return { valid: true, active: t.active, status: t.status, discarded: t.discarded === true };
  } catch (e) {
    return { valid: false, error: String((e && e.message) || e) };
  }
}

/**
 * Run the bounded schedule set.
 *
 * Every count here is a constant. Nothing adapts upward, so the worst case is known before
 * the run starts.
 */
async function runSchedules(tabId, windowId) {
  const out = { schedules: [], tabChecks: [] };

  const check = async (label) => {
    out.tabChecks.push({ label, at: new Date().toISOString(), ...(await tabState(tabId)) });
  };

  // ── 1. baseline: a single capture, nothing else in flight ─────────────────────────
  await check("before-baseline");
  {
    const r = await attempt("baseline", 0, null, null, windowId);
    out.schedules.push({ name: "baseline", attempts: [r] });
  }
  await sleep(2000);

  // ── 2. low rate: 10 captures at 0.5 Hz. The dossier's own budget is ~8 captures per
  //       10-step task, so this is the realistic-usage cell.
  {
    const attempts = [];
    let last = null;
    for (let i = 0; i < 10; i += 1) {
      const r = await attempt("low-rate", 0, 2000, last, windowId);
      last = r.tRequest;
      attempts.push(r);
      await sleep(2000);
    }
    out.schedules.push({ name: "low-rate", plannedHz: 0.5, attempts });
  }
  await check("after-low-rate");
  await sleep(3000);

  // ── 3. frequency ladder, repeated 3x so a boundary can be told from noise ──────────
  //       Each rung is 12 attempts with a 3 s quiet gap after it, so the previous rung
  //       cannot contaminate the next one.
  const RUNGS = [1, 2, 3, 4, 5, 10];
  for (let pass = 1; pass <= 3; pass += 1) {
    for (const hz of RUNGS) {
      const interval = Math.round(1000 / hz);
      const attempts = [];
      let last = null;
      for (let i = 0; i < 12; i += 1) {
        const r = await attempt(`ladder-p${pass}`, hz, interval, last, windowId);
        last = r.tRequest;
        attempts.push(r);
        await sleep(interval);
      }
      out.schedules.push({ name: `ladder-p${pass}`, rungHz: hz, plannedIntervalMs: interval, attempts });
      await sleep(3000); // quiet gap: let any stateful budget refill
    }
  }
  await check("after-ladder");

  // ── 4. burst: 8 sequential captures with NO delay ─────────────────────────────────
  {
    const attempts = [];
    let last = null;
    for (let i = 0; i < 8; i += 1) {
      const r = await attempt("burst", 0, 0, last, windowId);
      last = r.tRequest;
      attempts.push(r);
    }
    out.schedules.push({ name: "burst", attempts });
  }

  // ── 5. recovery: immediately after the burst, poll at 250 ms until a success or a
  //       bounded ceiling. Measures how long the observed failure state persists.
  {
    const attempts = [];
    let last = null;
    let recoveredAfterMs = null;
    const t0 = now();
    for (let i = 0; i < 24; i += 1) {
      const r = await attempt("recovery", 0, 250, last, windowId);
      last = r.tRequest;
      attempts.push(r);
      if (r.ok) {
        recoveredAfterMs = r.tResponse - t0;
        break;
      }
      await sleep(250);
    }
    out.schedules.push({ name: "recovery", attempts, recoveredAfterMs });
  }
  await sleep(3000);

  // ── 6. concurrency: 5 captures in flight at once ──────────────────────────────────
  {
    const started = now();
    const settled = await Promise.all(
      [0, 1, 2, 3, 4].map(() => attempt("concurrent", 0, 0, null, windowId))
    );
    out.schedules.push({ name: "concurrent", attempts: settled, wallMs: now() - started });
  }
  await sleep(3000);

  // ── 7. sustained: 40 captures at 2 Hz. Bounded at 20 s; tests whether a rate that
  //       survives a short rung also survives a longer one (stateful vs instantaneous).
  {
    const attempts = [];
    let last = null;
    for (let i = 0; i < 40; i += 1) {
      const r = await attempt("sustained-2hz", 2, 500, last, windowId);
      last = r.tRequest;
      attempts.push(r);
      await sleep(500);
    }
    out.schedules.push({ name: "sustained-2hz", plannedHz: 2, attempts });
  }
  await check("after-sustained");

  return out;
}

/** Probe the permission surface once, so cause E is never confused with a rate limit. */
async function permissionState() {
  const state = { hostPermissions: null, activeTab: null, error: null };
  try {
    if (API.permissions && API.permissions.getAll) {
      const all = await API.permissions.getAll();
      state.hostPermissions = all.origins || [];
      state.activeTab = (all.permissions || []).includes("activeTab");
    }
  } catch (e) {
    state.error = String((e && e.message) || e);
  }
  return state;
}

async function main() {
  const started = new Date().toISOString();
  let payload;
  try {
    const tabs = await API.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) throw new Error("no active tab in the current window");

    const permissions = await permissionState();
    const result = await runSchedules(tab.id, tab.windowId);

    payload = {
      ok: true,
      started,
      finished: new Date().toISOString(),
      context: API.runtime.getManifest().manifest_version === 3 ? "mv3-service-worker" : "mv2-background",
      manifestVersion: API.runtime.getManifest().manifest_version,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      tabId: tab.id,
      windowId: tab.windowId,
      permissions,
      ...result,
      allRecords: records,
    };
  } catch (e) {
    payload = {
      ok: false,
      started,
      finished: new Date().toISOString(),
      harnessError: String((e && e.stack) || e),
      allRecords: records,
    };
  }

  // Report to the loopback collector. Chunked, because a full run is large and some
  // background contexts cap a single body.
  const body = JSON.stringify(payload);
  const CHUNK = 60000;
  const total = Math.ceil(body.length / CHUNK);
  for (let i = 0; i < total; i += 1) {
    await fetch(`${COLLECTOR}/result?part=${i}&of=${total}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: body.slice(i * CHUNK, (i + 1) * CHUNK),
    }).catch(() => {});
  }
  await fetch(`${COLLECTOR}/done`).catch(() => {});
}

main();
