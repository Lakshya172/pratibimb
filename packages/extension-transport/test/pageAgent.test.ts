/**
 * The content-script agent refuses, and what it refuses is never half-done.
 *
 * Each test names the D-E6-4 case it belongs to. These are implementation tests, not the experiment:
 * they prove the refusal exists, on a surface the test controls. **They are not evidence for D-E6-4.**
 */
import { describe, expect, it } from "vitest";
import { createPageAgent, type PageReply, type PagePoint, type PageSurface } from "../src/index.js";

interface FakeElement {
  selector: string;
  role: string;
  name: string;
  box: { x: number; y: number; w: number; h: number };
}

/** A page whose topmost element is the LAST one covering the point, as painting order works. */
class FakePage implements PageSurface<FakeElement> {
  clock = 1_000;
  readonly fired: { selector: string; point: PagePoint }[] = [];
  constructor(
    public elements: FakeElement[] = [
      { selector: "#panel", role: "region", name: "Panel", box: { x: 0, y: 0, w: 1024, h: 768 } },
      { selector: "#save", role: "button", name: "Save", box: { x: 400, y: 300, w: 120, h: 40 } },
    ],
    public viewportSize = { w: 1024, h: 768 }
  ) {}

  now(): number {
    this.clock += 1;
    return this.clock;
  }
  viewport() {
    return { w: this.viewportSize.w, h: this.viewportSize.h, dpr: 1, scrollX: 0, scrollY: 0 };
  }
  elementAt(p: PagePoint): FakeElement | null {
    let hit: FakeElement | null = null;
    for (const e of this.elements) {
      if (p.x >= e.box.x && p.x < e.box.x + e.box.w && p.y >= e.box.y && p.y < e.box.y + e.box.h) hit = e;
    }
    return hit;
  }
  describe(e: FakeElement) {
    return { selector: e.selector, role: e.role, name: e.name, box: e.box };
  }
  measure() {
    return {
      measurements: this.elements.map((e) => ({
        selector: e.selector,
        role: e.role,
        name: e.name,
        rect: e.box,
        enabled: true,
        cssHidden: false,
        parentIndex: -1,
      })),
      focus: { state: "NONE" } as const,
    };
  }
  visualRegions() {
    return [];
  }
  /** The browser's event objects are modelled as integer-only, so exactness has something to fail on. */
  prepareClick(element: FakeElement, point: PagePoint) {
    const exact = Number.isInteger(point.x) && Number.isInteger(point.y);
    return {
      coordinatesExact: exact,
      fire: () => {
        this.fired.push({ selector: element.selector, point });
      },
    };
  }
}

const POINT = { x: 460, y: 320 };
const hitTest = (cycleId: string, point: PagePoint = POINT, requestId = "r-hit") => ({ op: "HIT_TEST", requestId, cycleId, point });
const dispatch = (cycleId: string, deliveryId: string, point: PagePoint = POINT, requestId = "r-dis") => ({
  op: "DISPATCH",
  requestId,
  cycleId,
  deliveryId,
  point,
});
const refusalOf = (reply: PageReply | null): string | null => (reply && reply.op === "REFUSED" ? reply.refused : null);

describe("hit test", () => {
  it("answers with what is topmost at the point (C01)", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    const reply = agent.handle(hitTest("c1"));
    expect(reply?.op).toBe("HIT_TEST");
    expect(reply && reply.op === "HIT_TEST" && reply.topmost?.selector).toBe("#save");
    expect(reply && reply.op === "HIT_TEST" && reply.sampledAt).toBeGreaterThan(0);
  });

  it("answers the overlay once it is on top, not the target underneath (C02)", () => {
    const page = new FakePage();
    page.elements.push({ selector: "#overlay", role: "generic", name: "", box: { x: 380, y: 280, w: 200, h: 80 } });
    const reply = createPageAgent(page).handle(hitTest("c1"));
    expect(reply && reply.op === "HIT_TEST" && reply.topmost?.selector).toBe("#overlay");
  });

  it("reports nothing at the point as a finding, never as an unknown (C05)", () => {
    const page = new FakePage([{ selector: "#save", role: "button", name: "Save", box: { x: 400, y: 300, w: 120, h: 40 } }]);
    page.elements = [];
    const reply = createPageAgent(page).handle(hitTest("c1"));
    expect(reply && reply.op === "HIT_TEST" && reply.topmost).toBeNull();
  });

  it("refuses a point outside the viewport instead of calling it empty", () => {
    const agent = createPageAgent(new FakePage());
    expect(refusalOf(agent.handle(hitTest("c1", { x: 2000, y: 320 })))).toBe("POINT_OUTSIDE_VIEWPORT");
    expect(refusalOf(agent.handle(hitTest("c2", { x: -1, y: 320 })))).toBe("POINT_OUTSIDE_VIEWPORT");
  });

  it("answers a cycle once", () => {
    const agent = createPageAgent(new FakePage());
    expect(agent.handle(hitTest("c1"))?.op).toBe("HIT_TEST");
    expect(refusalOf(agent.handle(hitTest("c1")))).toBe("CYCLE_ALREADY_HIT_TESTED");
  });
});

