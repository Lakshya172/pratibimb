/**
 * The sweep: every surface this package can produce, checked against every secret it holds.
 *
 * The other suites assert behaviour. This one assumes the behaviour is right and asks the blunt
 * question anyway — if somebody serializes this, does a secret come out? — over the handoff, the
 * ledger, the report, the vault, every refusal shape, and the hints.
 *
 * It checks exact containment *and* normalised containment, so a value that survived with a hyphen
 * in it, or with a letter standing in for a digit, still fails the test.
 */
import { describe, expect, it } from "vitest";
import {
  bind,
  checkLiteral,
  containsSecret,
  createVault,
  hintFor,
  rehydrate,
  sanitize,
  serializeHandoff,
  verifyHandoff,
  type BindContext,
  type BindView,
} from "../src/index.js";
import { markDraft, type HandoffDraft } from "../src/handoff.js";
import { DEMO, GOAL, ORIGIN, SECRETS, TODAY, demoContext, demoFields, demoFingerprint, demoGraph } from "./support/demoFixture.js";

const ALL_SECRETS = [...SECRETS, DEMO.otp];

/** Fails on an exact match and on a normalised one. */
const expectNoSecret = (label: string, text: string) => {
  for (const secret of ALL_SECRETS) {
    expect(text, `${label} contains ${secret.slice(0, 2)}…`).not.toContain(secret);
    expect(containsSecret(text, secret), `${label} contains a normalised form`).toBe(false);
  }
};

describe("nothing this package emits carries a secret", () => {
  it("sweeps every artifact of a successful sanitize", async () => {
    const outcome = await sanitize(demoGraph(), GOAL, demoContext(), { fields: demoFields() });
    if (!outcome.ok) throw new Error("test setup");

    expectNoSecret("handoff", serializeHandoff(outcome.handoff));
    expectNoSecret("handoff (pretty)", JSON.stringify(outcome.handoff, null, 2));
    expectNoSecret("ledger entry", JSON.stringify(outcome.ledgerEntry));
    expectNoSecret("ledger", JSON.stringify(outcome.ledger));
    expectNoSecret("report", JSON.stringify(outcome.report));
    expectNoSecret("vault", JSON.stringify(outcome.vault));
    expectNoSecret("vault (string)", String(outcome.vault));
    expectNoSecret("redactions", JSON.stringify(outcome.handoff.redactions));
    expectNoSecret("elements", JSON.stringify(outcome.handoff.elements));
  });

  it("sweeps the descriptors a panel would render", async () => {
    const outcome = await sanitize(demoGraph(), GOAL, demoContext(), { fields: demoFields() });
    if (!outcome.ok) throw new Error("test setup");
    for (const redaction of outcome.handoff.redactions) {
      expectNoSecret(`descriptor ${redaction.class}`, JSON.stringify(outcome.vault.describe(redaction.token)));
      expectNoSecret(`hint ${redaction.class}`, JSON.stringify(redaction.hint));
    }
  });

  it("sweeps every refusal shape", async () => {
    const outcome = await sanitize(demoGraph(), GOAL, demoContext(), { fields: demoFields() });
    if (!outcome.ok) throw new Error("test setup");

    const view: BindView = {
      viewId: "view-1",
      documentId: "doc-1",
      fields: new Map([["#mobile", { accepts: "PHONE" as const, origin: ORIGIN, fingerprint: demoFingerprint("#mobile") }]]),
    };
    const ctx: BindContext = {
      vault: outcome.vault,
      sessionId: "session-1",
      view,
      currentDocumentId: "doc-2", // stale
      classOriginGrants: new Set(),
      useGrants: [],
      now: 1_760_000_000_000,
    };

    expectNoSecret("bind refusal", JSON.stringify(bind({ ref: DEMO.mobile, targetId: "#mobile", viewId: "view-1" }, ctx)));
    expectNoSecret("rehydrate refusal", JSON.stringify(rehydrate({ ref: DEMO.mobile, targetId: "#mobile", viewId: "view-1" }, ctx)));
    expectNoSecret(
      "literal refusal",
      JSON.stringify(checkLiteral(DEMO.mobile, { vault: outcome.vault, targetIsRedacted: true, today: TODAY }))
    );
    expectNoSecret("aadhaar literal refusal", JSON.stringify(checkLiteral(DEMO.aadhaar, { vault: outcome.vault, targetIsRedacted: false, today: TODAY })));

    const refusedSanitize = await sanitize(demoGraph(), "", demoContext(), { fields: demoFields() });
    expectNoSecret("sanitize refusal", JSON.stringify(refusedSanitize));
  });

  it("sweeps a verification refusal, including the one caused by a leak", () => {
    const vault = createVault({ sessionId: "session-1", origin: ORIGIN, now: () => 1 });
    vault.store({ piiClass: "PHONE", value: DEMO.mobile });
    const leaky = markDraft<HandoffDraft>({
      manifestVersion: "1.1",
      capture: { w: 1024, h: 768, dpr: 1, zoom: 1, scale_to_css: 1, scroll: { x: 0, y: 0 }, origin: ORIGIN },
      capability: { backend: "none" as never, tiers_fired: ["T0"] },
      elements: [{ id: "#echo", role: "status", name: DEMO.mobile, source: "dom", visible: true, offscreen: false, enabled: true }],
      goal: GOAL,
      redactions: [],
      request: { requestId: "request-1", sessionId: "session-1", issuedAt: 1 },
      verified: false,
    });
    const result = verifyHandoff(leaky, { sessionId: "session-1", requestId: "request-1", origin: ORIGIN, vault });
    expect(result.verified).toBe(false);
    expectNoSecret("verification refusal", JSON.stringify(result));
  });

  it("builds hints from shape alone", () => {
    for (const [cls, value] of [
      ["PHONE", DEMO.mobile],
      ["AADHAAR", DEMO.aadhaar],
      ["DOB", DEMO.dob],
      ["NAME", DEMO.name],
    ] as const) {
      const hint = hintFor(cls, value, "tel");
      const serialized = JSON.stringify(hint);
      expectNoSecret(`hint ${cls}`, serialized);
      // Not even a fragment: no two-character run of the value appears in the hint.
      for (let i = 0; i + 2 <= value.length; i += 1) {
        const fragment = value.slice(i, i + 2);
        if (/^\s|\s$/.test(fragment)) continue;
        expect(serialized).not.toContain(fragment);
      }
    }
  });

  it("keeps the goal, which is the user's own words, and nothing else", async () => {
    const outcome = await sanitize(demoGraph(), GOAL, demoContext(), { fields: demoFields() });
    if (!outcome.ok) throw new Error("test setup");
    expect(outcome.handoff.goal).toBe(GOAL);
    expect(JSON.stringify(outcome.ledgerEntry)).not.toContain(GOAL);
  });
});
