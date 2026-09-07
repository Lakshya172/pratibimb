/*
 * S-01 orchestrator. Runs in the MV3 BACKGROUND SERVICE WORKER.
 * THROWAWAY SPIKE CODE.
 *
 * Sequence:
 *   1. probe this service worker itself
 *   2. create the chrome.offscreen document, which probes itself and then spawns a
 *      dedicated Worker that probes too  <-- the real PratiBimb target context
 *   3. tell the collector the run is complete
 */
importScripts('probe.js');

const COLLECTOR = 'http://127.0.0.1:8899';

async function say(stage, detail) {
  try {
    await fetch(COLLECTOR + '/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, detail, at: new Date().toISOString() })
    });
  } catch (_) { /* collector may be gone; nothing to do */ }
}

async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument?.();
  if (existing) return 'already-open';
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    // WORKERS is the honest reason: the document exists to host a dedicated worker
    // that runs inference. This mirrors what PratiBimb itself will declare.
    reasons: ['WORKERS'],
    justification: 'Host a dedicated worker for local WebGPU/WASM inference (S-01 probe).'
  });
  return 'created';
}

async function main() {
  await say('start', {
    chromeVersion: navigator.userAgent,
    manifestVersion: chrome.runtime.getManifest().manifest_version,
    extensionId: chrome.runtime.id
  });

  // 1 — the service worker itself
  await say('probing', 'mv3-service-worker');
  await reportProbe(COLLECTOR, 'mv3-service-worker');

  // 2 — offscreen document (which chains to the dedicated worker)
  let offscreenState = 'not-attempted';
  try {
    offscreenState = await ensureOffscreen();
    await say('offscreen', offscreenState);
  } catch (e) {
    await say('offscreen-error', { name: e.name, message: e.message });
    await fetch(COLLECTOR + '/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: 'offscreen-document',
        navigatorGpuPresent: null,
        error: { name: e.name, message: e.message },
        conclusion: 'chrome.offscreen.createDocument() failed'
      })
    });
    await fetch(COLLECTOR + '/done', { method: 'POST' });
  }
}

// Loading an unpacked extension fires onInstalled, but the worker is also evaluated
// directly, so main() can be entered twice. Two probes running CONCURRENTLY contend
// for the same GPU and produce latency that looks like a slow context but is really
// self-inflicted contention -- observed in run 0 as a 4.3 s p95. Guard it.
let started = false;
function once() {
  if (started) return;
  started = true;
  main();
}

chrome.runtime.onInstalled.addListener(once);
chrome.runtime.onStartup.addListener(once);
once();