describe("dispatch", () => {
  it("dispatches once, at exactly the authorised point, to whatever is topmost there (C01)", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    const reply = agent.handle(dispatch("c1", "d1"));
    expect(reply?.op).toBe("DISPATCH");
    expect(page.fired).toEqual([{ selector: "#save", point: POINT }]);
    expect(reply && reply.op === "DISPATCH" && reply.dispatchedTo.selector).toBe("#save");
  });

  it("dispatches to the overlay that arrived after the hit test, and never to the target (R1)", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    page.elements.push({ selector: "#overlay", role: "generic", name: "", box: { x: 380, y: 280, w: 200, h: 80 } });
    agent.handle(dispatch("c1", "d1"));
    expect(page.fired.map((f) => f.selector)).toEqual(["#overlay"]);
  });

  it("refuses a point the cycle did not hit test, even one still inside the target (C08c)", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    expect(refusalOf(agent.handle(dispatch("c1", "d1", { x: 490, y: 320 })))).toBe("POINT_NOT_HIT_TESTED");
    expect(page.fired).toEqual([]);
  });

  it("refuses a delivery for a cycle with no hit test", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    expect(refusalOf(agent.handle(dispatch("c-unknown", "d1")))).toBe("NO_HIT_TEST_FOR_CYCLE");
    expect(page.fired).toEqual([]);
  });

  it("refuses a repeated delivery id, and the repeat changes nothing (C11b)", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    expect(agent.handle(dispatch("c1", "d1"))?.op).toBe("DISPATCH");
    expect(refusalOf(agent.handle(dispatch("c1", "d1")))).toBe("DUPLICATE_DELIVERY");
    expect(page.fired).toHaveLength(1);
  });

  it("refuses a second delivery of the same cycle under a fresh id (C11a)", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    agent.handle(dispatch("c1", "d1"));
    expect(refusalOf(agent.handle(dispatch("c1", "d2")))).toBe("CYCLE_ALREADY_DISPATCHED");
    expect(page.fired).toHaveLength(1);
  });

  it("spends the cycle on a refused attempt too, so a retry cannot fix it into a click", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    expect(refusalOf(agent.handle(dispatch("c1", "d1", { x: 490, y: 320 })))).toBe("POINT_NOT_HIT_TESTED");
    expect(refusalOf(agent.handle(dispatch("c1", "d2", POINT)))).toBe("CYCLE_ALREADY_DISPATCHED");
    expect(page.fired).toEqual([]);
  });

  it("refuses when the target has gone and nothing is at the point (C05)", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    page.elements = [];
    expect(refusalOf(agent.handle(dispatch("c1", "d1")))).toBe("NOTHING_AT_POINT");
    expect(page.fired).toEqual([]);
  });

  it("refuses coordinates the browser would not carry exactly, rather than rounding them", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    const fractional = { x: 460.5, y: 320 };
    agent.handle(hitTest("c1", fractional));
    expect(refusalOf(agent.handle(dispatch("c1", "d1", fractional)))).toBe("POINT_NOT_REPRESENTABLE");
    expect(page.fired).toEqual([]);
  });
});

describe("message hygiene", () => {
  it("refuses a malformed request but still correlates the refusal", () => {
    const agent = createPageAgent(new FakePage());
    expect(refusalOf(agent.handle({ op: "CLICK_SELECTOR", requestId: "r1", selector: "#save" }))).toBe("MALFORMED_REQUEST");
    expect(agent.handle({ op: "CLICK_SELECTOR" })).toBeNull();
  });

  it("observes and reads the clock without touching cycle state", () => {
    const agent = createPageAgent(new FakePage());
    const observed = agent.handle({ op: "OBSERVE", requestId: "r1" });
    expect(observed?.op).toBe("OBSERVE");
    expect(observed && observed.op === "OBSERVE" && observed.measurements).toHaveLength(2);
    expect(agent.handle({ op: "CLOCK", requestId: "r2" })?.op).toBe("CLOCK");
    expect(agent.cycleCount()).toBe(0);
  });

  it("refuses rather than evicting when its bounded state is full", () => {
    const agent = createPageAgent(new FakePage(), 2);
    expect(agent.handle(hitTest("c1"))?.op).toBe("HIT_TEST");
    expect(agent.handle(hitTest("c2"))?.op).toBe("HIT_TEST");
    expect(refusalOf(agent.handle(hitTest("c3")))).toBe("STATE_CAPACITY_EXHAUSTED");
  });
});

/**
 * M2-EXEC — ONE APPROVED TASK, ONE BROWSER ACTION.
 *
 * M2 saw ten raw events at a button where five were expected, while the transport recorded one
 * dispatch and zero refusals, and could not say which of five things had happened. Three of those
 * five are answerable here, in Node, against a surface this test controls:
 *
 *   A. two logical dispatches — the agent was asked twice
 *   B. two transport deliveries — the same ask arrived twice
 *   C. two browser actions — `fire()` ran twice
 *
 * The point of every test below is the same pair of assertions: the refusal, and **`page.fired`**.
 * A refusal that still fired would be the exact bug the symptom looked like, and a refusal code on
 * its own cannot rule it out. So the count of real dispatches is asserted every time.
 *
 * The audit is asserted alongside `page.fired` so that the instrument the evidence run reads is
 * itself checked against the thing it claims to measure. An instrument nobody checks is a belief.
 */
