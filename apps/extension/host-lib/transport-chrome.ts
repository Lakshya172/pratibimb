/**
 * The chrome glue for the page transport: three thin adapters, one per realm.
 *
 * Everything that decides anything lives in `@pratibimb/extension-transport`. What is here is the
 * part that cannot be written without `chrome.*`, kept as small as it can be:
 *
 * - **service worker** — turns a `chrome.runtime.Port` into the router's `PortLike`, and refuses one
 *   whose sender the browser did not fully attest. `port.sender` is the browser's word for which
 *   document is on the other end; nothing else in the system can establish that.
 * - **offscreen document** — one `chrome.runtime.sendMessage` to the worker, and no interpretation
 *   of the answer beyond handing it to the transport's own parser.
 * - **content script** — connects the port, answers with the page agent, and reconnects when the
 *   worker is replaced.
 *
 * There is no "trust this sender" shortcut anywhere: the checks are the host's existing ones
 * (`isFromThisExtension`, `isFromExtensionPage`, the loopback-origin rule), applied before anything
 * is routed.
 */
import {
  TRANSPORT_PORT_NAME,
  parseAttachedNotice,
  type AttestedDocument,
  type PageAgent,
  type PortLike,
  type TransportRelay,
} from "@pratibimb/extension-transport";

import { identityOf, isFromExtensionPage, isFromThisExtension } from "./messages";

/**
 * The browser's attestation of a content script, or `null`.
 *
 * `null` is a refusal to route at all. A partially attested sender is not a document this transport
 * can bind to, and inventing the missing half would defeat the point of asking the browser.
 */
export function attestedDocumentOf(sender: chrome.runtime.MessageSender | undefined): AttestedDocument | null {
  if (!sender || !isFromThisExtension(sender)) return null;
  const identity = identityOf(sender);
  if (identity.tabId === null || identity.frameId === null) return null;
  if (identity.documentId === null || identity.origin === null) return null;
  return { tabId: identity.tabId, frameId: identity.frameId, documentId: identity.documentId, origin: identity.origin };
}

/** Only the offscreen document may ask the worker to relay. Not a tab, not the side panel. */
export const isFromOffscreenDocument = (sender: chrome.runtime.MessageSender): boolean =>
  isFromExtensionPage(sender) && sender.url === chrome.runtime.getURL("offscreen.html");

/** Service worker: a `chrome.runtime.Port` as the router sees it. */
export const adaptPort = (port: chrome.runtime.Port): PortLike => ({
  sender: attestedDocumentOf(port.sender),
  postMessage: (message) => port.postMessage(message),
  disconnect: () => port.disconnect(),
  onMessage: (listener) => port.onMessage.addListener((message) => listener(message)),
  onDisconnect: (listener) =>
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // read, so a normal disconnect is not an unchecked error
      listener();
    }),
});

/**
 * Offscreen document: the core realm's one way out.
 *
 * A throw here means the message never left or no answer came back — the transport turns that into
 * `RELAY_UNAVAILABLE`, and the core into UNKNOWN. An answer of `undefined` (nobody responded) fails
 * the envelope parser for the same reason.
 */
export const chromeRelay: TransportRelay = {
  request: (request) => chrome.runtime.sendMessage(request) as Promise<unknown>,
};

export interface ContentTransportOptions {
  /** Consecutive reconnects without ever being attached. Stops a refused port from looping. */
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

/**
 * Content script: connect, answer, and reconnect when the worker goes away.
 *
 * A disconnect is ordinary in MV3 — the worker is terminated when idle — and reconnecting is what
 * wakes its replacement. Reconnecting does NOT resume anything: the cycles this document has
 * answered stay in this document, and any attempt bound to the old worker refuses on its boot id.
 */
export function connectPageTransport(agent: PageAgent, options: ContentTransportOptions = {}): void {
  const maxAttempts = options.maxAttempts ?? 5;
  const retryDelayMs = options.retryDelayMs ?? 250;
  let attempts = 0;

  const connect = (): void => {
    attempts += 1;
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: TRANSPORT_PORT_NAME });
    } catch {
      return; // no extension to connect to; nothing to retry against
    }

    port.onMessage.addListener((raw: unknown) => {
      // The worker's only unsolicited message: this port is registered.
      if (parseAttachedNotice(raw)) {
        attempts = 0;
        return;
      }
      const reply = agent.handle(raw);
      if (reply === null) return; // unreadable and uncorrelatable: answering would invent a request
      try {
        port.postMessage(reply);
      } catch {
        /* the port went away while we were answering */
      }
    });

    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (attempts >= maxAttempts) return;
      setTimeout(connect, retryDelayMs);
    });
  };

  connect();
}
