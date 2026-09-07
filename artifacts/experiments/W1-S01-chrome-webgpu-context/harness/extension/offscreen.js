/*
 * Runs on the MAIN THREAD of the chrome.offscreen document.
 * THROWAWAY SPIKE CODE.
 */
const COLLECTOR = 'http://127.0.0.1:8899';

(async () => {
  // 2a — the offscreen document's own main thread
  await reportProbe(COLLECTOR, 'offscreen-document');

  // 2b — a dedicated Worker inside it. THIS is where PratiBimb intends to run
  //      ONNX Runtime Web, so this is the result that actually decides the matrix.
  await new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };

    let worker;
    try {
      worker = new Worker('probe-worker.js');
    } catch (e) {
      fetch(COLLECTOR + '/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: 'offscreen-dedicated-worker',
          error: { name: e.name, message: e.message },
          conclusion: 'could not construct Worker inside the offscreen document'
        })
      }).finally(() => finish());
      return;
    }

    worker.onmessage = (ev) => {
      if (ev.data && ev.data.type === 'probe-complete') {
        worker.terminate();
        finish();
      }
    };
    worker.onerror = (ev) => {
      fetch(COLLECTOR + '/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: 'offscreen-dedicated-worker',
          error: { name: 'WorkerError', message: ev.message || 'worker onerror' },
          conclusion: 'worker failed to run'
        })
      }).finally(() => finish());
    };

    worker.postMessage({ type: 'run', collector: COLLECTOR });
    setTimeout(() => finish(), 60000); // hard cap
  });

  await fetch(COLLECTOR + '/done', { method: 'POST' }).catch(() => {});
})();
