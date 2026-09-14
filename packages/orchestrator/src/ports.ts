/**
 * What the orchestrator needs from the world, and nothing more.
 *
 * Every capability is an injected port, for one reason: the state machine must be testable without a
 * browser, and must be **incapable** of doing anything it was not handed. It cannot observe a page,
 * click one, or ask a human unless something gave it the means, and the means are all here where they
 * can be counted.
 *
 * THE TWO PORTS THAT CARRY A SECRET, and the asymmetry between them is deliberate:
 *
 * - `observe()` brings values **in**. They go straight to `sanitize()` and into the vault; the
 *   orchestrator never keeps them.
 * - `insert()` puts one value **back**, locally, after privacy and a human have both agreed. It is
 *   the trusted client's restoration step, **not an agent action**. There is no TYPE action, the
 *   value never enters a plan, a permit or the reasoner, and `guardedAct` never sees it.
 *
 * `requestGrant` is the only way a human decision enters the machine. Nothing here can answer it, and
 * a port that returned an approval nobody gave would be fabricating consent — the same trust boundary
 * `recordHumanConfirmation` names, in the same place: the UI that asks.
 */
import { type GuardedBridges } from "@pratibimb/agent";
import { type ElementGraph } from "@pratibimb/perception";
import { type ObservedField, type PiiClass } from "@pratibimb/privacy";
import { type ReasonerClient, type ReasonerKind } from "@pratibimb/reasoner";

/**
 * One reading of the page.
 *
 * `graph.frameId` must be **new every time**. VERIFY RESULT refuses an observation taken in the
 * frame the action was dispatched against, because a graph that predates the click cannot show what
 * the click changed.
 */
export interface Observation {
  readonly graph: ElementGraph;
  /** Values read locally. The only place a secret enters this package. */
  readonly fields: readonly ObservedField[];
  readonly viewport: {
    readonly w: number;
    readonly h: number;
    readonly dpr: number;
    readonly zoom: number;
    readonly scrollX: number;
    readonly scrollY: number;
  };
  /** The document identity. A reload or navigation changes it, and stale bindings refuse. */
  readonly documentId: string;
  /** Three-valued, as ADR-0007 §5 requires: a selector, `null` for reliably nothing, absent for unknown. */
  readonly focusedSelector?: string | null;
  /** Targets present, visible and enabled right now. */
  readonly actionable: ReadonlySet<string>;
  /** Status text the fixture shows, for the Planning View. Never used as the result oracle. */
  readonly statusText?: string | null;
}

/** What a human is being asked, in the words they will see. */
export interface GrantRequest {
  readonly ref: string;
  readonly piiClass: PiiClass;
  /** The element the value would go into, by stable reference. */
  readonly target: string;
  readonly targetLabel: string;
  readonly fingerprint: string;
  readonly origin: string;
  readonly sessionId: string;
  /** "Allow PratiBimb to use the registered mobile number for Confirm mobile number?" */
  readonly purpose: string;
  /** What happens if they agree, in full: the restoration and the action that follows it. */
  readonly actionContext: string;
  /** The control that will be clicked, so the same decision can authorise it. */
  readonly action: { readonly target: string; readonly label: string };
}

export type GrantDecision =
  | { readonly granted: true }
  /** A refusal, or a prompt that was dismissed, or a UI that could not ask. All stop the run. */
  | { readonly granted: false; readonly reason: "DENIED" | "DISMISSED" | "UNAVAILABLE" };

export interface ClientPorts {
  /** Read the page. Called for OBSERVE, for REFRESH before ACT, and for VERIFY RESULT. */
  observe(): Promise<Observation>;
  /** The untrusted reasoner asked first. A local model, or the deterministic planner. */
  readonly reasoner: ReasonerClient;
  /** What to call the primary reasoner in the record. Defaults to `LOCAL_MODEL`. */
  readonly reasonerKind?: ReasonerKind;
  /**
   * The deterministic planner, kept alive behind the model.
   *
   * Asked only when the fallback policy permits it, and its output goes through parse → validate →
   * bind → grant → confirm → act exactly like the model's. "Known-good" describes its reliability,
   * never its authority.
   */
  readonly fallback?: ReasonerClient;
  /** Ask a human. The only source of consent. */
  requestGrant(request: GrantRequest): Promise<GrantDecision>;
  /**
   * Restore one value into one target, locally. Resolves `true` only if the page took it.
   *
   * Not an agent action, not routed through the permit gate, and never given a value the privacy
   * layer did not release for this exact target.
   */
  insert(target: string, value: string): Promise<boolean>;
  /** The audited bridges `guardedAct` drives. Looking and touching, kept apart. */
  readonly bridges: GuardedBridges;
}
