/**
 * The demo, wired up.
 *
 * WHAT IS REAL HERE. All of it. The page is a real page in a real same-origin frame; the observation,
 * sanitization, verification, egress, plan parsing, validation, binding, grant, rehydration, permit,
 * hit test, dispatch and result verification are the shipped packages. The reasoner is a real
 * Qwen2.5-0.5B answering over real loopback HTTP, behind a boundary built so that replacing it
 * changes nothing after it.
 *
 * THE THREE BUTTONS ARE THE SAME CODE PATH. Success, compromised reasoner and model outage differ
 * only in **which reasoner answers and at what address** (`demoScript.ts`). There is no demo-only
 * branch anywhere below this file, no mode the security layers can see, and no UI-only refusal: act
 * two is refused by the same `validatePlan` → `checkLiteral` act one passes through, and act three
 * reaches the same permit gate act one does.
 *
 * WHY THE HOSTILE REASONER HAS TO BE HANDED THE NUMBER. It cannot obtain it from the handoff — the
 * handoff contains no values, which is the thing being demonstrated. So the harness reads the
 * registered number out of the local DOM and gives it to the simulated attacker. That necessity is
 * the evidence, and the UI says so rather than hiding it.
 *
 * WHAT THE SCREEN SHOWS DURING A RUN, AND HOW IT KNOWS. The orchestrator returns its record only when
 * the run ends, but the story a judge follows — the boundary filling in, the model planning, the
 * approval request — happens before that. So three READ-ONLY TAPS watch the ports as the pipeline uses
 * them: the first page reading, the verified handoff a reasoner is given, and the grant request. They
 * pass every call through unchanged and alter no argument or result. Each catches its own rendering
 * errors, because an exception thrown inside `propose` would be read by `sendToReasoner` as
 * `REASONER_THREW` and trigger a fallback — a display bug silently changing what the system does.
 * When the run ends, the record replaces everything the taps saw.
 */
import { type EgressRecord, type EgressRefusal } from "@pratibimb/egress";
import { runTask, type ClientPorts, type GrantDecision, type GrantRequest, type RunRecord } from "@pratibimb/orchestrator";
import { deterministicReasoner, localModelReasoner, unavailableReasoner, type ReasonerClient } from "@pratibimb/reasoner";

import { ACTS, ENDPOINTS, type ActId } from "./demoScript.js";
import { type EgressAttempt } from "./evidence.js";
import { PageAdapter, portsFrom } from "./pageAdapter.js";
import { IDLE, type Asked, type StoryInput } from "./story.js";
import { render } from "./view.js";

const GOAL = "Submit my application with my registered mobile number.";

/**
 * Instrument values for this demo. **No lifetime in this file is approved by the repository**:
 * ADR-0008 §5 leaves the permit TTL an open owner decision, and the grant and confirmation
 * lifetimes are stated here for the same reason — so that something has to state them.
 */
const TTL = { permitMs: 5_000, confirmationMs: 60_000, grantMs: 60_000 } as const;

let runs = 0;

const frame = (): HTMLIFrameElement => {
  const found = document.getElementById("page") as HTMLIFrameElement | null;
  if (!found?.contentDocument || !found.contentWindow) throw new Error("demo: the page frame is not loaded");
  return found;
};

// ── what the screen is showing ───────────────────────────────────────────────────────────────

let screen: StoryInput = IDLE;
let currentAct: ActId | null = null;
/**
 * Which run owns the screen. A reset bumps it, so a run that finishes after a reset cannot paint its
 * result over the cleared view.
 */
let generation = 0;

const paint = (): void => render(GOAL, screen, currentAct);

/** Update the screen from inside the pipeline. Never throws into it. */
const live = (owner: number, update: (current: StoryInput) => StoryInput): void => {
  if (owner !== generation) return;
  try {
    screen = update(screen);
    paint();
  } catch (error) {
    console.error("planning view: a live update could not be shown", error);
  }
};

// ── the human ────────────────────────────────────────────────────────────────────────────────

/** The answer to the approval currently on screen, if one is. The only place consent comes from. */
let answer: ((decision: GrantDecision) => void) | null = null;

document.addEventListener("click", (event) => {
  const button = (event.target as Element | null)?.closest<HTMLElement>("[data-grant]");
  if (!button || !answer) return;
  answer(button.dataset["grant"] === "allow" ? { granted: true } : { granted: false, reason: "DENIED" });
});

