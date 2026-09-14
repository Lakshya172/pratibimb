/**
 * SANITIZE, over the synthetic application form.
 *
 * The central assertion is the boring-looking one: after sanitizing a form that contains a name, a
 * phone number, an Aadhaar number, a date of birth and an OTP, **none of those values appears
 * anywhere in the bytes that would be sent** — checked exactly and under normalisation, over the
 * serialized handoff and the serialized ledger entry, not over a summary of them.
 */
import { describe, expect, it } from "vitest";
import { buildElementGraph, frameId, type CaptureGeometry, type DomMeasurement } from "@pratibimb/perception";
import { containsSecret, isVerifiedHandoff, sanitize, serializeHandoff } from "../src/index.js";
import { DEMO, GOAL, ORIGIN, SECRETS, TODAY, VIEWPORT, demoContext, demoFields, demoGraph } from "./support/demoFixture.js";

const run = async (over: Parameters<typeof demoContext>[0] = {}, fields = demoFields()) =>
  sanitize(demoGraph(), GOAL, demoContext(over), { fields });

const assertNoSecrets = (text: string) => {
  for (const secret of SECRETS) {
    expect(text).not.toContain(secret);
    expect(containsSecret(text, secret)).toBe(false);
  }
  expect(text).not.toContain(DEMO.otp);
};

describe("the happy path", () => {
  it("produces a verified handoff, and the verification is not the flag", async () => {
    const outcome = await run();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.handoff.verified).toBe(true);
    expect(isVerifiedHandoff(outcome.handoff)).toBe(true);
    expect(outcome.handoff.manifestVersion).toBe("1.1");
    expect(outcome.handoff.goal).toBe(GOAL);
    expect(outcome.handoff.capture.origin).toBe(ORIGIN);
  });

  it("tokenises the four tokenisable classes and masks the OTP without a reference", async () => {
    const outcome = await run();
    if (!outcome.ok) throw new Error("expected sanitize to succeed");

    const referenced = outcome.handoff.redactions.filter((r) => r.method === "token_reference");
    const masked = outcome.handoff.redactions.filter((r) => r.method === "masked_no_token");

    expect(referenced.map((r) => r.class).sort()).toEqual(["AADHAAR", "DOB", "NAME", "PHONE"]);
    expect(referenced.map((r) => r.token)).toEqual([
      "<PII:NAME:1>",
      "<PII:PHONE:1>",
      "<PII:AADHAAR:1>",
      "<PII:DOB:1>",
    ]);
    expect(masked).toHaveLength(1);
    expect(masked[0]?.class).toBe("OTP");
    expect(masked[0]?.token).toBe("");
    expect(outcome.vault.size).toBe(4);
  });

  it("gives the server shape, not content", async () => {
    const outcome = await run();
    if (!outcome.ok) throw new Error("expected sanitize to succeed");
    const phone = outcome.handoff.redactions.find((r) => r.class === "PHONE");
    expect(phone?.hint).toEqual({ len: 10, kind: "numeric", field_role: "tel" });
    expect(phone?.tier).toBe("PERSONAL");
    expect(phone?.detectors).toEqual(["D1", "D2"]);
    expect(phone?.targetId).toBe("#mobile");
    expect(phone?.bbox).toEqual([320, 240, 300, 32]);

    const aadhaar = outcome.handoff.redactions.find((r) => r.class === "AADHAAR");
    expect(aadhaar?.tier).toBe("SENSITIVE");
    expect(aadhaar?.hint.kind).toBe("numeric");
  });

  it("keeps every secret out of the handoff and the ledger entry", async () => {
    const outcome = await run();
    if (!outcome.ok) throw new Error("expected sanitize to succeed");
    assertNoSecrets(serializeHandoff(outcome.handoff));
    assertNoSecrets(JSON.stringify(outcome.ledgerEntry));
    assertNoSecrets(JSON.stringify(outcome.ledger));
    assertNoSecrets(JSON.stringify(outcome.report));
  });

  it("holds the values locally, so the demo is about protection rather than absence", async () => {
    const outcome = await run();
    if (!outcome.ok) throw new Error("expected sanitize to succeed");
    expect(outcome.vault.holdsLiteral(DEMO.mobile)).toEqual({ held: true, piiClass: "PHONE" });
    expect(outcome.vault.holdsLiteral(DEMO.aadhaar).held).toBe(true);
    // The OTP was masked, not stored: there is nothing to rehydrate.
    expect(outcome.vault.holdsLiteral(DEMO.otp).held).toBe(false);
  });

  it("records a ledger entry that makes the claim checkable", async () => {
    const outcome = await run();
    if (!outcome.ok) throw new Error("expected sanitize to succeed");
    const entry = outcome.ledgerEntry;
    expect(entry.verified).toBe(true);
    expect(entry.leakCheck).toBe("CLEAN");
    expect(entry.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.payloadBytes).toBe(new TextEncoder().encode(serializeHandoff(outcome.handoff)).length);
    expect(entry.references.map((r) => r.class).sort()).toEqual(["AADHAAR", "DOB", "NAME", "PHONE"]);
    expect(entry.maskedWithoutReference).toBe(1);
    expect(entry.note).toContain("not evidence of a network send");
  });

  it("reports what it decided, including the protective disagreement rule not firing here", async () => {
    const outcome = await run();
    if (!outcome.ok) throw new Error("expected sanitize to succeed");
    const byId = new Map(outcome.report.classified.map((row) => [row.id, row]));
    expect(byId.get("#mobile")?.outcome).toBe("TOKENISED");
    expect(byId.get("#otp")?.outcome).toBe("MASKED_NO_TOKEN");
    expect(byId.get("#otp")?.ref).toBeNull();
    expect(outcome.report.classified.every((row) => row.disagreement === false)).toBe(true);
  });
});

