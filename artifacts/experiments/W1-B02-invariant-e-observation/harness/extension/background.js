// B-02 probe: service worker only creates the offscreen document and relays commands.
// All sending happens in the offscreen document, which is the context S-01b showed
// Playwright cannot observe, and which the constitution makes PratiBimb's send path.
async function ensureOffscreen() {
  const has = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (has.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "B-02 Invariant E observation probe"
  });
}

globalThis.__b02_run = async function (scenario) {
  await ensureOffscreen();
  return await new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: "offscreen timeout" }), 15000);
    chrome.runtime.onMessage.addListener(function h(msg) {
      if (msg && msg.type === "b02-result") {
        clearTimeout(t);
        chrome.runtime.onMessage.removeListener(h);
        resolve(msg.result);
      }
    });
    chrome.runtime.sendMessage({ type: "b02-go", scenario }).catch(() => {});
  });
};
