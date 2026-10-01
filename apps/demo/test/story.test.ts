/**
 * The story model, checked against real runs.
 *
 * The upgraded Planning View says confident things — "Allowed", "Blocked", "Task completed",
 * "No raw sensitive values". Every one of those words comes from `story.ts`, so this suite drives the
 * three acts through the real pipeline (the same harness `demoFlows.test.ts` uses) and asserts that
 * the story matches what actually happened, and that no part of it except the trusted side of the
 * boundary carries a value.
 */
import { runTask, type ClientPorts, type GrantDecision, type RunRecord } from "@pratibimb/orchestrator";
import { deterministicReasoner, unavailableReasoner, type ReasonerClient } from "@pratibimb/reasoner";
import { describe, expect, it } from "vitest";

import { sweep, type EgressAttempt } from "../src/evidence.js";
import {
  approvalOf,
  boundaryRowsOf,
  decisionOf,
  IDLE,
  leavingOf,
  outcomeOf,
  pipelineOf,
  proposalOf,
  restorationOf,
  taskStatusOf,
  TRUST,
  type StoryInput,
} from "../src/story.js";
import { DEMO, RUN_OPTIONS, SimulatedPage } from "../../../packages/orchestrator/test/support/simulatedPage.js";

const SECRETS = [DEMO.name, DEMO.mobile, DEMO.aadhaar, DEMO.dob, DEMO.otp];

const portsFor = (page: SimulatedPage, reasoner: ReasonerClient, kind: "LOCAL_MODEL" | "DETERMINISTIC_FALLBACK", grant?: GrantDecision): ClientPorts => ({
  observe: () => page.observe(),
  reasoner,
  reasonerKind: kind,
  fallback: deterministicReasoner(),
  requestGrant: async () => grant ?? { granted: true },
  insert: (target, value) => page.insert(target, value),
  bridges: page.bridges,
});

const finished = (record: RunRecord, attempts: readonly EgressAttempt[] = []): StoryInput => ({ ...IDLE, phase: "done", record, attempts });

const act = async (reasoner: ReasonerClient, grant?: GrantDecision): Promise<RunRecord> =>
  runTask(portsFor(new SimulatedPage(), reasoner, "LOCAL_MODEL", grant), RUN_OPTIONS);

const success = () => act(deterministicReasoner());
const refusal = () => act(deterministicReasoner({ mode: "literal-echo", literal: DEMO.mobile }));
const outage = () => act(unavailableReasoner());

/** Everything the story shows except the trusted side's values. */
const everythingButTheLocalValues = (input: StoryInput) => ({
  pipeline: pipelineOf(input),
  status: taskStatusOf(input),
  rows: boundaryRowsOf(input).map(({ localValue: _local, ...rest }) => rest),
  proposal: proposalOf(input),
  decision: decisionOf(input),
  approval: approvalOf(input),
  restoration: restorationOf(input),
  outcome: outcomeOf(input),
  leaving: leavingOf(input),
});

describe("before anything runs", () => {
  it("shows a ready task, a pending pipeline and an empty boundary", () => {
    expect(taskStatusOf(IDLE)).toEqual({ label: "Ready", tone: "neutral" });
    expect(pipelineOf(IDLE).every((s) => s.status === "pending")).toBe(true);
    expect(boundaryRowsOf(IDLE)).toEqual([]);
    expect(outcomeOf(IDLE).kind).toBe("none");
    expect(decisionOf(IDLE).verdict).toBe("idle");
  });
});

