/**
 * The demo, wired up.
 *
 * WHAT IS REAL HERE. Everything except the reasoner's intelligence. The page is a real page in a real
 * same-origin frame; the observation, sanitization, verification, plan parsing, validation, binding,
 * grant, rehydration, permit, hit test, dispatch and result verification are the shipped packages.
 * The reasoner is deterministic, by design for this phase, behind a boundary built so that swapping
 * it for a small open-weight model on loopback changes nothing after it.
 *
 * THE TWO BUTTONS ARE THE SAME CODE PATH. "Run" and "Run with a compromised reasoner" differ by one
 * argument to `deterministicReasoner`. There is no demo-only branch anywhere below, and no UI-only
 * refusal: the second run is refused by the same `validatePlan` → `checkLiteral` the first one passes
 * through.
 *
 * WHY THE HOSTILE REASONER HAS TO BE HANDED THE NUMBER. It cannot obtain it from the handoff — the
 * handoff contains no values, which is the thing being demonstrated. So the page reads the registered
 * number out of the local DOM and gives it to the simulated attacker. That necessity is the evidence,
 * and the UI says so rather than hiding it.
 */
import { type EgressRecord, type EgressRefusal } from "@pratibimb/egress";
import { runTask, type GrantDecision, type GrantRequest, type RunRecord } from "@pratibimb/orchestrator";
import { deterministicReasoner, localModelReasoner, unavailableReasoner } from "@pratibimb/reasoner";

import { PageAdapter, portsFrom } from "./pageAdapter.js";
import { renderAll } from "./view.js";

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

/** The human grant dialog. The only place a consent can come from. */
function askHuman(request: GrantRequest): Promise<GrantDecision> {
  return new Promise((resolve) => {
    const dialog = document.getElementById("grant") as HTMLDialogElement;
    const body = document.getElementById("grant-body") as HTMLElement;
    body.innerHTML = `
      <p class="ask">Allow PratiBimb to use your <b>registered ${request.piiClass.toLowerCase()}</b>
        for &ldquo;${request.targetLabel}&rdquo;?</p>
      <dl class="kv">
        <dt>value</dt><dd><code class="token">${request.ref}</code> — held locally, never sent</dd>
        <dt>into</dt><dd><code>${request.target}</code></dd>
        <dt>then</dt><dd>click <code>${request.action.target}</code> (&ldquo;${request.action.label}&rdquo;)</dd>
        <dt>on</dt><dd><code>${request.origin}</code></dd>
        <dt>session</dt><dd><code>${request.sessionId}</code></dd>
      </dl>
      <p class="sub">This permission is for this value, this field, this page and this session, once.
        It is not stored, and it does not cover anything else.</p>`;

    const finish = (decision: GrantDecision) => {
      dialog.close();
      allow.removeEventListener("click", onAllow);
      deny.removeEventListener("click", onDeny);
      resolve(decision);
    };
    const allow = document.getElementById("grant-allow") as HTMLButtonElement;
    const deny = document.getElementById("grant-deny") as HTMLButtonElement;
    const onAllow = () => finish({ granted: true });
    const onDeny = () => finish({ granted: false, reason: "DENIED" });
    allow.addEventListener("click", onAllow);
    deny.addEventListener("click", onDeny);
    dialog.showModal();
  });
}

/** Approve without a dialog — used only by the automated browser runs. */
const autoGrant = async (): Promise<GrantDecision> => ({ granted: true });

export interface RunRequest {
  /** `literal-echo` simulates a reasoner that returns the secret instead of the reference. */
  readonly mode?: "reference" | "literal-echo";
  /** Skip the modal, for the automated runs. The decision is still explicit and still one-shot. */
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

/** Every egress attempt this page made, for the evidence runner and the result pane. */
export const egressLog: { record?: EgressRecord; refusal?: EgressRefusal }[] = [];

export async function run(request: RunRequest = {}): Promise<RunRecord> {
  const iframe = frame();
  const doc = iframe.contentDocument as Document;
  const win = iframe.contentWindow as Window;
  const origin = win.location.origin;

  runs += 1;
  const adapter = new PageAdapter(doc, win, { origin, framePrefix: `demo-r${runs}` });

  // The attacker's input. It is read from the LOCAL page, because there is nowhere else it could
  // come from — the handoff contains no values.
  const registered = (doc.getElementById("mobile") as HTMLInputElement | null)?.value ?? "";

  const onEgress = (event: { record?: EgressRecord; refusal?: EgressRefusal }): void => {
    egressLog.push(event);
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

  const record = await runTask(
    portsFrom(adapter, {
      reasoner,
      reasonerKind,
      fallback: deterministic,
      requestGrant: request.auto ? autoGrant : askHuman,
    }),
    {
      goal: GOAL,
      sessionId: `demo-session-${runs}`,
      requestId: `demo-request-${runs}`,
      origin,
      permitTtlMs: TTL.permitMs,
      confirmationTtlMs: TTL.confirmationMs,
      grantTtlMs: TTL.grantMs,
    }
  );

  renderAll(GOAL, record);
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

declare global {
  interface Window {
    /** The automated browser runs drive exactly what the buttons drive. */
    __demo: {
      run: typeof run;
      resetPage: typeof resetPage;
      last: RunRecord | null;
      egressLog: typeof egressLog;
    };
  }
}

window.__demo = { run, resetPage, last: null, egressLog };

const wire = (id: string, mode: NonNullable<RunRequest["mode"]>): void => {
  document.getElementById(id)?.addEventListener("click", () => {
    void (async () => {
      const buttons = document.querySelectorAll<HTMLButtonElement>("header button");
      buttons.forEach((b) => (b.disabled = true));
      try {
        await resetPage();
        window.__demo.last = await run({ mode });
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    })();
  });
};

wire("run-happy", "reference");
wire("run-refusal", "literal-echo");
renderAll(GOAL, null);
