/**
 * THE STRUCTURAL PROBE — constitution §6's stale-observation path, step by step.
 *
 * **NOT IN A PRODUCTION BUILD.** `wxt.config.ts` resolves `#structural-probe` to
 * `structural-absent.ts` unless `STRUCTURAL_PROBE=1` is set, and the only caller that sets it is
 * `tests/browser/extension/run-structural-stale.mjs`. See `structural-absent.ts` for why.
 *
 * WHY IT EXISTS. The refusal M6.1 had to demonstrate lives in a window a whole-run harness cannot
 * open on purpose: between the reading a plan is validated against and the dispatch. A harness has
 * to take a reading, change the page ITSELF, and only then ask the gates to act — so the reading
 * must outlive one message, and a serialised graph is not a graph. Hence three steps and a held
 * observation.
 *
 * IT ADDS NO AUTHORITY. `guardedAct` below is the unchanged gate composition — VALIDATE, AUTHORISE,
 * HIT-TEST, MINT, ACT, VERIFY RESULT — driven through the same transport cycle a product run uses.
 * There is no second click path, no second validator, and no way to skip a gate: a refusal here is
 * the product's refusal. What is bypassed is the planner and the privacy stages, exactly as the
 * transport control plane already permits for evidence runs.
 *
 * IT CAPTURES NOTHING. No ticket is minted, no stream is opened, no frame is taken. The whole path
 * is DOM-only, which is why M6.1's evidence can say the capture policy was never exercised.
 *
 * IT RETURNS NO PAGE VALUE. Selectors, counts, codes, booleans and two sequence numbers.
 */
import { guardedAct, guardedActionDispatched, type ProposedAction } from "@pratibimb/agent";
import {
  createTransportCycle,
  observeBoundDocument,
  observePage,
  readStructure,
  toPostActionObservation,
  type TransportBinding,
  type TransportRelay,
} from "@pratibimb/extension-transport";
import { cssPx, type ElementGraph } from "@pratibimb/perception";

/** The reading the probe is holding between steps. Test-only state, in a test-only module. */
let held: { binding: TransportBinding; graph: ElementGraph; seq: number } | null = null;

export interface StructuralProbeMessage {
  readonly kind: "STRUCTURAL_PROBE";
  readonly step: "OBSERVE" | "STRUCTURE" | "ACT";
  readonly tabId?: number;
  readonly frameId?: number;
  readonly selector?: string;
}

async function run(relay: TransportRelay, msg: StructuralProbeMessage): Promise<unknown> {
  if (msg.step === "OBSERVE") {
    const observation = await observePage(relay, { tabId: msg.tabId ?? -1, frameId: msg.frameId ?? 0 });
    held = { binding: observation.binding, graph: observation.graph, seq: observation.structure.seq };
    return {
      ok: true,
      structure: observation.structure,
      nodes: observation.graph.nodes.length,
      documentId: observation.binding.document.documentId,
      selectors: observation.graph.nodes.map((node) => node.domRef.selector),
    };
  }
  if (held === null) return { ok: false, refused: "NO_PROBE_OBSERVATION" };
  const reading = held;

  if (msg.step === "STRUCTURE") {
    // The question the signal exists to answer, asked against the reading actually held.
    const { structure, stale } = await readStructure(relay, reading.binding, reading.seq);
    return { ok: true, structure, stale, heldSeq: reading.seq };
  }

  const node = reading.graph.nodes.find((n) => n.domRef.selector === msg.selector);
  if (!node || (node.evidence.kind !== "OBSERVED" && node.evidence.kind !== "CLIPPED")) {
    return { ok: false, refused: "TARGET_NOT_IN_HELD_GRAPH" };
  }
  const { structure } = await readStructure(relay, reading.binding, reading.seq);
  const box = node.evidence.viewportBox;
  const action: ProposedAction = {
    kind: "click",
    target: { nodeId: node.id, role: node.role, name: node.name, frameId: reading.graph.frameId, viewportBox: box },
    // Integer, for the same reason the machine rounds: a browser truncates event coordinates.
    point: { x: cssPx(Math.round(box.x + box.w / 2)), y: cssPx(Math.round(box.y + box.h / 2)) },
  };
  const cycle = createTransportCycle(relay, reading.binding);
  const outcome = await guardedAct(
    reading.graph,
    action,
    { hitTest: cycle.hitTest, action: cycle.action },
    {
      verify: {
        expect: { kind: "TARGET_ENABLED", expected: false },
        observe: async () => {
          const after = await observeBoundDocument(relay, reading.binding);
          return toPostActionObservation(after.graph, after.focus);
        },
      },
      permitTtlMs: 30_000,
      structure: { watching: structure.watching, seq: structure.seq, observedAtSeq: reading.seq },
    }
  );
  return {
    ok: true,
    reached: outcome.reached,
    decision: outcome.decision.decision,
    reason: outcome.decision.decision === "RE_OBSERVE" ? outcome.decision.reason : null,
    structurallyCurrent: outcome.decision.decision === "ALLOW" ? outcome.decision.structurallyCurrent : null,
    dispatched: guardedActionDispatched(outcome),
    verification: outcome.verification?.verification ?? null,
    witness: { watching: structure.watching, seq: structure.seq, observedAtSeq: reading.seq },
  };
}

/**
 * Serve one probe step, or decline the message.
 *
 * Returns `true` when it will answer asynchronously, matching the listener contract the offscreen
 * document already uses. Declining returns `false`, so the caller falls through unchanged — which
 * is exactly what the absent stub does for every message.
 */
export function serveStructuralProbe(
  relay: TransportRelay,
  message: unknown,
  sender: { tab?: unknown },
  sendResponse: (reply: unknown) => void
): boolean {
  const msg = message as StructuralProbeMessage;
  if (msg?.kind !== "STRUCTURAL_PROBE") return false;
  if (sender.tab) {
    sendResponse({ refused: "PROBE_ONLY_FROM_SERVICE_WORKER" });
    return false;
  }
  void run(relay, msg)
    .then(sendResponse)
    .catch((error: unknown) =>
      sendResponse({ ok: false, refused: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })
    );
  return true;
}
