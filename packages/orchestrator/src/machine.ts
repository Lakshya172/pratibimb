/**
 * THE ORCHESTRATOR — one task, once, through every gate, and nothing after a refusal.
 *
 *   IDLE → OBSERVE → SANITIZE → VERIFY_PAYLOAD → SEND → VALIDATE_PLAN → AWAIT_GRANT
 *        → REHYDRATE → ACT → VERIFY_RESULT → DONE
 *                                     ╰──────── any refusal ────────→ REFUSED (terminal)
 *
 * WHAT THIS IS NOT. Not an agent loop. It does not retry, recover, choose a target, plan a second
 * step, or decide what to do next. It runs one pre-stated task against one page and reports exactly
 * how far it got and why it stopped. Every capability it has was injected (`ports.ts`), so the list
 * of things it could possibly do is finite and visible.
 *
 * FOUR PROPERTIES WORTH READING THE FILE FOR.
 *
 * 1. **Each stage owns its own authority and borrows none.** SANITIZE and the vault are
 *    `@pratibimb/privacy`. Plan structure is `@pratibimb/plan`. Whether a reference may become a
 *    value is `bind`/`rehydrate`, asked through the validator. Whether the click may happen is
 *    `guardedAct`. This file sequences them; it decides nothing they decide.
 * 2. **REHYDRATE does not act.** Restoring the value and clicking the button are different stages
 *    with different gates. The value goes into the page through the trusted `insert` port; the click
 *    goes through `guardedAct` and through nothing else. This file contains no dispatch of any kind.
 * 3. **REFUSED is terminal, structurally.** Every refusal `return`s, so the code after it is
 *    unreachable — the same shape `guardedAct` uses. The transition recorder additionally refuses to
 *    record anything after REFUSED or DONE, so a future edit that tried to continue would be caught
 *    by a test rather than by a reviewer.
 * 4. **Uncertainty is never upgraded.** VERIFY RESULT's answer is reported as it comes. `UNKNOWN` is
 *    not success, `NOT_CONFIRMED` is not success, and `DONE` means the run completed — never that the
 *    action worked. `succeeded()` is the only thing that claims that, and it asks the verifier.
 */
import {
  guardedAct,
  recordHumanConfirmation,
  type GuardedOutcome,
  type HumanConfirmation,
  type ProposedAction,
} from "@pratibimb/agent";
import { cssPx, type ElementNode } from "@pratibimb/perception";
import {
  classOriginKey,
  fingerprintOf,
  findUseGrant,
  isVerifiedHandoff,
  rehydrate,
  sanitize,
  serializeHandoff,
  type BindView,
  type LedgerEntry,
  type UseGrant,
  type VerifiedHandoff,
  type ViewField,
} from "@pratibimb/privacy";
import {
  parsePlan,
  redactPlan,
  validatePlan,
  type PlanRefusal,
  type PlanValidation,
  type SafePlan,
  type ValidatedInsert,
} from "@pratibimb/plan";
import { sendToReasoner, type ReasonerResponse } from "@pratibimb/reasoner";

import { type ClientPorts, type GrantDecision, type Observation } from "./ports.js";

export type RunState =
  | "IDLE"
  | "OBSERVE"
  | "SANITIZE"
  | "VERIFY_PAYLOAD"
  | "SEND"
  | "VALIDATE_PLAN"
  | "AWAIT_GRANT"
  | "REHYDRATE"
  | "ACT"
  | "VERIFY_RESULT"
  | "DONE"
  | "REFUSED";

export const TERMINAL_STATES = ["DONE", "REFUSED"] as const;

/** Why the run stopped. Each names the authority that refused, never a second opinion about it. */
export type RefusalStage =
  | "OBSERVE"
  | "SANITIZE"
  | "VERIFY_PAYLOAD"
  | "SEND"
  | "PARSE_PLAN"
  | "VALIDATE_PLAN"
  | "AWAIT_GRANT"
  | "REHYDRATE"
  | "ACT";

export interface RunRefusal {
  readonly stage: RefusalStage;
  /** The refusing authority's own cause, verbatim. */
  readonly cause: string;
  /** Written to never contain a value. */
  readonly detail: string;
  readonly planRefusal?: PlanRefusal;
}

