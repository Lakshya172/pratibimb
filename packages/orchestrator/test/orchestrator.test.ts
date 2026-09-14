/**
 * THE LOOP — one task, once, through every gate.
 *
 * Only the browser is simulated here. The sanitizer, vault, verifier, parser, validator, binder,
 * permit gate and VERIFY RESULT are the real implementations, so a test that passes because the
 * orchestrator skipped a stage would fail rather than pass.
 *
 * The two claims the section is for:
 *
 * 1. **The happy path ends at CONFIRMED because the page said so**, not because anything here
 *    decided it. The postcondition can only hold if the value was restored correctly first.
 * 2. **The refusal path executes nothing.** The literal the reasoner should never have known is
 *    refused at VALIDATE_PLAN: no rehydration, no insertion, no click, no success — and the vault
 *    reference is still unspent afterwards.
 */
import { describe, expect, it } from "vitest";
import { deterministicReasoner, type ReasonerClient } from "@pratibimb/reasoner";
import { resultOf, runTask, succeeded, type RunState } from "../src/index.js";
import { DEMO, ORIGIN, RUN_OPTIONS, SimulatedPage, portsFor, type PortOptions } from "./support/simulatedPage.js";

const HAPPY_PATH: RunState[] = [
  "IDLE",
  "OBSERVE",
  "SANITIZE",
  "VERIFY_PAYLOAD",
  "SEND",
  "VALIDATE_PLAN",
  "AWAIT_GRANT",
  "REHYDRATE",
  "ACT",
  "VERIFY_RESULT",
  "DONE",
];

const run = async (options: PortOptions = {}) => {
  const page = new SimulatedPage(options);
  const record = await runTask(portsFor(page, options), RUN_OPTIONS);
  return { page, record };
};

const path = (record: { transitions: readonly { from: RunState; to: RunState }[] }): RunState[] => [
  record.transitions[0]?.from ?? "IDLE",
  ...record.transitions.map((t) => t.to),
];

describe("the happy path", () => {
  it("walks every state in order and finishes DONE", async () => {
    const { record } = await run();
    expect(record.state).toBe("DONE");
    expect(path(record)).toEqual(HAPPY_PATH);
    expect(record.refusal).toBeNull();
  });

  it("ends CONFIRMED because the page was read back, not because anything assumed it", async () => {
    const { record, page } = await run();
    expect(resultOf(record)?.verification).toBe("CONFIRMED");
    expect(succeeded(record)).toBe(true);
    expect(record.act?.reached).toBe("VERIFY_RESULT");
    expect(page.submitted).toBe(true);
    expect(page.statusText).toBe("Application submitted");
  });

  it("restored the value locally, into the field the plan named", async () => {
    const { page, record } = await run();
    expect(page.find("#mobile_confirm")?.value).toBe(DEMO.mobile);
    expect(record.rehydrated).toEqual([
      { ref: "<PII:PHONE:1>", target: "#mobile_confirm", piiClass: "PHONE", inserted: true },
    ]);
  });

  it("dispatched exactly one click, through the audited path", async () => {
    const { page, record } = await run();
    expect(page.clicks).toBe(1);
    expect(record.act?.result?.status).toBe("EXECUTED");
    expect(record.confirmation).not.toBeNull();
  });

  it("sent a handoff the privacy verifier produced, and kept the exact bytes", async () => {
    const { record } = await run();
    expect(record.handoff?.verified).toBe(true);
    expect(record.handoffSerialized).toBe(JSON.stringify(record.handoff));
    expect(record.response?.received).toBe(true);
  });

  it("asked a human, once, naming the value, the field and the action that follows", async () => {
    const asked: string[] = [];
    const { record } = await run({ onGrant: (r) => asked.push(`${r.piiClass}|${r.target}|${r.action.target}`) });
    expect(asked).toEqual(["PHONE|#mobile_confirm|#submit"]);
    expect(record.grant.requested).toBe(true);
    expect(record.grant.decision).toEqual({ granted: true });
    expect(record.grant.useGrant?.used).toBe(true);
  });

  it("measures each stage", async () => {
    const { record } = await run();
    for (const key of ["observeMs", "sanitizeMs", "sendMs", "validatePlanMs", "rehydrateMs", "actMs", "totalMs"] as const) {
      expect(typeof record.timings[key], key).toBe("number");
    }
  });

  it("holds no secret anywhere in the record it hands the UI", async () => {
    const { record } = await run();
    const serialized = JSON.stringify({ ...record, observation: null });
    for (const secret of [DEMO.mobile, DEMO.aadhaar, DEMO.name, DEMO.dob, DEMO.otp]) {
      expect(serialized, secret.slice(0, 3)).not.toContain(secret);
    }
  });
});

