/**
 * The DOM adapter — the demo's only contact with a page.
 *
 * It implements the ports the orchestrator needs (`observe`, `insert`) and the two bridges
 * `guardedAct` drives (`hitTest`, `action`). It is an adapter and nothing else: no policy, no
 * decisions, no state beyond a frame counter. Every refusal in the system lives somewhere else,
 * which is why those packages can be tested in Node and this file cannot.
 *
 * IT IS BOUND TO A DOCUMENT, NOT TO THE AMBIENT ONE. The Planning View and the page it drives are
 * different documents — the page runs in a same-origin iframe — so everything here takes the target
 * `Document`/`Window` explicitly. That is the difference from `apps/extension/host-lib/
 * page-surface-dom.ts`, which is written for a content script and reads the ambient globals; the
 * rules below are the same rules, deliberately.
 *
 * THE CLICK IS E6 MECHANISM B (TR-3): a pointer/mouse sequence dispatched to `elementFromPoint` at
 * exactly the point the permit fixed. **Not `el.click()`** — E6 measured that going straight through
 * a transparent overlay, so it proves nothing about what a user would have hit. The coordinates are
 * read back off the constructed events before anything is fired; if the browser did not keep the
 * exact numbers, nothing is dispatched. The fixture records the sequence it receives and the browser
 * test asserts it, so this cannot quietly become something else.
 *
 * IT READS ONLY WHAT PERCEPTION MAY READ — role, accessible name, geometry, enabled, CSS visibility —
 * plus, for form controls only, the local value, which goes straight to the vault and nowhere else
 * (INV-21).
 */
import { type CssPoint, type HitTestBridge, type PageActionBridge, type TopmostElement } from "@pratibimb/agent";
import { buildElementGraph, frameId, type CaptureGeometry, type DomMeasurement, type FrameId } from "@pratibimb/perception";
import { type ObservedField } from "@pratibimb/privacy";
import { type ClientPorts, type Observation } from "@pratibimb/orchestrator";

/** The element set the demo measures. Same shape as the extension host's. */
const MEASURED = "a, button, input, select, textarea, label, [role]";

/** MVP-2's role template, unchanged. */
export function roleOf(element: Element): string {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const tag = element.tagName;
  if (tag === "INPUT") {
    const type = (element as HTMLInputElement).type;
    return type === "checkbox" || type === "radio" ? type : "textbox";
  }
  if (tag === "TEXTAREA") return "textbox";
  if (tag === "SELECT") return "listbox";
  if (tag === "BUTTON") return "button";
  if (tag === "A") return "link";
  if (tag === "LABEL") return "label";
  return "generic";
}

/**
 * The accessible name: a control's label, bounded.
 *
 * A `<label for=…>` first, because that is what a person reads beside the field; then `aria-label`;
 * then the element's own text, which is what a button carries. Never a value, never an `href`, never
 * the inner text of an arbitrary node.
 */
export function nameOf(element: Element): string {
  const labelled = (element as HTMLInputElement).labels?.[0];
  if (labelled?.textContent) return labelled.textContent.trim().slice(0, 60);
  const aria = element.getAttribute("aria-label");
  if (aria) return aria.trim().slice(0, 60);
  if (element.tagName === "INPUT") return "";
  return (element.textContent ?? "").trim().slice(0, 60);
}

const enabledOf = (element: Element): boolean => {
  if (element.getAttribute("aria-disabled") === "true") return false;
  const maybe = element as { disabled?: unknown };
  return typeof maybe.disabled === "boolean" ? !maybe.disabled : true;
};

export interface AdapterOptions {
  readonly origin: string;
  /** Prefix for frame ids. Every observation gets a new one; VERIFY RESULT requires it. */
  readonly framePrefix?: string;
}

/** Counts of what the adapter was actually asked to do. The refusal run's claim is `clicks === 0`. */
export interface AdapterCounters {
  clicks: number;
  inserts: number;
  observations: number;
}

export class PageAdapter {
  readonly counters: AdapterCounters = { clicks: 0, inserts: 0, observations: 0 };
  #frame = 0;

  constructor(
    private readonly doc: Document,
    private readonly win: Window,
    private readonly options: AdapterOptions
  ) {}

  get currentFrame(): FrameId {
    return frameId(`${this.options.framePrefix ?? "demo"}-frame-${this.#frame}`);
  }

  /** Stable reference: `#id` where there is one, else the tag name, with an index when needed. */
  private referenceOf(element: Element): { selector: string; nth?: number } {
    const selector = element.id ? `#${element.id}` : element.tagName.toLowerCase();
    let matches: Element[];
    try {
      const query = element.id ? `#${CSS.escape(element.id)}` : element.tagName.toLowerCase();
      matches = Array.from(this.doc.querySelectorAll(query));
    } catch {
      return { selector };
    }
    if (matches.length <= 1) return { selector };
    const index = matches.indexOf(element);
    return index < 0 ? { selector } : { selector, nth: index };
  }

  private geometry(): CaptureGeometry {
    const w = this.doc.documentElement.clientWidth;
    const h = this.doc.documentElement.clientHeight;
    return {
      dpr: 1,
      zoom: 1,
      viewportCss: { w, h },
      captureSize: { w, h },
      scroll: { x: this.win.scrollX, y: this.win.scrollY },
      origin: this.options.origin,
    };
  }

