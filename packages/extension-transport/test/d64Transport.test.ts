/**
 * The transport under the REAL core: `guardedAct`, the real permit, the real hit-test agreement and
 * the real VERIFY RESULT, over a simulated MV3 browser.
 *
 * Every test names the D-E6-4 case it covers and asserts the behaviour that case pre-registered.
 *
 * **THESE ARE IMPLEMENTATION TESTS, NOT THE EXPERIMENT.** They run against a model of a browser, so
 * they settle nothing about Chrome, produce no timing evidence, and are not results for D-E6-4. What
 * they establish is narrower and worth having before the run: the refusals exist, they are reachable
 * through the real composition, and nothing in the transport turns an unknown into a success.
 *
 * The permit lifetime used here is the pre-registration's **instrument setting** (§7.4), chosen to be
 * non-binding. It is not a proposed TTL and must not be read as one.
 */
import { describe, expect, it, vi } from "vitest";
import {
  act,
  establishHitAgreement,
  guardedAct,
  mintDispatchPermit,
  validateActionFreshness,
  type CssPoint,
  type ExpectedPostcondition,
  type MonotonicClock,
  type TargetClaim,
} from "@pratibimb/agent";
import { cssPx } from "@pratibimb/perception";

import {
  createPostActionObserver,
  createTransportCycle,
  observePage,
  type AttestedDocument,
  type PageObservation,
  type TransportRelay,
} from "../src/index.js";
import { SimulatedBrowser, sequentialIds, type SimulatedDocument } from "./support/simulatedBrowser.js";

/** D-E6-4 §7.4: an instrument setting, deliberately non-binding. NOT a permit-lifetime proposal. */
const INSTRUMENT_TTL_MS = 60_000;

const SAVED: ExpectedPostcondition = { kind: "TARGET_NAME", expected: "Saved" };
const DISABLED: ExpectedPostcondition = { kind: "TARGET_ENABLED", expected: false };
const FOCUS: ExpectedPostcondition = { kind: "FOCUS_ON_TARGET" };

const point = (x: number, y: number): CssPoint => ({ x: cssPx(x), y: cssPx(y) });

interface RelayHooks {
  /** Runs after VALIDATE and AUTHORISE, before the hit-test query leaves the core realm (B1). */
  beforeHitTest?: () => void | Promise<void>;
  /** Runs after the permit is redeemed, before the dispatch leaves the core realm (B2). */
  beforeDispatch?: () => void | Promise<void>;
  /** Route the hit test at another document, as a misrouting fault would. */
  retargetHitTestTo?: () => AttestedDocument;
  /** Alter the point in transit, after the core fixed it. */
  alterDispatchPoint?: { x: number; y: number };
  /** Hold the hit-test answer back, so the core's deadline expires first. */
  delayHitTestMs?: number;
  /** Deliver the identical dispatch message a second time. */
  duplicateDispatch?: boolean;
}

/** The relay is the experiment's fault-injection seam: the harness will wrap it in exactly this way. */
const relayWithHooks = (browser: SimulatedBrowser, hooks: RelayHooks = {}): TransportRelay & { duplicates: unknown[] } => {
  const base = browser.relay;
  const duplicates: unknown[] = [];
  return {
    duplicates,
    async request(request) {
      if (request.body.op === "HIT_TEST") {
        if (hooks.beforeHitTest) await hooks.beforeHitTest();
        const retarget = hooks.retargetHitTestTo?.();
        const outgoing = retarget
          ? { ...request, target: { tabId: retarget.tabId, frameId: retarget.frameId, documentId: retarget.documentId } }
          : request;
        const envelope = await base.request(outgoing);
        if (hooks.delayHitTestMs !== undefined) await new Promise((resolve) => setTimeout(resolve, hooks.delayHitTestMs));
        return envelope;
      }
      if (request.body.op === "DISPATCH") {
        if (hooks.beforeDispatch) await hooks.beforeDispatch();
        const outgoing = hooks.alterDispatchPoint
          ? { ...request, body: { ...request.body, point: hooks.alterDispatchPoint } }
          : request;
        const envelope = await base.request(outgoing);
        if (hooks.duplicateDispatch) duplicates.push(await base.request(outgoing));
        return envelope;
      }
      return base.request(request);
    },
  };
};

interface Plan {
  readonly observation: PageObservation;
  readonly claim: TargetClaim;
}

const newId = sequentialIds("t");

