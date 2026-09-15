/**
 * THE STORY MODEL — what the screen says, derived only from what the run actually produced.
 *
 * The Planning View now leads with a story a judge can follow in seconds: a task, a privacy boundary
 * with the device on one side and the reasoner on the other, a model that proposes, a client that
 * decides, a human who approves, a value restored locally, and a verified result. That is a lot of
 * confident language, so every sentence of it is computed here, as pure functions over the run's own
 * objects, and tested without a browser.
 *
 * THE RULE. Nothing here decides anything. Every status is read off something the pipeline did — a
 * transition it recorded, a refusal it issued, an egress record it wrote, a grant it requested. Where
 * the evidence is absent the model says so ("not claimed", "not reached") rather than rounding up to
 * the reassuring answer.
 *
 * THE ONE PLACE A VALUE MAY APPEAR is `BoundaryRow.localValue`: the trusted side of the boundary,
 * showing the user their own page on their own machine. Every other output of this file is checked by
 * test to contain none of the page's values.
 *
 * LIVE vs FINAL. During a run the screen is fed by read-only taps (`main.ts`): the first page
 * reading, the verified handoff the reasoner was given, and the grant the orchestrator requested. When
 * the run ends, the record replaces all of them. Both paths go through the same functions.
 */
import { type GrantRequest, type RunRecord, type RunState } from "@pratibimb/orchestrator";

import { headlineOf, sweep, type EgressAttempt } from "./evidence.js";

export type Observed = NonNullable<RunRecord["initialObservation"]>;
export type Handoff = NonNullable<RunRecord["handoff"]>;

/** Which reasoner the client asked. Recorded by a tap on `propose`, never inferred. */
export type Asked = "model" | "planner" | "fallback";

export interface StoryInput {
  readonly phase: "idle" | "running" | "approval" | "done";
  /** The finished run. When present it is the only source of truth. */
  readonly record: RunRecord | null;
  /** Live: the first reading of the page. */
  readonly observation: Observed | null;
  /** Live: the verified handoff exactly as it was passed to a reasoner. */
  readonly handoff: Handoff | null;
  /** Live: every reasoner the client asked, in order. */
  readonly asked: readonly Asked[];
  /** Live: the grant the orchestrator requested, which only happens after validation passed. */
  readonly grant: GrantRequest | null;
  /** Live: what the human answered, before the record exists. */
  readonly approved: boolean | null;
  readonly attempts: readonly EgressAttempt[];
}

export const IDLE: StoryInput = {
  phase: "idle",
  record: null,
  observation: null,
  handoff: null,
  asked: [],
  grant: null,
  approved: null,
  attempts: [],
};

const observationOf = (input: StoryInput): Observed | null => input.record?.initialObservation ?? input.observation;
const handoffOf = (input: StoryInput): Handoff | null => input.record?.handoff ?? input.handoff;
const localValuesOf = (input: StoryInput): string[] =>
  (observationOf(input)?.fields ?? []).map((f) => f.value).filter((v) => v.trim() !== "");

const labelFor = (observation: Observed | null, selector: string): string =>
  observation?.graph.nodes.find((n) => n.domRef.selector === selector)?.name || selector;

const titleCase = (raw: string): string => raw.charAt(0) + raw.slice(1).toLowerCase();

const CLASS_LABEL: Readonly<Record<string, string>> = {
  PHONE: "Phone",
  AADHAAR: "Aadhaar",
  DOB: "Date of birth",
  NAME: "Name",
  OTP: "OTP",
  EMAIL: "Email",
};
export const classLabel = (piiClass: string): string => CLASS_LABEL[piiClass] ?? titleCase(piiClass);

// ── the pipeline ─────────────────────────────────────────────────────────────────────────────

export const PIPELINE = ["OBSERVE", "SANITIZE", "REASON", "VALIDATE", "AUTHORIZE", "ACT", "VERIFY"] as const;
export type PipelineStep = (typeof PIPELINE)[number];
export type StepStatus = "done" | "current" | "pending" | "blocked";

/** Which story step each orchestrator state belongs to. The state machine itself is untouched. */
const STEP_OF: Readonly<Partial<Record<RunState, number>>> = {
  OBSERVE: 0,
  SANITIZE: 1,
  VERIFY_PAYLOAD: 1,
  SEND: 2,
  VALIDATE_PLAN: 3,
  AWAIT_GRANT: 4,
  REHYDRATE: 5,
  ACT: 5,
  VERIFY_RESULT: 6,
  DONE: 6,
};

