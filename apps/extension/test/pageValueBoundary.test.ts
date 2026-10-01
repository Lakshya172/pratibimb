/**
 * THE PAGE-VALUE BOUNDARY, TESTED THROUGH THE MESSAGES RATHER THAN THROUGH THE OBJECTS.
 *
 * Both halves of the boundary run here: the page realm with a real `Vault` over a small fake DOM
 * holding real values, and the core realm's remote boundary talking to it. **Every message either
 * side sends is recorded**, and the assertions are made against that recording rather than against
 * anyone's internals. That is the point — "the value is not in the object" is a claim about code,
 * and "the value is not in the traffic" is a claim about behaviour.
 *
 * The browser harness proves the same properties against a real Chrome, once. These prove them on
 * every `npm test`, which is the difference between a demonstration and a regression test.
 *
 * The values below are the repository's synthetic canaries (SECURITY.md §2). They are named here so
 * their ABSENCE can be asserted; that is the only reason a test may name one.
 */
import { buildElementGraph, frameId, type DomMeasurement } from "@pratibimb/perception";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPagePrivacyBoundary } from "../host-lib/page-privacy-boundary";
import { createRemotePrivacyBoundary } from "../host-lib/remote-privacy-boundary";
import { createReleaseAuthority } from "../host-lib/value-release";
import { type BoundaryReply, type BoundaryRequest, type CapabilityPayload } from "../host-lib/boundary-protocol";

const ORIGIN = "http://127.0.0.1:8975";
const PHONE = "9000000001";
const NAME = "Ramesh Kumar";
const AADHAAR = "2345 6789 0124";
const OTP = "482913";
const VALUES = [PHONE, NAME, AADHAAR, OTP];

// ── the smallest page that can hold a value ──────────────────────────────────────────────────

interface FakeInput {
  readonly tagName: "INPUT";
  readonly id: string;
  value: string;
  disabled: boolean;
  readOnly: boolean;
  readonly labels: readonly { textContent: string }[];
  getAttribute(name: string): string | null;
  dispatchEvent(): boolean;
}

const input = (id: string, value: string, type: string, label: string, autocomplete?: string): FakeInput => ({
  tagName: "INPUT",
  id,
  value,
  disabled: false,
  readOnly: false,
  labels: [{ textContent: label }],
  getAttribute: (name) =>
    name === "type" ? type : name === "autocomplete" ? (autocomplete ?? null) : null,
  dispatchEvent: () => true,
});

const page = () => [
  input("name", NAME, "text", "Full name", "name"),
  input("mobile", PHONE, "tel", "Mobile number", "tel"),
  input("aadhaar", AADHAAR, "text", "Aadhaar number"),
  input("otp", OTP, "text", "OTP", "one-time-code"),
  input("mobile_confirm", "", "tel", "Confirm mobile number", "tel"),
];

const measurementFor = (id: string, name: string, index: number): DomMeasurement => ({
  selector: `#${id}`,
  role: "textbox",
  name,
  rect: { x: 10, y: 10 + index * 40, w: 200, h: 30 },
  enabled: true,
  cssHidden: false,
  parentIndex: -1,
});

const graphFor = (inputs: readonly FakeInput[]) =>
  buildElementGraph(
    inputs.map((element, index) => measurementFor(element.id, element.labels[0]!.textContent, index)),
    {
      dpr: 1,
      zoom: 1,
      viewportCss: { w: 1280, h: 720 },
      captureSize: { w: 1280, h: 720 },
      scroll: { x: 0, y: 0 },
      origin: ORIGIN,
    },
    frameId("test-frame-1")
  );

