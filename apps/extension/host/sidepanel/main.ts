/**
 * Minimal host — side panel shell. Displays host status only; every control is inert.
 * No settings, no history, no telemetry, no state management.
 */
const status = document.getElementById("status");
const capture = document.getElementById("capture");

/**
 * What a person has to do, in one line.
 *
 * ADR-0009 accepts that a fresh toolbar invocation is required after navigation, and is explicit
 * that this is "a deliberate fail-closed behavior, not a defect to be hidden". Hiding it would mean
 * a capture refusing somewhere nobody can see; this is the smallest place to say it out loud.
 */
const CAPTURE_TEXT: Record<string, string> = {
  NO_GRANT: "Not authorised. Click the toolbar button to let PratiBimb look at this tab.",
  GRANTED: "Authorised. No frame taken yet.",
  STREAM_AVAILABLE: "Authorised for the page currently open.",
  DOCUMENT_CHANGED: "The page changed. Click the toolbar button again to re-authorise.",
  REVOKED: "Authorisation ended when the tab navigated. Click the toolbar button again.",
};

async function refresh() {
  try {
    const s = (await chrome.runtime.sendMessage({ kind: "HOST_STATUS" })) as {
      captureStatus?: { lifecycle: string; requiresReauth: boolean } | null;
    };
    if (status) status.textContent = JSON.stringify(s, null, 2);
    if (capture) {
      const lifecycle = s?.captureStatus?.lifecycle ?? "NO_GRANT";
      capture.textContent = CAPTURE_TEXT[lifecycle] ?? lifecycle;
      capture.dataset.lifecycle = lifecycle;
      capture.dataset.requiresReauth = String(s?.captureStatus?.requiresReauth ?? true);
    }
    document.documentElement.dataset.hostStatus = "ok";
  } catch (e) {
    if (status) status.textContent = `status unavailable: ${e instanceof Error ? e.message : String(e)}`;
    document.documentElement.dataset.hostStatus = "error";
  }
}

void refresh();
