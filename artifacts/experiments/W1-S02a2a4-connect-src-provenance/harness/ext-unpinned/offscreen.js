/* MAIN THREAD of the chrome.offscreen document. Throwaway spike code. */
const CFG = self.PRATIBIMB_CFG;
(async () => {
  await reportProbe(CFG, 'offscreen-document');
  await new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    let w;
    try { w = new Worker('worker.js'); }
    catch (e) {
      fetch(CFG.allowedOrigin + '/result', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: 'offscreen-dedicated-worker',
                               fatal: { name: e.name, message: e.message } })
      }).finally(done);
      return;
    }
    w.onmessage = (ev) => { if (ev.data && ev.data.type === 'probe-complete') { w.terminate(); done(); } };
    w.onerror = (ev) => {
      fetch(CFG.allowedOrigin + '/result', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: 'offscreen-dedicated-worker',
                               fatal: { name: 'WorkerError', message: ev.message || 'onerror' } })
      }).finally(done);
    };
    w.postMessage({ type: 'run', cfg: CFG });
    setTimeout(done, 60000);
  });
  await fetch(CFG.allowedOrigin + '/done', { method: 'POST' }).catch(() => {});
})();
