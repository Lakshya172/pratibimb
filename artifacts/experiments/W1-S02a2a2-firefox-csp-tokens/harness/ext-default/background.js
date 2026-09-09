// S-02a-2a-2: run the token probe inside the Firefox MV3 EVENT PAGE, then inside a
// dedicated worker spawned from it. Throwaway spike code. Loopback only.
//
// Reporting is belt-and-braces, reused from W1-S02a-2: "the event page never ran" and
// "it ran and everything was blocked" are completely different results. A tab-open to
// /alive proves execution independently of whether fetch is permitted, because Firefox
// MV3 gates host_permissions behind origin controls.
const BASE = "http://127.0.0.1:8909";
const DECLARED_CSP = null;
const api = typeof browser !== "undefined" ? browser : chrome;

function beacon(pathAndQuery) {
  try { return api.tabs.create({ url: BASE + pathAndQuery, active: false }); }
  catch (e) { return Promise.resolve(); }
}

async function report(payload) {
  let via = null;
  try {
    await fetch(BASE + "/result", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    via = "fetch";
  } catch (e) {
    payload.fetchError = String(e).slice(0, 200);
    await beacon("/sink?d=" + encodeURIComponent(JSON.stringify(payload)));
    via = "tabs-beacon";
  }
  return via;
}

(async () => {
  await beacon("/alive?stage=start&variant=" + encodeURIComponent("ext-default"));

  // 1 - the event page itself
  let ep;
  try { ep = await globalThis.runTokenProbe("firefox-mv3-event-page", DECLARED_CSP); }
  catch (e) { ep = { context: "firefox-mv3-event-page", fatal: String(e).slice(0, 300) }; }
  try { ep.manifestVersion = api.runtime.getManifest().manifest_version; } catch {}
  ep.variant = "ext-default";
  ep.reportedVia = await report(ep);

  // 2 - a dedicated worker spawned from the event page
  let wr;
  try {
    wr = await new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      let w;
      try { w = new Worker("worker.js"); }
      catch (e) {
        return done({ context: "firefox-event-page-dedicated-worker",
                      fatal: "Worker construction failed: " + String(e).slice(0, 200) });
      }
      w.onmessage = (ev) => { w.terminate(); done(ev.data); };
      w.onerror = (ev) => done({ context: "firefox-event-page-dedicated-worker",
                                 fatal: "worker onerror: " + (ev.message || "") });
      w.postMessage({ type: "run", csp: DECLARED_CSP });
      setTimeout(() => done({ context: "firefox-event-page-dedicated-worker",
                              fatal: "worker timeout" }), 30000);
    });
  } catch (e) { wr = { context: "firefox-event-page-dedicated-worker", fatal: String(e).slice(0, 200) }; }
  wr.variant = "ext-default";
  wr.reportedVia = await report(wr);
})();
