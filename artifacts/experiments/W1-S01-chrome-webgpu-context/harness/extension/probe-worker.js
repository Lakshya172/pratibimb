/*
 * DEDICATED WORKER spawned by the offscreen document.
 * This is PratiBimb's real inference context. THROWAWAY SPIKE CODE.
 */
importScripts('probe.js');

self.onmessage = async (ev) => {
  if (!ev.data || ev.data.type !== 'run') return;
  await reportProbe(ev.data.collector, 'offscreen-dedicated-worker');
  self.postMessage({ type: 'probe-complete' });
};
