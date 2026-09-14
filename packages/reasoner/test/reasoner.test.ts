/**
 * THE UNTRUSTED BOUNDARY.
 *
 * Three claims:
 *
 * 1. **Nothing leaves unless the privacy verifier produced it.** Asked of the verifier, not of a
 *    flag, so a forged `verified: true` does not get a send.
 * 2. **What comes back is `unknown` and stays `unknown`.** There is no field on `ReasonerResponse`
 *    that a caller could read as a plan, and no path from here to execution.
 * 3. **The deterministic planner sees only what the server sees.** It plans from references and
 *    element metadata; it cannot obtain a value, which is why the literal-echo mode has to be handed
 *    one — and that is the evidence, not a gap.
 */
import { describe, expect, it } from "vitest";
import { deterministicReasoner, sendToReasoner, type ReasonerClient } from "../src/index.js";
import { DEMO, GOAL, ORIGIN, REQUEST, SESSION, verifiedHandoff } from "./support/handoff.js";

const request = async (over: Record<string, unknown> = {}) => {
  const { handoff, vault } = await verifiedHandoff();
  return { handoff, vault, goal: GOAL, requestId: REQUEST, sessionId: SESSION, origin: ORIGIN, ...over } as never;
};

describe("SEND refuses before it sends", () => {
  it("refuses a handoff the privacy verifier did not produce", async () => {
    const { handoff, vault } = await verifiedHandoff();
    const forged = JSON.parse(JSON.stringify(handoff)) as typeof handoff;
    expect(forged.verified).toBe(true); // the flag is right; the membership is not
    const response = await sendToReasoner(deterministicReasoner(), {
      handoff: forged,
      vault,
      goal: GOAL,
      requestId: REQUEST,
      sessionId: SESSION,
      origin: ORIGIN,
    });
    expect(response).toMatchObject({ received: false, cause: "HANDOFF_NOT_VERIFIED" });
  });

  it("refuses an empty goal", async () => {
    const response = await sendToReasoner(deterministicReasoner(), await request({ goal: "   " }));
    expect(response).toMatchObject({ received: false, cause: "EMPTY_GOAL" });
  });

  it.each([
    ["request", { requestId: "other-request" }],
    ["session", { sessionId: "other-session" }],
    ["origin", { origin: "http://127.0.0.1:9999" }],
  ])("refuses when the %s does not match the handoff it would send", async (_label, over) => {
    const response = await sendToReasoner(deterministicReasoner(), await request(over));
    expect(response).toMatchObject({ received: false, cause: "IDENTITY_MISMATCH" });
  });

  it("never calls the reasoner when it refuses", async () => {
    let calls = 0;
    const counting: ReasonerClient = {
      name: "counting",
      transport: "IN_PROCESS",
      async propose() {
        calls += 1;
        return {};
      },
    };
    await sendToReasoner(counting, await request({ goal: "" }));
    expect(calls).toBe(0);
  });
});

describe("SEND survives a badly behaved reasoner", () => {
  it("turns a thrown reasoner into a refusal, and drops its message", async () => {
    const throwing: ReasonerClient = {
      name: "throwing",
      transport: "IN_PROCESS",
      async propose() {
        throw new Error(`the phone number is ${DEMO.mobile}`);
      },
    };
    const response = await sendToReasoner(throwing, await request());
    expect(response).toMatchObject({ received: false, cause: "REASONER_THREW" });
    // An exception message is untrusted text and could quote anything (INV-21).
    expect(JSON.stringify(response)).not.toContain(DEMO.mobile);
  });

  it("times out rather than hanging the loop", async () => {
    const silent: ReasonerClient = {
      name: "silent",
      transport: "IN_PROCESS",
      propose: () => new Promise(() => {}),
    };
    const response = await sendToReasoner(silent, await request(), { timeoutMs: 10 });
    expect(response).toMatchObject({ received: false, cause: "REASONER_TIMEOUT" });
  });

  it("records how it travelled, so no artifact can imply a network", async () => {
    const response = await sendToReasoner(deterministicReasoner(), await request());
    expect(response.received).toBe(true);
    if (!response.received) return;
    expect(response.transport).toBe("IN_PROCESS");
    expect(response.reasoner).toBe("deterministic:reference");
  });
});

