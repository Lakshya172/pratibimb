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

/** MVP-2's name template, unchanged: structural UI text only, bounded. */
export function nameOf(element: Element): string {
  return (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 60);
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

export const domPageSurface: PageSurface<Element> = {
  now: () => performance.timeOrigin + performance.now(),
  viewport,
  elementAt: (point) => document.elementFromPoint(point.x, point.y),
  describe: describeElement,
  measure,
  prepareClick,
};