/** Wire both halves together and keep a copy of everything that passed between them. */
function boundaryPair() {
  const inputs = page();
  const byId = new Map(inputs.map((element) => [`#${element.id}`, element]));
  const fakeDocument = {
    querySelectorAll: (selector: string) =>
      selector === "input" ? inputs : inputs.filter((element) => `#${element.id}` === selector),
    querySelector: (selector: string) => byId.get(selector) ?? null,
  };
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("Event", class {});

  const pageRealm = createPagePrivacyBoundary({ document: fakeDocument as unknown as Document, now: () => 1_000 });
  const capabilities = createReleaseAuthority<CapabilityPayload>();
  const asker = { tabId: 7, frameId: 0, documentId: "doc-A" };

  /** Every message that crossed, in order, in both directions. */
  const crossings: { readonly way: "down" | "up"; readonly message: unknown }[] = [];

  const send = async (request: BoundaryRequest): Promise<BoundaryReply> => {
    crossings.push({ way: "down", message: request });
    let reply: BoundaryReply;
    if (request.kind === "CLASSIFY") reply = pageRealm.classify(request.ask);
    else if (request.kind === "FORGET") reply = pageRealm.forget();
    else {
      // The page realm collects the capability directly. This exchange is the one the service
      // worker does not see, so it is deliberately NOT recorded as a crossing.
      const collected = capabilities.redeem(request.nonce, request.target, asker);
      if (!collected.released) reply = { ok: false, refused: collected.refused };
      else if (collected.payload.kind === "QUESTION") reply = pageRealm.answer(collected.payload.texts);
      else reply = pageRealm.release(collected.payload.ask);
    }
    crossings.push({ way: "up", message: reply });
    return reply;
  };

  const core = createRemotePrivacyBoundary({
    binding: {
      observationFrameId: frameId("test-frame-1"),
      document: { tabId: 7, frameId: 0, documentId: "doc-A", origin: ORIGIN },
      swBootId: "boot-1",
    },
    send,
    capabilities,
    capabilityTtlMs: 10_000,
  });

  const ask = {
    graph: graphFor(inputs),
    goal: "Submit my application with my registered mobile number.",
    sessionId: "s-1",
    requestId: "r-1",
    viewId: "r-1",
    origin: ORIGIN,
    documentId: "doc-A",
    viewport: { w: 1280, h: 720, dpr: 1, zoom: 1, scrollX: 0, scrollY: 0 },
    now: 1_000,
    destination: "(test)",
  };

  /** What a service worker in the middle would have been able to read. */
  const traffic = () => JSON.stringify(crossings);

  return { core, pageRealm, capabilities, inputs, byId, ask, crossings, traffic };
}

afterEach(() => vi.unstubAllGlobals());