describe("the refusal path", () => {
  const leaking = () => deterministicReasoner({ mode: "literal-echo", literal: DEMO.mobile });

  it("stops at VALIDATE_PLAN and goes no further", async () => {
    const { record } = await run({ reasoner: leaking() });
    expect(record.state).toBe("REFUSED");
    expect(path(record)).toEqual(["IDLE", "OBSERVE", "SANITIZE", "VERIFY_PAYLOAD", "SEND", "VALIDATE_PLAN", "REFUSED"]);
  });

  it("names the leak as a leak, with privacy's own cause", async () => {
    const { record } = await run({ reasoner: leaking() });
    expect(record.refusal?.stage).toBe("VALIDATE_PLAN");
    expect(record.refusal?.cause).toBe("LITERAL_REFUSED");
    expect(record.refusal?.planRefusal?.literalCause).toBe("VAULT_LITERAL_ECHO");
    expect(record.refusal?.planRefusal?.literalSeverity).toBe("LEAKAGE_EVENT");
  });

  it("executes nothing: no grant, no rehydration, no insertion, no click, no success", async () => {
    const { page, record } = await run({ reasoner: leaking() });
    expect(record.grant.requested).toBe(false);
    expect(record.rehydrated).toEqual([]);
    expect(record.confirmation).toBeNull();
    expect(record.act).toBeNull();
    expect(page.clicks).toBe(0);
    expect(page.find("#mobile_confirm")?.value).toBe("");
    expect(page.submitted).toBe(false);
    expect(page.statusText).toBe("Not submitted");
    expect(succeeded(record)).toBe(false);
  });

  it("never quotes the secret in the refusal it shows a human", async () => {
    const { record } = await run({ reasoner: leaking() });
    const serialized = JSON.stringify({ ...record, observation: null });
    expect(serialized).not.toContain(DEMO.mobile);
  });

  it("leaves the reference unspent, so the refusal costs nothing", async () => {
    // Asserted through the record rather than the vault handle: the orchestrator does not expose
    // the vault, which is itself the property.
    const { record } = await run({ reasoner: leaking() });
    expect(record.rehydrated).toEqual([]);
    expect(record.validation?.ok).toBe(false);
  });
});