/** Ask a human, on the approval card. */
const askHuman =
  (owner: number) =>
  (request: GrantRequest): Promise<GrantDecision> =>
    new Promise((resolve) => {
      answer = (decision) => {
        answer = null;
        live(owner, (s) => ({ ...s, phase: "running", approved: decision.granted }));
        resolve(decision);
      };
      live(owner, (s) => ({ ...s, phase: "approval", grant: request, approved: null }));

      const allow = document.getElementById("grant-allow");
      if (!allow) {
        // The approval card did not render. Ask through the browser instead: still an explicit human
        // decision, and never an automatic one.
        const decided = window.confirm(`${request.purpose}?\n\nThis permission covers this value, this field, this page and this session, once.`);
        answer(decided ? { granted: true } : { granted: false, reason: "DENIED" });
        return;
      }
      allow.focus({ preventScroll: true });
      allow.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

/**
 * Approve without a human — used only by the automated browser runs. It passes through the same
 * approval states on screen, so a rendering fault in them fails the rehearsal instead of the demo.
 */
const autoGrant =
  (owner: number) =>
  async (request: GrantRequest): Promise<GrantDecision> => {
    live(owner, (s) => ({ ...s, phase: "approval", grant: request, approved: null }));
    live(owner, (s) => ({ ...s, phase: "running", approved: true }));
    return { granted: true };
  };

export interface RunRequest {
  /** `literal-echo` simulates a reasoner that returns the secret instead of the reference. */
  readonly mode?: "reference" | "literal-echo";
  /** Skip the approval card, for the automated runs. The decision is still explicit and still one-shot. */
  readonly auto?: boolean;
  /**
   * Which reasoner answers first.
   *
   * `local-model` is a REAL HTTP request to a service on this machine; `deterministic` is the
   * in-process planner. `unavailable` is how the fallback path is forced without touching any
   * security code. In every case the deterministic planner stays behind as the fallback, and every
   * answer goes through the same validation.
   */
  readonly reasoner?: "deterministic" | "local-model" | "unavailable";
  /** The loopback endpoint for the local model. */
  readonly endpoint?: string;
}

/** Every egress attempt this page made, for the evidence runner and the ledger. */
export const egressLog: { record?: EgressRecord; refusal?: EgressRefusal }[] = [];

export async function run(request: RunRequest = {}): Promise<RunRecord> {
  const iframe = frame();
  const doc = iframe.contentDocument as Document;
  const win = iframe.contentWindow as Window;
  const origin = win.location.origin;

  runs += 1;
  generation += 1;
  const owner = generation;
  const adapter = new PageAdapter(doc, win, { origin, framePrefix: `demo-r${runs}` });
  // Only this run's egress attempts reach this run's ledger.
  const egressBefore = egressLog.length;
  const thisRun = (): EgressAttempt[] => egressLog.slice(egressBefore);

  // The attacker's input. It is read from the LOCAL page, because there is nowhere else it could
  // come from — the handoff contains no values.
  const registered = (doc.getElementById("mobile") as HTMLInputElement | null)?.value ?? "";

  const onEgress = (event: { record?: EgressRecord; refusal?: EgressRefusal }): void => {
    egressLog.push(event);
    live(owner, (s) => ({ ...s, attempts: thisRun() }));
  };

  // The deterministic planner, always available behind whatever answers first.
  const deterministic =
    request.mode === "literal-echo"
      ? deterministicReasoner({ mode: "literal-echo", literal: registered })
      : deterministicReasoner();

  const pick = request.reasoner ?? "deterministic";
  const reasoner =
    pick === "local-model"
      ? localModelReasoner({ ...(request.endpoint ? { endpoint: request.endpoint } : {}), onEgress })
      : pick === "unavailable"
        ? unavailableReasoner()
        : deterministic;
  const reasonerKind = pick === "deterministic" ? ("DETERMINISTIC_FALLBACK" as const) : ("LOCAL_MODEL" as const);

  // TAP: note which reasoner was asked and the verified handoff it was given, then call it exactly
  // as before. The request is passed through untouched; nothing reads the vault it carries.
  const tap = (client: ReasonerClient, asked: Asked): ReasonerClient => ({
    ...client,
    propose: (proposal) => {
      live(owner, (s) => ({ ...s, handoff: proposal.handoff, asked: [...s.asked, asked] }));
      return client.propose(proposal);
    },
  });

  const ports = portsFrom(adapter, {
    reasoner: tap(reasoner, pick === "deterministic" ? "planner" : "model"),
    reasonerKind,
    fallback: tap(deterministic, "fallback"),
    requestGrant: request.auto ? autoGrant(owner) : askHuman(owner),
  });

  // TAP: the first reading of the page, so the device side of the boundary fills in as it happens.
  let firstReading = true;
  const tapped: ClientPorts = {
    ...ports,
    observe: async () => {
      const reading = await ports.observe();
      if (firstReading) {
        firstReading = false;
        live(owner, (s) => ({ ...s, observation: reading }));
      }
      return reading;
    },
  };

  screen = { ...IDLE, phase: "running" };
  paint();

  const record = await runTask(tapped, {
    goal: GOAL,
    sessionId: `demo-session-${runs}`,
    requestId: `demo-request-${runs}`,
    origin,
    permitTtlMs: TTL.permitMs,
    confirmationTtlMs: TTL.confirmationMs,
    grantTtlMs: TTL.grantMs,
  });

  // The record replaces everything the taps saw. Not guarded: a fault here should fail loudly.
  if (owner === generation) {
    screen = { ...screen, phase: "done", record, attempts: thisRun() };
    paint();
  }
  return record;
}

/** Put the page back to its starting state, so a second run starts from a clean form. */
export function resetPage(): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.getElementById("page") as HTMLIFrameElement;
    iframe.addEventListener("load", () => resolve(), { once: true });
    iframe.contentWindow?.location.reload();
  });
}

