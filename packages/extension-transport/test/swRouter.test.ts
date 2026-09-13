/**
 * The router binds a request to one attested document and one worker boot, or refuses it.
 *
 * Implementation tests over a simulated port, named by the D-E6-4 case each belongs to. **Not
 * evidence for D-E6-4.**
 */
import { describe, expect, it } from "vitest";
import {
  TRANSPORT_CHANNEL,
  createServiceWorkerRouter,
  type AttestedDocument,
  type PageRequest,
  type PortLike,
  type RelayEnvelope,
} from "../src/index.js";

const DOC_A: AttestedDocument = { tabId: 7, frameId: 0, documentId: "doc-a", origin: "http://127.0.0.1:8990" };
const DOC_B: AttestedDocument = { tabId: 7, frameId: 0, documentId: "doc-b", origin: "http://127.0.0.1:8990" };
const DOC_OTHER_TAB: AttestedDocument = { tabId: 9, frameId: 0, documentId: "doc-c", origin: "http://127.0.0.1:8990" };

/** A port that answers whatever the test tells it to, or nothing at all. */
class FakePort implements PortLike {
  readonly received: unknown[] = [];
  disconnected = false;
  private messageListener: ((m: unknown) => void) | null = null;
  private disconnectListener: (() => void) | null = null;
  answer: ((request: PageRequest) => unknown) | null = null;

  constructor(readonly sender: AttestedDocument | null) {}

  postMessage(message: unknown): void {
    this.received.push(message);
    const answer = this.answer;
    if (!answer) return;
    const reply = answer(message as PageRequest);
    if (reply !== undefined) queueMicrotask(() => this.messageListener?.(reply));
  }
  disconnect(): void {
    this.disconnected = true;
    this.disconnectListener?.();
  }
  onMessage(listener: (m: unknown) => void): void {
    this.messageListener = listener;
  }
  onDisconnect(listener: () => void): void {
    this.disconnectListener = listener;
  }
  /** What the content script itself would send back. */
  reply(message: unknown): void {
    this.messageListener?.(message);
  }
}

/** A content script that answers each operation with the reply that operation expects. */
const wellBehavedAnswer = (request: PageRequest): unknown => {
  switch (request.op) {
    case "CLOCK":
      return { op: "CLOCK", requestId: request.requestId, now: 42 };
    case "OBSERVE":
      return {
        op: "OBSERVE",
        requestId: request.requestId,
        measurements: [],
        focus: { state: "NONE" },
        viewport: { w: 1024, h: 768, dpr: 1, scrollX: 0, scrollY: 0 },
      };
    case "HIT_TEST":
      return {
        op: "HIT_TEST",
        requestId: request.requestId,
        cycleId: request.cycleId,
        point: request.point,
        topmost: null,
        receivedAt: 1,
        sampledAt: 2,
      };
    case "DISPATCH":
      return { op: "REFUSED", requestId: request.requestId, refused: "NO_HIT_TEST_FOR_CYCLE" };
  }
};

const relayRequest = (body: PageRequest, over: { documentId?: string | null; tabId?: number; expectSwBootId?: string | null } = {}) => ({
  channel: TRANSPORT_CHANNEL,
  kind: "RELAY",
  target: { tabId: over.tabId ?? 7, frameId: 0, documentId: over.documentId === undefined ? "doc-a" : over.documentId },
  expectSwBootId: over.expectSwBootId === undefined ? "boot-1" : over.expectSwBootId,
  body,
});

const hitTest: PageRequest = { op: "HIT_TEST", requestId: "r1", cycleId: "c1", point: { x: 460, y: 320 } };
const observe: PageRequest = { op: "OBSERVE", requestId: "r-obs" };
const refusalOf = (e: RelayEnvelope): string | null => (e.kind === "RELAY_REFUSED" ? e.refused : null);

const attach = (router: ReturnType<typeof createServiceWorkerRouter>, document: AttestedDocument | null): FakePort => {
  const port = new FakePort(document);
  port.answer = wellBehavedAnswer;
  router.acceptPort(port);
  return port;
};

describe("accepting ports", () => {
  it("refuses a port the browser did not attest", () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    expect(router.acceptPort(new FakePort(null))).toBe(false);
    expect(router.connectionCount()).toBe(0);
  });

  it("refuses a port from an origin outside loopback", () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    expect(router.acceptPort(new FakePort({ ...DOC_A, origin: "https://example.com" }))).toBe(false);
  });

  it("accepts an attested loopback document once and tells it which boot it is attached to", () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    const port = new FakePort(DOC_A);
    expect(router.acceptPort(port)).toBe(true);
    expect(port.received).toEqual([{ op: "ATTACHED", swBootId: "boot-1" }]);
    expect(router.acceptPort(new FakePort(DOC_A))).toBe(false);
  });
});