describe("act one — the story of a completed task", () => {
  it("walks every pipeline step to done", async () => {
    const story = finished(await success());
    expect(pipelineOf(story).map((s) => s.status)).toEqual(Array(7).fill("done"));
    expect(taskStatusOf(story)).toEqual({ label: "Completed", tone: "success" });
  });

  it("puts each real value on the device side and only a reference on the reasoner side", async () => {
    const rows = boundaryRowsOf(finished(await success()));
    const phone = rows.find((r) => r.piiClass === "PHONE");
    expect(phone?.localValue).toBe(DEMO.mobile);
    expect(phone?.token).toBe("<PII:PHONE:1>");
    expect(phone?.hint).toBe("10 digits");
    expect(phone?.label).toBe("Mobile number");
  });

  it("shows the OTP with no reference at all", async () => {
    const otp = boundaryRowsOf(finished(await success())).find((r) => r.piiClass === "OTP");
    expect(otp?.token).toBeNull();
    expect(otp?.localValue).toBe(DEMO.otp);
  });

  it("says the model proposed a reference, the client allowed it, and a human approved once", async () => {
    const story = finished(await success());
    expect(proposalOf(story).steps).toEqual([
      { kind: "fill-reference", targetLabel: "Confirm mobile number", ref: "<PII:PHONE:1>" },
      { kind: "click", targetLabel: "Submit application" },
    ]);
    expect(decisionOf(story).verdict).toBe("allowed");
    expect(approvalOf(story)).toMatchObject({ state: "approved", ref: "<PII:PHONE:1>", valueLabel: "Phone", spent: true });
    expect(restorationOf(story)).toEqual({
      state: "restored",
      items: [{ ref: "<PII:PHONE:1>", targetLabel: "Confirm mobile number", classLabel: "Phone", inserted: true }],
    });
  });

  it("claims completion only with the page's own words and passing checks", async () => {
    const outcome = outcomeOf(finished(await success()));
    expect(outcome.kind).toBe("completed");
    expect(outcome.subtitle).toContain("Application submitted");
    expect(outcome.checks).toEqual([
      { ok: true, text: "Privacy checks passed" },
      { ok: true, text: "Action verified" },
    ]);
  });

  /** The declined path must not borrow any of the success path's reassurance. */
  it("tells a declined approval apart from a completed task", async () => {
    const story = finished(await act(deterministicReasoner(), { granted: false, reason: "DENIED" }));
    expect(taskStatusOf(story).label).toBe("Not approved");
    expect(approvalOf(story).state).toBe("declined");
    expect(outcomeOf(story).kind).toBe("stopped");
    expect(outcomeOf(story).checks.every((c) => c.ok)).toBe(true);
    expect(restorationOf(story).state).toBe("none");
  });
});

describe("act two — the story of a blocked leak", () => {
  it("stops the pipeline at VALIDATE and marks nothing after it as done", async () => {
    const steps = pipelineOf(finished(await refusal()));
    expect(steps.map((s) => s.status)).toEqual(["done", "done", "done", "blocked", "pending", "pending", "pending"]);
  });

  it("says Blocked, names protected-value detection, and shows the literal only as a class marker", async () => {
    const story = finished(await refusal());
    expect(decisionOf(story).verdict).toBe("blocked");
    expect(decisionOf(story).reason).toContain("Protected local value detected");
    expect(proposalOf(story).steps[0]).toEqual({ kind: "fill-literal", targetLabel: "Confirm mobile number", marker: "⟨literal:PHONE⟩" });
    expect(taskStatusOf(story)).toEqual({ label: "Blocked", tone: "blocked" });
  });

  it("points at the device-side row whose value came back, without repeating the value anywhere else", async () => {
    const rows = boundaryRowsOf(finished(await refusal()));
    expect(rows.filter((r) => r.echoed).map((r) => r.piiClass)).toEqual(["PHONE"]);
  });

  it("reports the protection as held: nothing restored, nothing executed, no quiet fallback", async () => {
    const outcome = outcomeOf(finished(await refusal()));
    expect(outcome.kind).toBe("blocked");
    expect(outcome.checks).toEqual([
      { ok: true, text: "No value restored" },
      { ok: true, text: "No action executed" },
      { ok: true, text: "No quiet fallback to a working plan" },
    ]);
  });

  it("never shows an approval that was never requested", async () => {
    expect(approvalOf(finished(await refusal())).state).toBe("not-requested");
  });
});

describe("act three — the story of a model outage", () => {
  it("says the fallback finished, through the same gates", async () => {
    const story = finished(await outage());
    const outcome = outcomeOf(story);
    expect(outcome.kind).toBe("completed-fallback");
    expect(outcome.checks.every((c) => c.ok)).toBe(true);
    expect(outcome.checks.map((c) => c.text)).toContain("Same validation, approval and action gates");
    expect(taskStatusOf(story).tone).toBe("fallback");
  });

  it("names the deterministic fallback as the author and the model as unavailable", async () => {
    const proposal = proposalOf(finished(await outage()));
    expect(proposal.source).toBe("FALLBACK");
    expect(proposal.modelFailed).toBe("UNAVAILABLE");
  });
});