const statuses = (doneBefore: number, at: number | null, atStatus: StepStatus): StepStatus[] =>
  PIPELINE.map((_, i) => (i < doneBefore ? "done" : i === at ? atStatus : "pending"));

export function pipelineOf(input: StoryInput): readonly { readonly step: PipelineStep; readonly status: StepStatus }[] {
  const zip = (list: StepStatus[]) => PIPELINE.map((step, i) => ({ step, status: list[i] ?? "pending" }));
  const record = input.record;

  if (record) {
    if (record.state === "DONE") return zip(PIPELINE.map(() => "done"));
    if (record.state === "REFUSED") {
      // The step it stopped in is the state it was in when it was refused — the `from` of the last
      // transition — not a guess from the cause.
      const last = record.transitions[record.transitions.length - 1];
      const at = last ? (STEP_OF[last.from] ?? 0) : 0;
      return zip(statuses(at, at, "blocked"));
    }
    const reached = Math.max(0, ...record.transitions.map((t) => STEP_OF[t.to] ?? 0));
    return zip(statuses(reached, reached, "current"));
  }

  switch (input.phase) {
    case "idle":
      return zip(PIPELINE.map(() => "pending"));
    case "approval":
      return zip(statuses(4, 4, "current"));
    default: {
      if (input.approved === true) return zip(statuses(5, 5, "current"));
      if (input.asked.length > 0) return zip(statuses(2, 2, "current"));
      if (input.observation) return zip(statuses(1, 1, "current"));
      return zip(statuses(0, 0, "current"));
    }
  }
}

// ── the task ─────────────────────────────────────────────────────────────────────────────────

export type Tone = "neutral" | "working" | "attention" | "success" | "blocked" | "fallback" | "warning";

export function taskStatusOf(input: StoryInput): { readonly label: string; readonly tone: Tone } {
  if (input.record) {
    switch (headlineOf(input.record)) {
      case "CONFIRMED":
        return { label: "Completed", tone: "success" };
      case "CONFIRMED_VIA_FALLBACK":
        return { label: "Completed · fallback", tone: "fallback" };
      case "LEAKAGE_BLOCKED":
        return { label: "Blocked", tone: "blocked" };
      case "REFUSED":
        return input.record.refusal?.stage === "AWAIT_GRANT"
          ? { label: "Not approved", tone: "warning" }
          : { label: "Stopped", tone: "blocked" };
      case "NOT_CONFIRMED":
        return { label: "Not verified", tone: "warning" };
      default:
        return { label: "Ready", tone: "neutral" };
    }
  }
  if (input.phase === "approval") return { label: "Waiting for approval", tone: "attention" };
  if (input.phase === "running") {
    if (input.approved === true) return { label: "Acting", tone: "working" };
    if (input.asked.length > 0) return { label: "Model is planning", tone: "working" };
    return { label: "Running", tone: "working" };
  }
  return { label: "Ready", tone: "neutral" };
}

// ── the boundary ─────────────────────────────────────────────────────────────────────────────

export interface BoundaryRow {
  readonly targetId: string;
  readonly label: string;
  readonly piiClass: string;
  readonly classLabel: string;
  readonly tier: string;
  /**
   * The real value — the ONE field in this module allowed to carry one. It is the trusted side of the
   * boundary: the user's own page, on the user's own machine.
   */
  readonly localValue: string;
  /** What crossed instead: an opaque reference, or `null` when the value was masked with none. */
  readonly token: string | null;
  /** The safe hint that crossed with it — length and kind, never content. */
  readonly hint: string;
  /** This row's class is the one a hostile reasoner handed back. */
  readonly echoed: boolean;
}

const hintText = (hint: { readonly len: number; readonly kind: string }): string => {
  switch (hint.kind) {
    case "numeric":
      return `${hint.len} digits`;
    case "alpha":
      return `${hint.len} letters`;
    case "date":
      return "a date";
    default:
      return `${hint.len} characters`;
  }
};

export function boundaryRowsOf(input: StoryInput): readonly BoundaryRow[] {
  const observation = observationOf(input);
  const handoff = handoffOf(input);
  if (!observation || !handoff) return [];
  const valueOf = new Map(observation.fields.map((f) => [f.id, f.value]));
  const refusal = input.record?.refusal?.planRefusal;
  const echoedClass = refusal?.literalSeverity === "LEAKAGE_EVENT" ? (refusal.piiClass ?? null) : null;

  return handoff.redactions.map((r) => ({
    targetId: r.targetId,
    label: labelFor(observation, r.targetId),
    piiClass: r.class,
    classLabel: classLabel(r.class),
    tier: titleCase(r.tier),
    localValue: valueOf.get(r.targetId) ?? "",
    token: r.token === "" ? null : r.token,
    hint: hintText(r.hint),
    echoed: echoedClass !== null && r.class === echoedClass,
  }));
}