describe("the page-value boundary", () => {
  describe("the page realm", () => {
    it("reads the page's real values and issues a reference for each protectable one", async () => {
      const { core, ask } = boundaryPair();
      const answer = await core.sanitize(ask);
      expect(answer.ok).toBe(true);
      expect(core.report.fieldsSeenByThePageRealm).toBe(5);
      // Name, phone and Aadhaar are tokenised. The OTP is CRITICAL and gets no reference at all;
      // the confirm field is empty and is not sensitive.
      expect(core.report.referencesIssued).toBe(3);
    });

    it("masks the OTP and never issues a reference for it", async () => {
      const { core, ask } = boundaryPair();
      const answer = await core.sanitize(ask);
      if (!answer.ok) throw new Error(answer.refused);
      const otp = answer.handoff.redactions.find((redaction) => redaction.class === "OTP");
      expect(otp).toBeDefined();
      expect(otp?.method).toBe("masked_no_token");
      expect(otp?.token).toBe("");
      expect(answer.descriptors.some((descriptor) => descriptor.piiClass === "OTP")).toBe(false);
    });

    it("recognises its own values when the core realm asks", async () => {
      const { core, ask } = boundaryPair();
      await core.sanitize(ask);
      await core.inspect([PHONE, "Chandrayaan-3"]);
      expect(core.reader.holdsLiteral(PHONE)).toEqual({ held: true, piiClass: "PHONE" });
      expect(core.reader.holdsLiteral("Chandrayaan-3")).toEqual({ held: false });
    });
  });

  describe("what crosses", () => {
    it("carries no page value in any message, in either direction", async () => {
      const { core, ask, traffic } = boundaryPair();
      const answer = await core.sanitize(ask);
      if (!answer.ok) throw new Error(answer.refused);
      await core.inspect([PHONE]);
      await core.releaseInto({
        ref: answer.descriptors.find((d) => d.piiClass === "PHONE")!.ref,
        target: "#mobile_confirm",
        viewId: "r-1",
        sessionId: "s-1",
        currentDocumentId: "doc-A",
        classOriginGrants: [`PHONE|${ORIGIN}`],
        useGrants: [],
        now: 1_000,
      });
      await core.forget();

      const text = traffic();
      expect(text.length).toBeGreaterThan(500); // there really was traffic to inspect
      for (const value of VALUES) expect(text).not.toContain(value);
    });

    it("carries no page value in the verified handoff that would be sent", async () => {
      const { core, ask } = boundaryPair();
      const answer = await core.sanitize(ask);
      if (!answer.ok) throw new Error(answer.refused);
      const serialized = JSON.stringify(answer.handoff);
      for (const value of VALUES) expect(serialized).not.toContain(value);
    });

    it("carries no page value in the plan projection the record keeps", async () => {
      const { core, ask } = boundaryPair();
      await core.sanitize(ask);
      await core.inspect([PHONE]);
      const safe = core.redact({
        planVersion: "1",
        steps: [
          { op: "insert", target: "#mobile_confirm", literal: PHONE },
          { op: "click", target: "#submit" },
        ],
        provenance: { requestId: "r-1", sessionId: "s-1", viewId: "r-1" },
      });
      const serialized = JSON.stringify(safe);
      expect(serialized).not.toContain(PHONE);
      expect(serialized).toContain("PHONE");
    });
  });

  describe("the leak check cannot be satisfied by silence", () => {
    it("refuses rather than answering 'no' when the page realm cannot be reached", async () => {
      const { core, ask, capabilities } = boundaryPair();
      await core.sanitize(ask);
      // Every capability is revoked before the page realm can collect it: the channel is broken.
      const original = capabilities.arm.bind(capabilities);
      vi.spyOn(capabilities, "arm").mockImplementation((...args) => {
        const nonce = original(...args);
        capabilities.revokeAll();
        return nonce;
      });
      await expect(core.inspect([PHONE])).rejects.toThrow(/could not answer/);
    });

    it("throws rather than shrugging when asked about a literal nobody established", async () => {
      const { core, ask } = boundaryPair();
      await core.sanitize(ask);
      expect(() => core.reader.holdsLiteral("never-asked-about")).toThrow(/no answer was established/);
    });
  });

  describe("the release", () => {
    it("writes the value into the approved field, locally, and reports only a boolean", async () => {
      const { core, ask, byId } = boundaryPair();
      const answer = await core.sanitize(ask);
      if (!answer.ok) throw new Error(answer.refused);
      const phone = answer.descriptors.find((d) => d.piiClass === "PHONE")!;

      const released = await core.releaseInto({
        ref: phone.ref,
        target: "#mobile_confirm",
        viewId: "r-1",
        sessionId: "s-1",
        currentDocumentId: "doc-A",
        classOriginGrants: [`PHONE|${ORIGIN}`],
        useGrants: [],
        now: 1_000,
      });

      expect(released).toEqual({ ok: true, ref: phone.ref, piiClass: "PHONE", inserted: true });
      // The value arrived in the page, which is the whole purpose — and it got there without ever
      // being in a message.
      expect(byId.get("#mobile_confirm")?.value).toBe(PHONE);
    });

    it("refuses a second release of the same reference", async () => {
      const { core, ask } = boundaryPair();
      const answer = await core.sanitize(ask);
      if (!answer.ok) throw new Error(answer.refused);
      const phone = answer.descriptors.find((d) => d.piiClass === "PHONE")!;
      const request = {
        ref: phone.ref,
        target: "#mobile_confirm",
        viewId: "r-1",
        sessionId: "s-1",
        currentDocumentId: "doc-A",
        classOriginGrants: [`PHONE|${ORIGIN}`],
        useGrants: [],
        now: 1_000,
      };
      expect((await core.releaseInto(request)).ok).toBe(true);
      expect(await core.releaseInto(request)).toEqual({ ok: false, cause: "CONSUMED" });
    });

    it("refuses when the document under the view has been replaced", async () => {
      const { core, ask } = boundaryPair();
      const answer = await core.sanitize(ask);
      if (!answer.ok) throw new Error(answer.refused);
      const phone = answer.descriptors.find((d) => d.piiClass === "PHONE")!;
      expect(
        await core.releaseInto({
          ref: phone.ref,
          target: "#mobile_confirm",
          viewId: "r-1",
          sessionId: "s-1",
          currentDocumentId: "doc-B",
          classOriginGrants: [`PHONE|${ORIGIN}`],
          useGrants: [],
          now: 1_000,
        })
      ).toEqual({ ok: false, cause: "STALE_BINDING" });
    });

    // `NEEDS_USER` rather than the specific cause: the orchestrator's own flattening keeps the
    // cause only for a REFUSE, and "a human has not agreed to this class on this origin" is not a
    // refusal — it is the run being told to go and ask. Parity with `machine.ts`, deliberately.
    it("refuses without the class-origin grant a human has to give", async () => {
      const { core, ask } = boundaryPair();
      const answer = await core.sanitize(ask);
      if (!answer.ok) throw new Error(answer.refused);
      const phone = answer.descriptors.find((d) => d.piiClass === "PHONE")!;
      expect(
        await core.releaseInto({
          ref: phone.ref,
          target: "#mobile_confirm",
          viewId: "r-1",
          sessionId: "s-1",
          currentDocumentId: "doc-A",
          classOriginGrants: [],
          useGrants: [],
          now: 1_000,
        })
      ).toEqual({ ok: false, cause: "NEEDS_USER" });
    });
  });

  describe("when the run ends", () => {
    it("destroys the vault in the page realm", async () => {
      const { core, pageRealm, ask } = boundaryPair();
      await core.sanitize(ask);
      expect(pageRealm.state().open).toBe(true);
      await core.forget();
      expect(pageRealm.state()).toEqual({ refs: 0, open: false });
    });
  });
});
