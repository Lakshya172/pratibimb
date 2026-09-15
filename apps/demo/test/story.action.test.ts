/**
 * Two small claims the upgraded screen makes, pinned against real runs: that the click is shown as
 * executed and verified only when the permit gate and the page both say so, and that the fallback
 * banner explains *why* the planner answered without inventing an outage.
 */
import { runTask, type ClientPorts, type RunRecord } from "@pratibimb/orchestrator";
import { deterministicReasoner, unavailableReasoner, type ReasonerClient } from "@pratibimb/reasoner";
import { describe, expect, it } from "vitest";

import { actionOf, IDLE, outcomeOf, type StoryInput } from "../src/story.js";
import { DEMO, RUN_OPTIONS, SimulatedPage } from "../../../packages/orchestrator/test/support/simulatedPage.js";

const portsFor = (page: SimulatedPage, reasoner: ReasonerClient): ClientPorts => ({
  observe: () => page.observe(),
  reasoner,
  reasonerKind: "LOCAL_MODEL",
  fallback: deterministicReasoner(),
  requestGrant: async () => ({ granted: true }),
  insert: (target, value) => page.insert(target, value),
  bridges: page.bridges,
});

const runWith = (reasoner: ReasonerClient): Promise<RunRecord> => runTask(portsFor(new SimulatedPage(), reasoner), RUN_OPTIONS);
const finished = (record: RunRecord): StoryInput => ({ ...IDLE, phase: "done", record });

/** A model that answers, but with something that is not a plan. Unusable — not unavailable. */
const unusableModel: ReasonerClient = {
  name: "local-model:test-unusable",
  transport: deterministicReasoner().transport,
  propose: async () => "here is your plan, boss",
};

describe("the action", () => {
  it("is executed and verified on a completed run, and names the control", async () => {
    expect(actionOf(finished(await runWith(deterministicReasoner())))).toEqual({
      state: "executed",
      targetLabel: "Submit application",
      verified: true,
    });
  });

  it("is not executed and not verified when the plan was refused", async () => {
    const record = await runWith(deterministicReasoner({ mode: "literal-echo", literal: DEMO.mobile }));
    expect(actionOf(finished(record))).toMatchObject({ state: "not-executed", verified: false });
  });

  it("is idle during the approval moment, naming the control the grant covers", () => {
    const live: StoryInput = {
      ...IDLE,
      phase: "approval",
      grant: {
        ref: "<PII:PHONE:1>",
        piiClass: "PHONE",
        target: "#mobile_confirm",
        targetLabel: "Confirm mobile number",
        fingerprint: "fp",
        origin: RUN_OPTIONS.origin,
        sessionId: RUN_OPTIONS.sessionId,
        purpose: "p",
        actionContext: "c",
        action: { target: "#submit", label: "Submit application" },
      },
    };
    expect(actionOf(live)).toEqual({ state: "idle", targetLabel: "Submit application", verified: false });
  });
});

describe("why the fallback answered", () => {
  it("says the model was unavailable when it was", async () => {
    expect(outcomeOf(finished(await runWith(unavailableReasoner()))).subtitle).toContain("The model was unavailable");
  });

  /** An earlier draft said "unavailable" here too — describing an outage that never happened. */
  it("says the plan was not usable when the model answered with nonsense", async () => {
    const record = await runWith(unusableModel);
    expect(record.fallback?.fellBack).toBe(true);
    const subtitle = outcomeOf(finished(record)).subtitle;
    expect(subtitle).toContain("not usable");
    expect(subtitle).not.toContain("unavailable");
  });
});