// ── the model proposes ───────────────────────────────────────────────────────────────────────

export type ProposedStep =
  | { readonly kind: "fill-reference"; readonly targetLabel: string; readonly ref: string }
  /** A literal. Its text is never available here — only the class of what it was. */
  | { readonly kind: "fill-literal"; readonly targetLabel: string; readonly marker: string }
  | { readonly kind: "click"; readonly targetLabel: string };

export interface Proposal {
  readonly source: "LOCAL_MODEL" | "FALLBACK" | "PLANNER" | null;
  /** e.g. "Qwen2.5-0.5B", from the reasoner's recorded name. */
  readonly model: string | null;
  readonly transport: string | null;
  readonly steps: readonly ProposedStep[];
  /** The model was asked first and did not produce the plan that was used. */
  readonly modelFailed: "UNAVAILABLE" | "UNUSABLE" | null;
  readonly waiting: boolean;
}

const MODEL_NAME = /qwen2\.5-0\.5b/i;

const modelOutcomeOf = (input: StoryInput): Proposal["modelFailed"] => {
  const outcome = input.record?.fallback?.fellBack === true ? input.record.fallback.outcome : null;
  if (outcome === "UNAVAILABLE" || outcome === "TIMEOUT") return "UNAVAILABLE";
  if (outcome) return "UNUSABLE";
  if (!input.record && input.asked.includes("fallback")) {
    return input.attempts.some((a) => a.refusal?.stage === "TRANSPORT") ? "UNAVAILABLE" : "UNUSABLE";
  }
  return null;
};

export function proposalOf(input: StoryInput): Proposal {
  const observation = observationOf(input);
  const record = input.record;
  const modelFailed = modelOutcomeOf(input);

  const fromKind = (kind: RunRecord["reasonerKind"]): Proposal["source"] =>
    kind === "LOCAL_MODEL" ? "LOCAL_MODEL" : kind === "DETERMINISTIC_FALLBACK" ? (modelFailed ? "FALLBACK" : "PLANNER") : null;

  const sentName = input.attempts.find((a) => a.record)?.record?.reasoner ?? null;
  const response = record?.response && record.response.received ? record.response : null;
  const name = response?.reasoner ?? sentName;
  const model = name && MODEL_NAME.test(name) ? "Qwen2.5-0.5B" : null;
  const transport = response?.transport ?? (sentName ? "LOOPBACK_HTTP" : null);

  if (record?.plan) {
    return {
      source: fromKind(record.reasonerKind),
      model: record.reasonerKind === "LOCAL_MODEL" ? model : null,
      transport,
      modelFailed,
      waiting: false,
      steps: record.plan.steps.map((s): ProposedStep =>
        s.op === "click"
          ? { kind: "click", targetLabel: labelFor(observation, s.target) }
          : s.ref
            ? { kind: "fill-reference", targetLabel: labelFor(observation, s.target), ref: s.ref }
            : { kind: "fill-literal", targetLabel: labelFor(observation, s.target), marker: s.literalMarker ?? "" }
      ),
    };
  }

  if (input.grant) {
    const last = input.asked[input.asked.length - 1] ?? null;
    return {
      source: last === "model" ? "LOCAL_MODEL" : last === "fallback" ? "FALLBACK" : last === "planner" ? "PLANNER" : null,
      model: last === "model" ? model : null,
      transport: last === "model" ? transport : null,
      modelFailed,
      waiting: false,
      steps: [
        { kind: "fill-reference", targetLabel: input.grant.targetLabel, ref: input.grant.ref },
        { kind: "click", targetLabel: input.grant.action.label },
      ],
    };
  }

  return { source: null, model: null, transport: null, steps: [], modelFailed, waiting: input.asked.length > 0 && !record };
}

// ── the client decides ───────────────────────────────────────────────────────────────────────

export interface Decision {
  readonly verdict: "idle" | "waiting" | "allowed" | "blocked" | "refused" | "no-plan";
  readonly title: string;
  readonly reason: string;
}

