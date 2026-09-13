/**
 * The core-realm bridges refuse anything that is not an answer from the bound document.
 *
 * Canned envelopes here, so each check is isolated; the end-to-end path with the real core is
 * `d64Transport.test.ts`. Implementation tests, **not evidence for D-E6-4**.
 */
import { describe, expect, it } from "vitest";
import { frameId } from "@pratibimb/perception";
import {
  TRANSPORT_CHANNEL,
  TransportRefusal,
  createPostActionObserver,
  createTransportCycle,
  observePage,
  toPostActionObservation,
  emptyGraph,
  type AttestedDocument,
  type PageReply,
  type RelayEnvelope,
  type TransportBinding,
  type TransportRelay,
} from "../src/index.js";

const DOC: AttestedDocument = { tabId: 7, frameId: 0, documentId: "doc-a", origin: "http://127.0.0.1:8990" };
const OBSERVATION_FRAME = frameId("obs-1");
const BINDING: TransportBinding = { observationFrameId: OBSERVATION_FRAME, document: DOC, swBootId: "boot-1" };
const POINT = { x: 460, y: 320 };
const SAVE = { selector: "#save", role: "button", name: "Save", box: { x: 400, y: 300, w: 120, h: 40 } };

const relayed = (reply: PageReply, over: { attested?: AttestedDocument; swBootId?: string } = {}): RelayEnvelope => ({
  channel: TRANSPORT_CHANNEL,
  kind: "RELAYED",
  swBootId: over.swBootId ?? "boot-1",
  attested: over.attested ?? DOC,
  reply,
});

/** A relay that answers each request with whatever the test supplies. */
const relayOf = (answer: (body: { op: string; requestId: string }) => unknown | Promise<unknown>): TransportRelay & { sent: unknown[] } => {
  const sent: unknown[] = [];
  return {
    sent,
    async request(request) {
      sent.push(request);
      return answer(request.body as { op: string; requestId: string });
    },
  };
};

const hitReply = (requestId: string, cycleId: string, topmost: typeof SAVE | null = SAVE, point = POINT): PageReply => ({
  op: "HIT_TEST",
  requestId,
  cycleId,
  point,
  topmost,
  receivedAt: 10,
  sampledAt: 11,
});

const dispatchReply = (requestId: string, cycleId: string, deliveryId: string, point = POINT): PageReply => ({
  op: "DISPATCH",
  requestId,
  cycleId,
  deliveryId,
  point,
  dispatchedTo: SAVE,
  receivedAt: 20,
  dispatchedAt: 21,
});

/** Deterministic ids: c-1 for the cycle, then r-1, d-2, r-3 … in call order. */
const ids = () => {
  let n = 0;
  return () => {
    n += 1;
    return n === 1 ? "c-1" : `id-${n}`;
  };
};

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof TransportRefusal) return error.code;
    return `THREW_${String(error)}`;
  }
  return "NO_REFUSAL";
};

