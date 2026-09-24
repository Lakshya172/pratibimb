/**
 * THE STRUCTURAL CHANGE SIGNAL — constitution §6, IN FORCE for v1 under ADR-0010 (Option B).
 *
 * These are black-box tests over the page agent: they drive the same `PageSurface` the browser
 * adapter implements, ask the agent the same messages the transport sends, and read the same
 * replies. Nothing reaches into the agent's internals, so what they pin is the CONTRACT — what a
 * structural event may contain, when an observation counts as stale, and above all what a
 * structural event does NOT cause.
 *
 * THE LOAD-BEARING TEST IN THIS FILE IS "TRIGGERS NO CAPTURE". Under the capture policy approved in
 * ADR-0009 a frame is taken only when a person invokes the extension. A change signal that quietly
 * reached for a frame would undo that decision without anyone editing a policy document, so the
 * surface handed to the agent here records EVERY method it is asked for, and the assertion is that
 * a storm of structural events leaves that record empty.
 */
import { describe, expect, it } from "vitest";
import {
  createPageAgent,
  type PageAgent,
  type PagePoint,
  type PageReply,
  type PageSurface,
  type StructuralEvent,
} from "../src/index.js";

interface FakeElement {
  selector: string;
  role: string;
  name: string;
  box: { x: number; y: number; w: number; h: number };
}

const ELEMENT: FakeElement = { selector: "#save", role: "button", name: "Save", box: { x: 400, y: 300, w: 120, h: 40 } };

/**
 * A surface that records everything it is asked to do.
 *
 * `calls` is the whole point: a structural observer that captured, measured, messaged or clicked
 * would have to come through one of these methods, and every one of them leaves a mark.
 */
class WatchedPage implements PageSurface<FakeElement> {
  clock = 1_000;
  readonly calls: string[] = [];
  readonly fired: PagePoint[] = [];
  /** The callback the agent installed, so a test can play the browser and deliver a batch. */
  emit: ((event: StructuralEvent) => void) | null = null;
  disconnected = 0;

  constructor(private readonly watchable = true) {}

  now(): number {
    // NOT recorded in `calls`: the agent timestamps a batch, and a clock read is not an observation,
    // a capture or an action. Recording it would make every other assertion here noise.
    this.clock += 1;
    return this.clock;
  }
  viewport() {
    this.calls.push("viewport");
    return { w: 1024, h: 768, dpr: 1, scrollX: 0, scrollY: 0 };
  }
  elementAt(p: PagePoint): FakeElement | null {
    this.calls.push("elementAt");
    const e = ELEMENT;
    return p.x >= e.box.x && p.x < e.box.x + e.box.w && p.y >= e.box.y && p.y < e.box.y + e.box.h ? e : null;
  }
  describe(e: FakeElement) {
    this.calls.push("describe");
    return { selector: e.selector, role: e.role, name: e.name, box: e.box };
  }
  measure() {
    this.calls.push("measure");
    return {
      measurements: [
        { selector: ELEMENT.selector, role: ELEMENT.role, name: ELEMENT.name, rect: ELEMENT.box, enabled: true, cssHidden: false, parentIndex: -1 },
      ],
      focus: { state: "NONE" } as const,
    };
  }
  prepareClick(_element: FakeElement, point: PagePoint) {
    this.calls.push("prepareClick");
    return {
      coordinatesExact: true,
      fire: () => {
        this.calls.push("fire");
        this.fired.push(point);
      },
    };
  }
  /** What `structuralTracked()` answers. A test sets it; the browser adapter counts observations. */
  tracked = 3;

  structuralTracked(): number {
    return this.tracked;
  }
  watchStructure(onChange: (event: StructuralEvent) => void): () => void {
    if (!this.watchable) throw new Error("this surface cannot watch");
    this.calls.push("watchStructure");
    this.emit = onChange;
    return () => {
      this.disconnected += 1;
    };
  }
}

/**
 * The same surface with **no `watchStructure` property at all** — not one set to `undefined`.
 *
 * Written out method by method rather than by deleting a field, because that is what a surface that
 * cannot watch actually looks like: the agent finds nothing to install and must say so.
 */