const CAUSE_TEXT: Readonly<Record<string, string>> = {
  DENIED: "You declined the request.",
  DISMISSED: "The approval prompt was dismissed.",
  UNAVAILABLE: "No one could be asked for approval.",
  NO_EXECUTABLE_STEP: "The plan proposes no action.",
  NOT_A_PARSED_PLAN: "The reasoner's answer is not a plan this client can read.",
};
const humanCause = (cause: string): string => CAUSE_TEXT[cause] ?? `${titleCase(cause.replace(/_/g, " "))}.`;

export function decisionOf(input: StoryInput): Decision {
  const record = input.record;
  if (record) {
    const refusal = record.refusal;
    const planRefusal = refusal?.planRefusal;
    if (refusal && (refusal.stage === "VALIDATE_PLAN" || refusal.stage === "PARSE_PLAN")) {
      if (planRefusal?.literalSeverity === "LEAKAGE_EVENT") {
        return {
          verdict: "blocked",
          title: "Blocked",
          reason: `Protected local value detected. The model returned a ${classLabel(planRefusal.piiClass ?? "protected").toLowerCase()} value this device holds and never sent.`,
        };
      }
      return { verdict: "refused", title: "Refused", reason: humanCause(planRefusal?.literalCause ?? planRefusal?.bindCause ?? refusal.cause) };
    }
    if (record.validation?.ok) {
      return { verdict: "allowed", title: "Allowed", reason: "The plan passed validation on this device." };
    }
    if (refusal && (refusal.stage === "SEND" || refusal.stage === "OBSERVE" || refusal.stage === "SANITIZE" || refusal.stage === "VERIFY_PAYLOAD")) {
      return { verdict: "no-plan", title: "No plan", reason: "Nothing reached the client to decide on." };
    }
    return { verdict: "idle", title: "", reason: "" };
  }
  // A grant is requested only after VALIDATE_PLAN has passed, so its existence is the evidence.
  if (input.grant) return { verdict: "allowed", title: "Allowed", reason: "The plan passed validation on this device." };
  if (input.phase === "running" && input.asked.length > 0) {
    return { verdict: "waiting", title: "Waiting", reason: "Waiting for the model's proposal." };
  }
  return { verdict: "idle", title: "", reason: "" };
}

// ── the human ────────────────────────────────────────────────────────────────────────────────

export interface Approval {
  readonly state: "idle" | "requested" | "approved" | "declined" | "not-requested" | "not-needed";
  readonly valueLabel: string | null;
  readonly ref: string | null;
  readonly targetLabel: string | null;
  readonly actionLabel: string | null;
  readonly spent: boolean | null;
  readonly reason: string | null;
}

export function approvalOf(input: StoryInput): Approval {
  const none = { valueLabel: null, ref: null, targetLabel: null, actionLabel: null, spent: null, reason: null };
  const record = input.record;
  if (record) {
    const g = record.grant;
    const ref = g.useGrant?.ref ?? null;
    if (g.requested && g.decision?.granted) {
      return {
        ...none,
        state: "approved",
        ref,
        valueLabel: g.useGrant ? classLabel(g.useGrant.piiClass) : null,
        spent: g.useGrant?.used ?? null,
      };
    }
    if (g.requested) {
      return { ...none, state: "declined", reason: g.decision && !g.decision.granted ? humanCause(g.decision.reason) : null };
    }
    return { ...none, state: record.state === "REFUSED" ? "not-requested" : "not-needed" };
  }
  if (input.grant) {
    return {
      state: input.approved === true ? "approved" : input.approved === false ? "declined" : "requested",
      valueLabel: classLabel(input.grant.piiClass),
      ref: input.grant.ref,
      targetLabel: input.grant.targetLabel,
      actionLabel: input.grant.action.label,
      spent: null,
      reason: null,
    };
  }
  return { ...none, state: "idle" };
}

// ── restoration ──────────────────────────────────────────────────────────────────────────────

export interface Restoration {
  readonly state: "idle" | "restoring" | "restored" | "none";
  readonly items: readonly { readonly ref: string; readonly targetLabel: string; readonly classLabel: string; readonly inserted: boolean }[];
}

export function restorationOf(input: StoryInput): Restoration {
  const record = input.record;
  if (record) {
    if (record.rehydrated.length === 0) return { state: "none", items: [] };
    const observation = observationOf(input);
    return {
      state: "restored",
      items: record.rehydrated.map((r) => ({
        ref: r.ref,
        targetLabel: labelFor(observation, r.target),
        classLabel: classLabel(r.piiClass),
        inserted: r.inserted,
      })),
    };
  }
  return { state: input.approved === true ? "restoring" : "idle", items: [] };
}

