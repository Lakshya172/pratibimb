/* DEDICATED WORKER inside the offscreen document - PratiBimb's real inference context. */
importScripts('probe.js');
self.onmessage = async (ev) => {
  if (!ev.data || ev.data.type !== 'run') return;
  await reportProbe(ev.data.collector, 'offscreen-dedicated-worker');
  self.postMessage({ type: 'probe-complete' });
};