const observeAndClaim = async (relay: TransportRelay, tabId: number, selector: string): Promise<Plan> => {
  const observation = await observePage(relay, { tabId, frameId: 0 }, { newId });
  const node = observation.graph.nodes.find((n) => n.domRef.selector === selector);
  if (!node) throw new Error(`test setup: ${selector} was not observed`);
  const evidence = node.evidence;
  if (evidence.kind !== "OBSERVED" && evidence.kind !== "CLIPPED") throw new Error(`test setup: ${selector} is ${evidence.kind}`);
  return {
    observation,
    claim: {
      nodeId: node.id,
      role: node.role,
      name: node.name,
      frameId: observation.graph.frameId,
      viewportBox: evidence.viewportBox,
    },
  };
};

const runGuarded = async (
  relay: TransportRelay,
  plan: Plan,
  expected: ExpectedPostcondition,
  options: { readonly point?: CssPoint; readonly now?: MonotonicClock; readonly graphFrom?: PageObservation } = {}
) => {
  const cycle = createTransportCycle(relay, plan.observation.binding, { newId });
  const observer = createPostActionObserver(relay, plan.observation.binding, { newId });
  const graph = (options.graphFrom ?? plan.observation).graph;
  const outcome = await guardedAct(
    graph,
    { kind: "click", target: plan.claim, ...(options.point ? { point: options.point } : {}) },
    { action: cycle.action, hitTest: cycle.hitTest },
    {
      verify: { expect: expected, observe: observer.observe },
      permitTtlMs: INSTRUMENT_TTL_MS,
      ...(options.now ? { now: options.now } : {}),
    }
  );
  return { outcome, cycle, observer };
};

const openFixture = (): { browser: SimulatedBrowser; document: SimulatedDocument } => {
  const browser = new SimulatedBrowser();
  return { browser, document: browser.openTab(7) };
};

describe("the authorised path", () => {
  it("C01 — dispatches one click at the authorised point and confirms the effect", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser);
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome, cycle } = await runGuarded(relay, plan, SAVED);

    expect(outcome.reached).toBe("VERIFY_RESULT");
    expect(outcome.hit?.agreement).toBe("MATCH");
    expect(outcome.result?.status).toBe("EXECUTED");
    expect(outcome.verification?.verification).toBe("CONFIRMED");
    expect(document.clicksOn("#save")).toBe(1);
    expect(document.events.every((e) => e.isTrusted === false)).toBe(true);
    expect(document.events.every((e) => e.x === 460 && e.y === 320)).toBe(true);
    expect(cycle.report.dispatch?.dispatchedTo).toBe("#save");
    expect(document.find("#save")?.name).toBe("Saved"); // the oracle agrees with the verdict
  });

  it("C16 — confirms an effect expressed as the target's own state", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser);
    const plan = await observeAndClaim(relay, 7, "#lock");
    const { outcome } = await runGuarded(relay, plan, DISABLED);

    expect(outcome.verification?.verification).toBe("CONFIRMED");
    expect(document.find("#lock")?.enabled).toBe(false);
    expect(document.clicksOn("#lock")).toBe(1);
  });
});