export interface Transition {
  readonly from: RunState;
  readonly to: RunState;
  readonly at: number;
  readonly elapsedMs: number;
}

/** Only the timings that mean something. No framework, no sampling, no telemetry. */
export interface RunTimings {
  observeMs?: number;
  sanitizeMs?: number;
  verifyPayloadMs?: number;
  sendMs?: number;
  validatePlanMs?: number;
  grantMs?: number;
  rehydrateMs?: number;
  refreshMs?: number;
  actMs?: number;
  verifyResultMs?: number;
  totalMs?: number;
}

/**
 * Everything the run produced, for the Planning View and for a ledger.
 *
 * Deliberately the same objects the run actually used — the handoff here **is** the one that crossed
 * the reasoner boundary, not a copy made for display. A pane rendering a separately-built summary
 * would be able to show something the system never did.
 */
export interface RunRecord {
  readonly goal: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly origin: string;
  readonly state: RunState;
  readonly transitions: readonly Transition[];
  readonly timings: RunTimings;
  readonly refusal: RunRefusal | null;

  /** The reading the plan was made against. What Pane 2 shows; never overwritten by later reads. */
  readonly initialObservation: Observation | null;
  /** The most recent reading, which after a completed run is the post-action one. */
  readonly observation: Observation | null;
  readonly handoff: VerifiedHandoff | null;
  /** The exact bytes that were handed to the reasoner. */
  readonly handoffSerialized: string | null;
  readonly ledgerEntry: LedgerEntry | null;
  /**
   * The send's outcome **without** `raw`.
   *
   * A hostile reasoner's response contains whatever it chose to send, including a secret it should
   * never have had. Keeping those bytes would put the leak into the client's own record, log and UI —
   * so the raw response is used to parse and then dropped. What survives is the projection below.
   */
  readonly response: Omit<Extract<ReasonerResponse, { received: true }>, "raw"> | Extract<ReasonerResponse, { received: false }> | null;
  /** The plan, with any literal replaced by a class marker. Never the reasoner's text. */
  readonly plan: SafePlan | null;
  readonly validation: PlanValidation | null;
  readonly grant: { readonly requested: boolean; readonly decision: GrantDecision | null; readonly useGrant: UseGrant | null };
  readonly rehydrated: readonly { readonly ref: string; readonly target: string; readonly piiClass: string; readonly inserted: boolean }[];
  readonly confirmation: HumanConfirmation | null;
  readonly act: GuardedOutcome | null;
}

export interface RunOptions {
  readonly goal: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly origin: string;
  /**
   * Permit lifetime. **No TTL is approved by this repository** (ADR-0008 §5); this is an instrument
   * value for the demo, stated by the caller and recorded as such.
   */
  readonly permitTtlMs: number;
  /** Confirmation lifetime. An instrument value on the same terms. */
  readonly confirmationTtlMs: number;
  /** Grant lifetime. An instrument value on the same terms. */
  readonly grantTtlMs: number;
  readonly now?: () => number;
  readonly today?: Date;
  readonly reasonerTimeoutMs?: number;
}

const labelOf = (observation: Observation, selector: string): string =>
  observation.graph.nodes.find((n) => n.domRef.selector === selector)?.name ?? selector;

/** The view the binder and the validator both read. Built from one observation, never assembled twice. */
const viewFrom = (observation: Observation, viewId: string, origin: string): BindView => {
  const fields = new Map<string, ViewField>();
  for (const node of observation.graph.nodes) {
    const accepts = acceptsOf(node);
    fields.set(node.domRef.selector, {
      accepts,
      origin,
      fingerprint: fingerprintOf(node.domRef.selector, node.role, node.name),
    });
  }
  return { viewId, documentId: observation.documentId, fields };
};

/**
 * What a field accepts, from its accessible name and role.
 *
 * The same D1 vocabulary `@pratibimb/privacy` classifies with, applied to the live view so the binder
 * has something to compare a reference's class against. A field this cannot read confidently is
 * `UNKNOWN`, which the binder routes to a human rather than guessing.
 */
