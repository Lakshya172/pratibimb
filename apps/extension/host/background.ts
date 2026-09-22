/**
 * Minimal host — service worker. Creates the offscreen document and routes messages.
 *
 * Holds NO values and NO secrets: MV3 terminates an idle service worker, so anything kept here is
 * lost on termination by design. `bootId` exists only so an evidence run can tell whether this
 * worker was restarted.
 */
import { createServiceWorkerRouter, relayRefused, TRANSPORT_CHANNEL, TRANSPORT_PORT_NAME } from "@pratibimb/extension-transport";

import { identityOf, isFromContentScript, isFromExtensionPage, type SenderIdentity, type ToSw } from "../host-lib/messages";
import { adaptPort, isFromOffscreenDocument } from "../host-lib/transport-chrome";

export default defineBackground(() => {
  const bootId = crypto.randomUUID();
  /**
   * EXPERIMENT D-E6-4: the page transport's router. Stateless — it holds no permit, no value and no
   * decision, and adds only the browser's attestation of which document answered. `bootId` is what
   * ties a delivery to the worker that relayed its hit test, so a restart cannot finish an
   * interrupted attempt.
   */
  const transport = createServiceWorkerRouter({ bootId });
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
    // EXPERIMENT D-E6-4: how many documents currently hold a transport port, for diagnosis only.
    transportConnections: () => transport.connectionCount(),
    /**
     * M1: drive one product run in the core realm, and carry a human's answer to it.
     *
     * The worker starts nothing and decides nothing here. `runTask` hands the request to the
     * offscreen document and waits; `grantPeek` reads what a person is being asked, which contains a
     * token and a field label and no value; `grantDecide` carries an answer that came from outside
     * this extension entirely. An automated run's operator answers through these, exactly as the
     * demo rehearsal's `auto` mode answers on the page.
     */
    runTask: async (request: object) => {
      await ensureOffscreen();
      return chrome.runtime.sendMessage({ target: "offscreen", kind: "RUN_TASK", request });
    },
    grantPeek: async () => {
      await ensureOffscreen();
      return chrome.runtime.sendMessage({ target: "offscreen", kind: "GRANT_PEEK" });
    },
    grantDecide: async (granted: boolean) => {
      await ensureOffscreen();
      return chrome.runtime.sendMessage({ target: "offscreen", kind: "GRANT_DECIDE", granted });
    },
    // EXPERIMENT E6: arm a single-use value release for the latest document seen in a tab. The worker
    // handles only the nonce and the document identity — never the value.
    e6Arm: async (tabId: number, ttlMs: number) => {
      const hello = [...hellos].reverse().find((h) => h.identity.tabId === tabId);
      if (!hello || hello.identity.documentId === null || hello.identity.frameId === null) return { refused: "NO_DOCUMENT_FOR_TAB" };
      await ensureOffscreen();
      const r = (await chrome.runtime.sendMessage({
        target: "offscreen", kind: "E6_ARM", tabId, frameId: hello.identity.frameId, documentId: hello.identity.documentId, ref: "<PII:PHONE:1>", selector: "#t", ttlMs,
      })) as { armed: boolean; nonce?: string; refused?: string };
      // The nonce is minted by the core realm, not here. This worker asks for a capability and is
      // told what it is called; it cannot name one into existence.
      return { nonce: r.nonce ?? null, documentId: hello.identity.documentId, armed: r };
    },
  };

  // EXPERIMENT D-E6-4. A content script opens a port; the browser attests who it is through
  // `port.sender`. A port we cannot fully attest, or one from an origin outside loopback, is dropped.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== TRANSPORT_PORT_NAME) return;
    if (!transport.acceptPort(adaptPort(port))) port.disconnect();
  });

  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const msg = raw as ToSw & { target?: string };

    // EXPERIMENT D-E6-4: relay one page request for the core realm. Only the offscreen document may
    // ask; a tab, the side panel or anything else is refused before a page is touched.
    if (typeof raw === "object" && raw !== null && (raw as { channel?: unknown }).channel === TRANSPORT_CHANNEL) {
      if (!isFromOffscreenDocument(sender)) {
        sendResponse(relayRefused("SENDER_NOT_ACCEPTED", bootId));
        return false;
      }
      void transport.relay(raw).then(sendResponse);
      return true;
    }

    if (msg?.target === "offscreen") return false; // addressed to the offscreen document, not here

    /**
     * M1 — carry a release capability to the bound document.
     *
     * THE WORKER IS THE POSTMAN AND IT IS NOT GIVEN THE LETTER. What passes through here is a nonce
     * and a field name. There is no value in this message, no value in the reply, and no branch
     * below that could add one: the page fetches the value from the core realm directly, and that
     * reply never reaches this context. Only the offscreen document may ask, and it may only ask for
     * a tab — it cannot make this worker do anything else.
     */
    if (msg?.kind === "REHYDRATE_REQUEST") {
      if (!isFromOffscreenDocument(sender)) {
        sendResponse({ refused: "SENDER_NOT_ACCEPTED" });
        return false;
      }
      const ask = raw as { tabId: number; frameId: number; nonce: string; target: string };
      chrome.tabs
        .sendMessage(ask.tabId, { kind: "REHYDRATE", nonce: ask.nonce, target: ask.target }, { frameId: ask.frameId })
        .then(sendResponse)
        .catch((error: unknown) => sendResponse({ written: false, refused: error instanceof Error ? error.message : String(error) }));
      return true;
    }

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