describe("the page changed between validation and dispatch", () => {
  it("C02 — an overlay makes the hit test a MISMATCH and nothing is clicked", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser, {
      beforeHitTest: () => {
        document.elements.push({
          selector: "#overlay",
          role: "generic",
          name: "",
          box: { x: 380, y: 280, w: 200, h: 80 },
          enabled: true,
        });
      },
    });
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome } = await runGuarded(relay, plan, SAVED);

    expect(outcome.reached).toBe("HIT_TEST");
    expect(outcome.hit?.agreement).toBe("MISMATCH");
    expect(outcome.hit && outcome.hit.agreement === "MISMATCH" && outcome.hit.cause).toBe("DIFFERENT_ELEMENT");
    expect(outcome.result).toBeNull();
    expect(document.clicks).toBe(0);
  });

  it("C05 — a removed target is a MISMATCH against what is underneath", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser, {
      beforeHitTest: () => {
        document.elements = document.elements.filter((e) => e.selector !== "#save");
      },
    });
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome } = await runGuarded(relay, plan, SAVED);

    expect(outcome.hit?.agreement).toBe("MISMATCH");
    expect(outcome.hit && outcome.hit.agreement === "MISMATCH" && outcome.hit.observed?.selector).toBe("#panel");
    expect(document.clicks).toBe(0);
  });

  it("C06a — a target moved off the point is a MISMATCH", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser, {
      beforeHitTest: () => {
        const save = document.find("#save");
        if (save) save.box = { ...save.box, x: save.box.x + 200 };
      },
    });
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome } = await runGuarded(relay, plan, SAVED);

    expect(outcome.hit?.agreement).toBe("MISMATCH");
    expect(document.clicks).toBe(0);
  });

  it("C06b — a target still under the point but moved beyond the geometry floor is a MISMATCH", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser, {
      beforeHitTest: () => {
        const save = document.find("#save");
        if (save) save.box = { ...save.box, x: save.box.x + 40 }; // IoU 3200/6400 = 0.50, below 0.8
      },
    });
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome } = await runGuarded(relay, plan, SAVED);

    expect(outcome.hit && outcome.hit.agreement === "MISMATCH" && outcome.hit.cause).toBe("GEOMETRY_DISAGREES");
    expect(document.clicks).toBe(0);
  });

  it("C07 — a renamed target is a MISMATCH, even at the same selector and role", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser, {
      beforeHitTest: () => {
        const save = document.find("#save");
        if (save) save.name = "Discard";
      },
    });
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome } = await runGuarded(relay, plan, SAVED);

    expect(outcome.hit && outcome.hit.agreement === "MISMATCH" && outcome.hit.cause).toBe("NAME_DISAGREES");
    expect(document.clicks).toBe(0);
  });

  it("R1 — an overlay that arrives after MATCH takes the click, and the target receives none", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser, {
      beforeDispatch: () => {
        document.elements.push({
          selector: "#overlay",
          role: "generic",
          name: "",
          box: { x: 380, y: 280, w: 200, h: 80 },
          enabled: true,
        });
      },
    });
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome, cycle } = await runGuarded(relay, plan, SAVED);

    // Point-bound, not element-bound: el.click() would have gone through the overlay to #save.
    expect(cycle.report.dispatch?.dispatchedTo).toBe("#overlay");
    expect(document.clicksOn("#overlay")).toBe(1);
    expect(document.clicksOn("#save")).toBe(0);
    expect(outcome.result?.status).toBe("EXECUTED");
    expect(outcome.verification?.verification).toBe("NOT_CONFIRMED");
    expect(outcome.verification && outcome.verification.verification === "NOT_CONFIRMED" && outcome.verification.cause).toBe(
      "STATE_DIFFERS"
    );
  });
});

describe("the wrong document, frame or origin", () => {
  it("C03 — a stale document refuses, even though its replacement is identical", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser);
    const plan = await observeAndClaim(relay, 7, "#save");
    const replacement = browser.navigate(7); // same layout, new documentId

    const { outcome } = await runGuarded(relay, plan, SAVED);

    expect(outcome.hit?.agreement).toBe("UNKNOWN");
    expect(outcome.hit && outcome.hit.agreement === "UNKNOWN" && outcome.hit.cause).toBe("BRIDGE_THREW");
    expect(document.clicks).toBe(0);
    expect(replacement.clicks).toBe(0);
  });

  it("C04a — a claim from an earlier observation is refused by VALIDATE, before the page is asked", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser);
    const first = await observeAndClaim(relay, 7, "#save");
    const second = await observeAndClaim(relay, 7, "#save");

    const { outcome, cycle } = await runGuarded(relay, first, SAVED, { graphFrom: second.observation });

    expect(outcome.reached).toBe("VALIDATE");
    expect(outcome.decision.decision).toBe("RE_OBSERVE");
    expect(outcome.decision.decision === "RE_OBSERVE" && outcome.decision.reason).toBe("FRAME_MISMATCH");
    expect(cycle.report.hitTest).toBeNull();
    expect(document.clicks).toBe(0);
  });

  it("C04b — an answer from another tab's identical document is refused", async () => {
    const { browser, document } = openFixture();
    const other = browser.openTab(9);
    const plan = await observeAndClaim(relayWithHooks(browser), 7, "#save");
    const relay = relayWithHooks(browser, { retargetHitTestTo: () => other.attested });

    const { outcome } = await runGuarded(relay, plan, SAVED);

    expect(outcome.hit?.agreement).toBe("UNKNOWN");
    expect(document.clicks).toBe(0);
    expect(other.clicks).toBe(0);
  });

  it("C12a — a navigation before the hit test refuses", async () => {
    const { browser, document } = openFixture();
    let replacement: SimulatedDocument | null = null;
    const relay = relayWithHooks(browser, {
      beforeHitTest: () => {
        replacement = browser.navigate(7);
      },
    });
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome } = await runGuarded(relay, plan, SAVED);

    expect(outcome.hit?.agreement).toBe("UNKNOWN");
    expect(document.clicks).toBe(0);
    expect(replacement!.clicks).toBe(0);
  });

  it("C12b — a navigation after the permit is spent refuses, and the outcome stays UNKNOWN", async () => {
    const { browser, document } = openFixture();
    let replacement: SimulatedDocument | null = null;
    const relay = relayWithHooks(browser, {
      beforeDispatch: () => {
        replacement = browser.navigate(7);
      },
    });
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome, observer } = await runGuarded(relay, plan, SAVED);

    expect(outcome.hit?.agreement).toBe("MATCH");
    expect(outcome.result?.status).toBe("EXECUTION_ERROR");
    expect(outcome.verification?.verification).toBe("UNKNOWN");
    expect(outcome.verification && outcome.verification.verification === "UNKNOWN" && outcome.verification.cause).toBe(
      "DISPATCH_OUTCOME_UNKNOWN"
    );
    expect(document.clicks).toBe(0);
    expect(replacement!.clicks).toBe(0);
    expect(observer.report.refusals).toEqual(["NO_DOCUMENT_CONNECTION"]);
  });
});