const acceptsOf = (node: ElementNode): ViewField["accepts"] => {
  if (node.role !== "textbox") return "UNKNOWN";
  const name = node.name.toLowerCase();
  if (/one[- ]?time|otp|verification code/.test(name)) return "OTP";
  if (/mobile|phone|tel\b/.test(name)) return "PHONE";
  if (/aadhaar|aadhar/.test(name)) return "AADHAAR";
  if (/date of birth|dob|birth/.test(name)) return "DOB";
  if (/name/.test(name)) return "NAME";
  return "UNKNOWN";
};

/**
 * Run the task.
 *
 * One page, one plan, one action. Returns the record whatever happens; it does not throw for a
 * refusal, because a refusal is an outcome and the Planning View must be able to show it.
 */
export async function runTask(ports: ClientPorts, options: RunOptions): Promise<RunRecord> {
  const clock = options.now ?? (() => Date.now());
  const startedAt = clock();

  let state: RunState = "IDLE";
  const transitions: Transition[] = [];
  const timings: RunTimings = {};
  const rehydrated: RunRecord["rehydrated"][number][] = [];

  let observation: Observation | null = null;
  let initialObservation: Observation | null = null;
  let handoff: VerifiedHandoff | null = null;
  let handoffSerialized: string | null = null;
  let ledgerEntry: LedgerEntry | null = null;
  let response: RunRecord["response"] = null;
  let plan: SafePlan | null = null;
  let validation: PlanValidation | null = null;
  let grantDecision: GrantDecision | null = null;
  let grantRequested = false;
  let useGrant: UseGrant | null = null;
  let confirmation: HumanConfirmation | null = null;
  let act: GuardedOutcome | null = null;
  let refusal: RunRefusal | null = null;

  /** The only way `state` changes. Refuses to move once the run has ended. */
  const go = (to: RunState): void => {
    if (state === "REFUSED" || state === "DONE") {
      throw new Error(`orchestrator: attempted ${state} → ${to}; a finished run does not continue.`);
    }
    const at = clock();
    transitions.push({ from: state, to, at, elapsedMs: at - startedAt });
    state = to;
  };

  const record = (): RunRecord => ({
    goal: options.goal,
    sessionId: options.sessionId,
    requestId: options.requestId,
    origin: options.origin,
    state,
    transitions,
    timings: { ...timings, totalMs: clock() - startedAt },
    refusal,
    initialObservation,
    observation,
    handoff,
    handoffSerialized,
    ledgerEntry,
    response,
    plan,
    validation,
    grant: { requested: grantRequested, decision: grantDecision, useGrant },
    rehydrated,
    confirmation,
    act,
  });

  const stop = (stage: RefusalStage, cause: string, detail: string, planRefusal?: PlanRefusal): RunRecord => {
    refusal = { stage, cause, detail, ...(planRefusal ? { planRefusal } : {}) };
    go("REFUSED");
    return record();
  };

  const timed = async <T>(key: keyof RunTimings, work: () => Promise<T>): Promise<T> => {
    const began = clock();
    try {
      return await work();
    } finally {
      timings[key] = clock() - began;
    }
  };

  // ── OBSERVE ──────────────────────────────────────────────────────────────────────────────
  go("OBSERVE");
  try {
    observation = await timed("observeMs", () => ports.observe());
    initialObservation = observation;
  } catch {
    return stop("OBSERVE", "OBSERVER_THREW", "the page could not be read; nothing was planned or done.");
  }

  // ── SANITIZE ─────────────────────────────────────────────────────────────────────────────
  go("SANITIZE");
  const sanitized = await timed("sanitizeMs", () =>
    sanitize(observation!.graph, options.goal, {
      sessionId: options.sessionId,
      requestId: options.requestId,
      origin: options.origin,
      viewport: observation!.viewport,
      now: clock(),
      ...(options.today ? { today: options.today } : {}),
      destination: "(no egress client in this phase)",
    }, { fields: observation!.fields })
  );
  if (!sanitized.ok) {
    return stop("SANITIZE", sanitized.refused, "the observation could not be sanitized, so nothing was sent.");
  }
  handoff = sanitized.handoff;
  ledgerEntry = sanitized.ledgerEntry;
  const vault = sanitized.vault;

  // ── VERIFY PAYLOAD ───────────────────────────────────────────────────────────────────────
  // Asked of the verifier, never of `handoff.verified`: the flag type-checks, the membership does
  // not (INV-22). This stage exists so the orchestrator cannot be the thing that declares a payload
  // fit to leave.
  go("VERIFY_PAYLOAD");
  const verified = await timed("verifyPayloadMs", async () => isVerifiedHandoff(handoff));
  if (!verified) {
    return stop("VERIFY_PAYLOAD", "HANDOFF_NOT_VERIFIED", "the payload is not one the privacy verifier produced.");
  }
  handoffSerialized = serializeHandoff(handoff);

  // ── SEND ─────────────────────────────────────────────────────────────────────────────────
  go("SEND");
  const sent = await timed("sendMs", () =>
    sendToReasoner(
      ports.reasoner,
      {
        handoff: handoff!,
        goal: options.goal,
        requestId: options.requestId,
        sessionId: options.sessionId,
        origin: options.origin,
      },
      { ...(options.reasonerTimeoutMs === undefined ? {} : { timeoutMs: options.reasonerTimeoutMs }) }
    )
  );
  if (!sent.received) {
    response = sent;
    return stop("SEND", sent.cause, "the reasoner produced nothing usable; no plan exists to validate.");
  }
  // Everything except the bytes. See `RunRecord.response`.
  const { raw, ...withoutRaw } = sent;
  response = withoutRaw;

  // ── VALIDATE PLAN ────────────────────────────────────────────────────────────────────────
  go("VALIDATE_PLAN");
  const parsed = parsePlan(raw);
  if (!parsed.ok) {
    return stop("PARSE_PLAN", parsed.cause, "the reasoner's response is not a plan this client can read.");
  }
  // `parsedPlan` stays local and is what the validator sees; the record keeps only the projection,
  // so a literal the reasoner echoed is never retained or displayed.
  const parsedPlan = parsed.plan;
  plan = redactPlan(parsedPlan, vault);

  const viewId = options.requestId;
  const view = viewFrom(observation, viewId, options.origin);
  const redactedTargets = new Set(handoff.redactions.map((r) => r.targetId));
  // The class×origin grants this session holds. In this phase the user's per-use decision covers
  // both levels at once; there is no blanket grant and nothing is persisted.
  const classOriginGrants = new Set<string>(
    handoff.redactions.filter((r) => r.method === "token_reference").map((r) => classOriginKey(r.class, options.origin))
  );
  const useGrants: UseGrant[] = [];

  const validateNow = (): PlanValidation =>
    validatePlan(parsedPlan, {
      vault,
      sessionId: options.sessionId,
      requestId: options.requestId,
      origin: options.origin,
      view,
      currentDocumentId: observation!.documentId,
      classOriginGrants,
      useGrants,
      now: clock(),
      redactedTargets,
      actionableTargets: observation!.actionable,
      ...(options.today ? { today: options.today } : {}),
    });

  validation = await timed("validatePlanMs", async () => validateNow());
  if (!validation.ok) {
    return stop("VALIDATE_PLAN", validation.refusal.cause, validation.refusal.detail, validation.refusal);
  }

  const inserts = validation.steps.filter((s): s is ValidatedInsert => s.op === "insert");
  const click = validation.steps.find((s) => s.op === "click");
  if (!click) {
    return stop("VALIDATE_PLAN", "NO_EXECUTABLE_STEP", "the plan proposes no action.");
  }

  // ── AWAIT GRANT ──────────────────────────────────────────────────────────────────────────
  // One human decision, covering exactly what it says: this value, into this field, then this
  // action. It produces two one-shot authorisations — a privacy use-grant and an agent
  // confirmation — each bound to its own subject. Neither is blanket and neither is persisted.
  go("AWAIT_GRANT");
  const clickLabel = labelOf(observation, click.target);
  const grantResult = await timed("grantMs", async () => {
    for (const insert of inserts) {
      const field = view.fields.get(insert.target);
      if (!field) return { stopped: "UNKNOWN_TARGET" as const };
      grantRequested = true;
      const decision = await ports.requestGrant({
        ref: insert.ref,
        piiClass: insert.piiClass,
        target: insert.target,
        targetLabel: labelOf(observation!, insert.target),
        fingerprint: field.fingerprint,
        origin: options.origin,
        sessionId: options.sessionId,
        purpose: `Allow PratiBimb to use your ${insert.piiClass.toLowerCase()} for "${labelOf(observation!, insert.target)}" on this page`,
        actionContext: `restore it into ${insert.target}, then click ${click.target} ("${clickLabel}")`,
        action: { target: click.target, label: clickLabel },
      });
      grantDecision = decision;
      if (!decision.granted) return { stopped: decision.reason };

      const granted: UseGrant = {
        ref: insert.ref,
        piiClass: insert.piiClass,
        fingerprint: field.fingerprint,
        origin: options.origin,
        sessionId: options.sessionId,
        purpose: `Use of ${insert.piiClass} for "${labelOf(observation!, insert.target)}"`,
        actionContext: `insert into ${insert.target}, then click ${click.target}`,
        grantedAt: clock(),
        expiresAt: clock() + options.grantTtlMs,
        used: false,
      };
      useGrants.push(granted);
      useGrant = granted;
    }
    return { stopped: null };
  });
  if (grantResult.stopped !== null) {
    return stop("AWAIT_GRANT", grantResult.stopped, "a human did not authorise the use of a local value.");
  }

  // Re-validate with the grants in hand. The binder must be the thing that says the grant suffices —
  // the orchestrator holding a grant object is not the same as privacy accepting it.
  validation = validateNow();
  if (!validation.ok) {
    return stop("VALIDATE_PLAN", validation.refusal.cause, validation.refusal.detail, validation.refusal);
  }
  const stillNeedsHuman = validation.needsHuman;
  if (stillNeedsHuman.length > 0) {
    return stop("AWAIT_GRANT", "NEEDS_HUMAN_GRANT", "the privacy layer still requires a human decision after the grant.");
  }

  // ── REHYDRATE ────────────────────────────────────────────────────────────────────────────
  // The value comes back here and nowhere else, and this stage does not act on it. The reference is
  // spent by `rehydrate` before the value is returned, so a dropped value costs the authority.
  go("REHYDRATE");
  const rehydrateOutcome = await timed("rehydrateMs", async () => {
    for (const insert of validation!.ok ? inserts : []) {
      const outcome = rehydrate(
        { ref: insert.ref, targetId: insert.target, viewId },
        {
          vault,
          sessionId: options.sessionId,
          view,
          currentDocumentId: observation!.documentId,
          classOriginGrants,
          useGrants,
          now: clock(),
        }
      );
      if (!outcome.ok) {
        return { cause: outcome.decision.decision === "REFUSE" ? outcome.decision.cause : outcome.decision.decision };
      }
      // A PERSONAL-tier grant is not spent by privacy (it only requires one for SENSITIVE), so this
      // client spends it: one human decision authorises one restoration.
      const spent = findUseGrant(insert.ref, view.fields.get(insert.target)!, {
        vault,
        sessionId: options.sessionId,
        view,
        currentDocumentId: observation!.documentId,
        classOriginGrants,
        useGrants,
        now: clock(),
      });
      if (spent) spent.used = true;

      const inserted = await ports.insert(insert.target, outcome.value);
      rehydrated.push({ ref: insert.ref, target: insert.target, piiClass: insert.piiClass, inserted });
      if (!inserted) return { cause: "INSERTION_REFUSED" };
    }
    return { cause: null };
  });
  if (rehydrateOutcome.cause !== null) {
    return stop("REHYDRATE", rehydrateOutcome.cause, "the value was not restored; no action follows.");
  }

  // ── REFRESH ──────────────────────────────────────────────────────────────────────────────
  // A new reading, because the page changed when the value went in. `guardedAct` re-validates
  // freshness against this graph; there is no second freshness implementation here.
  let fresh: Observation;
  try {
    fresh = await timed("refreshMs", () => ports.observe());
  } catch {
    return stop("ACT", "OBSERVER_THREW", "the page could not be re-read before acting, so nothing was clicked.");
  }
  observation = fresh;
  const node = fresh.graph.nodes.find((n) => n.domRef.selector === click.target);
  if (!node || (node.evidence.kind !== "OBSERVED" && node.evidence.kind !== "CLIPPED")) {
    return stop("ACT", "TARGET_ABSENT_AFTER_REFRESH", "the control the plan named is no longer actionable.");
  }

  // The human's decision, recorded for this exact control now that it has been re-identified.
  const recorded = recordHumanConfirmation(
    {
      nodeId: node.id,
      selector: node.domRef.selector,
      role: node.role,
      name: node.name,
      frameId: fresh.graph.frameId,
      origin: options.origin,
    },
    { purpose: `Click "${node.name}" to submit this application`, ttlMs: options.confirmationTtlMs, now: clock }
  );
  if (!recorded.recorded) {
    return stop("ACT", recorded.cause, "the human's confirmation could not be recorded, so no permit may be minted.");
  }
  confirmation = recorded.confirmation;

  // ── ACT ──────────────────────────────────────────────────────────────────────────────────
  // Through the audited path, and only it: VALIDATE → AUTHORISE → HIT-TEST → MINT → ACT →
  // VERIFY RESULT. This file dispatches nothing itself.
  go("ACT");
  // THE POINT IS AN INTEGER, ON PURPOSE.
  //
  // Left to itself the gate derives the box centre, which for a real layout is fractional. Browsers
  // truncate `MouseEvent.clientX`/`clientY` to integers, so a fractional permit point can never be
  // dispatched exactly — and the page agent's exactness check correctly refuses to fire a sequence
  // whose coordinates the browser did not keep. Rounding here, before the permit is minted, means
  // the point the permit fixes is a point the browser can actually reproduce. Every gate still runs
  // against it: the gate checks it lies inside the validated box, and the hit test must agree that
  // this target is topmost at exactly this point.
  const box = node.evidence.viewportBox;
  const action: ProposedAction = {
    kind: "click",
    target: {
      nodeId: node.id,
      role: node.role,
      name: node.name,
      frameId: fresh.graph.frameId,
      viewportBox: box,
    },
    point: { x: cssPx(Math.round(box.x + box.w / 2)), y: cssPx(Math.round(box.y + box.h / 2)) },
  };

  go("VERIFY_RESULT");
  act = await timed("actMs", () =>
    guardedAct(fresh.graph, action, ports.bridges, {
      verify: {
        // The postcondition is a real observable of this fixture: a submitted form disables its own
        // submit control. Nothing here hardcodes CONFIRMED — the verifier reads the page back.
        expect: { kind: "TARGET_ENABLED", expected: false },
        observe: async () => {
          const after = await timed("verifyResultMs", () => ports.observe());
          observation = after;
          return {
            graph: after.graph,
            ...(after.focusedSelector === undefined ? {} : { focusedSelector: after.focusedSelector }),
          };
        },
      },
      permitTtlMs: options.permitTtlMs,
      confirmation,
      origin: options.origin,
    })
  );

  if (act.reached !== "VERIFY_RESULT") {
    const cause =
      act.result && act.result.status !== "EXECUTED" && "cause" in act.result
        ? String(act.result.cause)
        : act.reached === "VALIDATE" && act.decision.decision === "RE_OBSERVE"
          ? act.decision.reason
          : act.hit && act.hit.agreement !== "MATCH" && "cause" in act.hit
            ? String(act.hit.cause)
            : act.reached;
    return stop("ACT", cause, `the execution gate stopped at ${act.reached}; the page was not acted on beyond that point.`);
  }

  go("DONE");
  return record();
}

/**
 * Did the task actually work?
 *
 * One expression, asking the verifier. `DONE` means the run finished every stage; it does not mean
 * the page did anything. `UNKNOWN` and `NOT_CONFIRMED` are both not-success, and neither is rescued
 * here.
 */
export const succeeded = (run: RunRecord): boolean =>
  run.state === "DONE" && run.act !== null && run.act.verification?.verification === "CONFIRMED";

/** The verifier's exact answer, or `null` when nothing was dispatched. Never normalised to a boolean. */
export const resultOf = (run: RunRecord): GuardedOutcome["verification"] => run.act?.verification ?? null;
