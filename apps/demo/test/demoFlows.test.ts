/**
 * The three demo acts, driven through the real pipeline.
 *
 * WHAT IS REAL AND WHAT IS SUBSTITUTED. The sanitizer, the vault, the verifier, the plan parser, the
 * validator, the binder, the human grant, the permit gate and VERIFY RESULT are the shipped
 * implementations. Two things stand in: the browser (a simulated page, exactly as the orchestrator's
 * own suite uses) and the network (an in-process reasoner instead of loopback HTTP). Those two are
 * what `npm run demo` supplies for real, in Chrome for Testing, against a live model.
 *
 * WHY THIS SUITE EXISTS ANYWAY. The browser run needs a model, a browser and about a minute. This
 * runs in milliseconds in the ordinary gate, and it checks the one thing no other suite does: that
 * the expectations a judge is shown — `ACTS[id].expect` — are what the pipeline actually produces. If
 * someone relaxes an expectation so the demo "passes", these fail.
 */
import { runTask, type ClientPorts, type GrantDecision, type RunRecord } from "@pratibimb/orchestrator";
import { deterministicReasoner, unavailableReasoner, type ReasonerClient } from "@pratibimb/reasoner";
import { describe, expect, it } from "vitest";

import { ACTS } from "../src/demoScript.js";
import { headlineOf, sweep } from "../src/evidence.js";
import { DEMO, RUN_OPTIONS, SimulatedPage } from "../../../packages/orchestrator/test/support/simulatedPage.js";

/** Every value the simulated page holds, for the negative assertions. */
const SECRETS = [DEMO.name, DEMO.mobile, DEMO.aadhaar, DEMO.dob, DEMO.otp];

interface ActOptions {
  readonly reasoner: ReasonerClient;
  readonly reasonerKind?: "LOCAL_MODEL" | "DETERMINISTIC_FALLBACK";
  readonly grant?: GrantDecision;
}

const portsFor = (page: SimulatedPage, options: ActOptions): ClientPorts => ({
  observe: () => page.observe(),
  reasoner: options.reasoner,
  reasonerKind: options.reasonerKind ?? "LOCAL_MODEL",
  // The deterministic planner stays behind whatever answers first, exactly as the demo wires it.
  fallback: deterministicReasoner(),
  requestGrant: async () => options.grant ?? { granted: true },
  insert: (target, value) => page.insert(target, value),
  bridges: page.bridges,
});

const runOf = async (options: ActOptions): Promise<{ record: RunRecord; page: SimulatedPage }> => {
  const page = new SimulatedPage();
  const record = await runTask(portsFor(page, options), RUN_OPTIONS);
  return { record, page };
};

/** Stands in for the local model answering correctly over the network. */
const modelAnswers = () => deterministicReasoner();
/** Stands in for a compromised service answering with a value the client holds. */
const modelEchoesTheSecret = () => deterministicReasoner({ mode: "literal-echo", literal: DEMO.mobile });

describe("act one — the task completes", () => {
  it("reaches the state, verification and fallback the demo promises", async () => {
    const { record } = await runOf({ reasoner: modelAnswers() });
    const promised = ACTS.SUCCESS.expect;
    expect(record.state).toBe(promised.state);
    expect(record.act?.verification?.verification).toBe(promised.verification);
    expect(record.fallback?.fellBack ?? false).toBe(promised.fellBack);
    expect(record.rehydrated.length).toBe(promised.rehydrations);
  });

  it("restores exactly one value, locally, and clicks exactly once", async () => {
    const { record, page } = await runOf({ reasoner: modelAnswers() });
    expect(record.rehydrated).toHaveLength(1);
    expect(record.rehydrated[0]?.target).toBe("#mobile_confirm");
    expect(record.rehydrated[0]?.inserted).toBe(true);
    expect(page.clicks).toBe(1);
  });

  it("asks a human, and spends the grant", async () => {
    const { record } = await runOf({ reasoner: modelAnswers() });
    expect(record.grant.requested).toBe(true);
    expect(record.grant.decision?.granted).toBe(true);
    expect(record.grant.useGrant?.used).toBe(true);
    expect(record.confirmation).not.toBeNull();
  });

  it("reads the result back from the page rather than assuming it", async () => {
    const { record, page } = await runOf({ reasoner: modelAnswers() });
    expect(page.submitted).toBe(true);
    expect(record.act?.verification?.verification).toBe("CONFIRMED");
    expect(headlineOf(record)).toBe("CONFIRMED");
  });

  /** A denial is a human saying no, and it must stop everything the approval would have started. */
  it("does nothing at all if the human declines", async () => {
    const { record, page } = await runOf({ reasoner: modelAnswers(), grant: { granted: false, reason: "DENIED" } });
    expect(record.state).toBe("REFUSED");
    expect(record.rehydrated).toHaveLength(0);
    expect(page.clicks).toBe(0);
    expect(page.submitted).toBe(false);
  });
});