const unwatched = (page: WatchedPage): PageSurface<FakeElement> => ({
  now: () => page.now(),
  viewport: () => page.viewport(),
  elementAt: (point) => page.elementAt(point),
  describe: (element) => page.describe(element),
  measure: () => page.measure(),
  prepareClick: (element, point) => page.prepareClick(element, point),
});

/** A watching surface that cannot say how many elements it tracks: the method is simply absent. */
const untracked = (page: WatchedPage): PageSurface<FakeElement> => ({
  now: () => page.now(),
  viewport: () => page.viewport(),
  elementAt: (point) => page.elementAt(point),
  describe: (element) => page.describe(element),
  measure: () => page.measure(),
  prepareClick: (element, point) => page.prepareClick(element, point),
  watchStructure: (onChange) => page.watchStructure(onChange),
});

const NODES: StructuralEvent = { nodes: true, attributes: false, text: false, resized: false };
const ATTRS: StructuralEvent = { nodes: false, attributes: true, text: false, resized: false };
const TEXT: StructuralEvent = { nodes: false, attributes: false, text: true, resized: false };
const RESIZE: StructuralEvent = { nodes: false, attributes: false, text: false, resized: true };

const ask = (agent: PageAgent, op: unknown): PageReply => {
  const reply = agent.handle(op);
  if (reply === null) throw new Error("the agent could not correlate the request");
  return reply;
};

const structureOf = (agent: PageAgent, sinceSeq: number | null) =>
  ask(agent, { op: "STRUCTURE", requestId: "r-str", sinceSeq });

const observe = (agent: PageAgent) => ask(agent, { op: "OBSERVE", requestId: "r-obs" });

const seqOf = (reply: PageReply): number => {
  if (reply.op !== "OBSERVE" && reply.op !== "STRUCTURE") throw new Error("not a reply carrying a reading");
  return reply.structure.seq;
};

describe("a structural change marks the observation stale", () => {
  it("1 — a DOM mutation moves the sequence the observation belongs to", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    const before = seqOf(observe(agent));

    page.emit?.(NODES);

    const after = structureOf(agent, before);
    expect(after.op === "STRUCTURE" && after.stale).toBe(true);
    expect(seqOf(after)).toBe(before + 1);
    expect(after.op === "STRUCTURE" && after.structure.nodes).toBe(1);
  });

  it("2 — a resize marks it stale too, and is counted as its own category", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    const before = seqOf(observe(agent));

    page.emit?.(RESIZE);

    const after = structureOf(agent, before);
    expect(after.op === "STRUCTURE" && after.stale).toBe(true);
    expect(after.op === "STRUCTURE" && after.structure.resizes).toBe(1);
    expect(after.op === "STRUCTURE" && after.structure.nodes).toBe(0);
  });

  it("2a — an attribute change and a text change are distinguished, not merged", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    page.emit?.(ATTRS);
    page.emit?.(TEXT);

    const reading = structureOf(agent, null);
    expect(reading.op === "STRUCTURE" && reading.structure.attributes).toBe(1);
    expect(reading.op === "STRUCTURE" && reading.structure.text).toBe(1);
    expect(seqOf(reading)).toBe(2);
  });

  it("3 — a batch is one increment however much it carried, so a busy page is not a storm", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);

    // One delivered batch that touched everything at once. The browser called back once; the
    // sequence advances once. That is the whole coalescing rule, and it needs no timer.
    page.emit?.({ nodes: true, attributes: true, text: true, resized: true });

    const reading = structureOf(agent, null);
    expect(seqOf(reading)).toBe(1);
    expect(reading.op === "STRUCTURE" && reading.structure.nodes).toBe(1);
    expect(reading.op === "STRUCTURE" && reading.structure.attributes).toBe(1);
    expect(reading.op === "STRUCTURE" && reading.structure.text).toBe(1);
    expect(reading.op === "STRUCTURE" && reading.structure.resizes).toBe(1);
  });

  it("3a — a thousand batches cost a thousand increments and nothing else", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    const before = page.calls.length;

    for (let i = 0; i < 1_000; i += 1) page.emit?.(NODES);

    expect(seqOf(structureOf(agent, null))).toBe(1_000);
    // No measurement, no viewport read, no element touched: a structural event is counters only.
    expect(page.calls.slice(before)).toEqual([]);
  });

  it("5 — an observation the page has moved past is never reported fresh", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    const at = seqOf(observe(agent));
    page.emit?.(ATTRS);

    // Asking about the OLD sequence must keep answering stale, however often it is asked.
    for (let i = 0; i < 3; i += 1) {
      const reply = structureOf(agent, at);
      expect(reply.op === "STRUCTURE" && reply.stale).toBe(true);
    }
    // Only a reading taken since the change is current.
    const current = seqOf(observe(agent));
    const reply = structureOf(agent, current);
    expect(reply.op === "STRUCTURE" && reply.stale).toBe(false);
  });

  it("5a — no observer means UNESTABLISHED, which fails closed rather than fresh", () => {
    const page = unwatched(new WatchedPage());
    const agent = createPageAgent(page);
    const reading = observe(agent);
    expect(reading.op === "OBSERVE" && reading.structure.watching).toBe(false);

    // Nothing has changed — there is simply nothing that could have noticed if it had.
    const reply = structureOf(agent, 0);
    expect(reply.op === "STRUCTURE" && reply.stale).toBe(true);
    expect(reply.op === "STRUCTURE" && reply.structure.watching).toBe(false);
  });

  it("5b — a caller holding no sequence is stale, not fresh", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    const reply = structureOf(agent, null);
    expect(reply.op === "STRUCTURE" && reply.stale).toBe(true);
  });

  it("an observation dates itself, so a graph is current for exactly one sequence", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    page.emit?.(NODES);
    page.emit?.(NODES);
    const reply = observe(agent);
    expect(reply.op === "OBSERVE" && reply.structure.seq).toBe(2);
    expect(reply.op === "OBSERVE" && reply.structure.watching).toBe(true);
  });
});

