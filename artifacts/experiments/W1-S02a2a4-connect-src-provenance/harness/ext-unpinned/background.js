/* S-02a-2a-4 orchestrator - MV3 BACKGROUND SERVICE WORKER. Throwaway spike code. */
importScripts('config.js', 'probe.js');
const CFG = self.PRATIBIMB_CFG;

async function say(stage, detail) {
  try {
    await fetch(CFG.allowedOrigin + '/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pratibimb-probe': 'sw::log' },
      body: JSON.stringify({ stage, detail, at: new Date().toISOString() })
    });
  } catch (_) {}
}

let started = false;
async function main() {
  if (started) return;
  started = true;
  // Liveness beacon first. "The service worker never ran" and "it ran and everything was
  // blocked" are completely different results and must never be confused (B-02 rule).
  await say('alive', { id: chrome.runtime.id,
                       csp: chrome.runtime.getManifest().content_security_policy });
  await reportProbe(CFG, 'mv3-service-worker');
  try {
    if (!(await chrome.offscreen.hasDocument?.())) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html', reasons: ['WORKERS'],
        justification: 'Host a dedicated worker for local inference (S-02a-2a-4 probe).'
      });
    }
  } catch (e) {
    await say('offscreen-error', { name: e.name, message: e.message });
    await fetch(CFG.allowedOrigin + '/done', { method: 'POST' }).catch(() => {});
  }
}
chrome.runtime.onInstalled.addListener(main);
chrome.runtime.onStartup.addListener(main);
main();
