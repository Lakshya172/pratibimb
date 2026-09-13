/**
 * Minimal host — side panel shell. Displays host status only; every control is inert.
 * No settings, no history, no telemetry, no state management.
 */
const status = document.getElementById("status");

async function refresh() {
  try {
    const s = await chrome.runtime.sendMessage({ kind: "HOST_STATUS" });
    if (status) status.textContent = JSON.stringify(s, null, 2);
    document.documentElement.dataset.hostStatus = "ok";
  } catch (e) {
    if (status) status.textContent = `status unavailable: ${e instanceof Error ? e.message : String(e)}`;
    document.documentElement.dataset.hostStatus = "error";
  }
}

void refresh();
