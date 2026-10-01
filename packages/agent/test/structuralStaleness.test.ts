/**
 * A STALE OBSERVATION CANNOT BE SILENTLY TREATED AS FRESH — constitution §6, ADR-0010.
 *
 * VALIDATE already re-checks one target against one graph. What it could not previously ask is
 * whether the GRAPH still describes the page at all: a claim can pass every per-node check against
 * a reading the page moved past seconds ago. The structural witness is that question, and these
 * tests pin its three answers — current, moved, and unestablished — and pin that the last two are
 * refusals rather than warnings.
 *
 * THE WITNESS COSTS NO CAPTURE. It is two numbers and a flag that a content script's own observers
 * accumulated. That is the whole reason this check can exist under a capture policy which says a
 * frame is taken only when a person asks for one.
 */
import { describe, it, expect } from "vitest";
import {
  actionableTarget,
  mustReObserve,
  validateActionFreshness,
  type ProposedAction,
  type StructuralWitness,
  type TargetClaim,
} from "@pratibimb/agent";
import {
  cssPx,
  docPx,
  frameId,
  nodeId,
  type CssBox,
  type ElementGraph,
  type ElementNode,
  type VisualEvidence,
} from "@pratibimb/perception";

const F1 = frameId("frame-1");
const ID = nodeId("e12");

const box = (x: number, y: number, w: number, h: number): CssBox => ({ x: cssPx(x), y: cssPx(y), w: cssPx(w), h: cssPx(h) });
const observed = (b: CssBox): VisualEvidence => ({
  kind: "OBSERVED",
  frameId: F1,
  viewportBox: b,
  documentBox: { x: docPx(b.x), y: docPx(b.y), w: docPx(b.w), h: docPx(b.h) },
});

const NODE: ElementNode = {
  id: ID,
  role: "button",
  name: "Submit",
  domRef: { selector: "#submit" },
  evidence: observed(box(100, 200, 300, 40)),
  enabled: true,
  parent: null,
  children: [],
};

const GRAPH: ElementGraph = { frameId: F1, nodes: [NODE], byId: new Map([[ID, NODE]]) };

const CLAIM: TargetClaim = { nodeId: ID, role: "button", name: "Submit", frameId: F1, viewportBox: box(100, 200, 300, 40) };
const CLICK: ProposedAction = { kind: "click", target: CLAIM };

const witness = (over: Partial<StructuralWitness> = {}): StructuralWitness => ({
  watching: true,
  seq: 7,
  observedAtSeq: 7,
  ...over,
});

describe("the structural witness", () => {
  it("allows an action against an observation the page has not moved past", () => {
    const d = validateActionFreshness(GRAPH, CLICK, undefined, witness());
    expect(d.decision).toBe("ALLOW");
    expect(d.decision === "ALLOW" && d.structurallyCurrent).toBe(true);
  });

  it("4 & 5 — refuses when the page moved after the reading, producing no fallback target", () => {
    const d = validateActionFreshness(GRAPH, CLICK, undefined, witness({ seq: 9, observedAtSeq: 7 }));

    expect(d.decision).toBe("RE_OBSERVE");
    expect(d.decision === "RE_OBSERVE" && d.reason).toBe("OBSERVATION_STALE");
    expect(mustReObserve(d)).toBe(true);
    // The same load-bearing assertion every other refusal carries: nothing actionable comes back.
    expect(actionableTarget(d)).toBeNull();
    expect((d as { node?: unknown }).node).toBeUndefined();
    expect((d as { viewportBox?: unknown }).viewportBox).toBeUndefined();
  });

  it("refuses when nothing is watching, because unestablished is not fresh", () => {
    const d = validateActionFreshness(GRAPH, CLICK, undefined, witness({ watching: false }));
    expect(d.decision === "RE_OBSERVE" && d.reason).toBe("OBSERVATION_STALE");
    expect(actionableTarget(d)).toBeNull();
  });

  it("refuses BEFORE any per-node check, because the whole graph is what went stale", () => {
    // A claim that would fail on identity as well. The reason reported must be the structural one:
    // re-checking one element against a graph the page has left is the wrong question asked well.
    const wrongRole: ProposedAction = { kind: "click", target: { ...CLAIM, role: "link" } };
    const d = validateActionFreshness(GRAPH, wrongRole, undefined, witness({ seq: 8 }));
    expect(d.decision === "RE_OBSERVE" && d.reason).toBe("OBSERVATION_STALE");
  });

  it("an unasked question is reported as unasked, never as an answer", () => {
    // No witness: exactly the behaviour every existing caller has. The difference is that the ALLOW
    // now SAYS the check did not run, so a record cannot read silence as freshness.
    const d = validateActionFreshness(GRAPH, CLICK);
    expect(d.decision).toBe("ALLOW");
    expect(d.decision === "ALLOW" && d.structurallyCurrent).toBe(null);
  });

  it("does not refuse a control action, which aims at nothing a page could move", () => {
    const d = validateActionFreshness(GRAPH, { kind: "done" }, undefined, witness({ seq: 99 }));
    expect(d.decision).toBe("ALLOW");
    expect(d.decision === "ALLOW" && d.structurallyCurrent).toBe(null);
  });

  it("the refusal names the two sequences, and carries nothing from the page", () => {
    const d = validateActionFreshness(GRAPH, CLICK, undefined, witness({ seq: 12, observedAtSeq: 7 }));
    if (d.decision !== "RE_OBSERVE") throw new Error("expected a refusal");
    expect(d.detail).toMatch(/\b7\b/);
    expect(d.detail).toMatch(/\b12\b/);
    // INV-21: a refusal explains itself without quoting the page it was about.
    expect(d.detail).not.toMatch(/Submit|#submit/);
  });

  it("10 — the witness is two numbers and a flag: there is no capture in it and none of it is a value", () => {
    const w = witness();
    expect(Object.keys(w).sort()).toEqual(["observedAtSeq", "seq", "watching"]);
    for (const value of Object.values(w)) {
      expect(typeof value === "number" || typeof value === "boolean").toBe(true);
    }
  });
});