describe("every other way it can stop", () => {
  it("refuses a reasoner that returns something that is not a plan", async () => {
    for (const malformed of ["not-an-object", "missing-steps", "empty-steps", "unknown-op"] as const) {
      const { record, page } = await run({ reasoner: deterministicReasoner({ malformed }) });
      expect(record.state, malformed).toBe("REFUSED");
      expect(record.refusal?.stage, malformed).toBe("PARSE_PLAN");
      expect(page.clicks).toBe(0);
    }
  });

  it("refuses a reasoner that throws, without quoting it", async () => {
    const throwing: ReasonerClient = {
      name: "throwing",
      transport: "IN_PROCESS",
      async propose() {
        throw new Error(DEMO.mobile);
      },
    };
    const { record, page } = await run({ reasoner: throwing });
    expect(record.refusal?.stage).toBe("SEND");
    expect(record.refusal?.cause).toBe("REASONER_THREW");
    expect(JSON.stringify(record.refusal)).not.toContain(DEMO.mobile);
    expect(page.clicks).toBe(0);
  });

  it("stops when a human says no, before anything is rehydrated", async () => {
    const { record, page } = await run({ grant: { granted: false, reason: "DENIED" } });
    expect(record.state).toBe("REFUSED");
    expect(record.refusal?.stage).toBe("AWAIT_GRANT");
    expect(record.refusal?.cause).toBe("DENIED");
    expect(record.rehydrated).toEqual([]);
    expect(page.find("#mobile_confirm")?.value).toBe("");
    expect(page.clicks).toBe(0);
  });

  it.each([["DISMISSED"], ["UNAVAILABLE"]] as const)("treats a %s prompt as a refusal, never as consent", async (reason) => {
    const { record, page } = await run({ grant: { granted: false, reason } });
    expect(record.state).toBe("REFUSED");
    expect(page.clicks).toBe(0);
  });

  it("stops when the restoration does not take", async () => {
    const { record, page } = await run({ insertFails: true });
    expect(record.state).toBe("REFUSED");
    expect(record.refusal?.stage).toBe("REHYDRATE");
    expect(record.refusal?.cause).toBe("INSERTION_REFUSED");
    expect(page.clicks).toBe(0);
  });

  it("stops when the page cannot be read at all", async () => {
    const { record } = await run({ observeThrowsAfter: 0 });
    expect(record.state).toBe("REFUSED");
    expect(record.refusal?.stage).toBe("OBSERVE");
    expect(record.handoff).toBeNull();
  });

  it("stops before acting when the page cannot be re-read", async () => {
    // REFRESH is not optional: an action is never dispatched against a page nobody could re-observe.
    const { record, page } = await run({ observeThrowsAfter: 1 });
    expect(record.state).toBe("REFUSED");
    expect(record.refusal?.stage).toBe("ACT");
    expect(page.clicks).toBe(0);
  });

  it("stops at the hit test when nothing is at the point", async () => {
    const { record, page } = await run({ nothingAtPoint: true });
    expect(record.state).toBe("REFUSED");
    expect(record.refusal?.stage).toBe("ACT");
    expect(record.act?.reached).toBe("HIT_TEST");
    expect(page.clicks).toBe(0);
  });

  it("stops at VALIDATE when the target's identity changed under the plan", async () => {
    const { record, page } = await run({ renameSubmitAfterObserve: true });
    expect(record.state).toBe("REFUSED");
    expect(page.clicks).toBe(0);
  });
});

describe("VERIFY RESULT is reported exactly as it comes", () => {
  it("reports NOT_CONFIRMED when the page did not do what was expected", async () => {
    // The click lands and the form accepts it, but the button never disables, so the declared
    // postcondition is positively not met.
    const { record, page } = await run({ neverDisablesSubmit: true });
    expect(page.clicks).toBe(1);
    expect(record.state).toBe("DONE");
    expect(resultOf(record)?.verification).toBe("NOT_CONFIRMED");
    expect(succeeded(record)).toBe(false);
  });

  it("reports UNKNOWN when the dispatch outcome cannot be established", async () => {
    const { record } = await run({ clickThrows: true });
    expect(record.state).toBe("DONE");
    expect(resultOf(record)?.verification).toBe("UNKNOWN");
    // An unknown is never a success, and DONE is not a claim that anything worked.
    expect(succeeded(record)).toBe(false);
  });

  it("never turns an uncertain result into a successful one", async () => {
    for (const options of [{ clickThrows: true }, { neverDisablesSubmit: true }]) {
      const { record } = await run(options);
      expect(succeeded(record)).toBe(false);
    }
  });
});

describe("REFUSED is terminal", () => {
  it("records no transition after it", async () => {
    const { record } = await run({ reasoner: deterministicReasoner({ mode: "literal-echo", literal: DEMO.mobile }) });
    const refusedAt = record.transitions.findIndex((t) => t.to === "REFUSED");
    expect(refusedAt).toBe(record.transitions.length - 1);
  });

  it("leaves every later stage's record empty, so nothing can look partly done", async () => {
    const { record } = await run({ grant: { granted: false, reason: "DENIED" } });
    expect(record.rehydrated).toEqual([]);
    expect(record.confirmation).toBeNull();
    expect(record.act).toBeNull();
    expect(record.state).toBe("REFUSED");
  });

  it("reports the origin and identity it ran under, for a ledger", async () => {
    const { record } = await run();
    expect(record.origin).toBe(ORIGIN);
    expect(record.sessionId).toBe(RUN_OPTIONS.sessionId);
    expect(record.requestId).toBe(RUN_OPTIONS.requestId);
    expect(record.ledgerEntry?.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
