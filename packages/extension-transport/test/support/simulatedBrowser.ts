/**
 * A simulated MV3 browser: documents, ports, a service worker that can restart, and the D-E6-4
 * fixture's geometry. Test support only.
 *
 * It exists so the transport's refusals can be exercised against the **real** `guardedAct`, the real
 * permit and the real VERIFY RESULT, deterministically and without a browser. It is a model of a
 * browser, not a browser: it settles nothing about Chrome, and nothing produced with it is evidence
 * for D-E6-4. The experiment runs in Chrome for Testing and Edge, later, with its own harness.
 *
 * Fidelity is deliberate where it matters and crude where it does not:
 * - messages are JSON-cloned, as a real port serialises them;
 * - a port disconnects when its document goes away, and a worker restart disconnects every port;
 * - `elementAt` returns the LAST element covering the point, which is painting order;
 * - synthetic events do not move focus — E6 measured that an extension click is untrusted, so the
 *   fixture's focus stays where it was;
 * - event coordinates are modelled as integers only, so "the browser would not carry this point
 *   exactly" has something to fail on.
 */
import {
  createPageAgent,
  createServiceWorkerRouter,
  type AttestedDocument,
  type ElementDescription,
  type FocusReading,
  type PageAgent,
  type PagePoint,
  type PageSurface,
  type PortLike,
  type RelayEnvelope,
  type ServiceWorkerRouter,
  type TransportRelay,
} from "../../src/index.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export interface WitnessEvent {
  readonly type: "pointerdown" | "click";
  readonly selector: string;
  readonly x: number;
  readonly y: number;
  /** Always false: an extension's synthetic events are untrusted (E6). */
  readonly isTrusted: boolean;
}

export interface FixtureElement {
  selector: string;
  role: string;
  name: string;
  box: { x: number; y: number; w: number; h: number };
  enabled: boolean;
  checked?: boolean;
  onClick?: (document: SimulatedDocument, element: FixtureElement) => void;
}

/**
 * The D-E6-4 fixture, at the geometry the pre-registration fixes (README §5.3). Integer centres:
 * `#save` (460, 320), `#save-inert` (460, 400), `#lock` (620, 320), `#next` (620, 400),
 * `#sms` (410, 470), `#same-address` (570, 470).
 */
export const fixtureElements = (): FixtureElement[] => [
  { selector: "#panel", role: "region", name: "Panel", box: { x: 0, y: 0, w: 1024, h: 768 }, enabled: true },
  {
    selector: "#save",
    role: "button",
    name: "Save",
    box: { x: 400, y: 300, w: 120, h: 40 },
    enabled: true,
    onClick: (_document, element) => {
      element.name = "Saved";
    },
  },
  {
    selector: "#save-inert",
    role: "button",
    name: "Save",
    box: { x: 400, y: 380, w: 120, h: 40 },
    enabled: true,
    onClick: () => {
      /* the handler runs and changes nothing */
    },
  },
  {
    selector: "#lock",
    role: "button",
    name: "Lock",
    box: { x: 560, y: 300, w: 120, h: 40 },
    enabled: true,
    onClick: (_document, element) => {
      element.enabled = false;
    },
  },
  {
    selector: "#next",
    role: "button",
    name: "Next step",
    box: { x: 560, y: 380, w: 120, h: 40 },
    enabled: true,
    onClick: (document) => {
      document.hash = "#step2";
      document.elements = document.elements.filter((e) => e.selector !== "#next");
      document.elements.push({
        selector: "#step2",
        role: "heading",
        name: "Step 2",
        box: { x: 400, y: 200, w: 300, h: 24 },
        enabled: true,
      });
    },
  },
  {
    selector: "#sms",
    role: "checkbox",
    name: "SMS updates",
    box: { x: 400, y: 460, w: 20, h: 20 },
    enabled: true,
    checked: false,
    onClick: (_document, element) => {
      // The page cancels the toggle, as E8's A5 fixture does.
      element.checked = false;
    },
  },
  {
    selector: "#same-address",
    role: "checkbox",
    name: "Same as permanent address",
    box: { x: 560, y: 460, w: 20, h: 20 },
    enabled: true,
    checked: false,
    onClick: (_document, element) => {
      element.checked = !element.checked;
    },
  },
];

export class SimulatedDocument implements PageSurface<FixtureElement> {
  elements: FixtureElement[] = fixtureElements();
  hash = "";
  /** The page's own record of what happened to it: the independent witness. */
  readonly events: WitnessEvent[] = [];
  private tick = 0;

  constructor(
    readonly tabId: number,
    readonly documentId: string,
    readonly origin: string,
    readonly viewportSize = { w: 1024, h: 768 }
  ) {}

  get attested(): AttestedDocument {
    return { tabId: this.tabId, frameId: 0, documentId: this.documentId, origin: this.origin };
  }

  now(): number {
    this.tick += 1;
    return 1_000 + this.tick;
  }

  viewport() {
    return { w: this.viewportSize.w, h: this.viewportSize.h, dpr: 1, scrollX: 0, scrollY: 0 };
  }

  elementAt(point: PagePoint): FixtureElement | null {
    let hit: FixtureElement | null = null;
    for (const element of this.elements) {
      const b = element.box;
      if (point.x >= b.x && point.x < b.x + b.w && point.y >= b.y && point.y < b.y + b.h) hit = element;
    }
    return hit;
  }