describe("the point", () => {
  it("C08a — a proposed point outside the target is refused by VALIDATE", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser);
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome, cycle } = await runGuarded(relay, plan, SAVED, { point: point(380, 320) });

    expect(outcome.reached).toBe("VALIDATE");
    expect(outcome.decision.decision === "RE_OBSERVE" && outcome.decision.reason).toBe("POINT_OUTSIDE_TARGET");
    expect(cycle.report.hitTest).toBeNull();
    expect(document.clicks).toBe(0);
  });

  it("C08c — a point altered in transit is refused by the page, still inside the target", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser, { alterDispatchPoint: { x: 490, y: 320 } });
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome, cycle } = await runGuarded(relay, plan, SAVED);

    expect(outcome.hit?.agreement).toBe("MATCH");
    expect(outcome.result?.status).toBe("EXECUTION_ERROR");
    expect(outcome.verification?.verification).toBe("UNKNOWN");
    expect(cycle.report.refusals).toEqual(["POINT_NOT_HIT_TESTED"]);
    expect(document.clicks).toBe(0);
  });
});

describe("the hit-test answer", () => {
  it("C09 — an answer after the deadline is UNKNOWN, and the late answer clicks nothing", async () => {
    vi.useFakeTimers();
    try {
      const { browser, document } = openFixture();
      const relay = relayWithHooks(browser, { delayHitTestMs: 2_500 });
      const plan = await observeAndClaim(relay, 7, "#save");
      const running = runGuarded(relay, plan, SAVED);

      await vi.advanceTimersByTimeAsync(2_000); // the core's default hit-test deadline
      const { outcome } = await running;
      expect(outcome.reached).toBe("HIT_TEST");
      expect(outcome.hit && outcome.hit.agreement === "UNKNOWN" && outcome.hit.cause).toBe("BRIDGE_TIMEOUT");

      await vi.advanceTimersByTimeAsync(1_000); // the answer arrives late
      expect(document.clicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the permit", () => {
  it("C10 — an expired permit is refused at redemption and never reaches the page", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser);
    const plan = await observeAndClaim(relay, 7, "#save");
    let call = 0;
    const now: MonotonicClock = () => {
      call += 1;
      return call === 1 ? 1_000 : 1_000 + INSTRUMENT_TTL_MS; // minted, then redeemed after expiry
    };
    const { outcome, cycle } = await runGuarded(relay, plan, SAVED, { now });

    expect(outcome.reached).toBe("ACT");
    expect(outcome.result?.status).toBe("REJECTED");
    expect(outcome.result && outcome.result.status === "REJECTED" && outcome.result.cause).toBe("PERMIT_EXPIRED");
    expect(outcome.verification).toBeNull();
    expect(cycle.report.dispatch).toBeNull();
    expect(document.clicks).toBe(0);
  });

  it("C11a — a replayed permit is refused by the gate, and the page is asked once", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser);
    const plan = await observeAndClaim(relay, 7, "#save");
    const cycle = createTransportCycle(relay, plan.observation.binding, { newId });

    // guardedAct never exposes a permit, so a replay has to be composed from the exported stages —
    // in guardedAct's own order, with nothing awaited between MINT and ACT.
    const decision = validateActionFreshness(plan.observation.graph, { kind: "click", target: plan.claim });
    const hit = await establishHitAgreement(decision, cycle.hitTest, {});
    const minted = mintDispatchPermit(decision, hit, { ttlMs: INSTRUMENT_TTL_MS });
    if (!minted.minted) throw new Error("test setup: the gate refused to mint");

    const first = await act(minted.permit, cycle.action);
    const replay = await act(minted.permit, cycle.action);

    expect(first.status).toBe("EXECUTED");
    expect(replay.status).toBe("REJECTED");
    expect(replay.status === "REJECTED" && replay.cause).toBe("PERMIT_CONSUMED");
    expect(document.clicksOn("#save")).toBe(1);
  });

  it("C11b — a redelivered dispatch message is refused by the page, and clicks once", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser, { duplicateDispatch: true });
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome } = await runGuarded(relay, plan, SAVED);

    expect(outcome.verification?.verification).toBe("CONFIRMED");
    expect(document.clicksOn("#save")).toBe(1);
    expect(relay.duplicates).toHaveLength(1);
    expect(JSON.stringify(relay.duplicates[0])).toContain("DUPLICATE_DELIVERY");
  });
});

