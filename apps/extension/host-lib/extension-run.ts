/**
 * ONE TASK, RUN FROM THE OFFSCREEN DOCUMENT, THROUGH THE REAL EXTENSION.
 *
 * This is the demo's `apps/demo/src/main.ts` with the same parts in the same order and a different
 * page underneath it: the page is in a tab, reached through the content script and the service
 * worker, instead of a same-origin frame in the same realm. Everything between `runTask` and the
 * click is the shipped packages, unmodified and unwrapped.
 *
 * WHAT THIS FILE IS ALLOWED TO DECIDE: nothing. It chooses which reasoner is asked and at what
 * address — the two things a deployment chooses — and it holds the lifetimes, which ADR-0008 §5
 * leaves open and which therefore have to be stated somewhere. Every refusal in the run belongs to
 * a package.
 *
 * THE THREE ACTS DIFFER BY ONE THING. Not a flag, not a mode, not a branch: **what is listening at
 * the reasoner's address**. An honest front, a hostile front, or nothing at all. The security path is
 * the same object graph in all three, which is the claim the evidence has to be able to make.
 *
 * WHY THE ADDRESS IS ALWAYS THE SAME ONE. The manifest pins `connect-src` to a single loopback
 * origin (ADR-0001 §7.2), and M1 does not widen it. So the acts share an address and differ in what
 * answers there — which is closer to a real outage than three addresses would be.
 *
 * WHERE THE PAGE'S VALUES ARE. Not here. They are read, classified and held in the content
 * script's isolated world, and this realm is handed a `PrivacyBoundary` onto that world rather than
 * a vault. Nothing in this file, in the orchestrator, in the planner, in the reasoner or in the
 * egress guard ever holds one — which is checkable by reading what `createRemotePrivacyBoundary`
 * is able to return.
 *
 * THE HUMAN. `requestGrant` is left pending until something outside this realm answers it. Nothing
 * here can answer it, the reasoner cannot reach it, and the service worker only carries the answer.
 * In an automated run the operator answers through the harness, exactly as the demo rehearsal's
 * `auto` mode does — and M1 does not claim to have built a human-facing grant surface.
 */
import { type EgressRecord, type EgressRefusal } from "@pratibimb/egress";
import { observePage, type TransportBinding, type TransportRelay } from "@pratibimb/extension-transport";
import { runTask, type GrantDecision, type GrantRequest, type Observation, type RunRecord } from "@pratibimb/orchestrator";
import { deterministicReasoner, localModelReasoner, type ReasonerClient } from "@pratibimb/reasoner";

import { type BoundaryReply, type BoundaryRequest, type CapabilityPayload } from "./boundary-protocol";
import { createExtensionPorts, type ExtensionPortsOptions, type ExtensionPortsReport } from "./extension-ports";
import { type PerceptionSummary } from "./perception-realm";
import { createRemotePrivacyBoundary, type RemoteBoundaryReport } from "./remote-privacy-boundary";
import { type ReleaseAuthority } from "./value-release";

/**
 * Lifetimes. **None of these is approved by the repository** — ADR-0008 §5 leaves the permit TTL an
 * open owner decision, and the rest are stated here for the same reason: so that something has to
 * state them. The release TTL is the shortest, because it is the only one that gates a value.
 */
export const TTL = { permitMs: 5_000, confirmationMs: 60_000, grantMs: 60_000, releaseMs: 10_000 } as const;

export type ExtensionActId = "SUCCESS" | "REFUSAL" | "OUTAGE";

export interface ExtensionRunRequest {
  readonly tabId: number;
  readonly frameId: number;
  readonly goal: string;
  readonly act: ExtensionActId;
  /** The reasoner's address. The manifest's one pinned origin, or `null` for the in-process planner. */
  readonly endpoint: string | null;
  readonly sessionId: string;
  readonly requestId: string;
}