describe("what a structural event may contain", () => {
  it("6 & 7 — counters and a flag: no selector, no text, no value, no pixel", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    page.emit?.({ nodes: true, attributes: true, text: true, resized: true });

    const reply = structureOf(agent, null);
    if (reply.op !== "STRUCTURE") throw new Error("expected a structural reply");

    expect(Object.keys(reply.structure).sort()).toEqual(
      ["at", "attributes", "nodes", "resizes", "seq", "text", "tracked", "watching"].sort()
    );
    // Every field is a number, a boolean or null. A string cannot appear, so page text cannot.
    for (const [key, value] of Object.entries(reply.structure)) {
      expect(typeof value === "number" || typeof value === "boolean" || value === null, key).toBe(true);
    }
    // And the same said of the whole serialised message, which is what actually crosses.
    const wire = JSON.stringify(reply);
    expect(wire).not.toMatch(/#save|Save|button/);
    expect(wire).not.toMatch(/data:image|iVBORw0KGgo|base64/);
  });

  it("the reading reports its own resize fan-out, from the surface rather than from a claim", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    // §6's "tracked elements". The agent does not count them — it asks the surface that observes
    // them, so the number in the reading is the number of live observations and not an estimate.
    page.tracked = 9;
    const reading = structureOf(agent, null);
    expect(reading.op === "STRUCTURE" && reading.structure.tracked).toBe(9);
  });

  it("a surface that cannot report its fan-out reports zero, not a guess", () => {
    const agent = createPageAgent(untracked(new WatchedPage()));
    const reading = structureOf(agent, null);
    expect(reading.op === "STRUCTURE" && reading.structure.tracked).toBe(0);
  });

  it("the audit reports the same reading, and the batch count alongside it", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    page.emit?.(NODES);
    page.emit?.(RESIZE);

    const audit = agent.audit();
    expect(audit.structuralBatches).toBe(2);
    expect(audit.structure.seq).toBe(2);
    expect(JSON.stringify(audit.structure)).not.toMatch(/#save|Save/);
  });
});