describe("one approved task, one browser action (M2-EXEC)", () => {
  it("fires exactly once for one cycle, and says so", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    expect(agent.handle(dispatch("c1", "d1"))?.op).toBe("DISPATCH");

    expect(page.fired).toHaveLength(1);
    const audit = agent.audit();
    expect(audit.firesStarted).toBe(1);
    expect(audit.firesCompleted).toBe(1);
    expect(audit.dispatchRequests).toBe(1);
    expect(audit.refusals).toEqual([]);
    expect(audit.fires).toHaveLength(1);
    expect(audit.fires[0]?.cycleId).toBe("c1");
    expect(audit.fires[0]?.deliveryId).toBe("d1");
    expect(audit.fires[0]?.to).toBe("#save");
  });

  it("A: a second dispatch for the same cycle refuses and fires nothing, even with a fresh delivery id", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    agent.handle(dispatch("c1", "d1"));
    expect(refusalOf(agent.handle(dispatch("c1", "d2")))).toBe("CYCLE_ALREADY_DISPATCHED");

    expect(page.fired).toHaveLength(1);
    expect(agent.audit().firesStarted).toBe(1);
    expect(agent.audit().dispatchRequests).toBe(2);
    expect(agent.audit().refusals).toContain("CYCLE_ALREADY_DISPATCHED");
  });

  it("B: the same delivery arriving twice refuses and fires nothing", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    agent.handle(dispatch("c1", "d1"));
    expect(refusalOf(agent.handle(dispatch("c1", "d1")))).toBe("DUPLICATE_DELIVERY");

    expect(page.fired).toHaveLength(1);
    expect(agent.audit().firesStarted).toBe(1);
  });

  it("A: a second cycle needs its own hit test, and a dispatch without one fires nothing", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    agent.handle(dispatch("c1", "d1"));
    expect(refusalOf(agent.handle(dispatch("c2", "d2")))).toBe("NO_HIT_TEST_FOR_CYCLE");

    expect(page.fired).toHaveLength(1);
    expect(agent.audit().firesStarted).toBe(1);
  });

  it("counts a refused dispatch as an attempt and not as an action", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    expect(refusalOf(agent.handle(dispatch("c1", "d1", { x: 10, y: 10 })))).toBe("POINT_NOT_HIT_TESTED");

    expect(page.fired).toHaveLength(0);
    const audit = agent.audit();
    expect(audit.dispatchRequests).toBe(1);
    expect(audit.firesStarted).toBe(0);
    expect(audit.firesCompleted).toBe(0);
    expect(audit.fires).toEqual([]);
  });

  it("records a sequence that threw part-way as started and not completed", () => {
    const page = new FakePage();
    page.prepareClick = (element, point) => ({
      coordinatesExact: true,
      fire: () => {
        page.fired.push({ selector: element.selector, point });
        throw new Error("the document went away mid-sequence");
      },
    });
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    expect(() => agent.handle(dispatch("c1", "d1"))).toThrow();

    // The distinction matters: "fired and we do not know how far it got" is not "did not fire".
    const audit = agent.audit();
    expect(audit.firesStarted).toBe(1);
    expect(audit.firesCompleted).toBe(0);
    expect(audit.fires[0]?.doneAt).toBeNull();
  });

  it("dates the events from before they were dispatched, which is what attribution needs", () => {
    const page = new FakePage();
    const agent = createPageAgent(page);
    agent.handle(hitTest("c1"));
    agent.handle(dispatch("c1", "d1"));

    // A MouseEvent's timeStamp is fixed at construction, so a page-side observation carries a time
    // from before `at`. A window anchored at `at` would call our own click somebody else's.
    const fire = agent.audit().fires[0];
    expect(fire?.preparedAt).toBeLessThan(fire?.at ?? 0);
    expect(fire?.doneAt ?? 0).toBeGreaterThanOrEqual(fire?.at ?? 0);
  });

  it("C: two agents over one document are two separate counts, which is why only one may connect", () => {
    // If a document ever held two agents, each would have its own cycle and delivery state and
    // neither would see the other's dispatch — so both would fire, and both would be right to. That
    // is exactly the shape of the M2 symptom, and it is why the router refuses the second port
    // rather than the agent refusing the second dispatch. See swRouter.test.ts.
    const page = new FakePage();
    const first = createPageAgent(page);
    const second = createPageAgent(page);
    first.handle(hitTest("c1"));
    second.handle(hitTest("c1"));
    first.handle(dispatch("c1", "d1"));
    second.handle(dispatch("c1", "d1"));

    expect(page.fired).toHaveLength(2);
    expect(first.audit().firesStarted).toBe(1);
    expect(second.audit().firesStarted).toBe(1);
  });
});
