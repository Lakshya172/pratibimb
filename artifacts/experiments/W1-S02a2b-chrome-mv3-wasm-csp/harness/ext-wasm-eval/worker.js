// Dedicated worker inside the offscreen document — the context S-01 identified as
// PratiBimb's real inference target. Throwaway spike code.
importScripts("probe.js");
self.onmessage = async () => {
  const r = await globalThis.runWasmProbe("chrome-offscreen-dedicated-worker");
  self.postMessage(r);
};