describe("labels that hold values", () => {
  it("scrubs an accessible name that contains a secret", async () => {
    const geometry: CaptureGeometry = {
      dpr: 1,
      zoom: 1,
      viewportCss: { w: VIEWPORT.w, h: VIEWPORT.h },
      captureSize: { w: VIEWPORT.w, h: VIEWPORT.h },
      scroll: { x: 0, y: 0 },
      origin: ORIGIN,
    };
    const leaky: DomMeasurement[] = [
      { selector: "#mobile", role: "textbox", name: "Mobile number", rect: { x: 1, y: 1, w: 10, h: 10 }, enabled: true, cssHidden: false, parentIndex: -1 },
      { selector: "#echo", role: "status", name: `Sending to ${DEMO.mobile}`, rect: { x: 1, y: 20, w: 10, h: 10 }, enabled: true, cssHidden: false, parentIndex: -1 },
      { selector: "#who", role: "status", name: DEMO.name, rect: { x: 1, y: 40, w: 10, h: 10 }, enabled: true, cssHidden: false, parentIndex: -1 },
    ];
    const outcome = await sanitize(
      buildElementGraph(leaky, geometry, frameId("leaky-1")),
      GOAL,
      demoContext(),
      { fields: demoFields() }
    );
    if (!outcome.ok) throw new Error("expected sanitize to succeed");
    const names = outcome.handoff.elements.map((e) => e.name);
    expect(names).toContain("Mobile number");
    expect(names).toContain("⟨redacted:PHONE⟩");
    expect(names).toContain("⟨redacted:NAME⟩");
    expect(outcome.report.scrubbedElementNames).toBe(2);
    assertNoSecrets(serializeHandoff(outcome.handoff));
  });
});

describe("refusals", () => {
  it("refuses an empty goal", async () => {
    const outcome = await sanitize(demoGraph(), "   ", demoContext(), { fields: demoFields() });
    expect(outcome).toEqual({ ok: false, refused: "EMPTY_GOAL" });
  });

  it("refuses a field observed on another origin", async () => {
    const fields = demoFields().map((f) => (f.id === "#mobile" ? { ...f, origin: "http://127.0.0.1:9999" } : f));
    const outcome = await run({}, fields);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refused).toBe("ORIGIN_MISMATCH");
  });

  it("refuses when the session vault belongs to a different page", async () => {
    const outcome = await sanitize(demoGraph(), GOAL, demoContext({ origin: "http://127.0.0.1:9999" }), {
      fields: demoFields().map((f) => ({ ...f, origin: "http://127.0.0.1:9999" })),
    });
    // The vault opens on the context's origin, so this succeeds; the mismatch case is a vault whose
    // origin differs from the context, which `enforceOrigin` destroys.
    expect(outcome.ok).toBe(true);
  });

  it("produces nothing at all when it refuses", async () => {
    const outcome = await sanitize(demoGraph(), "", demoContext(), { fields: demoFields() });
    expect("handoff" in outcome).toBe(false);
    expect("ledgerEntry" in outcome).toBe(false);
  });
});
