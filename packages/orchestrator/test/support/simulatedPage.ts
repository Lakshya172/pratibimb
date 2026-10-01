/**
 * A simulated page for the orchestrator's unit tests.
 *
 * WHAT IT SIMULATES AND WHAT IT DOES NOT. It stands in for a DOM: elements with geometry, values a
 * content script may read, a click that lands at a point, and a form that responds to being
 * submitted. It does **not** stand in for anything the orchestrator is being tested about — the
 * sanitizer, the vault, the verifier, the plan parser, the validator, the binder, the permit gate and
 * VERIFY RESULT are all the real implementations. Only the browser is simulated, and the browser is
 * exactly what the two real browser runs supply instead.
 *
 * THE FIXTURE'S CONTRACT, mirrored from `tests/browser/demo/fixture/application.html` so the unit
 * tests and the real page agree about what success means:
 *
 *   - the registered mobile number is already on the page; `#mobile_confirm` is **empty**;
 *   - clicking `#submit` succeeds **only if** `#mobile_confirm` matches the registered number;
 *   - on success the status changes and `#submit` disables itself, which is the postcondition
 *     VERIFY RESULT reads back.
 *
 * That last rule is why `TARGET_ENABLED: false` is a meaningful oracle rather than a formality: the
 * button can only end up disabled if the value was restored correctly first.
 *
 * Every observation gets a NEW frame id, because VERIFY RESULT refuses one taken in the frame the
 * action was dispatched against.
 */
import { type CssPoint, type HitTestBridge, type PageActionBridge, type TopmostElement } from "@pratibimb/agent";
import {
  buildElementGraph,
  frameId,
  type CaptureGeometry,
  type DomMeasurement,
  type FrameId,
} from "@pratibimb/perception";
import { type ObservedField } from "@pratibimb/privacy";
import { type ClientPorts, type GrantDecision, type GrantRequest, type Observation } from "../../src/index.js";
import { deterministicReasoner, type ReasonerClient } from "@pratibimb/reasoner";

export const ORIGIN = "http://127.0.0.1:8974";
export const SESSION = "orch-session-1";
export const REQUEST = "orch-request-1";
export const GOAL = "Submit my application with my registered mobile number.";
export const TODAY = new Date("2026-09-14T00:00:00Z");

/** Synthetic. Not a real person, not a real number. */
export const DEMO = { name: "Ramesh Kumar", mobile: "9000000001", aadhaar: "2345 6789 0124", dob: "1998-04-12", otp: "482913" } as const;

export const VIEWPORT = { w: 1024, h: 768, dpr: 1, zoom: 1, scrollX: 0, scrollY: 0 };

const geometry: CaptureGeometry = {
  dpr: 1,
  zoom: 1,
  viewportCss: { w: VIEWPORT.w, h: VIEWPORT.h },
  captureSize: { w: VIEWPORT.w, h: VIEWPORT.h },
  scroll: { x: 0, y: 0 },
  origin: ORIGIN,
};

interface Element {
  readonly selector: string;
  readonly role: string;
  name: string;
  readonly rect: { x: number; y: number; w: number; h: number };
  enabled: boolean;
  cssHidden: boolean;
  value: string;
  readonly label: string;
  readonly type: string;
  readonly autocomplete?: string;
  readonly isField: boolean;
}

const initial = (): Element[] => [
  { selector: "#name", role: "textbox", name: "Full name", rect: { x: 320, y: 140, w: 300, h: 32 }, enabled: true, cssHidden: false, value: DEMO.name, label: "Full name", type: "text", autocomplete: "name", isField: true },
  { selector: "#mobile", role: "textbox", name: "Mobile number", rect: { x: 320, y: 190, w: 300, h: 32 }, enabled: true, cssHidden: false, value: DEMO.mobile, label: "Mobile number", type: "tel", autocomplete: "tel", isField: true },
  { selector: "#aadhaar", role: "textbox", name: "Aadhaar number", rect: { x: 320, y: 240, w: 300, h: 32 }, enabled: true, cssHidden: false, value: DEMO.aadhaar, label: "Aadhaar number", type: "text", isField: true },
  { selector: "#dob", role: "textbox", name: "Date of birth", rect: { x: 320, y: 290, w: 300, h: 32 }, enabled: true, cssHidden: false, value: DEMO.dob, label: "Date of birth", type: "date", isField: true },
  { selector: "#otp", role: "textbox", name: "OTP", rect: { x: 320, y: 340, w: 300, h: 32 }, enabled: true, cssHidden: false, value: DEMO.otp, label: "OTP", type: "text", autocomplete: "one-time-code", isField: true },
  { selector: "#mobile_confirm", role: "textbox", name: "Confirm mobile number", rect: { x: 320, y: 390, w: 300, h: 32 }, enabled: true, cssHidden: false, value: "", label: "Confirm mobile number", type: "tel", autocomplete: "tel", isField: true },
  { selector: "#submit", role: "button", name: "Submit application", rect: { x: 320, y: 450, w: 180, h: 40 }, enabled: true, cssHidden: false, value: "", label: "", type: "", isField: false },
];

export interface PageOptions {
  /** Add a free-text "Notes" field, which carries no redaction token: where a safe literal may go. */
  readonly withNotesField?: boolean;
  /** Refuse to write the value, to exercise a failed restoration. */
  readonly insertFails?: boolean;
  /** Throw from `observe`, to exercise an unreadable page. */
  readonly observeThrowsAfter?: number;
  /** Make the click bridge throw, so the dispatch outcome is unknown. */
  readonly clickThrows?: boolean;
  /** Report nothing at the click point, so the hit test disagrees. */
  readonly nothingAtPoint?: boolean;
  /** Change the target's identity between observation and action. */
  readonly renameSubmitAfterObserve?: boolean;
  /** Accept the submission without disabling the button, so the postcondition is not met. */
  readonly neverDisablesSubmit?: boolean;
}