  describe(element: FixtureElement): ElementDescription {
    return { selector: element.selector, role: element.role, name: element.name, box: { ...element.box } };
  }

  measure(): { measurements: ReturnType<SimulatedDocument["measurementOf"]>[]; focus: FocusReading } {
    return {
      measurements: this.elements.map((e) => this.measurementOf(e)),
      // Synthetic events never move focus, so nothing here ever holds it.
      focus: { state: "NONE" },
    };
  }

  private measurementOf(element: FixtureElement) {
    return {
      selector: element.selector,
      role: element.role,
      name: element.name,
      rect: { ...element.box },
      enabled: element.enabled,
      cssHidden: false,
      parentIndex: -1,
    };
  }

  prepareClick(element: FixtureElement, point: PagePoint) {
    const coordinatesExact = Number.isInteger(point.x) && Number.isInteger(point.y);
    return {
      coordinatesExact,
      fire: () => {
        for (const type of ["pointerdown", "click"] as const) {
          this.events.push({ type, selector: element.selector, x: point.x, y: point.y, isTrusted: false });
        }
        element.onClick?.(this, element);
      },
    };
  }

  // ── the effect oracle: the harness's knowledge of its own fixture, never the product's ──
  find(selector: string): FixtureElement | undefined {
    return this.elements.find((e) => e.selector === selector);
  }
  clicksOn(selector: string): number {
    return this.events.filter((e) => e.type === "click" && e.selector === selector).length;
  }
  get clicks(): number {
    return this.events.filter((e) => e.type === "click").length;
  }
}

/** One end of a `chrome.runtime.Port`, from the service worker's side. */
class SimulatedPort implements PortLike {
  private messageListener: ((message: unknown) => void) | null = null;
  private disconnectListener: (() => void) | null = null;
  open = true;

  constructor(
    readonly sender: AttestedDocument,
    private readonly agent: PageAgent
  ) {}

  postMessage(message: unknown): void {
    if (!this.open) throw new Error("port is disconnected");
    const delivered = clone(message);
    void Promise.resolve().then(() => {
      if (!this.open) return;
      const reply = this.agent.handle(delivered);
      if (reply !== null) this.messageListener?.(clone(reply));
    });
  }
  disconnect(): void {
    if (!this.open) return;
    this.open = false;
    this.disconnectListener?.();
  }
  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
  }
  onDisconnect(listener: () => void): void {
    this.disconnectListener = listener;
  }
}

interface Connection {
  readonly document: SimulatedDocument;
  port: SimulatedPort;
}

export class SimulatedBrowser {
  private router: ServiceWorkerRouter;
  private boot = 0;
  private documents = 0;
  private readonly connections = new Map<number, Connection>();
  /**
   * One agent per document, kept across reconnects.
   *
   * A worker restart drops the port, but the document and its content script are untouched — so the
   * cycles it has already answered are still there. Handing out a fresh agent would make the page
   * look protected by amnesia rather than by the boot binding.
   */
  private readonly agents = new Map<string, PageAgent>();

  constructor(readonly origin = "http://127.0.0.1:8990") {
    this.router = createServiceWorkerRouter({ bootId: this.nextBootId() });
  }

  private nextBootId(): string {
    this.boot += 1;
    return `boot-${this.boot}`;
  }

  get swBootId(): string {
    return this.router.bootId;
  }

  /** The offscreen document's channel to the worker. */
  get relay(): TransportRelay {
    return {
      request: async (request): Promise<RelayEnvelope | unknown> => this.router.relay(clone(request)),
    };
  }

  openTab(tabId: number): SimulatedDocument {
    const document = this.newDocument(tabId);
    this.connect(document);
    return document;
  }

  /** A fresh document with identical layout: what a reload or a same-layout navigation produces. */
  navigate(tabId: number): SimulatedDocument {
    const existing = this.connections.get(tabId);
    existing?.port.disconnect();
    const document = this.newDocument(tabId);
    this.connect(document);
    return document;
  }

  /**
   * Terminate the worker and start a new one. Every port drops; the content scripts reconnect to the
   * replacement, exactly as they would when the next message wakes it.
   */
  restartServiceWorker(): void {
    const live = [...this.connections.values()].map((c) => c.document);
    for (const connection of this.connections.values()) connection.port.disconnect();
    this.connections.clear();
    this.router = createServiceWorkerRouter({ bootId: this.nextBootId() });
    for (const document of live) this.connect(document);
  }

  documentFor(tabId: number): SimulatedDocument {
    const connection = this.connections.get(tabId);
    if (!connection) throw new Error(`test setup: no document in tab ${tabId}`);
    return connection.document;
  }

  private newDocument(tabId: number): SimulatedDocument {
    this.documents += 1;
    return new SimulatedDocument(tabId, `doc-${this.documents}`, this.origin);
  }

  private connect(document: SimulatedDocument): void {
    const agent = this.agents.get(document.documentId) ?? createPageAgent(document);
    this.agents.set(document.documentId, agent);
    const port = new SimulatedPort(document.attested, agent);
    if (!this.router.acceptPort(port)) throw new Error("test setup: the router refused the port");
    this.connections.set(document.tabId, { document, port });
  }
}

/** Deterministic ids, so a failing test names the same cycle every time. */
export const sequentialIds = (prefix = "id"): (() => string) => {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
};
