/**
 * EXPERIMENT E6 ONLY — candidate TYPE and CLICK mechanisms available to a content script without
 * `chrome.debugger`. This is capability discovery, not the production TYPE subsystem, and nothing here
 * decides whether an action is allowed: E6 exercises mechanisms on synthetic loopback fixtures.
 *
 * Every function runs in the content script's isolated world, so the page's own prototype patches are
 * not on these code paths — which is one of the things E6 measures rather than assumes.
 */

export type TypeMechanism = "A_native_setter_events" | "B1_execCommand_insertText" | "B2_setRangeText_inputEvent";
export type ClickMechanism = "A_element_click" | "B_point_pointer_sequence";

const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

export function typeInto(el: HTMLInputElement, value: string, mechanism: TypeMechanism): void {
  if (mechanism === "A_native_setter_events") {
    if (!nativeValueSetter) throw new Error("no native value setter");
    nativeValueSetter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (mechanism === "B1_execCommand_insertText") {
    el.focus();
    el.select();
    // Deprecated but implemented; returns false when the command is unsupported in this context.
    const ok = document.execCommand("insertText", false, value);
    if (!ok) throw new Error("execCommand insertText returned false");
    return;
  }
  if (mechanism === "B2_setRangeText_inputEvent") {
    el.setRangeText(value, 0, el.value.length, "end");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return;
  }
  throw new Error(`unknown type mechanism ${String(mechanism)}`);
}

export function clickOn(el: HTMLElement, mechanism: ClickMechanism): { dispatchedTo: string | null } {
  const sel = (e: Element | null) => (e ? (e.id ? `#${e.id}` : e.tagName.toLowerCase()) : null);
  if (mechanism === "A_element_click") {
    el.click();
    return { dispatchedTo: sel(el) };
  }
  if (mechanism === "B_point_pointer_sequence") {
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit) return { dispatchedTo: null };
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
    hit.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true }));
    hit.dispatchEvent(new MouseEvent("mousedown", init));
    hit.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse", isPrimary: true }));
    hit.dispatchEvent(new MouseEvent("mouseup", init));
    hit.dispatchEvent(new MouseEvent("click", init));
    return { dispatchedTo: sel(hit) };
  }
  throw new Error(`unknown click mechanism ${String(mechanism)}`);
}
