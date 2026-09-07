const BASE = "http://127.0.0.1:8901";
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "s01b-offscreen-go") return;
  fetch(`${BASE}/egress/offscreen-document`, { method: "POST", body: "off" })
    .then((r) => chrome.runtime.sendMessage({ type: "s01b-offscreen-result", result: { ok: true, status: r.status } }))
    .catch((e) => chrome.runtime.sendMessage({ type: "s01b-offscreen-result", result: { ok: false, error: String(e) } }));
});