describe("the service worker", () => {
  it("C13 — a restart before delivery clicks nothing, and a fresh attempt afterwards works", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser, { beforeDispatch: () => browser.restartServiceWorker() });
    const plan = await observeAndClaim(relay, 7, "#save");
    const { outcome, cycle } = await runGuarded(relay, plan, SAVED);

    expect(outcome.hit?.agreement).toBe("MATCH");
    expect(outcome.result?.status).toBe("EXECUTION_ERROR");
    expect(outcome.verification?.verification).toBe("UNKNOWN");
    expect(cycle.report.refusals).toEqual(["SW_BOOT_MISMATCH"]);
    expect(document.clicks).toBe(0);

    // The recovery cycle acquires a fresh binding — a new observation under the new boot.
    const fresh = relayWithHooks(browser);
    const freshPlan = await observeAndClaim(fresh, 7, "#save");
    const recovered = await runGuarded(fresh, freshPlan, SAVED);

    expect(recovered.outcome.verification?.verification).toBe("CONFIRMED");
    expect(document.clicksOn("#save")).toBe(1);
  });

  it("a stale attempt replayed after a restart still refuses", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser);
    const plan = await observeAndClaim(relay, 7, "#save");
    const cycle = createTransportCycle(relay, plan.observation.binding, { newId });
    await cycle.hitTest.topmostAtCssPoint(point(460, 320));

    browser.restartServiceWorker();

    await expect(cycle.action.clickAtCssPoint(point(460, 320))).rejects.toThrow("SW_BOOT_MISMATCH");
    expect(document.clicks).toBe(0);
  });
});

describe("what a dispatch actually established", () => {
  it("C14 — a click that lands while the effect does not happen is NOT_CONFIRMED", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser);
    const plan = await observeAndClaim(relay, 7, "#save-inert");
    const { outcome } = await runGuarded(relay, plan, SAVED);

    expect(outcome.result?.status).toBe("EXECUTED");
    expect(outcome.verification?.verification).toBe("NOT_CONFIRMED");
    expect(document.clicksOn("#save-inert")).toBe(1);
    expect(document.find("#save-inert")?.name).toBe("Save"); // the oracle agrees: no effect
  });

  it("C15a — navigation happens, the target goes, and the answer is UNKNOWN rather than success", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser);
    const plan = await observeAndClaim(relay, 7, "#next");
    const { outcome } = await runGuarded(relay, plan, FOCUS);

    expect(outcome.result?.status).toBe("EXECUTED");
    expect(outcome.verification?.verification).toBe("UNKNOWN");
    expect(outcome.verification && outcome.verification.verification === "UNKNOWN" && outcome.verification.cause).toBe(
      "TARGET_ABSENT_AFTER_ACTION"
    );
    // The landing is real — and it is not confirmation of the requested effect.
    expect(document.hash).toBe("#step2");
    expect(document.find("#step2")).toBeDefined();
  });

  it("C15b — a cancelled toggle lands and is not confirmed", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser);
    const plan = await observeAndClaim(relay, 7, "#sms");
    const { outcome } = await runGuarded(relay, plan, FOCUS);

    expect(outcome.result?.status).toBe("EXECUTED");
    expect(outcome.verification?.verification).toBe("NOT_CONFIRMED");
    expect(document.clicksOn("#sms")).toBe(1);
    expect(document.find("#sms")?.checked).toBe(false); // the oracle: the effect did not happen
  });

  it("C15c — a toggle that works is still not confirmed by a landing-only postcondition", async () => {
    const { browser, document } = openFixture();
    const relay = relayWithHooks(browser);
    const plan = await observeAndClaim(relay, 7, "#same-address");
    const { outcome } = await runGuarded(relay, plan, FOCUS);

    expect(outcome.result?.status).toBe("EXECUTED");
    expect(outcome.verification?.verification).toBe("NOT_CONFIRMED");
    expect(document.find("#same-address")?.checked).toBe(true); // the effect DID happen
  });
});
