/**
 * THE DEMO SCRIPT — the three acts, as data.
 *
 * A presenter runs SUCCESS → RESET → REFUSAL → RESET → FALLBACK in front of judges, on a laptop,
 * once, with no second chance. So the acts are declared here as plain values rather than assembled
 * inside click handlers: the browser buttons, the automated rehearsal runner and the unit tests all
 * read the *same* definitions, and a test can assert what an act is going to do without a browser.
 *
 * WHAT AN ACT IS NOT. It is not a mode the security code knows about. Nothing below is consulted by
 * the privacy layer, the validator, the permit gate or the orchestrator — they cannot tell which act
 * is running, and there is no branch anywhere beneath this file that asks. An act chooses only two
 * things a real deployment would also choose: **which reasoner answers**, and **at what address**.
 * Everything after the answer is the same code in all three.
 *
 * THE THREE ACTS, and why each is the real thing rather than a simulation of it:
 *
 * - `SUCCESS`  — the local Qwen2.5-0.5B answers over loopback HTTP. A real model, a real request.
 * - `REFUSAL`  — a *second* service, listening at the same time on another port, answers with a plan
 *                carrying a value this client holds locally. The refusal comes from `validatePlan` →
 *                `checkLiteral`, the same path the success run passes through. There is no demo-mode
 *                refusal and no UI-only refusal.
 * - `OUTAGE`   — the client addresses a loopback port with nothing behind it. The connection is
 *                genuinely refused, exactly as it would be if `llama-server` died mid-demo, and the
 *                deterministic planner answers through the identical pipeline.
 *
 * WHY THE HOSTILE SERVICE HAS TO BE HANDED THE NUMBER. It cannot read it out of the request: the
 * request contains no values, which is the whole claim. So the harness reads the registered number
 * from the local page and gives it to the simulated attacker. That necessity *is* the evidence, and
 * the UI says so rather than hiding it.
 */

/**
 * Where each act sends. All three are loopback, and `@pratibimb/egress` refuses anything that is not.
 *
 * `outage` points at a port with nothing behind it on purpose: that act must be a real refused
 * connection, not a flag that makes the client pretend.
 */
export const ENDPOINTS: Readonly<Record<"model" | "hostile" | "outage", string>> = {
  model: "http://127.0.0.1:8978/v1/chat/completions",
  hostile: "http://127.0.0.1:8979/v1/chat/completions",
  outage: "http://127.0.0.1:8989/v1/chat/completions",
} as const;

/** Which reasoner answers first. `unavailable` is in-process; the others are real HTTP. */
export type ReasonerChoice = "deterministic" | "local-model" | "unavailable";

export type ActId = "SUCCESS" | "REFUSAL" | "OUTAGE";

/** What a run is expected to reach. Used by the rehearsal runner to judge, never by the product. */
export interface ActExpectation {
  /** The terminal state. */
  readonly state: "DONE" | "REFUSED";
  /** `VERIFY RESULT`'s answer, when the run gets that far. */
  readonly verification: "CONFIRMED" | null;
  /** Whether the deterministic planner is expected to have been allowed to answer. */
  readonly fellBack: boolean;
  /** How many references the run is expected to have restored locally. */
  readonly rehydrations: number;
  /** How many raw events the fixture's submit button is expected to have seen. */
  readonly clicks: number;
}

export interface DemoAct {
  readonly id: ActId;
  /** The button's words. Short enough to read from the back of a room. */
  readonly label: string;
  /** One line under the headline verdict, for the audience. */
  readonly blurb: string;
  readonly reasoner: ReasonerChoice;
  /**
   * `literal-echo` makes the *in-process* planner echo the secret, for the case where no service is
   * running. Over HTTP the hostile service does it instead, and this is left alone.
   */
  readonly mode: "reference" | "literal-echo";
  /** Which service address this act talks to, by role. Resolved to a URL by the caller. */
  readonly endpoint: "model" | "hostile" | "outage" | null;
  readonly expect: ActExpectation;
}

export const ACTS: Readonly<Record<ActId, DemoAct>> = {
  SUCCESS: {
    id: "SUCCESS",
    label: "Run the task",
    blurb: "The local model plans it. You authorise the number. The client does the rest.",
    reasoner: "local-model",
    mode: "reference",
    endpoint: "model",
    expect: { state: "DONE", verification: "CONFIRMED", fellBack: false, rehydrations: 1, clicks: 5 },
  },
  REFUSAL: {
    id: "REFUSAL",
    label: "Compromised reasoner",
    blurb: "The reasoner answers with the secret itself. Watch what the client does about it.",
    reasoner: "local-model",
    mode: "reference",
    endpoint: "hostile",
    expect: { state: "REFUSED", verification: null, fellBack: false, rehydrations: 0, clicks: 0 },
  },
  OUTAGE: {
    id: "OUTAGE",
    label: "Model outage",
    blurb: "The model is gone. The same gates run, and the task still completes.",
    reasoner: "local-model",
    mode: "reference",
    endpoint: "outage",
    expect: { state: "DONE", verification: "CONFIRMED", fellBack: true, rehydrations: 1, clicks: 5 },
  },
} as const;

/** The order a presenter runs them in. The narrative depends on success coming first. */
export const RUNNING_ORDER: readonly ActId[] = ["SUCCESS", "REFUSAL", "OUTAGE"] as const;

/**
 * What RESET has to put back, enumerated so a test can check the list rather than trust the code.
 *
 * A presenter must be able to run the three acts in any order, repeatedly, without restarting the
 * browser or the services. Anything that survives a reset and influences the next run is a way for
 * act two to be contaminated by act one — in front of judges.
 */
export const RESET_CONTRACT = [
  "the confirm-mobile field is empty",
  "the fixture reports Not submitted",
  "the submit button is enabled again",
  "no submit events are recorded against the button",
  "the page has a fresh document identity, so no earlier binding can still apply",
  "the Planning View shows no run",
  "the egress log for the new run is empty",
] as const;

/**
 * Every act sends to a loopback address, and the egress guard refuses anything else.
 *
 * Stated here as well so the demo cannot quietly acquire a remote endpoint through a config edit
 * without a test noticing.
 */
export const isLoopbackUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1")
    );
  } catch {
    return false;
  }
};
