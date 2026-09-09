/* DEDICATED WORKER inside the offscreen document - PratiBimb's real inference context. */
importScripts('config.js', 'probe.js');
self.onmessage = async (ev) => {
  if (!ev.data || ev.data.type !== 'run') return;
  await reportProbe(ev.data.cfg, 'offscreen-dedicated-worker');
  self.postMessage({ type: 'probe-complete' });
};
