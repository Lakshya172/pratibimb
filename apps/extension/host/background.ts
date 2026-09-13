/**
 * Minimal host — service worker. Creates the offscreen document and routes messages.
 *
 * Holds NO values and NO secrets: MV3 terminates an idle service worker, so anything kept here is
 * lost on termination by design. `bootId` exists only so an evidence run can tell whether this
 * worker was restarted.
 */
import { identityOf, isFromContentScript, isFromExtensionPage, type SenderIdentity, type ToSw } from "../host-lib/messages";

export default defineBackground(() => {
  const bootId = crypto.randomUUID();
  const bootedAt = Date.now();
  const hellos: { at: number; identity: SenderIdentity }[] = [];

  async function ensureOffscreen(): Promise<number> {
    const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (existing.length === 0) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: "PratiBimb minimal host: ORT inference and the synthetic vault stub",
      });
    }
    return (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length;
  }

  // A test-only control plane: evidence runs call these through the DevTools protocol. They are not
  // reachable from any web page.
  (globalThis as Record<string, unknown>).__host = {
    bootId,
    bootedAt,
    hellos,
    ensureOffscreen,
    toOffscreen: async (msg: object) => {
      await ensureOffscreen();
      return chrome.runtime.sendMessage({ target: "offscreen", ...msg });
    },
    toTab: (tabId: number, msg: object) => chrome.tabs.sendMessage(tabId, msg),
    offscreenContexts: async () => (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length,
    // EXPERIMENT E6: arm a single-use value release for the latest document seen in a tab. The worker
    // handles only the nonce and the document identity — never the value.
    e6Arm: async (tabId: number, ttlMs: number) => {
      const hello = [...hellos].reverse().find((h) => h.identity.tabId === tabId);
      if (!hello || hello.identity.documentId === null || hello.identity.frameId === null) return { refused: "NO_DOCUMENT_FOR_TAB" };
      await ensureOffscreen();
      const nonce = crypto.randomUUID();
      const r = await chrome.runtime.sendMessage({
        target: "offscreen", kind: "E6_ARM", nonce, tabId, frameId: hello.identity.frameId, documentId: hello.identity.documentId, ref: "<PII:PHONE:1>", ttlMs,
      });
      return { nonce, documentId: hello.identity.documentId, armed: r };
    },
  };

  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const msg = raw as ToSw & { target?: string };
    if (msg?.target === "offscreen") return false; // addressed to the offscreen document, not here
    if (msg?.kind === "HOST_STATUS" && isFromExtensionPage(sender)) {
      void ensureOffscreen().then((n) => sendResponse({ bootId, bootedAt, offscreenContexts: n, hellos: hellos.length }));
      return true;
    }
    if (!isFromContentScript(sender)) {
      sendResponse({ refused: "SENDER_NOT_ACCEPTED" });
      return false;
    }
    if (msg.kind === "HELLO") {
      hellos.push({ at: Date.now(), identity: identityOf(sender) });
      sendResponse({ bootId, identity: identityOf(sender) });
      return false;
    }
    if (msg.kind === "RELAY_ECHO") {
      void ensureOffscreen()
        .then(() => chrome.runtime.sendMessage({ target: "offscreen", kind: "ECHO" }))
        .then((echo) => sendResponse({ bootId, echo, identity: identityOf(sender) }));
      return true;
    }
    sendResponse({ refused: "UNKNOWN_KIND" });
    return false;
  });
});