describe("the response is untrusted, by construction", () => {
  it("offers no field a caller could read as a plan", async () => {
    const response = await sendToReasoner(deterministicReasoner(), await request());
    expect(response.received).toBe(true);
    if (!response.received) return;
    expect(Object.keys(response).sort()).toEqual(
      ["elapsedMs", "raw", "reasoner", "received", "requestId", "transport"].sort()
    );
    expect("plan" in response).toBe(false);
    expect("ok" in response).toBe(false);
  });

  it("passes through whatever the reasoner returned, unexamined", async () => {
    const odd: ReasonerClient = { name: "odd", transport: "IN_PROCESS", async propose() { return 42; } };
    const response = await sendToReasoner(odd, await request());
    expect(response.received).toBe(true);
    if (!response.received) return;
    expect(response.raw).toBe(42);
  });
});

describe("the deterministic planner", () => {
  it("proposes the reference and the click, reading only what the server can see", async () => {
    const response = await sendToReasoner(deterministicReasoner(), await request());
    if (!response.received) throw new Error("setup");
    const raw = response.raw as { steps: { op: string; target: string; ref?: string }[] };
    expect(raw.steps).toHaveLength(2);
    expect(raw.steps[0]).toEqual({ op: "insert", target: "#mobile_confirm", ref: "<PII:PHONE:1>" });
    expect(raw.steps[1]).toEqual({ op: "click", target: "#submit" });
  });

  it("cannot obtain a value: nothing it produced contains one", async () => {
    const response = await sendToReasoner(deterministicReasoner(), await request());
    if (!response.received) throw new Error("setup");
    const serialized = JSON.stringify(response.raw);
    for (const secret of [DEMO.mobile, DEMO.aadhaar, DEMO.name, DEMO.dob, DEMO.otp]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("has to be handed the secret to leak it — which is the evidence", async () => {
    // A hostile reasoner in this architecture cannot derive the number from what it was sent. The
    // harness supplies it, and that necessity is the sanitizer's result, not a shortcut.
    const blind = deterministicReasoner({ mode: "literal-echo" });
    const blindResponse = await sendToReasoner(blind, await request());
    if (!blindResponse.received) throw new Error("setup");
    expect(JSON.stringify(blindResponse.raw)).not.toContain(DEMO.mobile);

    const handed = deterministicReasoner({ mode: "literal-echo", literal: DEMO.mobile });
    const leaked = await sendToReasoner(handed, await request());
    if (!leaked.received) throw new Error("setup");
    const raw = leaked.raw as { steps: { literal?: string }[] };
    expect(raw.steps[0]?.literal).toBe(DEMO.mobile);
  });

  it("produces each malformed shape the parser is tested against", async () => {
    const shapes = ["not-an-object", "missing-steps", "unknown-op", "empty-steps"] as const;
    for (const malformed of shapes) {
      const response = await sendToReasoner(deterministicReasoner({ malformed }), await request());
      expect(response.received, malformed).toBe(true);
    }
  });

  it("says so rather than guessing when the page lacks what the goal needs", async () => {
    const { handoff, vault } = await verifiedHandoff();
    const withoutFields = {
      ...handoff,
      elements: handoff.elements.filter((e) => e.id !== "#mobile_confirm"),
    };
    // Passed directly to the planner: SEND would refuse this object, which is the point of SEND.
    const raw = (await deterministicReasoner().propose({
      handoff: withoutFields as never,
      vault,
      goal: GOAL,
      requestId: REQUEST,
      sessionId: SESSION,
      origin: ORIGIN,
    })) as { steps: unknown[] };
    expect(raw.steps).toEqual([]);
  });
});