describe("the live moments, before the record exists", () => {
  it("advances the pipeline only on events that actually happened", async () => {
    const record = await success();
    const observation = record.initialObservation;
    const handoff = record.handoff;
    const statusAt = (input: StoryInput) => pipelineOf(input).findIndex((s) => s.status === "current");

    expect(statusAt({ ...IDLE, phase: "running" })).toBe(0);
    expect(statusAt({ ...IDLE, phase: "running", observation })).toBe(1);
    expect(statusAt({ ...IDLE, phase: "running", observation, handoff, asked: ["model"] })).toBe(2);
  });

  /**
   * The orchestrator requests a grant only after VALIDATE_PLAN has passed. So a live grant request is
   * itself the evidence for "allowed" — and the story must say exactly that, no earlier.
   */
  it("says Allowed at the approval moment because the grant request is the evidence", async () => {
    const record = await success();
    const grant = {
      ref: "<PII:PHONE:1>",
      piiClass: "PHONE" as const,
      target: "#mobile_confirm",
      targetLabel: "Confirm mobile number",
      fingerprint: "fp",
      origin: RUN_OPTIONS.origin,
      sessionId: RUN_OPTIONS.sessionId,
      purpose: "p",
      actionContext: "c",
      action: { target: "#submit", label: "Submit application" },
    };
    const live: StoryInput = { ...IDLE, phase: "approval", observation: record.initialObservation, handoff: record.handoff, asked: ["model"], grant };
    expect(decisionOf(live).verdict).toBe("allowed");
    expect(approvalOf(live).state).toBe("requested");
    expect(taskStatusOf(live)).toEqual({ label: "Waiting for approval", tone: "attention" });
    expect(pipelineOf(live).find((s) => s.status === "current")?.step).toBe("AUTHORIZE");
    expect(boundaryRowsOf(live).length).toBeGreaterThan(0);
    // Waiting for a model that has not answered is not an allowance.
    expect(decisionOf({ ...live, grant: null, phase: "running" }).verdict).toBe("waiting");
  });
});

describe("what left the device", () => {
  const sent = (over: Record<string, unknown> = {}): EgressAttempt => ({
    record: {
      requestId: "r",
      sessionId: "s",
      at: 0,
      destination: "http://127.0.0.1:8978/v1/chat/completions",
      transport: "LOOPBACK_HTTP",
      reasoner: "local-model:qwen2.5-0.5b-instruct-q4_k_m",
      verified: true,
      payloadSha256: "a".repeat(64),
      payloadBytes: 2679,
      leakCheck: "CLEAN",
      references: ["<PII:NAME:1>", "<PII:PHONE:1>"],
      responseStatus: 200,
      responseBytes: 10,
      elapsedMs: 500,
      ...over,
    } as EgressAttempt["record"],
  });

  it("lists every check as passed only when the egress record says so", async () => {
    const leaving = leavingOf(finished(await success(), [sent({ peerReceipt: { sha256: "a".repeat(64), bytes: 2679, agrees: true } })]));
    expect(leaving.state).toBe("sent");
    expect(leaving.checks.map((c) => [c.text, c.ok])).toEqual([
      ["Sanitized references", true],
      ["Safe context only", true],
      ["Verified payload", true],
      ["No raw sensitive values", true],
      ["Receiving service agrees", true],
    ]);
    expect(leaving.proof?.bytes).toBe(2679);
  });

  /** Absence of a cross-check is not a failed one, and must not be drawn as a red cross. */
  it("shows a silent receiving service as not claimed, not as a failure", async () => {
    const check = leavingOf(finished(await success(), [sent()])).checks.at(-1);
    expect(check).toMatchObject({ neutral: true, text: "Receiving service digest", detail: "Not claimed by the service" });
  });

  it("does not claim nothing left when a send was attempted and failed", async () => {
    const leaving = leavingOf(
      finished(await outage(), [
        {
          refusal: {
            requestId: "r",
            sessionId: "s",
            at: 0,
            destination: "http://127.0.0.1:8989/",
            cause: "TRANSPORT_FAILED",
            stage: "TRANSPORT",
            severity: "REFUSED",
            detail: "the request could not be completed.",
          },
        },
      ])
    );
    expect(leaving.state).toBe("not-delivered");
    expect(leaving.title).toBe("Model unreachable");
    expect(JSON.stringify(leaving).toLowerCase()).not.toContain("nothing left");
  });

  it("says no network request for an in-process planner", async () => {
    const record = await runTask(portsFor(new SimulatedPage(), deterministicReasoner(), "DETERMINISTIC_FALLBACK"), RUN_OPTIONS);
    expect(leavingOf(finished(record)).state).toBe("local");
  });
});

describe("nothing but the trusted side carries a value", () => {
  it.each([
    ["success", success],
    ["refusal", refusal],
    ["outage", outage],
  ])("keeps every non-local part of the story clean — %s", async (_name, run) => {
    const story = finished(await run());
    const result = sweep(everythingButTheLocalValues(story), SECRETS);
    expect(result.clean).toBe(true);
    expect(result.complete).toBe(true);
  });

  it("makes no claim about the reasoner that the implementation does not enforce", () => {
    expect(TRUST.reasonerCannot).toEqual(["Never receives your values", "Cannot authorize itself", "Cannot execute actions directly"]);
    const all = JSON.stringify(TRUST).toLowerCase();
    for (const overclaim of ["100%", "perfect", "guarantee", "production", "extension", "firefox", "any browser"]) {
      expect(all).not.toContain(overclaim);
    }
  });
});
