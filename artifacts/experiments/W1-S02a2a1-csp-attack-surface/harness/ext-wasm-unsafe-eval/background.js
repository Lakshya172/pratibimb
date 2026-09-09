/* S-02a-2a-1 orchestrator - MV3 BACKGROUND SERVICE WORKER. Throwaway spike code. */
importScripts('probe.js');
const COLLECTOR = 'http://127.0.0.1:8907';

async function say(stage, detail) {
  try {
    await fetch(COLLECTOR + '/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, detail, at: new Date().toISOString() })
    });
  } catch (_) {}
}

let started = false;
async function main() {
  if (started) return;
  started = true;
  await say('start', { variant: chrome.runtime.getManifest().name, id: chrome.runtime.id,
                       csp: chrome.runtime.getManifest().content_security_policy || null });
  await reportProbe(COLLECTOR, 'mv3-service-worker');
  try {
    if (!(await chrome.offscreen.hasDocument?.())) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html', reasons: ['WORKERS'],
        justification: 'Host a dedicated worker for local inference (S-02a-2a-1 probe).'
      });
    }
  } catch (e) {
    await say('offscreen-error', { name: e.name, message: e.message });
    await fetch(COLLECTOR + '/done', { method: 'POST' });
  }
}
chrome.runtime.onInstalled.addListener(main);
chrome.runtime.onStartup.addListener(main);
main();