describe("act two — the reasoner returns the secret", () => {
  it("reaches the state and verification the demo promises, and no more", async () => {
    const { record } = await runOf({ reasoner: modelEchoesTheSecret() });
    const promised = ACTS.REFUSAL.expect;
    expect(record.state).toBe(promised.state);
    expect(record.act?.verification?.verification ?? null).toBe(promised.verification);
    expect(record.rehydrated.length).toBe(promised.rehydrations);
  });

  it("is refused by the privacy layer at plan validation, naming the echo", async () => {
    const { record } = await runOf({ reasoner: modelEchoesTheSecret() });
    expect(record.refusal?.stage).toBe("VALIDATE_PLAN");
    expect(record.refusal?.planRefusal?.literalCause).toBe("VAULT_LITERAL_ECHO");
    expect(record.refusal?.planRefusal?.literalSeverity).toBe("LEAKAGE_EVENT");
    expect(headlineOf(record)).toBe("LEAKAGE_BLOCKED");
  });

  it("executes nothing: no rehydration, no click, no submission, no confirmation", async () => {
    const { record, page } = await runOf({ reasoner: modelEchoesTheSecret() });
    expect(record.rehydrated).toHaveLength(0);
    expect(record.confirmation).toBeNull();
    expect(page.clicks).toBe(0);
    expect(page.submitted).toBe(false);
    expect(page.statusText).toBe("Not submitted");
  });

  /**
   * THE ASYMMETRY THAT MATTERS. A model that *failed* may be replaced by the deterministic planner.
   * A model that *misbehaved* may not — falling back here would turn a caught leakage event into a
   * successful run, which is the one outcome that would make the demo a lie.
   */
  it("does not quietly fall back into a plan that would have worked", async () => {
    const { record } = await runOf({ reasoner: modelEchoesTheSecret() });
    expect(record.fallback?.fellBack).toBe(false);
    expect(record.fallback?.outcome).toBe("HOSTILE");
  });

  /** The refusal is written to a file and shown on a projector. It must not carry the value. */
  it("never quotes the value it caught", async () => {
    const { record } = await runOf({ reasoner: modelEchoesTheSecret() });
    expect(sweep(record.refusal, SECRETS).clean).toBe(true);
    expect(sweep(record.plan, SECRETS).clean).toBe(true);
    expect(sweep(record.response, SECRETS).clean).toBe(true);
  });
});

describe("act three — the model is gone", () => {
  it("reaches the state, verification and fallback the demo promises", async () => {
    const { record } = await runOf({ reasoner: unavailableReasoner() });
    const promised = ACTS.OUTAGE.expect;
    expect(record.state).toBe(promised.state);
    expect(record.act?.verification?.verification).toBe(promised.verification);
    expect(record.fallback?.fellBack).toBe(promised.fellBack);
    expect(record.rehydrated.length).toBe(promised.rehydrations);
  });

  it("is answered by the deterministic planner, and says so", async () => {
    const { record } = await runOf({ reasoner: unavailableReasoner() });
    expect(record.reasonerKind).toBe("DETERMINISTIC_FALLBACK");
    expect(record.fallback?.outcome).toBe("UNAVAILABLE");
    expect(headlineOf(record)).toBe("CONFIRMED_VIA_FALLBACK");
  });

  /** The fallback is not a bypass. It is the same plan pipeline with a different author. */
  it("goes through validation, a human grant and the permit gate like any other plan", async () => {
    const { record, page } = await runOf({ reasoner: unavailableReasoner() });
    const reached = record.transitions.map((t) => t.to);
    expect(reached).toContain("VALIDATE_PLAN");
    expect(reached).toContain("AWAIT_GRANT");
    expect(reached).toContain("REHYDRATE");
    expect(reached).toContain("ACT");
    expect(record.grant.requested).toBe(true);
    expect(record.confirmation).not.toBeNull();
    expect(page.clicks).toBe(1);
  });

  it("still stops if the human declines", async () => {
    const { record, page } = await runOf({ reasoner: unavailableReasoner(), grant: { granted: false, reason: "DENIED" } });
    expect(record.state).toBe("REFUSED");
    expect(page.clicks).toBe(0);
  });
});

describe("nothing presentable carries a value, in any act", () => {
  it.each([
    ["success", () => modelAnswers()],
    ["refusal", () => modelEchoesTheSecret()],
    ["outage", () => unavailableReasoner()],
  ])("keeps the sanitized representation free of every local value — %s", async (_name, reasoner) => {
    const { record } = await runOf({ reasoner: reasoner() });
    expect(sweep(record.handoffSerialized ?? "", SECRETS).clean).toBe(true);
  });

  it.each([
    ["success", () => modelAnswers()],
    ["refusal", () => modelEchoesTheSecret()],
    ["outage", () => unavailableReasoner()],
  ])("keeps the ledger entry free of every local value — %s", async (_name, reasoner) => {
    const { record } = await runOf({ reasoner: reasoner() });
    expect(sweep(record.ledgerEntry, SECRETS).clean).toBe(true);
  });

  /**
   * The local observation is the documented exception: it is the reading of the user's own page, on
   * the user's own machine, and pane 2 shows it deliberately. Everything else must be clean.
   */
  it("keeps every part of the record clean except the local observation", async () => {
    const { record } = await runOf({ reasoner: modelAnswers() });
    const { initialObservation, observation, ...rest } = record;
    expect(sweep(rest, SECRETS).clean).toBe(true);
    expect(sweep(initialObservation, SECRETS).clean).toBe(false);
  });
});