export class SimulatedPage {
  elements: Element[];
  statusText = "Not submitted";
  submitted = false;
  documentId = "orch-doc-1";
  /** How many times the click bridge was actually driven. Zero is the refusal tests' claim. */
  clicks = 0;
  observations = 0;
  #frame = 0;

  constructor(private readonly options: PageOptions = {}) {
    this.elements = initial();
    if (options.withNotesField) {
      this.elements.splice(6, 0, {
        selector: "#notes",
        role: "textbox",
        name: "Notes",
        rect: { x: 320, y: 415, w: 300, h: 30 },
        enabled: true,
        cssHidden: false,
        value: "",
        label: "Notes",
        type: "text",
        isField: true,
      });
    }
  }

  get currentFrame(): FrameId {
    return frameId(`orch-frame-${this.#frame}`);
  }

  find(selector: string): Element | undefined {
    return this.elements.find((e) => e.selector === selector);
  }

  private measurements(): DomMeasurement[] {
    return this.elements.map((e) => ({
      selector: e.selector,
      role: e.role,
      name: e.name,
      rect: e.rect,
      enabled: e.enabled,
      cssHidden: e.cssHidden,
      parentIndex: -1,
    }));
  }

  private fields(): ObservedField[] {
    return this.elements
      .filter((e) => e.isField)
      .map((e) => ({
        id: e.selector,
        value: e.value,
        label: e.label,
        type: e.type,
        ...(e.autocomplete ? { autocomplete: e.autocomplete } : {}),
        origin: ORIGIN,
      }));
  }

  async observe(): Promise<Observation> {
    this.observations += 1;
    if (this.options.observeThrowsAfter !== undefined && this.observations > this.options.observeThrowsAfter) {
      throw new Error("page unreadable");
    }
    if (this.options.renameSubmitAfterObserve && this.observations === 1) {
      const submit = this.find("#submit");
      if (submit) submit.name = "Send application";
    }
    this.#frame += 1;
    return {
      graph: buildElementGraph(this.measurements(), geometry, this.currentFrame),
      fields: this.fields(),
      viewport: VIEWPORT,
      documentId: this.documentId,
      focusedSelector: null,
      actionable: new Set(this.elements.filter((e) => e.enabled && !e.cssHidden).map((e) => e.selector)),
      statusText: this.statusText,
    };
  }

  /** The trusted client's restoration. Not an agent action; no permit, no dispatch. */
  async insert(target: string, value: string): Promise<boolean> {
    if (this.options.insertFails) return false;
    const element = this.find(target);
    if (!element || !element.enabled || element.cssHidden) return false;
    element.value = value;
    return true;
  }

  /** What the fixture does when its submit button is clicked. */
  private submit(): void {
    const confirm = this.find("#mobile_confirm")?.value ?? "";
    const registered = this.find("#mobile")?.value ?? "";
    if (confirm !== "" && confirm === registered) {
      this.statusText = "Application submitted";
      this.submitted = true;
      if (!this.options.neverDisablesSubmit) {
        const submit = this.find("#submit");
        if (submit) submit.enabled = false;
      }
      return;
    }
    this.statusText = "Mobile number does not match";
  }

  private at(point: CssPoint): Element | undefined {
    if (this.options.nothingAtPoint) return undefined;
    return this.elements.find((e) => {
      const r = e.rect;
      return !e.cssHidden && point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h;
    });
  }

  get bridges(): { action: PageActionBridge; hitTest: HitTestBridge } {
    const page = this;
    return {
      action: {
        get frameId() {
          return page.currentFrame;
        },
        async clickAtCssPoint(point: CssPoint): Promise<void> {
          if (page.options.clickThrows) throw new Error("dispatch failed");
          page.clicks += 1;
          const element = page.at(point);
          if (element?.selector === "#submit" && element.enabled) page.submit();
        },
      },
      hitTest: {
        get frameId() {
          return page.currentFrame;
        },
        async topmostAtCssPoint(point: CssPoint): Promise<TopmostElement | null> {
          const element = page.at(point);
          if (!element) return null;
          return {
            frameId: page.currentFrame,
            selector: element.selector,
            role: element.role,
            name: element.name,
            box: { x: element.rect.x, y: element.rect.y, w: element.rect.w, h: element.rect.h } as TopmostElement["box"],
          };
        },
      },
    };
  }
}

export interface PortOptions extends PageOptions {
  readonly reasoner?: ReasonerClient;
  readonly grant?: GrantDecision;
  /** Observe the grant requests a run made. */
  readonly onGrant?: (request: GrantRequest) => void;
}

export const portsFor = (page: SimulatedPage, options: PortOptions = {}): ClientPorts => ({
  observe: () => page.observe(),
  reasoner: options.reasoner ?? deterministicReasoner(),
  async requestGrant(request) {
    options.onGrant?.(request);
    return options.grant ?? { granted: true };
  },
  insert: (target, value) => page.insert(target, value),
  bridges: page.bridges,
});

export const RUN_OPTIONS = {
  goal: GOAL,
  sessionId: SESSION,
  requestId: REQUEST,
  origin: ORIGIN,
  /** Instrument values for the demo. No TTL is approved by this repository (ADR-0008 §5). */
  permitTtlMs: 5_000,
  confirmationTtlMs: 60_000,
  grantTtlMs: 60_000,
  today: TODAY,
} as const;
