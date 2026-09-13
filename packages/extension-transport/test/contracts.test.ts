/**
 * The wire contracts refuse anything they do not fully understand.
 *
 * A parser that accepts a nearly-right message accepts the shape a replay, a stale document or a
 * confused sender produces. These tests pin that: unknown operations, missing fields, extra fields,
 * non-finite numbers, oversized ids and wrong channels are all `null`, never a best-effort object.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_ID_LENGTH,
  MAX_MEASUREMENTS,
  TRANSPORT_CHANNEL,
  isLoopbackOrigin,
  parseAttachedNotice,
  parseAttestedDocument,
  parseElementDescription,
  parseFocusReading,
  parsePagePoint,
  parsePageReply,
  parsePageRequest,
  parseRelayEnvelope,
  parseRelayRequest,
  relayRefused,
  requestIdOf,
  sameAttestedDocument,
} from "../src/index.js";

const point = { x: 460, y: 320 };
const description = { selector: "#save", role: "button", name: "Save", box: { x: 400, y: 300, w: 120, h: 40 } };
const attested = { tabId: 7, frameId: 0, documentId: "doc-1", origin: "http://127.0.0.1:8990" };
const measurement = {
  selector: "#save",
  role: "button",
  name: "Save",
  rect: { x: 400, y: 300, w: 120, h: 40 },
  enabled: true,
  cssHidden: false,
  parentIndex: -1,
};

describe("page requests", () => {
  it("accepts exactly the four operations", () => {
    expect(parsePageRequest({ op: "OBSERVE", requestId: "r1" })).toEqual({ op: "OBSERVE", requestId: "r1" });
    expect(parsePageRequest({ op: "CLOCK", requestId: "r1" })).toEqual({ op: "CLOCK", requestId: "r1" });
    expect(parsePageRequest({ op: "HIT_TEST", requestId: "r1", cycleId: "c1", point })).toEqual({
      op: "HIT_TEST",
      requestId: "r1",
      cycleId: "c1",
      point,
    });
    expect(parsePageRequest({ op: "DISPATCH", requestId: "r1", cycleId: "c1", deliveryId: "d1", point })).not.toBeNull();
  });

  it("refuses an operation it does not know", () => {
    expect(parsePageRequest({ op: "CLICK_SELECTOR", requestId: "r1", selector: "#save" })).toBeNull();
    expect(parsePageRequest({ op: "EVALUATE", requestId: "r1", code: "1+1" })).toBeNull();
    expect(parsePageRequest({ op: "FOCUS", requestId: "r1" })).toBeNull();
  });

  it("refuses extra, missing and malformed fields", () => {
    expect(parsePageRequest({ op: "HIT_TEST", requestId: "r1", cycleId: "c1", point, selector: "#save" })).toBeNull();
    expect(parsePageRequest({ op: "HIT_TEST", requestId: "r1", point })).toBeNull();
    expect(parsePageRequest({ op: "DISPATCH", requestId: "r1", cycleId: "c1", point })).toBeNull();
    expect(parsePageRequest({ op: "OBSERVE", requestId: "" })).toBeNull();
    expect(parsePageRequest({ op: "OBSERVE", requestId: "x".repeat(MAX_ID_LENGTH + 1) })).toBeNull();
    expect(parsePageRequest(null)).toBeNull();
    expect(parsePageRequest([{ op: "OBSERVE", requestId: "r1" }])).toBeNull();
  });

  it("refuses a point that is not two finite numbers", () => {
    for (const bad of [
      { x: Number.NaN, y: 1 },
      { x: 1, y: Number.POSITIVE_INFINITY },
      { x: "460", y: 320 },
      { x: 460 },
      { x: 460, y: 320, z: 0 },
    ]) {
      expect(parsePagePoint(bad)).toBeNull();
      expect(parsePageRequest({ op: "HIT_TEST", requestId: "r1", cycleId: "c1", point: bad })).toBeNull();
    }
  });

  it("recovers a request id from a message it cannot parse, so a refusal can correlate", () => {
    expect(requestIdOf({ op: "NONSENSE", requestId: "r9" })).toBe("r9");
    expect(requestIdOf({ op: "NONSENSE" })).toBeNull();
  });
});

describe("page replies", () => {
  it("accepts a hit test that reports nothing at the point, which is a finding and not an unknown", () => {
    const reply = parsePageReply({
      op: "HIT_TEST",
      requestId: "r1",
      cycleId: "c1",
      point,
      topmost: null,
      receivedAt: 1,
      sampledAt: 2,
    });
    expect(reply).not.toBeNull();
    expect(reply && reply.op === "HIT_TEST" && reply.topmost).toBeNull();
  });

  it("accepts an observation and refuses one with a malformed measurement", () => {
    const ok = parsePageReply({
      op: "OBSERVE",
      requestId: "r1",
      measurements: [measurement],
      focus: { state: "NONE" },
      viewport: { w: 1024, h: 768, dpr: 1, scrollX: 0, scrollY: 0 },
    });
    expect(ok).not.toBeNull();
    for (const bad of [
      { ...measurement, enabled: "yes" },
      { ...measurement, parentIndex: -2 },
      { ...measurement, rect: { x: 0, y: 0, w: 1 } },
      { ...measurement, value: "9000000001" },
    ]) {
      expect(
        parsePageReply({
          op: "OBSERVE",
          requestId: "r1",
          measurements: [bad],
          focus: { state: "NONE" },
          viewport: { w: 1024, h: 768, dpr: 1, scrollX: 0, scrollY: 0 },
        })
      ).toBeNull();
    }
  });

  it("refuses an observation larger than the cap", () => {
    expect(
      parsePageReply({
        op: "OBSERVE",
        requestId: "r1",
        measurements: new Array(MAX_MEASUREMENTS + 1).fill(measurement),
        focus: { state: "NONE" },
        viewport: { w: 1024, h: 768, dpr: 1, scrollX: 0, scrollY: 0 },
      })
    ).toBeNull();
  });

  it("keeps focus three-valued", () => {
    expect(parseFocusReading({ state: "ELEMENT", selector: "#save" })).toEqual({ state: "ELEMENT", selector: "#save" });
    expect(parseFocusReading({ state: "NONE" })).toEqual({ state: "NONE" });
    expect(parseFocusReading({ state: "UNESTABLISHED" })).toEqual({ state: "UNESTABLISHED" });
    expect(parseFocusReading({ state: "MAYBE" })).toBeNull();
    expect(parseFocusReading({ state: "ELEMENT" })).toBeNull();
    expect(parseFocusReading(true)).toBeNull();
  });

  it("refuses a refusal code it does not know", () => {
    expect(parsePageReply({ op: "REFUSED", requestId: "r1", refused: "DUPLICATE_DELIVERY" })).not.toBeNull();
    expect(parsePageReply({ op: "REFUSED", requestId: "r1", refused: "BECAUSE" })).toBeNull();
  });

  it("refuses an element description carrying anything but graph vocabulary", () => {
    expect(parseElementDescription(description)).toEqual(description);
    expect(parseElementDescription({ ...description, value: "secret" })).toBeNull();
    expect(parseElementDescription({ ...description, nth: -1 })).toBeNull();
    expect(parseElementDescription({ ...description, box: { x: 0, y: 0, w: 1, h: Number.NaN } })).toBeNull();
  });
});

describe("relay messages", () => {
  const body = { op: "OBSERVE" as const, requestId: "r1" };

  it("accepts a well-formed request and refuses a foreign channel", () => {
    expect(
      parseRelayRequest({ channel: TRANSPORT_CHANNEL, kind: "RELAY", target: { tabId: 7, frameId: 0, documentId: null }, expectSwBootId: null, body })
    ).not.toBeNull();
    expect(
      parseRelayRequest({ channel: "other.channel", kind: "RELAY", target: { tabId: 7, frameId: 0, documentId: null }, expectSwBootId: null, body })
    ).toBeNull();
  });

  it("refuses a malformed target", () => {
    for (const target of [
      { tabId: 7.5, frameId: 0, documentId: null },
      { tabId: 7, frameId: -1, documentId: null },
      { tabId: 7, frameId: 0, documentId: "" },
      { tabId: 7, frameId: 0 },
    ]) {
      expect(parseRelayRequest({ channel: TRANSPORT_CHANNEL, kind: "RELAY", target, expectSwBootId: null, body })).toBeNull();
    }
  });

  it("round-trips envelopes and refuses unknown refusal codes", () => {
    const relayed = {
      channel: TRANSPORT_CHANNEL,
      kind: "RELAYED",
      swBootId: "boot-1",
      attested,
      reply: { op: "CLOCK", requestId: "r1", now: 12 },
    };
    expect(parseRelayEnvelope(relayed)).not.toBeNull();
    expect(parseRelayEnvelope(relayRefused("SW_BOOT_MISMATCH", "boot-1"))).not.toBeNull();
    expect(parseRelayEnvelope({ ...relayRefused("SW_BOOT_MISMATCH", "boot-1"), refused: "NOPE" })).toBeNull();
    expect(parseRelayEnvelope({ ...relayed, attested: { ...attested, documentId: "" } })).toBeNull();
  });

  it("attests a document only when every browser-supplied field is present", () => {
    expect(parseAttestedDocument(attested)).toEqual(attested);
    expect(parseAttestedDocument({ ...attested, documentId: null })).toBeNull();
    expect(parseAttestedDocument({ ...attested, extra: 1 })).toBeNull();
  });

  it("compares documents on every attested field", () => {
    expect(sameAttestedDocument(attested, { ...attested })).toBe(true);
    expect(sameAttestedDocument(attested, { ...attested, documentId: "doc-2" })).toBe(false);
    expect(sameAttestedDocument(attested, { ...attested, origin: "http://127.0.0.1:8991" })).toBe(false);
    expect(sameAttestedDocument(attested, { ...attested, frameId: 1 })).toBe(false);
    expect(sameAttestedDocument(attested, { ...attested, tabId: 8 })).toBe(false);
  });

  it("accepts only loopback origins", () => {
    expect(isLoopbackOrigin("http://127.0.0.1:8990")).toBe(true);
    expect(isLoopbackOrigin("http://127.0.0.1")).toBe(true);
    expect(isLoopbackOrigin("https://127.0.0.1:8990")).toBe(false);
    expect(isLoopbackOrigin("http://localhost:8990")).toBe(false);
    expect(isLoopbackOrigin("http://127.0.0.1.example.com")).toBe(false);
    expect(isLoopbackOrigin(null)).toBe(false);
  });

  it("parses the service worker's attach notice", () => {
    expect(parseAttachedNotice({ op: "ATTACHED", swBootId: "boot-1" })).toEqual({ op: "ATTACHED", swBootId: "boot-1" });
    expect(parseAttachedNotice({ op: "ATTACHED" })).toBeNull();
    expect(parseAttachedNotice({ op: "OBSERVE", requestId: "r1" })).toBeNull();
  });
});
