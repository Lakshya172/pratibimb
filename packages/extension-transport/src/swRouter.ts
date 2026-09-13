/**
 * The service worker's half of the transport: a **stateless router**. D-E6-4 properties TR-2, TR-7.
 *
 * It holds no permit, no value, no target and no decision — MV3 terminates an idle worker, so
 * anything kept here is lost by design, and the architecture keeps the worker value-free anyway. It
 * adds exactly one thing a message cannot carry for itself:
 *
 *     **the browser-attested identity of the document that answered.**
 *
 * A content script cannot state its own `documentId` credibly — a message is just data. `port.sender`
 * is the browser's word for it, and the router copies that into the envelope so the core realm can
 * compare it against the binding the action was validated against. That is the whole of TR-2 on this
 * side, and it is why replies travel over a **port the document opened** rather than a one-shot
 * message: a port is created by one document, carries its attested sender, and disconnects when that
 * document goes away.
 *
 * TR-7, and why a restart cannot finish an interrupted attempt: every bound request names the boot it
 * expects (`expectSwBootId`). This router knows only its own `bootId`, so a worker that replaced the
 * one which relayed the hit test refuses the delivery rather than completing it under new
 * bookkeeping. The correct response to a restart is a fresh observation, a fresh validation and a
 * fresh permit — never the resumption of an authority whose relay is gone.
 *
 * Every refusal is a code. The router never invents a reply, never retries, and never picks a
 * document when the address matches more than one.
 */
import {
  TRANSPORT_CHANNEL,
  isLoopbackOrigin,
  parsePageReply,
  parseRelayRequest,
  relayRefused,
  sameAttestedDocument,
  type AttestedDocument,
  type PageOp,
  type RelayEnvelope,
} from "./contracts.js";

/**
 * A `chrome.runtime.Port` reduced to what routing needs.
 *
 * `sender` is `null` when the browser did not attest a full identity — which is a refusal to accept
 * the port at all, never a port with an assumed identity.
 */
export interface PortLike {
  readonly sender: AttestedDocument | null;
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage(listener: (message: unknown) => void): void;
  onDisconnect(listener: () => void): void;
}

export interface ServiceWorkerRouter {
  /** The boot this router belongs to. A new worker is a new boot, and bound requests notice. */
  readonly bootId: string;
  /** Register a content script's port. `false` means the caller must disconnect it. */
  acceptPort(port: PortLike): boolean;
  /** Route one relay request and resolve with the envelope the core realm reads. */
  relay(raw: unknown): Promise<RelayEnvelope>;
  readonly connectionCount: () => number;
}

interface Pending {
  readonly op: PageOp;
  readonly settle: (envelope: RelayEnvelope) => void;
}

interface Connection {
  readonly port: PortLike;
  readonly document: AttestedDocument;
  readonly pending: Map<string, Pending>;
  open: boolean;
}

const channel = TRANSPORT_CHANNEL;

export function createServiceWorkerRouter(options: { readonly bootId: string }): ServiceWorkerRouter {
  const { bootId } = options;
  const connections: Connection[] = [];

  const drop = (connection: Connection): void => {
    connection.open = false;
    const index = connections.indexOf(connection);
    if (index >= 0) connections.splice(index, 1);
    for (const pending of connection.pending.values()) pending.settle(relayRefused("PORT_DISCONNECTED", bootId));
    connection.pending.clear();
  };

  const onReply = (connection: Connection, raw: unknown): void => {
    const reply = parsePageReply(raw);
    if (!reply) return; // Unreadable: leave the request pending for the core's own deadline.
    const pending = connection.pending.get(reply.requestId);
    if (!pending) return; // Not ours, already settled, or a duplicate answer. Never resurrected.
    connection.pending.delete(reply.requestId);
    if (reply.op !== "REFUSED" && reply.op !== pending.op) {
      pending.settle(relayRefused("REPLY_MISMATCH", bootId));
      return;
    }
    pending.settle({ channel, kind: "RELAYED", swBootId: bootId, attested: connection.document, reply });
  };

  return {
    bootId,
    connectionCount: () => connections.length,

    acceptPort(port: PortLike): boolean {
      const document = port.sender;
      // No attested identity, or an origin outside loopback: the host's own content-script rule.
      if (!document || !isLoopbackOrigin(document.origin)) return false;
      // The same document connecting twice would make its address ambiguous; keep the first.
      if (connections.some((c) => sameAttestedDocument(c.document, document))) return false;

      const connection: Connection = { port, document, pending: new Map(), open: true };
      connections.push(connection);
      port.onMessage((message) => {
        if (connection.open) onReply(connection, message);
      });
      port.onDisconnect(() => drop(connection));
      port.postMessage({ op: "ATTACHED", swBootId: bootId });
      return true;
    },

    async relay(raw: unknown): Promise<RelayEnvelope> {
      const request = parseRelayRequest(raw);
      if (!request) return relayRefused("MALFORMED_RELAY_REQUEST", bootId);

      // TR-7. A request bound to another boot belongs to an attempt this worker did not relay.
      if (request.expectSwBootId !== null && request.expectSwBootId !== bootId) {
        return relayRefused("SW_BOOT_MISMATCH", bootId);
      }

      // Acting on a page requires a bound address and a bound boot. Only the observation that
      // establishes a binding may address a tab and frame without naming the document.
      const acts = request.body.op === "HIT_TEST" || request.body.op === "DISPATCH";
      if (acts && (request.target.documentId === null || request.expectSwBootId === null)) {
        return relayRefused("UNBOUND_REQUEST", bootId);
      }

      const { tabId, frameId, documentId } = request.target;
      const candidates = connections.filter(
        (c) =>
          c.document.tabId === tabId &&
          c.document.frameId === frameId &&
          (documentId === null || c.document.documentId === documentId)
      );
      // Nothing is connected for that document: it navigated, closed, or never loaded. Not a click.
      if (candidates.length === 0) return relayRefused("NO_DOCUMENT_CONNECTION", bootId);
      if (candidates.length > 1) return relayRefused("AMBIGUOUS_DOCUMENT_CONNECTION", bootId);
      const connection = candidates[0] as Connection;

      const { requestId } = request.body;
      if (connection.pending.has(requestId)) return relayRefused("DUPLICATE_REQUEST_ID", bootId);

      return new Promise<RelayEnvelope>((resolve) => {
        let settled = false;
        const settle = (envelope: RelayEnvelope): void => {
          if (settled) return;
          settled = true;
          resolve(envelope);
        };
        connection.pending.set(requestId, { op: request.body.op, settle });
        try {
          connection.port.postMessage(request.body);
        } catch {
          connection.pending.delete(requestId);
          settle(relayRefused("PORT_DISCONNECTED", bootId));
        }
      });
    },
  };
}