describe("routing", () => {
  it("relays to the addressed document and attests who answered", async () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    attach(router, DOC_A);
    const envelope = await router.relay(relayRequest(observe, { documentId: null, expectSwBootId: null }));
    expect(envelope.kind).toBe("RELAYED");
    expect(envelope.kind === "RELAYED" && envelope.attested).toEqual(DOC_A);
    expect(envelope.kind === "RELAYED" && envelope.swBootId).toBe("boot-1");
  });

  it("refuses a stale document: nothing is connected for it (C03, C12a)", async () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    const portA = attach(router, DOC_A);
    portA.disconnect(); // the document navigated away
    attach(router, DOC_B); // its replacement, identical layout, different documentId
    expect(refusalOf(await router.relay(relayRequest(hitTest, { documentId: "doc-a" })))).toBe("NO_DOCUMENT_CONNECTION");
  });

  it("refuses a boot that did not relay the attempt (C13, TR-7)", async () => {
    const router = createServiceWorkerRouter({ bootId: "boot-2" });
    attach(router, DOC_A);
    expect(refusalOf(await router.relay(relayRequest(hitTest, { expectSwBootId: "boot-1" })))).toBe("SW_BOOT_MISMATCH");
  });

  it("refuses to act on a page without a bound document and boot", async () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    attach(router, DOC_A);
    expect(refusalOf(await router.relay(relayRequest(hitTest, { documentId: null })))).toBe("UNBOUND_REQUEST");
    expect(refusalOf(await router.relay(relayRequest(hitTest, { expectSwBootId: null })))).toBe("UNBOUND_REQUEST");
  });

  it("routes to the addressed tab, not to another one holding the same layout (C04b)", async () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    attach(router, DOC_A);
    const other = attach(router, DOC_OTHER_TAB);
    const envelope = await router.relay(relayRequest(observe, { tabId: 9, documentId: "doc-c" }));
    expect(envelope.kind === "RELAYED" && envelope.attested).toEqual(DOC_OTHER_TAB);
    expect(other.received).toHaveLength(2); // ATTACHED, then the request
  });

  it("refuses when an address matches more than one connection", async () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    attach(router, DOC_A);
    attach(router, DOC_B); // same tab and frame, different documents, both still connected
    expect(refusalOf(await router.relay(relayRequest(observe, { documentId: null, expectSwBootId: null })))).toBe(
      "AMBIGUOUS_DOCUMENT_CONNECTION"
    );
  });

  it("refuses a malformed relay request", async () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    attach(router, DOC_A);
    expect(refusalOf(await router.relay({ channel: TRANSPORT_CHANNEL, kind: "RELAY" }))).toBe("MALFORMED_RELAY_REQUEST");
    expect(refusalOf(await router.relay({ channel: "other", kind: "RELAY" }))).toBe("MALFORMED_RELAY_REQUEST");
  });

  it("refuses a duplicate request id while the first is still in flight", async () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    const port = attach(router, DOC_A);
    port.answer = null; // never answers
    const first = router.relay(relayRequest(hitTest));
    expect(refusalOf(await router.relay(relayRequest(hitTest)))).toBe("DUPLICATE_REQUEST_ID");
    port.disconnect();
    expect(refusalOf(await first)).toBe("PORT_DISCONNECTED");
  });

  it("settles an in-flight request as disconnected when the document goes away (C12b)", async () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    const port = attach(router, DOC_A);
    port.answer = null;
    const inFlight = router.relay(relayRequest(hitTest));
    port.disconnect();
    expect(refusalOf(await inFlight)).toBe("PORT_DISCONNECTED");
  });

  it("refuses a reply that answers a different operation", async () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    const port = attach(router, DOC_A);
    port.answer = (request) => ({ op: "CLOCK", requestId: request.requestId, now: 1 });
    expect(refusalOf(await router.relay(relayRequest(hitTest)))).toBe("REPLY_MISMATCH");
  });

  it("passes a page refusal through as the page's own answer", async () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    const port = attach(router, DOC_A);
    port.answer = (request) => ({ op: "REFUSED", requestId: request.requestId, refused: "DUPLICATE_DELIVERY" });
    const envelope = await router.relay(relayRequest(hitTest));
    expect(envelope.kind === "RELAYED" && envelope.reply.op === "REFUSED" && envelope.reply.refused).toBe("DUPLICATE_DELIVERY");
  });

  it("ignores an unreadable reply and a reply nobody is waiting for", async () => {
    const router = createServiceWorkerRouter({ bootId: "boot-1" });
    const port = attach(router, DOC_A);
    port.answer = null;
    const inFlight = router.relay(relayRequest(hitTest));
    port.reply({ op: "GARBAGE" });
    port.reply({ op: "CLOCK", requestId: "someone-else", now: 1 });
    port.disconnect();
    expect(refusalOf(await inFlight)).toBe("PORT_DISCONNECTED");
  });
});
