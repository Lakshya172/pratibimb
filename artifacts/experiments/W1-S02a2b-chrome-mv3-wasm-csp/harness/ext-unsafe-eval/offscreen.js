// Runs the WASM probe in the offscreen document, then in a dedicated worker inside it.
// Throwaway spike code.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "s02a2b-go") return;
  (async () => {
    const results = [];
    results.push(await globalThis.runWasmProbe("chrome-offscreen-document"));
    const workerResult = await new Promise((resolve) => {
      let w;
      const t = setTimeout(() => resolve({ context: "chrome-offscreen-dedicated-worker",
        conclusion: "worker timeout", error: { name: "Timeout", message: "no reply from worker" } }), 15000);
      try {
        w = new Worker("worker.js");
        w.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
        w.onerror = (e) => { clearTimeout(t); resolve({ context: "chrome-offscreen-dedicated-worker",
          conclusion: "worker construction/exec error",
          error: { name: "WorkerError", message: String(e.message || e).slice(0, 300) } }); };
        w.postMessage("go");
      } catch (e) {
        clearTimeout(t);
        resolve({ context: "chrome-offscreen-dedicated-worker", conclusion: "worker constructor threw",
          error: { name: e && e.name, message: String(e && e.message || e).slice(0, 300) } });
      }
    });
    results.push(workerResult);
    chrome.runtime.sendMessage({ type: "s02a2b-offscreen-results", results });
  })();
});
