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

  /**
   * TEST-ONLY: everything this worker actually saw.
   *
   * The claim "no page value crosses the service worker" is worth very little as a reading of the
   * code and a great deal as a recording of the traffic. So every message delivered to this
   * context's listeners, every message it sends to a tab, and every frame on a transport port is
   * kept here, and an evidence run scans the lot against the fixture's own values. If a value ever
   * crossed, it is in this list — which is the point: the worker is being asked to incriminate
   * itself, and the test passes only when it cannot.
   *
   * Bounded, in memory, reachable only through the DevTools protocol, and gone when MV3 terminates
   * this worker. No page can read it.
   */
  const seen: { at: number; way: "in" | "to-tab" | "port"; message: unknown }[] = [];
  const note = (way: "in" | "to-tab" | "port", message: unknown): void => {
    if (seen.length < 2_000) seen.push({ at: Date.now(), way, message });
  };

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
    toTab: (tabId: number, msg: object) => {
      note("to-tab", msg);
      return chrome.tabs.sendMessage(tabId, msg);
    },
    /** TEST-ONLY: everything this worker saw, for an evidence run to scan. */
    seen,
    forgetSeen: () => {
      seen.length = 0;
      return true;
    },
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
    /**
     * TEST-ONLY: arm one boundary capability outside a run, so an evidence run can present it
     * wrongly. Reachable only through the DevTools protocol, exactly as `e6Arm` is; no page can
     * reach it, and the capability it arms carries a reference and a target, never a value.
     */
    armBoundaryCapability: async (tabId: number, target: string, ttlMs: number) => {
      const hello = [...hellos].reverse().find((h) => h.identity.tabId === tabId);
      if (!hello || hello.identity.documentId === null || hello.identity.frameId === null) return { refused: "NO_DOCUMENT_FOR_TAB" };
      await ensureOffscreen();
      const r = (await chrome.runtime.sendMessage({
        target: "offscreen", kind: "ARM_BOUNDARY_CAPABILITY", tabId, frameId: hello.identity.frameId, documentId: hello.identity.documentId, field: target, ttlMs,
      })) as { nonce?: string };
      return { nonce: r.nonce ?? null, documentId: hello.identity.documentId, tabId };
    },
    /** TEST-ONLY: present a capability to a tab exactly as the core realm would. */
    presentCapability: (tabId: number, frameId: number, nonce: string, target: string) =>
      chrome.tabs.sendMessage(tabId, { kind: "BOUNDARY", body: { kind: "CAPABILITY", nonce, target } }, { frameId }),
    grantDecide: async (granted: boolean) => {
      await ensureOffscreen();
      return chrome.runtime.sendMessage({ target: "offscreen", kind: "GRANT_DECIDE", granted });
    },
    // EXPERIMENT E6: arm a single-use value release for the latest document seen in a tab. The worker
    // handles only the nonce and the document identity — never the value.
    e6Arm: async (tabId: number, ttlMs: number, selector = "#t") => {
      const hello = [...hellos].reverse().find((h) => h.identity.tabId === tabId);
      if (!hello || hello.identity.documentId === null || hello.identity.frameId === null) return { refused: "NO_DOCUMENT_FOR_TAB" };
      await ensureOffscreen();
      const r = (await chrome.runtime.sendMessage({
        target: "offscreen", kind: "E6_ARM", tabId, frameId: hello.identity.frameId, documentId: hello.identity.documentId, ref: "<PII:PHONE:1>", selector, ttlMs,
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
    const adapted = adaptPort(port);
    // Same recording, for the one channel that is not a runtime message.
    const watched = {
      ...adapted,
      postMessage: (message: unknown) => {
        note("port", message);
        adapted.postMessage(message as never);
      },
      onMessage: (listener: (message: unknown) => void) =>
        adapted.onMessage((message) => {
          note("port", message);
          listener(message);
        }),
    };
    if (!transport.acceptPort(watched)) port.disconnect();
  });

  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    note("in", raw);
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
     * Carry one privacy-boundary request to the bound document.
     *
     * THE WORKER IS THE POSTMAN AND IT IS NOT GIVEN THE LETTER. What passes through here is a
     * value-free element graph on the way down, spans and descriptors and counts on the way back,
     * and — for a capability — a nonce and a field name. Whatever a capability holds is collected by
     * the content script as a reply this context never sees. Only the offscreen document may ask,
     * and it may only ask for a tab.
     */
    if (msg?.kind === "TO_PAGE_BOUNDARY") {
      if (!isFromOffscreenDocument(sender)) {
        sendResponse({ ok: false, refused: "SENDER_NOT_ACCEPTED" });
        return false;
      }
      const ask = raw as { tabId: number; frameId: number; body: unknown };
      note("to-tab", ask.body);
      chrome.tabs
        .sendMessage(ask.tabId, { kind: "BOUNDARY", body: ask.body }, { frameId: ask.frameId })
        .then(sendResponse)
        .catch((error: unknown) => sendResponse({ ok: false, refused: error instanceof Error ? error.message : String(error) }));
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