describe("the hit-test bridge", () => {
  it("reports the bound observation frame, never one the page claims", async () => {
    const relay = relayOf((body) => relayed(hitReply(body.requestId, "c-1")));
    const cycle = createTransportCycle(relay, BINDING, { newId: ids() });
    expect(cycle.hitTest.frameId).toBe(OBSERVATION_FRAME);
    expect(cycle.action.frameId).toBe(OBSERVATION_FRAME);
    const topmost = await cycle.hitTest.topmostAtCssPoint(POINT as never);
    expect(topmost?.frameId).toBe(OBSERVATION_FRAME);
    expect(topmost?.selector).toBe("#save");
  });

  it("passes 'nothing at the point' through as null, which the core reads as MISMATCH", async () => {
    const relay = relayOf((body) => relayed(hitReply(body.requestId, "c-1", null)));
    const cycle = createTransportCycle(relay, BINDING, { newId: ids() });
    await expect(cycle.hitTest.topmostAtCssPoint(POINT as never)).resolves.toBeNull();
  });

  it("throws — never returns null — when the answer came from another document (C03, C04b, C12a)", async () => {
    const relay = relayOf((body) => relayed(hitReply(body.requestId, "c-1"), { attested: { ...DOC, documentId: "doc-b" } }));
    const cycle = createTransportCycle(relay, BINDING, { newId: ids() });
    expect(await codeOf(() => cycle.hitTest.topmostAtCssPoint(POINT as never))).toBe("ATTESTATION_MISMATCH");
  });

  it("throws when the origin changed", async () => {
    const relay = relayOf((body) =>
      relayed(hitReply(body.requestId, "c-1"), { attested: { ...DOC, origin: "http://127.0.0.1:9999" } })
    );
    const cycle = createTransportCycle(relay, BINDING, { newId: ids() });
    expect(await codeOf(() => cycle.hitTest.topmostAtCssPoint(POINT as never))).toBe("ATTESTATION_MISMATCH");
  });

  it("throws when the worker that answered is not the one it is bound to (C13)", async () => {
    const relay = relayOf((body) => relayed(hitReply(body.requestId, "c-1"), { swBootId: "boot-2" }));
    const cycle = createTransportCycle(relay, BINDING, { newId: ids() });
    expect(await codeOf(() => cycle.hitTest.topmostAtCssPoint(POINT as never))).toBe("SW_BOOT_MISMATCH");
  });

  it("throws on a router refusal, a malformed envelope and a dead channel", async () => {
    const refused = relayOf(() => ({ channel: TRANSPORT_CHANNEL, kind: "RELAY_REFUSED", swBootId: "boot-1", refused: "NO_DOCUMENT_CONNECTION" }));
    expect(await codeOf(() => createTransportCycle(refused, BINDING, { newId: ids() }).hitTest.topmostAtCssPoint(POINT as never))).toBe(
      "NO_DOCUMENT_CONNECTION"
    );

    const garbage = relayOf(() => ({ hello: true }));
    expect(await codeOf(() => createTransportCycle(garbage, BINDING, { newId: ids() }).hitTest.topmostAtCssPoint(POINT as never))).toBe(
      "MALFORMED_ENVELOPE"
    );

    const dead: TransportRelay = {
      request: () => Promise.reject(new Error("Receiving end does not exist")),
    };
    expect(await codeOf(() => createTransportCycle(dead, BINDING, { newId: ids() }).hitTest.topmostAtCssPoint(POINT as never))).toBe(
      "RELAY_UNAVAILABLE"
    );
  });

  it("throws the page's own refusal code", async () => {
    const relay = relayOf((body) => relayed({ op: "REFUSED", requestId: body.requestId, refused: "POINT_OUTSIDE_VIEWPORT" }));
    expect(await codeOf(() => createTransportCycle(relay, BINDING, { newId: ids() }).hitTest.topmostAtCssPoint(POINT as never))).toBe(
      "POINT_OUTSIDE_VIEWPORT"
    );
  });

  it("throws when the answer is about another cycle, another point or another request", async () => {
    const wrongCycle = relayOf((body) => relayed(hitReply(body.requestId, "c-other")));
    expect(await codeOf(() => createTransportCycle(wrongCycle, BINDING, { newId: ids() }).hitTest.topmostAtCssPoint(POINT as never))).toBe(
      "REPLY_MISMATCH"
    );

    const wrongPoint = relayOf((body) => relayed(hitReply(body.requestId, "c-1", SAVE, { x: 461, y: 320 })));
    expect(await codeOf(() => createTransportCycle(wrongPoint, BINDING, { newId: ids() }).hitTest.topmostAtCssPoint(POINT as never))).toBe(
      "REPLY_MISMATCH"
    );

    const wrongRequest = relayOf(() => relayed(hitReply("someone-else", "c-1")));
    expect(await codeOf(() => createTransportCycle(wrongRequest, BINDING, { newId: ids() }).hitTest.topmostAtCssPoint(POINT as never))).toBe(
      "REPLY_MISMATCH"
    );
  });

  it("looks once per cycle", async () => {
    const relay = relayOf((body) => relayed(hitReply(body.requestId, "c-1")));
    const cycle = createTransportCycle(relay, BINDING, { newId: ids() });
    await cycle.hitTest.topmostAtCssPoint(POINT as never);
    expect(await codeOf(() => cycle.hitTest.topmostAtCssPoint(POINT as never))).toBe("CYCLE_ALREADY_HIT_TESTED");
  });
});

describe("the action bridge", () => {
  const workingRelay = () => {
    let deliveryId = "";
    return relayOf((body) => {
      if (body.op === "HIT_TEST") return relayed(hitReply(body.requestId, "c-1"));
      deliveryId = (body as unknown as { deliveryId: string }).deliveryId;
      return relayed(dispatchReply(body.requestId, "c-1", deliveryId));
    });
  };

  it("dispatches the authorised point once and records what happened", async () => {
    const relay = workingRelay();
    const cycle = createTransportCycle(relay, BINDING, { newId: ids() });
    await cycle.hitTest.topmostAtCssPoint(POINT as never);
    await cycle.action.clickAtCssPoint(POINT as never);
    expect(cycle.report.dispatch?.dispatchedTo).toBe("#save");
    expect(cycle.report.hitTest?.sampledAt).toBe(11);
    expect(cycle.report.refusals).toEqual([]);
  });

  it("refuses to dispatch without a hit test in this cycle", async () => {
    const relay = workingRelay();
    const cycle = createTransportCycle(relay, BINDING, { newId: ids() });
    expect(await codeOf(() => cycle.action.clickAtCssPoint(POINT as never))).toBe("NO_HIT_TEST_FOR_CYCLE");
    expect(relay.sent).toHaveLength(0);
  });

  it("refuses a point other than the one that was agreed", async () => {
    const relay = workingRelay();
    const cycle = createTransportCycle(relay, BINDING, { newId: ids() });
    await cycle.hitTest.topmostAtCssPoint(POINT as never);
    expect(await codeOf(() => cycle.action.clickAtCssPoint({ x: 490, y: 320 } as never))).toBe("POINT_NOT_HIT_TESTED");
    expect(relay.sent).toHaveLength(1); // the hit test only
  });

  it("acts once, and a second attempt never reaches the page (C11a)", async () => {
    const relay = workingRelay();
    const cycle = createTransportCycle(relay, BINDING, { newId: ids() });
    await cycle.hitTest.topmostAtCssPoint(POINT as never);
    await cycle.action.clickAtCssPoint(POINT as never);
    expect(await codeOf(() => cycle.action.clickAtCssPoint(POINT as never))).toBe("CYCLE_ALREADY_DISPATCHED");
    expect(relay.sent).toHaveLength(2);
  });

  it("records refusals as codes, never as prose that could quote the page", async () => {
    const relay = relayOf((body) =>
      body.op === "HIT_TEST" ? relayed(hitReply(body.requestId, "c-1")) : relayed({ op: "REFUSED", requestId: body.requestId, refused: "DUPLICATE_DELIVERY" })
    );
    const cycle = createTransportCycle(relay, BINDING, { newId: ids() });
    await cycle.hitTest.topmostAtCssPoint(POINT as never);
    await codeOf(() => cycle.action.clickAtCssPoint(POINT as never));
    expect(cycle.report.refusals).toEqual(["DUPLICATE_DELIVERY"]);
  });
});