/**
 * RESET DEMO — everything `RESET_CONTRACT` names, so the next act starts from nothing.
 *
 * Reloading the frame is what clears the form, the submit events and the status line, and it gives
 * the document a new identity so no binding, grant or permit from the previous act could still
 * apply even if one had survived. The screen and the egress log are cleared here because they are the
 * two things that live in *this* document and would otherwise carry act one into act two — in front of
 * judges.
 *
 * An approval still on screen is answered as DISMISSED — never as approved — so the run it belonged
 * to ends as a refusal rather than hanging, and the generation bump keeps it from painting afterwards.
 *
 * The vault, the handoff and the use-grant need no clearing: `sanitize()` builds a new vault per
 * run and nothing outlives the record.
 */
export async function resetDemo(): Promise<void> {
  generation += 1;
  answer?.({ granted: false, reason: "DISMISSED" });
  egressLog.splice(0, egressLog.length);
  window.__demo.last = null;
  await resetPage();
  screen = IDLE;
  currentAct = null;
  paint();
}

/** Run one act of the demo script. The buttons and the rehearsal runner both come through here. */
export async function runAct(id: ActId, options: { readonly auto?: boolean } = {}): Promise<RunRecord> {
  const act = ACTS[id];
  currentAct = id;
  const record = await run({
    reasoner: act.reasoner,
    mode: act.mode,
    ...(act.endpoint ? { endpoint: ENDPOINTS[act.endpoint] } : {}),
    ...(options.auto === true ? { auto: true } : {}),
  });
  window.__demo.last = record;
  return record;
}

declare global {
  interface Window {
    /** The automated browser runs drive exactly what the buttons drive. */
    __demo: {
      run: typeof run;
      runAct: typeof runAct;
      resetPage: typeof resetPage;
      resetDemo: typeof resetDemo;
      endpoints: typeof ENDPOINTS;
      last: RunRecord | null;
      egressLog: typeof egressLog;
    };
  }
}

window.__demo = { run, runAct, resetPage, resetDemo, endpoints: ENDPOINTS, last: null, egressLog };

const busy = (on: boolean): void => {
  document.querySelectorAll<HTMLButtonElement>("header button").forEach((b) => (b.disabled = on));
  document.body.dataset["busy"] = on ? "yes" : "no";
};

const wireAct = (id: string, act: ActId): void => {
  document.getElementById(id)?.addEventListener("click", () => {
    void (async () => {
      busy(true);
      try {
        await resetDemo();
        await runAct(act);
      } finally {
        busy(false);
      }
    })();
  });
};

wireAct("run-happy", "SUCCESS");
wireAct("run-refusal", "REFUSAL");
wireAct("run-outage", "OUTAGE");

document.getElementById("reset-demo")?.addEventListener("click", () => {
  void (async () => {
    busy(true);
    try {
      await resetDemo();
    } finally {
      busy(false);
    }
  })();
});

paint();