// ── the outcome ──────────────────────────────────────────────────────────────────────────────

export interface Check {
  readonly ok: boolean;
  readonly text: string;
}

export interface Outcome {
  readonly kind: "none" | "completed" | "completed-fallback" | "blocked" | "stopped" | "unverified";
  readonly title: string;
  readonly subtitle: string;
  readonly checks: readonly Check[];
}

/** Every privacy claim the success banner makes, each tied to a specific piece of evidence. */
const privacyHeld = (input: StoryInput): boolean => {
  const record = input.record;
  if (!record) return false;
  const sent = input.attempts.filter((a) => a.record);
  const sentClean = sent.every((a) => a.record?.leakCheck === "CLEAN" && a.record.verified === true);
  const handoffClean = sweep(record.handoffSerialized ?? "", localValuesOf(input)).clean;
  return record.ledgerEntry?.verified === true && sentClean && handoffClean;
};

export function outcomeOf(input: StoryInput): Outcome {
  const record = input.record;
  if (!record) return { kind: "none", title: "", subtitle: "", checks: [] };

  const pageSays = record.observation?.statusText?.trim();
  const verified = record.act?.verification?.verification === "CONFIRMED";
  const nothingRestored: Check = { ok: record.rehydrated.length === 0, text: "No value restored" };
  const nothingExecuted: Check = { ok: record.act === null, text: "No action executed" };

  switch (headlineOf(record)) {
    case "CONFIRMED":
      return {
        kind: "completed",
        title: "Task completed",
        subtitle: pageSays ? `The page reports “${pageSays}”.` : "The result was read back from the page.",
        checks: [
          { ok: privacyHeld(input), text: "Privacy checks passed" },
          { ok: verified, text: "Action verified" },
        ],
      };
    case "CONFIRMED_VIA_FALLBACK": {
      const path = record.transitions.map((t) => t.to);
      const sameGates = path.includes("VALIDATE_PLAN") && path.includes("AWAIT_GRANT") && path.includes("ACT");
      // The fallback also answers a model whose plan was merely unusable. Saying "unavailable" there
      // would describe an outage that did not happen.
      const outcome = record.fallback?.outcome;
      const why = outcome === "UNAVAILABLE" || outcome === "TIMEOUT" ? "The model was unavailable" : "The model's plan was not usable";
      return {
        kind: "completed-fallback",
        title: "Task completed",
        subtitle: pageSays
          ? `${why}, so the deterministic planner finished. The page reports “${pageSays}”.`
          : `${why}, so the deterministic planner finished.`,
        checks: [
          { ok: privacyHeld(input), text: "Privacy checks passed" },
          { ok: sameGates, text: "Same validation, approval and action gates" },
          { ok: verified, text: "Action verified" },
        ],
      };
    }
    case "LEAKAGE_BLOCKED":
      return {
        kind: "blocked",
        title: "Blocked",
        subtitle: "The model tried to return a protected value. PratiBimb stopped it.",
        checks: [
          nothingRestored,
          nothingExecuted,
          { ok: record.fallback?.fellBack !== true, text: "No quiet fallback to a working plan" },
        ],
      };
    case "REFUSED":
      return {
        kind: "stopped",
        title: "Stopped safely",
        subtitle: humanCause(record.refusal?.planRefusal?.literalCause ?? record.refusal?.cause ?? ""),
        checks: [nothingRestored, nothingExecuted],
      };
    case "NOT_CONFIRMED":
      return {
        kind: "unverified",
        title: "Not verified",
        subtitle: "The action ran, but the page did not confirm the result.",
        checks: [{ ok: false, text: "Action verified" }],
      };
    default:
      return { kind: "none", title: "", subtitle: "", checks: [] };
  }
}

// ── what left the device ─────────────────────────────────────────────────────────────────────

export interface Leaving {
  readonly state: "idle" | "sent" | "not-delivered" | "blocked" | "local";
  readonly title: string;
  readonly note: string;
  readonly checks: readonly (Check & { readonly detail: string; readonly neutral?: boolean })[];
  readonly proof: {
    readonly destination: string;
    readonly bytes: number;
    readonly clientSha256: string;
    readonly peerSha256: string | null;
    readonly agrees: boolean | null;
  } | null;
}