  async observe(): Promise<Observation> {
    this.counters.observations += 1;
    this.#frame += 1;

    const elements = Array.from(this.doc.querySelectorAll(MEASURED));
    const indexOf = new Map<Element, number>(elements.map((element, index) => [element, index]));

    const measurements: DomMeasurement[] = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = this.win.getComputedStyle(element);
      const reference = this.referenceOf(element);
      let parentIndex = -1;
      for (let ancestor = element.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
        const found = indexOf.get(ancestor);
        if (found !== undefined) {
          parentIndex = found;
          break;
        }
      }
      const base = {
        selector: reference.selector,
        role: roleOf(element),
        name: nameOf(element),
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        enabled: enabledOf(element),
        cssHidden: style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0,
        parentIndex,
      };
      return reference.nth === undefined ? base : { ...base, nth: reference.nth };
    });

    // Values: form controls only, and they go straight to `sanitize()`.
    const fields: ObservedField[] = elements
      .filter((element): element is HTMLInputElement => element.tagName === "INPUT")
      .map((element) => ({
        id: this.referenceOf(element).selector,
        value: element.value,
        label: nameOf(element),
        type: element.getAttribute("type") ?? "",
        ...(element.getAttribute("autocomplete") ? { autocomplete: element.getAttribute("autocomplete") as string } : {}),
        origin: this.options.origin,
      }));

    const active = this.doc.activeElement;
    const focusedSelector =
      active === null || active === this.doc.body || active === this.doc.documentElement
        ? null
        : this.referenceOf(active).selector;

    const status = this.doc.getElementById("status");
    return {
      graph: buildElementGraph(measurements, this.geometry(), this.currentFrame),
      fields,
      viewport: {
        w: this.doc.documentElement.clientWidth,
        h: this.doc.documentElement.clientHeight,
        dpr: 1,
        zoom: 1,
        scrollX: this.win.scrollX,
        scrollY: this.win.scrollY,
      },
      documentId: this.documentId(),
      focusedSelector,
      actionable: new Set(measurements.filter((m) => m.enabled && !m.cssHidden).map((m) => m.selector)),
      statusText: status?.textContent ?? null,
    };
  }

  /**
   * A stable identity for this document.
   *
   * A reload or a navigation must change it, because every binding is checked against it. The URL
   * plus a per-document marker gives that: the marker is created once per document and is gone after
   * a reload.
   */
  private documentId(): string {
    const w = this.win as Window & { __pratibimbDocumentId?: string };
    if (typeof w.__pratibimbDocumentId !== "string") {
      w.__pratibimbDocumentId = `${this.doc.location.pathname}#${Math.random().toString(36).slice(2, 10)}`;
    }
    return w.__pratibimbDocumentId;
  }

  /**
   * The trusted client's restoration. **Not an agent action.**
   *
   * No permit, no hit test, no dispatch — this is the client putting back a value it already held,
   * into a target privacy and a human both approved. The input events afterwards are what any
   * framework on the page needs to see the change; they carry no pointer and click nothing.
   */
  async insert(target: string, value: string): Promise<boolean> {
    this.counters.inserts += 1;
    const found = this.doc.querySelector(target);
    // `instanceof` is unreliable across realms — the frame has its own `HTMLInputElement` — so the
    // check is on the tag, which is the same in every realm.
    if (found === null || found.tagName !== "INPUT") return false;
    const element = found as HTMLInputElement;
    if (element.disabled || element.readOnly) return false;
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return element.value === value;
  }

  private describe(element: Element): TopmostElement {
    const rect = element.getBoundingClientRect();
    const reference = this.referenceOf(element);
    const base = {
      frameId: this.currentFrame,
      selector: reference.selector,
      role: roleOf(element),
      name: nameOf(element),
      box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } as TopmostElement["box"],
    };
    return reference.nth === undefined ? base : { ...base, nth: reference.nth };
  }

  get bridges(): { action: PageActionBridge; hitTest: HitTestBridge } {
    const self = this;
    return {
      hitTest: {
        get frameId() {
          return self.currentFrame;
        },
        async topmostAtCssPoint(point: CssPoint): Promise<TopmostElement | null> {
          // `null` means reliably nothing is there. An inability to answer must throw instead, and
          // `elementFromPoint` does not have a third state.
          const element = self.doc.elementFromPoint(point.x, point.y);
          return element === null ? null : self.describe(element);
        },
      },
      action: {
        get frameId() {
          return self.currentFrame;
        },
        async clickAtCssPoint(point: CssPoint): Promise<void> {
          const element = self.doc.elementFromPoint(point.x, point.y);
          if (element === null) throw new Error("NOTHING_AT_POINT");

          // E6 mechanism B. Constructed first, coordinates verified, then fired — a half-dispatched
          // sequence cannot be taken back.
          const init = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y, button: 0 };
          const events: Event[] = [
            new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true }),
            new MouseEvent("mousedown", init),
            new PointerEvent("pointerup", { ...init, pointerType: "mouse", isPrimary: true }),
            new MouseEvent("mouseup", init),
            new MouseEvent("click", init),
          ];
          const exact = events.every(
            (event) => (event as MouseEvent).clientX === point.x && (event as MouseEvent).clientY === point.y
          );
          if (!exact) throw new Error("COORDINATES_NOT_EXACT");

          self.counters.clicks += 1;
          for (const event of events) element.dispatchEvent(event);
        },
      },
    };
  }
}

/** Assemble the ports. The grant prompt and the reasoner are supplied by the caller. */
export const portsFrom = (
  adapter: PageAdapter,
  rest: Omit<ClientPorts, "observe" | "insert" | "bridges">
): ClientPorts => ({
  observe: () => adapter.observe(),
  insert: (target, value) => adapter.insert(target, value),
  bridges: adapter.bridges,
  ...rest,
});
