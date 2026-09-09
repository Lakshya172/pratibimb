importScripts("shared/probe.js");
self.onmessage = async (ev) => {
  if (!ev.data || ev.data.type !== "run") return;
  let r;
  try { r = await globalThis.runTokenProbe("firefox-event-page-dedicated-worker", ev.data.csp); }
  catch (e) { r = { context: "firefox-event-page-dedicated-worker", fatal: String(e).slice(0, 300) }; }
  self.postMessage(r);
};
