/**
 * The DOM behind `PageSurface`: the only place in the host that touches a page's elements.
 *
 * It is an adapter and nothing else — no decisions, no policy, no state. Every refusal lives in
 * `@pratibimb/extension-transport`'s page agent, which is why that package can be tested in Node.
 *
 * ONE DESCRIPTION FUNCTION (TR-4). The observation and the hit test both go through
 * `describeElement`. If they derived selectors differently, a MATCH would be comparing two
 * vocabularies and would mean nothing. The role and name rules are the MVP-2 probe templates, reused
 * verbatim through E8, so a graph built here is the graph those experiments' numbers describe.
 *
 * THE CLICK IS E6's MECHANISM B (TR-3): a pointer/mouse sequence dispatched to
 * `document.elementFromPoint`, at exactly the point the permit fixed. Not `el.click()` — E6 measured
 * that going straight through a transparent overlay. Nothing here focuses, scrolls or retries.
 *
 * EXACTNESS IS CHECKED BEFORE ANYTHING IS FIRED. The events are constructed first and their
 * coordinates read back: if the browser did not keep the exact numbers it was handed, the page agent
 * refuses and no event is dispatched. A half-dispatched sequence cannot be taken back.
 *
 * READS ONLY WHAT PERCEPTION MAY READ: role, accessible name, geometry, enabled and CSS visibility.
 * No value, no `href`, no inner text of arbitrary nodes (INV-21, TR-10).
 */
import type { DomMeasurement } from "@pratibimb/perception";
import type {
  ElementDescription,
  FocusReading,
  PagePoint,
  PageSurface,
  PreparedClick,
  StructuralEvent,
  ViewportReading,
} from "@pratibimb/extension-transport";

/** The same element set the host's own MEASURE handler uses. */
const MEASURED_SELECTOR = "a, button, input, select, textarea, label, [role]";

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
 * The accessible name: a control's label, bounded. Structural UI text only.
 *
 * A `<label for=…>` FIRST, because that is what a person reads beside the field and what an
 * accessible name is. An input has no text of its own, so a rule that starts at `textContent` names
 * every form control the empty string — and an unnamed field is one the planner cannot find, the
 * binder cannot classify, and a human cannot be meaningfully asked about. This is the same template
 * `apps/demo/src/pageAdapter.ts` uses, deliberately: the two sides must read one page the same way.
 *
 * Never a value, never an `href`, never the inner text of an arbitrary node.
 */
export function nameOf(element: Element): string {
  const labelled = (element as HTMLInputElement).labels?.[0];
  if (labelled?.textContent) return labelled.textContent.trim().slice(0, 60);
  const aria = element.getAttribute("aria-label");
  if (aria) return aria.trim().slice(0, 60);
  if (element.tagName === "INPUT") return "";
  return (element.textContent ?? "").trim().slice(0, 60);
}

/**
 * The stable reference: `#id` where there is one, else the tag name, with an index only when the
 * selector alone does not identify the element. `nth` exists because a tag name rarely does.
 */
export function referenceOf(element: Element): { selector: string; nth?: number } {
  const selector = element.id ? `#${element.id}` : element.tagName.toLowerCase();
  let matches: Element[];
  try {
    const query = element.id ? `#${CSS.escape(element.id)}` : element.tagName.toLowerCase();
    matches = Array.from(document.querySelectorAll(query));
  } catch {
    return { selector };
  }
  if (matches.length <= 1) return { selector };
  const index = matches.indexOf(element);
  return index < 0 ? { selector } : { selector, nth: index };
}

export function describeElement(element: Element): ElementDescription {
  const rect = element.getBoundingClientRect();
  const reference = referenceOf(element);
  const base = {
    selector: reference.selector,
    role: roleOf(element),
    name: nameOf(element),
    box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
  };
  return reference.nth === undefined ? base : { ...base, nth: reference.nth };
}

const enabledOf = (element: Element): boolean => {
  if (element.getAttribute("aria-disabled") === "true") return false;
  const maybe = element as { disabled?: unknown };
  return typeof maybe.disabled === "boolean" ? !maybe.disabled : true;
};

const cssHiddenOf = (element: Element, rect: DOMRect): boolean => {
  const style = getComputedStyle(element);
  return style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0;
};

/**
 * Focus, three-valued (ADR-0007 §5).
 *
 * `null` is reserved for "reliably nothing has it". An `iframe` or a shadow host holding focus means
 * focus is somewhere this document cannot read, which is UNESTABLISHED — never "nothing".
 */
function focusReading(): FocusReading {
  const active = document.activeElement;
  if (active === null || active === document.body || active === document.documentElement) return { state: "NONE" };
  if (active.tagName === "IFRAME" || active.shadowRoot !== null) return { state: "UNESTABLISHED" };
  const reference = referenceOf(active);
  return reference.nth === undefined
    ? { state: "ELEMENT", selector: reference.selector }
    : { state: "ELEMENT", selector: reference.selector, nth: reference.nth };
}

