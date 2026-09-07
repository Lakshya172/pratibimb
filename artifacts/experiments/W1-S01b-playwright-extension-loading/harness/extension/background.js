// S-01b probe: emit one fetch from the MV3 service worker, and one from an
// offscreen document, so the runner can test whether Playwright observes either.
// Loopback only. No product code.
const BASE = "http://127.0.0.1:8901";

async function fromServiceWorker() {
  try {
    const r = await fetch(`${BASE}/egress/service-worker`, { method: "POST", body: "sw" });
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "S-01b egress visibility probe"
  });
}

self.addEventListener("activate", () => {
  // Announce readiness by hitting a distinct path the runner can wait on.
  fetch(`${BASE}/ready/service-worker`).catch(() => {});
});

globalThis.__s01b_run = async function () {
  const sw = await fromServiceWorker();
  await ensureOffscreen();
  const off = await new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: "offscreen timeout" }), 8000);
    chrome.runtime.onMessage.addListener(function handler(msg) {
      if (msg && msg.type === "s01b-offscreen-result") {
        clearTimeout(t);
        chrome.runtime.onMessage.removeListener(handler);
        resolve(msg.result);
      }
    });
    chrome.runtime.sendMessage({ type: "s01b-offscreen-go" }).catch(() => {});
  });
  return { serviceWorker: sw, offscreen: off };
};
