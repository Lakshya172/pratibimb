// S-02: run the shared probe inside the Firefox MV3 EVENT PAGE.
//
// Reporting is deliberately belt-and-braces, because "the event page never ran" and
// "the event page ran and found no adapter" are completely different results and must
// never be confused. A tab-open to /alive proves the page executed, independently of
// whether fetch is permitted.
//
// Throwaway spike code. Loopback only.
const BASE = "http://127.0.0.1:8904";
const api = typeof browser !== "undefined" ? browser : chrome;

function beacon(pathAndQuery) {
  try { return api.tabs.create({ url: BASE + pathAndQuery, active: false }); }
  catch (e) { return Promise.resolve(); }
}

async function report(payload) {
  let via = null, fetchError = null;
  try {
    await fetch(`${BASE}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    via = "fetch";
  } catch (e) {
    fetchError = String(e).slice(0, 200);
    // Fallback channel that does not depend on host permissions. Firefox MV3 makes
    // host_permissions opt-in, so fetch from an extension page is refused until the
    // user grants the origin -- but a tab navigation is not gated the same way.
    // The FULL payload goes through here, so no measurement is lost to the fallback.
    payload.fetchError = fetchError;
    await beacon("/sink?d=" + encodeURIComponent(JSON.stringify(payload)));
    via = "tabs-beacon";
  }
  return via;
}

(async () => {
  // Liveness first: proves the event page executed at all.
  await beacon("/alive?stage=start");
  let payload;
  try {
    payload = await globalThis.runWasmProbe("firefox-mv3-event-page");
  } catch (e) {
    payload = { context: "firefox-mv3-event-page", error: String(e && e.stack ? e.stack : e).slice(0, 400),
                conclusion: "probe threw" };
  }
  try { payload.manifestVersion = api.runtime.getManifest().manifest_version; } catch {}
  payload.backgroundKind = "event-page (background.scripts)";
  payload.reportedVia = await report(payload);
})();