export function leavingOf(input: StoryInput): Leaving {
  const sent = input.attempts.find((a) => a.record)?.record ?? null;
  const refused = input.attempts.find((a) => a.refusal)?.refusal ?? null;
  const handoff = input.record?.handoffSerialized ?? handoffOf(input);
  const contextClean = handoff !== null && sweep(handoff, localValuesOf(input)).clean;

  if (sent) {
    const agrees = sent.peerReceipt?.agrees ?? null;
    return {
      state: "sent",
      title: "Data leaving device",
      note: "Only what is listed here crossed the boundary.",
      checks: [
        { ok: sent.references.length > 0, text: "Sanitized references", detail: `${sent.references.length} opaque references` },
        { ok: contextClean, text: "Safe context only", detail: "Field names, types and lengths" },
        { ok: sent.verified === true, text: "Verified payload", detail: "Built from a verified handoff" },
        { ok: sent.leakCheck === "CLEAN", text: "No raw sensitive values", detail: "Scanned against this device's values before sending" },
        agrees === null
          ? { ok: true, neutral: true, text: "Receiving service digest", detail: "Not claimed by the service" }
          : { ok: agrees, text: "Receiving service agrees", detail: agrees ? "Same SHA-256 on both sides" : "Digests differ" },
      ],
      proof: {
        destination: sent.destination,
        bytes: sent.payloadBytes,
        clientSha256: sent.payloadSha256,
        peerSha256: sent.peerReceipt?.sha256 ?? null,
        agrees,
      },
    };
  }

  if (refused) {
    if (refused.stage === "TRANSPORT") {
      // Stage TRANSPORT means verification, destination, token and value checks had all passed:
      // the guard only attempts a send after every one of them.
      return {
        state: "not-delivered",
        title: "Model unreachable",
        note: "The request was checked and attempted, and the model service did not answer.",
        checks: [
          { ok: true, text: "Verified payload", detail: "Passed every check before the attempt" },
          { ok: true, text: "No raw sensitive values", detail: "Scanned before the attempt" },
          { ok: false, neutral: true, text: "Not delivered", detail: refused.cause === "TRANSPORT_TIMEOUT" ? "The service timed out" : "Connection refused" },
        ],
        proof: null,
      };
    }
    return {
      state: "blocked",
      title: "Blocked before sending",
      note: "The egress guard refused the request, so no bytes left this device.",
      checks: [{ ok: true, text: "Request stopped", detail: humanCause(refused.cause) }],
      proof: null,
    };
  }

  const transport = input.record?.response?.received ? input.record.response.transport : null;
  if (input.record && transport === "IN_PROCESS") {
    return {
      state: "local",
      title: "No network request",
      note: "The planner ran on this device.",
      checks: [{ ok: contextClean, text: "Safe context only", detail: "Field names, types and lengths" }],
      proof: null,
    };
  }

  return { state: "idle", title: "Data leaving device", note: "Nothing has left this device yet.", checks: [], proof: null };
}

// ── the action ───────────────────────────────────────────────────────────────────────────────

export interface ActionSummary {
  readonly state: "idle" | "executed" | "not-executed";
  readonly targetLabel: string | null;
  /** `VERIFY RESULT` said CONFIRMED. Nothing short of that counts. */
  readonly verified: boolean;
}

/** The click, as the permit gate reported it and the page confirmed it. */
export function actionOf(input: StoryInput): ActionSummary {
  const record = input.record;
  const observation = observationOf(input);
  const click = record?.plan?.steps.find((s) => s.op === "click");
  const targetLabel = click ? labelFor(observation, click.target) : (input.grant?.action.label ?? null);
  if (!record) return { state: "idle", targetLabel, verified: false };
  return {
    state: record.act?.result?.status === "EXECUTED" ? "executed" : "not-executed",
    targetLabel,
    verified: record.act?.verification?.verification === "CONFIRMED",
  };
}

// ── who is trusted with what ─────────────────────────────────────────────────────────────────

/**
 * Capabilities, as implemented — each backed by a tested property, none aspirational.
 *
 * Client: the vault is memory-only and client-side; the human grant and the permit gate are the only
 * authorisation; `rehydrate` restores locally; `guardedAct` is the only dispatch. Reasoner: it receives
 * a verified handoff, returns `unknown`, and `EXECUTABLE_ACTIONS` is `["click"]` issued by the client.
 */
export const TRUST = {
  client: ["Holds your private values", "Controls authorization", "Restores values locally", "Executes the final action"],
  reasonerCan: ["Receives safe context", "Proposes a plan"],
  reasonerCannot: ["Never receives your values", "Cannot authorize itself", "Cannot execute actions directly"],
} as const;
