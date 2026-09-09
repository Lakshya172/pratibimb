// MV3 service worker: probes its own context, then drives the offscreen document and the
// dedicated worker inside it, and reports everything to the loopback collector.
// Chrome MV3 grants declared host_permissions at install, so fetch works here.
// Throwaway spike code. Loopback only.
importScripts("probe.js");
const BASE = "http://127.0.0.1:8905";

async function ensureOffscreen() {
  const has = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (has.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html", reasons: ["WORKERS"], justification: "S-02a-2b WASM CSP probe"
  });
}

globalThis.__s02a2b_run = async function () {
  const all = [];
  all.push(await globalThis.runWasmProbe("chrome-mv3-service-worker"));
  await ensureOffscreen();
  const offscreenResults = await new Promise((resolve) => {
    const t = setTimeout(() => resolve([{ context: "chrome-offscreen-document",
      conclusion: "offscreen timeout", error: { name: "Timeout", message: "no reply" } }]), 25000);
    chrome.runtime.onMessage.addListener(function h(m) {
      if (m && m.type === "s02a2b-offscreen-results") {
        clearTimeout(t); chrome.runtime.onMessage.removeListener(h); resolve(m.results);
      }
    });
    chrome.runtime.sendMessage({ type: "s02a2b-go" }).catch(() => {});
  });
  all.push(...offscreenResults);
  try {
    await fetch(`${BASE}/result`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contexts: all }) });
  } catch (e) { /* runner times out, which is itself recorded */ }
  return all;
};