/**
 * A reading, with everything that could carry a value taken out.
 *
 * `fields` holds the client's own details and `graph.nodes` hold accessible names read from the
 * page, and both would otherwise be in the record that crosses the worker. An allow-list, not a
 * deny-list: what is listed here is everything that crosses, and adding to it is a decision.
 */
export interface ObservationSummary {
  readonly nodes: number;
  readonly fields: number;
  readonly frameId: string;
  readonly viewport: Observation["viewport"];
  readonly documentId: string;
  readonly focusedSelector?: string | null;
  readonly actionable: readonly string[];
}

/**
 * The record, minus the two readings.
 *
 * Everything else in a `RunRecord` is value-free by construction and by test: the handoff is the
 * verified one, the plan is redacted, the reasoner's raw response is dropped before it is stored,
 * and `rehydrated` carries references and booleans. The observations are the exception, and they
 * are the reason this projection exists at all.
 */
export type CrossableRunRecord = Omit<RunRecord, "initialObservation" | "observation"> & {
  readonly initialObservation: ObservationSummary | null;
  readonly observation: ObservationSummary | null;
};

export interface ExtensionRunResult {
  readonly record: CrossableRunRecord;
  readonly binding: {
    readonly origin: string;
    readonly documentId: string;
    readonly tabId: number;
    readonly frameId: number;
    readonly swBootId: string;
  };
  readonly ports: ExtensionPortsReport;
  /** What the privacy boundary did, in counts. Never text. */
  readonly boundary: RemoteBoundaryReport;
  /** Every egress attempt this run made, as `packages/egress` recorded it. */
  readonly egress: readonly { record?: EgressRecord; refusal?: EgressRefusal }[];
  /** M3: how the perception realm came up. Null when this build ran the DOM-only floor. */
  readonly perceptionBoot: unknown;
  readonly grant: { readonly asked: boolean; readonly granted: boolean | null };
}

/** How the offscreen realm asks the page to come and collect, and how a human answers. */
export interface ExtensionRunDeps {
  readonly relay: TransportRelay;
  /**
   * The realm's ONE capability authority — the same object the collection handler redeems from.
   *
   * It is passed in rather than created here for a reason worth keeping: a run that made its own
   * would arm capabilities into a map nothing redeems from, and every collection would refuse with
   * `UNKNOWN_OR_CONSUMED_NONCE` while looking, from the outside, exactly like a capability system
   * working correctly. Arming and redeeming must be the same authority or neither is evidence.
   */
  readonly capabilities: ReleaseAuthority<CapabilityPayload>;
  sendToBoundary(binding: TransportBinding, body: BoundaryRequest): Promise<BoundaryReply>;
  /** Park the request until someone outside this realm decides. Never resolved from in here. */
  askHuman(request: GrantRequest): Promise<GrantDecision>;
  /**
   * M3 — the local perception pass, or nothing.
   *
   * Handed in for the same reason the reasoner and the capability authority are: this file decides
   * nothing, and a realm that built its own perception would be a second place that knows how to
   * look at a page. Absent means the DOM-only floor.
   */
  perceive?: ExtensionPortsOptions["perceive"];
  /** What happened when the ORT session was brought up, for the evidence record. */
  perceptionBoot?: () => unknown;
}

const summarise = (observation: Observation | null): ObservationSummary | null =>
  observation === null
    ? null
    : {
        nodes: observation.graph.nodes.length,
        fields: observation.fields.length,
        frameId: String(observation.graph.frameId),
        viewport: observation.viewport,
        documentId: observation.documentId,
        ...(observation.focusedSelector === undefined ? {} : { focusedSelector: observation.focusedSelector }),
        actionable: [...observation.actionable],
      };

/**
 * WHAT MAY LEAVE THIS REALM.
 *
 * The run's record is an object of the core realm. Handing it to the worker whole would put the
 * client's own details into a message every listening context receives — which is the exact thing
 * the release mechanism exists to avoid, undone by a convenience. So the two readings are replaced
 * by counts before anything crosses.
 */
const crossable = (record: RunRecord): CrossableRunRecord => ({
  ...record,
  initialObservation: summarise(record.initialObservation),
  observation: summarise(record.observation),
});

