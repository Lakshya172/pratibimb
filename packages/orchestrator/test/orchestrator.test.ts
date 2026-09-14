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
import { deterministicReasoner, unavailableReasoner, type ReasonerClient } from "@pratibimb/reasoner";
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

  it("keeps every secret out of the record, except the local observation that is meant to hold them", async () => {
    // The observations ARE the local view: they are what the client read off its own page, and the
    // Planning View's local pane shows them on purpose — that contrast is the demo. Everything else
    // in the record crosses a boundary or gets logged, and must be clean.
    const { record } = await run();
    const serialized = JSON.stringify({ ...record, observation: null, initialObservation: null });
    for (const secret of [DEMO.mobile, DEMO.aadhaar, DEMO.name, DEMO.dob, DEMO.otp]) {
      expect(serialized, secret.slice(0, 3)).not.toContain(secret);
    }
  });

  it("puts the values only there, and nowhere a later stage would carry them", async () => {
    const { record } = await run();
    // The local reading holds them...
    expect(JSON.stringify(record.initialObservation)).toContain(DEMO.mobile);
    // ...and the payload, the ledger, the plan and the grant do not.
    for (const part of [record.handoffSerialized, JSON.stringify(record.ledgerEntry), JSON.stringify(record.plan), JSON.stringify(record.grant)]) {
      expect(part).not.toContain(DEMO.mobile);
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

  it("never quotes the secret in the refusal, the kept plan, or the response record", async () => {
    const { record } = await run({ reasoner: leaking() });
    // The reasoner echoed the number back. Nothing the client keeps reproduces it: the raw bytes
    // were parsed and dropped, and the kept plan carries a class marker in the literal's place.
    const serialized = JSON.stringify({ ...record, observation: null, initialObservation: null });
    expect(serialized).not.toContain(DEMO.mobile);
    expect(JSON.stringify(record.plan)).toContain("⟨literal:PHONE⟩");
    expect(record.response && "raw" in record.response).toBe(false);
  });

  it("leaves the reference unspent, so the refusal costs nothing", async () => {
    // Asserted through the record rather than the vault handle: the orchestrator does not expose
    // the vault, which is itself the property.
    const { record } = await run({ reasoner: leaking() });
    expect(record.rehydrated).toEqual([]);
    expect(record.validation?.ok).toBe(false);
  });
});

describe("a safe literal takes the other path", () => {
  /**
   * A reasoner that types a non-sensitive string into the free-text field.
   *
   * The contract permits this and the validator now accepts it. The point of the test is the
   * *asymmetry*: no vault reference, no human grant, no rehydration — and the click afterwards is
   * still gated exactly as before.
   */
  const typing = (literal: string): ReasonerClient => ({
    name: "typing",
    transport: "IN_PROCESS",
    async propose(request) {
      return {
        planVersion: "1",
        steps: [
          { op: "insert", target: "#notes", literal },
          { op: "click", target: "#submit" },
        ],
        provenance: {
          requestId: request.requestId,
          sessionId: request.sessionId,
          viewId: request.handoff.request.requestId,
          origin: request.origin,
        },
      };
    },
  });

  it("inserts it without asking a human and without touching the vault", async () => {
    const { page, record } = await run({ reasoner: typing("Chandrayaan-3"), withNotesField: true });
    expect(record.state).toBe("DONE");
    expect(record.grant.requested).toBe(false);
    expect(record.rehydrated).toEqual([]);
    expect(record.literalsInserted).toEqual([{ target: "#notes", inserted: true }]);
    expect(page.find("#notes")?.value).toBe("Chandrayaan-3");
  });

  it("still gates the click exactly as before", async () => {
    const { page, record } = await run({ reasoner: typing("Punjab"), withNotesField: true });
    expect(page.clicks).toBe(1);
    expect(record.confirmation).not.toBeNull();
    expect(record.act?.result?.status).toBe("EXECUTED");
  });

  it("keeps the reasoner's text out of the record, even when it is safe", async () => {
    const { record } = await run({ reasoner: typing("Chandrayaan-3"), withNotesField: true });
    const serialized = JSON.stringify({ ...record, observation: null, initialObservation: null });
    expect(serialized).not.toContain("Chandrayaan-3");
  });

  it("refuses the same step when the literal is a value the vault holds", async () => {
    const { page, record } = await run({ reasoner: typing(DEMO.mobile), withNotesField: true });
    expect(record.state).toBe("REFUSED");
    expect(record.refusal?.planRefusal?.literalCause).toBe("VAULT_LITERAL_ECHO");
    expect(page.find("#notes")?.value).toBe("");
    expect(page.clicks).toBe(0);
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

/**
 * THE REASONER IS REPLACEABLE, AND HAS NO AUTHORITY.
 *
 * The model was swapped in behind the same boundary the deterministic planner sat behind. These
 * cases assert the swap changed nothing that matters: the same states, the same gates, the same
 * refusals — plus the one rule the fallback adds, which is that a plan the client *refused* does not
 * get quietly replaced by one it would accept.
 */
describe("the reasoner is replaceable", () => {
  /** A stand-in for the model: answers with whatever the case needs, over the same interface. */
  const answering = (steps: unknown): ReasonerClient => ({
    name: "local-model:test",
    transport: "LOOPBACK_HTTP",
    async propose(request) {
      return {
        planVersion: "1",
        goal: request.goal,
        steps,
        provenance: {
          requestId: request.requestId,
          sessionId: request.sessionId,
          viewId: request.handoff.request.requestId,
          origin: request.origin,
        },
      };
    },
  });

  const good = [
    { op: "insert", target: "#mobile_confirm", ref: "<PII:PHONE:1>" },
    { op: "click", target: "#submit" },
  ];

  const withFallback = (reasoner: ReasonerClient, options: PortOptions = {}) => {
    const page = new SimulatedPage(options);
    const ports = {
      ...portsFor(page, options),
      reasoner,
      reasonerKind: "LOCAL_MODEL" as const,
      fallback: deterministicReasoner(),
    };
    return { page, ports };
  };

  it("completes through a model answer, with every state unchanged", async () => {
    const { page, ports } = withFallback(answering(good));
    const record = await runTask(ports, RUN_OPTIONS);
    expect(path(record)).toEqual(HAPPY_PATH);
    expect(record.reasonerKind).toBe("LOCAL_MODEL");
    expect(record.fallback).toBeNull();
    expect(resultOf(record)?.verification).toBe("CONFIRMED");
    expect(page.clicks).toBe(1);
  });

  it("falls back when the model is unavailable, and still goes through every gate", async () => {
    const { page, ports } = withFallback(unavailableReasoner());
    const record = await runTask(ports, RUN_OPTIONS);
    expect(record.reasonerKind).toBe("DETERMINISTIC_FALLBACK");
    expect(record.fallback?.fellBack).toBe(true);
    expect(record.fallback?.outcome).toBe("UNAVAILABLE");
    expect(path(record)).toEqual(HAPPY_PATH);
    expect(record.grant.requested).toBe(true);
    expect(resultOf(record)?.verification).toBe("CONFIRMED");
    expect(page.clicks).toBe(1);
  });

  it("falls back when the model returns something that is not a plan", async () => {
    const nonsense: ReasonerClient = {
      name: "local-model:test",
      transport: "LOOPBACK_HTTP",
      async propose() {
        return "here is your plan, boss";
      },
    };
    const { record } = await (async () => {
      const { page, ports } = withFallback(nonsense);
      return { record: await runTask(ports, RUN_OPTIONS), page };
    })();
    expect(record.fallback?.outcome).toBe("MALFORMED");
    expect(record.reasonerKind).toBe("DETERMINISTIC_FALLBACK");
    expect(resultOf(record)?.verification).toBe("CONFIRMED");
  });

  it("falls back when the model names an element that is not there", async () => {
    const { record, page } = await (async () => {
      const { page, ports } = withFallback(answering([{ op: "click", target: "#invented" }]));
      return { record: await runTask(ports, RUN_OPTIONS), page };
    })();
    // Incompetence, not hostility: the fallback is exactly what this is for.
    expect(record.fallback?.outcome).toBe("UNUSABLE");
    expect(record.reasonerKind).toBe("DETERMINISTIC_FALLBACK");
    expect(resultOf(record)?.verification).toBe("CONFIRMED");
    expect(page.clicks).toBe(1);
  });

  it("does NOT fall back when the model echoes a secret", async () => {
    // The rule the fallback policy exists for. Falling back here would replace a caught leakage
    // event with a success and leave nothing in the record to find.
    const { page, ports } = withFallback(answering([{ op: "insert", target: "#mobile_confirm", literal: DEMO.mobile }, { op: "click", target: "#submit" }]));
    const record = await runTask(ports, RUN_OPTIONS);

    expect(record.state).toBe("REFUSED");
    expect(record.refusal?.planRefusal?.literalCause).toBe("VAULT_LITERAL_ECHO");
    expect(record.fallback?.fellBack).toBe(false);
    expect(record.fallback?.outcome).toBe("HOSTILE");
    expect(record.rehydrated).toEqual([]);
    expect(page.clicks).toBe(0);
    expect(page.find("#mobile_confirm")?.value).toBe("");
    expect(JSON.stringify(record.refusal)).not.toContain(DEMO.mobile);
  });

  it("gives the model no way to widen what the agent may do", async () => {
    // Every one of these is refused, and none of them reaches a permit or a page.
    for (const steps of [
      [{ op: "type", target: "#mobile_confirm", literal: "x" }],
      [{ op: "execute_javascript", target: "#submit" }],
      [{ op: "navigate", target: "https://example.invalid" }],
      [{ op: "click", target: "#mobile_confirm" }, { op: "eval", target: "#submit" }],
    ]) {
      // No fallback at all here: the point is that the MODEL's plan reaches nothing, not that a
      // different plan rescued the run.
      const { page, ports } = withFallback(answering(steps), { insertFails: true });
      const { fallback: _unused, ...withoutFallback } = ports;
      const record = await runTask(withoutFallback, RUN_OPTIONS);
      expect(record.state, JSON.stringify(steps)).toBe("REFUSED");
      expect(page.clicks).toBe(0);
    }
  });

  it("gives the model no way to bypass the human, the binder or the permit", async () => {
    // A plan that is structurally perfect still stops at AWAIT_GRANT when the human says no.
    const { page, ports } = withFallback(answering(good), { grant: { granted: false, reason: "DENIED" } });
    const record = await runTask(ports, RUN_OPTIONS);
    expect(record.state).toBe("REFUSED");
    expect(record.refusal?.stage).toBe("AWAIT_GRANT");
    expect(record.rehydrated).toEqual([]);
    expect(record.confirmation).toBeNull();
    expect(page.clicks).toBe(0);
  });

  it("cannot reach a value, whatever it asks for", async () => {
    const { record } = await (async () => {
      const { page, ports } = withFallback(answering(good));
      return { record: await runTask(ports, RUN_OPTIONS), page };
    })();
    // The model's own record carries references and classes; the values are only in the local
    // observation, which is never sent.
    const serialized = JSON.stringify({ ...record, observation: null, initialObservation: null });
    for (const secret of [DEMO.mobile, DEMO.aadhaar, DEMO.name, DEMO.dob, DEMO.otp]) {
      expect(serialized, secret.slice(0, 4)).not.toContain(secret);
    }
  });
});