describe("observation", () => {
  const observeReply = (requestId: string, over: Partial<{ focus: unknown }> = {}): PageReply =>
    ({
      op: "OBSERVE",
      requestId,
      measurements: [
        { selector: "#save", role: "button", name: "Save", rect: SAVE.box, enabled: true, cssHidden: false, parentIndex: -1 },
      ],
      focus: over.focus ?? { state: "NONE" },
      viewport: { w: 1024, h: 768, dpr: 1, scrollX: 0, scrollY: 0 },
    }) as PageReply;

  it("binds to the document that answered and mints a fresh frame", async () => {
    const relay = relayOf((body) => relayed(observeReply(body.requestId)));
    const newId = ids(); // one generator, as a real realm has
    const first = await observePage(relay, { tabId: 7, frameId: 0 }, { newId });
    expect(first.binding.document).toEqual(DOC);
    expect(first.binding.swBootId).toBe("boot-1");
    expect(first.graph.nodes).toHaveLength(1);

    const second = await observePage(relay, { tabId: 7, frameId: 0 }, { newId });
    expect(second.binding.observationFrameId).not.toBe(first.binding.observationFrameId);
  });

  it("refuses a reading from a tab it did not ask about", async () => {
    const relay = relayOf((body) => relayed(observeReply(body.requestId), { attested: { ...DOC, tabId: 9 } }));
    expect(await codeOf(() => observePage(relay, { tabId: 7, frameId: 0 }, { newId: ids() }))).toBe("ATTESTATION_MISMATCH");
  });

  it("refuses a reading from an origin outside loopback", async () => {
    const relay = relayOf((body) => relayed(observeReply(body.requestId), { attested: { ...DOC, origin: "https://example.com" } }));
    expect(await codeOf(() => observePage(relay, { tabId: 7, frameId: 0 }, { newId: ids() }))).toBe("NOT_LOOPBACK_ORIGIN");
  });

  it("keeps focus three-valued on the way to VERIFY RESULT", () => {
    const graph = emptyGraph(frameId("f-1"));
    expect(toPostActionObservation(graph, { state: "NONE" })).toEqual({ graph, focusedSelector: null });
    expect(toPostActionObservation(graph, { state: "ELEMENT", selector: "#save" })).toEqual({ graph, focusedSelector: "#save" });
    expect("focusedSelector" in toPostActionObservation(graph, { state: "UNESTABLISHED" })).toBe(false);
  });

  it("gives VERIFY RESULT an empty graph instead of throwing when the reading is refused (C12b)", async () => {
    const relay = relayOf(() => ({ channel: TRANSPORT_CHANNEL, kind: "RELAY_REFUSED", swBootId: "boot-1", refused: "NO_DOCUMENT_CONNECTION" }));
    const observer = createPostActionObserver(relay, BINDING, { newId: ids() });
    const observation = await observer.observe();
    expect(observation.graph.nodes).toEqual([]);
    expect("focusedSelector" in observation).toBe(false);
    expect(observer.report.refusals).toEqual(["NO_DOCUMENT_CONNECTION"]);
  });

  it("reads the bound document when it is still there", async () => {
    const relay = relayOf((body) => relayed(observeReply(body.requestId, { focus: { state: "ELEMENT", selector: "#save" } })));
    const observer = createPostActionObserver(relay, BINDING, { newId: ids() });
    const observation = await observer.observe();
    expect(observation.graph.nodes).toHaveLength(1);
    expect(observation.focusedSelector).toBe("#save");
    expect(observer.report.refusals).toEqual([]);
  });
});