function measure(): { measurements: DomMeasurement[]; focus: FocusReading } {
  const elements = Array.from(document.querySelectorAll(MEASURED_SELECTOR));
  const indexOf = new Map<Element, number>(elements.map((element, index) => [element, index]));
  const measurements = elements.map((element): DomMeasurement => {
    const rect = element.getBoundingClientRect();
    const reference = referenceOf(element);
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
      cssHidden: cssHiddenOf(element, rect),
      parentIndex,
    };
    return reference.nth === undefined ? base : { ...base, nth: reference.nth };
  });
  return { measurements, focus: focusReading() };
}

function viewport(): ViewportReading {
  return {
    w: document.documentElement.clientWidth,
    h: document.documentElement.clientHeight,
    dpr: window.devicePixelRatio,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

/** E6 mechanism B, at a given point rather than at an element's centre. */
function prepareClick(element: Element, point: PagePoint): PreparedClick {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y, button: 0 };
  const events: Event[] = [
    new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true }),
    new MouseEvent("mousedown", init),
    new PointerEvent("pointerup", { ...init, pointerType: "mouse", isPrimary: true }),
    new MouseEvent("mouseup", init),
    new MouseEvent("click", init),
  ];
  const coordinatesExact = events.every(
    (event) => (event as MouseEvent).clientX === point.x && (event as MouseEvent).clientY === point.y
  );
  return {
    coordinatesExact,
    fire: () => {
      for (const event of events) element.dispatchEvent(event);
    },
  };
}

/**
 * THE ATTRIBUTES THE ELEMENT GRAPH ACTUALLY READS — the whole filter, and no more.
 *
 * Constitution §6 requires the structural signal to be narrow, and this is where "narrow" is
 * decided. Every entry is here because `measure()` above derives something from it: `id` gives the
 * selector, `role` and the tag give the role, `aria-label` and `for` give the accessible name,
 * `disabled`/`aria-disabled` give enabled, and `class`/`style`/`hidden` are the only attributes
 * that can flip computed visibility without touching anything else.
 *
 * An unfiltered `attributes: true` would report every `data-*` write a page makes to itself, which
 * on a busy page is an event storm that says nothing about the graph. Adding an attribute here is
 * a decision about what "structural" means, not a tuning knob.
 */
const WATCHED_ATTRIBUTES = ["id", "role", "aria-label", "aria-disabled", "disabled", "hidden", "class", "style", "for"];

/**
 * THE STRUCTURAL SIGNAL — constitution §6, IN FORCE for v1 (ADR-0010). The only observers in the
 * product.
 *
 * EVENT-DRIVEN, LOCAL, NON-CAPTURING. `MutationObserver` and `ResizeObserver` both call back when
 * the browser has something to report; nothing here wakes up, polls, hashes, captures or measures.
 * The callback receives three booleans and a fourth — **never a node, an attribute name, a
 * selector, a text value or a pixel** — so there is no path from a page's contents to the counters
 * the agent keeps. Records are inspected here and dropped here.
 *
 * IT CANNOT CAPTURE. It has no capture authority, no relay, no port and no message channel: the
 * only thing it is given is `onChange`. Under the capture policy approved in ADR-0009 a frame is
 * taken only when a person asks for one, and a structural change says that the last observation may
 * be stale — it does not go and take a new picture.
 *
 * WHAT IS NOT IMPLEMENTED, stated rather than implied. §6 names "ResizeObserver on tracked
 * elements"; this installs one on `document.documentElement` only. Re-targeting it at the measured
 * set would mean re-enumerating that set on every mutation — polling by another name — and a
 * `ResizeObserver` delivers an initial callback for every newly observed element, which would make
 * each observation instantly stale against itself. Element-level resize that changes no attribute,
 * no node and no document geometry is therefore NOT observed, and §6's structural signal is
 * implemented CONDITIONALLY until that is measured and closed.
 */
function watchStructure(onChange: (event: StructuralEvent) => void): () => void {
  const mutations = new MutationObserver((records) => {
    let nodes = false;
    let attributes = false;
    let text = false;
    for (const record of records) {
      if (record.type === "childList") nodes = true;
      else if (record.type === "attributes") attributes = true;
      else if (record.type === "characterData") text = true;
    }
    // One callback in, one event out. The coalescing rule in full: the browser decides what a batch
    // is, and this reports the batch. No timer, no window, no queue.
    if (nodes || attributes || text) onChange({ nodes, attributes, text, resized: false });
  });
  mutations.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: WATCHED_ATTRIBUTES,
  });

  const resizes = new ResizeObserver(() => {
    onChange({ nodes: false, attributes: false, text: false, resized: true });
  });
  resizes.observe(document.documentElement);

  return () => {
    mutations.disconnect();
    resizes.disconnect();
  };
}

export const domPageSurface: PageSurface<Element> = {
  now: () => performance.timeOrigin + performance.now(),
  viewport,
  elementAt: (point) => document.elementFromPoint(point.x, point.y),
  describe: describeElement,
  measure,
  prepareClick,
  watchStructure,
};