export async function runExtensionTask(
  deps: ExtensionRunDeps,
  request: ExtensionRunRequest
): Promise<ExtensionRunResult> {
  // The binding comes first and everything else is bound to it: the browser attests which document
  // answered, and no later message may name a different one.
  const observation = await observePage(deps.relay, { tabId: request.tabId, frameId: request.frameId });
  const binding = observation.binding;
  const origin = binding.document.origin;

  const egress: { record?: EgressRecord; refusal?: EgressRefusal }[] = [];
  const onEgress = (event: { record?: EgressRecord; refusal?: EgressRefusal }): void => {
    egress.push(event);
  };

  // The deterministic planner, always behind whatever answers first. It is the fallback in every
  // act, including the one where the primary reasoner is hostile — where the client must NOT fall
  // back, and the record has to show that it did not.
  const deterministic: ReasonerClient = deterministicReasoner();
  const reasoner: ReasonerClient =
    request.endpoint === null ? deterministic : localModelReasoner({ endpoint: request.endpoint, onEgress });

  const grant = { asked: false, granted: null as boolean | null };

  /**
   * M3 — the most recent perception pass, for the manifest the core realm assembles.
   *
   * Held here, between the port that produces it and the boundary that declares it, so neither has
   * to know about the other. It carries counts, geometry, codes and a source per element id; there
   * is no pixel-bearing type in `PerceptionSummary` and no string in it that came from the page's
   * rendering.
   */
  let seen: PerceptionSummary | null = null;

  const privacy = createRemotePrivacyBoundary({
    binding,
    send: (body) => deps.sendToBoundary(binding, body),
    capabilities: deps.capabilities,
    capabilityTtlMs: TTL.releaseMs,
    visual: () => {
      // A pass that refused declares nothing. The floor is the honest claim, not a hopeful one.
      if (seen === null || !seen.ran || !seen.detector.ran || seen.capture === null) return null;
      return {
        backend: seen.detector.backend,
        tiersFired: ["T0", "T1", "T2"],
        scaleToCss: seen.capture.scaleToCss,
        // Keyed by selector, which is how the privacy layer identifies an element.
        sourceById: seen.sourceBySelector,
      };
    },
  });

  const { ports, report } = createExtensionPorts({
    relay: deps.relay,
    binding,
    origin,
    privacy,
    reasoner,
    reasonerKind: request.endpoint === null ? "DETERMINISTIC_FALLBACK" : "LOCAL_MODEL",
    fallback: deterministic,
    ...(deps.perceive
      ? {
          perceive: async (graph, measurement, visualRegions, perceiveOptions) => {
            const summary = await deps.perceive!(graph, measurement, visualRegions, perceiveOptions);
            seen = summary;
            return summary;
          },
        }
      : {}),
    requestGrant: async (grantRequest) => {
      grant.asked = true;
      const decision = await deps.askHuman(grantRequest);
      grant.granted = decision.granted;
      return decision;
    },
  });

  try {
    const record = await runTask(ports, {
      goal: request.goal,
      sessionId: request.sessionId,
      requestId: request.requestId,
      origin,
      permitTtlMs: TTL.permitMs,
      confirmationTtlMs: TTL.confirmationMs,
      grantTtlMs: TTL.grantMs,
    });

    return {
      record: crossable(record),
      binding: {
        origin,
        documentId: binding.document.documentId,
        tabId: binding.document.tabId,
        frameId: binding.document.frameId,
        swBootId: binding.swBootId,
      },
      ports: report,
      perceptionBoot: deps.perceptionBoot ? deps.perceptionBoot() : null,
      boundary: privacy.report,
      egress,
      grant,
    };
  } finally {
    // However the run ended — success, refusal, or a throw — no capability outlives it.
    deps.capabilities.revokeAll();
    // The vault in the page's world is destroyed rather than left to expire.
    await privacy.forget().catch(() => 0);
  }
}