describe("a structural event causes nothing", () => {
  it("8 & 9 — it triggers no capture, no measurement and no perception pass", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    // `watchStructure` is the only call the agent makes at construction.
    expect(page.calls).toEqual(["watchStructure"]);

    for (let i = 0; i < 500; i += 1) {
      page.emit?.(NODES);
      page.emit?.(RESIZE);
      page.emit?.(TEXT);
    }

    // NOTHING. Not a viewport read, not a measurement, not an element, and above all not a frame.
    // There is no capture method on this surface to call, which is the structural half of the
    // argument: the agent has no route to one even if it wanted a frame.
    expect(page.calls).toEqual(["watchStructure"]);
    expect(page.fired).toEqual([]);
    expect(agent.audit().firesStarted).toBe(0);
    expect(agent.audit().hitTests).toBe(0);
    expect(agent.audit().dispatchRequests).toBe(0);
  });

  it("8a — asking for the reading captures nothing and measures nothing either", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    page.emit?.(NODES);
    const before = page.calls.length;

    structureOf(agent, 0);
    structureOf(agent, 1);

    expect(page.calls.slice(before)).toEqual([]);
  });

  it("10 — observing is still the only thing that reads the page, and a person still starts it", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    page.emit?.(NODES);
    expect(page.calls).toEqual(["watchStructure"]);

    // An explicit OBSERVE is what measures. The structural signal never produced one by itself.
    observe(agent);
    expect(page.calls).toEqual(["watchStructure", "measure", "viewport"]);
  });

  it("a structural event cannot dispatch, and cannot make a spent cycle dispatchable again", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    ask(agent, { op: "HIT_TEST", requestId: "r-h", cycleId: "c-1", point: { x: 460, y: 320 } });
    ask(agent, { op: "DISPATCH", requestId: "r-d", cycleId: "c-1", deliveryId: "d-1", point: { x: 460, y: 320 } });
    expect(agent.audit().firesStarted).toBe(1);

    for (let i = 0; i < 50; i += 1) page.emit?.(NODES);

    // The cycle is spent and a page that moved does not unspend it.
    const again = ask(agent, { op: "DISPATCH", requestId: "r-d2", cycleId: "c-1", deliveryId: "d-2", point: { x: 460, y: 320 } });
    expect(again.op === "REFUSED" && again.refused).toBe("CYCLE_ALREADY_DISPATCHED");
    expect(agent.audit().firesStarted).toBe(1);
  });
});

describe("the reading belongs to one document and cannot be replayed into another", () => {
  it("11 & 12 — a second document starts its own sequence; one agent's counters are its own", () => {
    // One agent per document is the arrangement the content script actually uses, so two documents
    // are two agents with two independent sequences. A sequence number from one says nothing about
    // the other, and there is no shared counter for a replayed reading to land in.
    const first = new WatchedPage();
    const second = new WatchedPage();
    const agentA = createPageAgent(first);
    const agentB = createPageAgent(second);

    for (let i = 0; i < 5; i += 1) first.emit?.(NODES);

    expect(seqOf(structureOf(agentA, null))).toBe(5);
    expect(seqOf(structureOf(agentB, null))).toBe(0);

    // Replaying document A's sequence at document B does not make B look moved…
    const atB = structureOf(agentB, 0);
    expect(atB.op === "STRUCTURE" && atB.stale).toBe(false);
    // …and it does not make A look current either.
    const atA = structureOf(agentA, 0);
    expect(atA.op === "STRUCTURE" && atA.stale).toBe(true);
  });

  it("a malformed structural request is refused rather than answered approximately", () => {
    const page = new WatchedPage();
    const agent = createPageAgent(page);
    for (const bad of [
      { op: "STRUCTURE", requestId: "r", sinceSeq: -1 },
      { op: "STRUCTURE", requestId: "r", sinceSeq: 1.5 },
      { op: "STRUCTURE", requestId: "r", sinceSeq: "0" },
      { op: "STRUCTURE", requestId: "r" },
      { op: "STRUCTURE", requestId: "r", sinceSeq: 0, extra: true },
    ]) {
      const reply = agent.handle(bad);
      expect(reply?.op === "REFUSED" && reply.refused).toBe("MALFORMED_REQUEST");
    }
  });
});
