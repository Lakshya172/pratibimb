/**
 * EXPERIMENT E6 ONLY — the candidate TYPE and CLICK mechanisms, and the content-script handler that
 * exercises them. **Not in a production build.**
 *
 * `wxt.config.ts` resolves `#e6-probe` to `e6/absent.ts` unless the build sets `E6_PROBE=1`, and the
 * only thing that sets it is `artifacts/experiments/E6-mv3-dispatch/harness/run-e6.mjs`. So this
 * module is structurally outside the shipped bundle rather than guarded inside it: the mechanisms
 * are not present to be reached, disabled or re-enabled at runtime.
 *
 * WHY IT IS SEPARATED. Nothing here consults a permit, a hit test, a plan, a target binding or a
 * document binding. E6 asked what a content script can do *at all*, without `chrome.debugger`, and
 * that question is answered by trying — which is the opposite of an authority. In the product there
 * is exactly one route to a click: `guardedAct` → the transport's page agent → `prepareClick`, under
 * a single-use permit minted from an attested ALLOW and an attested MATCH.
 *
 * WHAT IT STILL IS. The code that produced `artifacts/experiments/E6-mv3-dispatch/logs/e6.json`,
 * moved rather than rewritten, so that record's numbers still have a source. Every function runs in
 * the content script's isolated world, so the page's own prototype patches are not on these code
 * paths — which is one of the things E6 measures rather than assumes.
 *
 * The one "value" E6 handles is a synthetic 10-digit canary held in the offscreen stub, released
 * against a nonce armed for one tab, frame and document. It is never a page's own value.
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

type E6Message =
  | { kind: "E6_TYPE"; mechanism: TypeMechanism; selector: string; nonce: string }
  | { kind: "E6_CLICK"; mechanism: ClickMechanism; selector: string };

/**
 * Answer one E6 message, or decline it.
 *
 * `true` means this module took the message and the caller must keep the reply channel open;
 * `false` means the message is not E6's and the caller should carry on. The production twin
 * (`e6/absent.ts`) always answers `false`, and contains none of the code above.
 */
export function serveE6(message: unknown, sendResponse: (reply: unknown) => void): boolean {
  const msg = message as E6Message;
  if (msg?.kind === "E6_TYPE") {
    // Fetch the value from the offscreen document against a nonce armed for THIS tab/frame/document,
    // insert it, and report booleans and timings — never the value itself.
    void (async () => {
      const el = document.querySelector(msg.selector);
      if (!(el instanceof HTMLInputElement)) return sendResponse({ ok: false, error: "NO_INPUT" });
      const t0 = performance.now();
      const release = (await chrome.runtime.sendMessage({ target: "offscreen", kind: "E6_RELEASE", nonce: msg.nonce, target2: msg.selector })) as { value?: string; refused?: string };
      const fetchMs = performance.now() - t0;
      if (typeof release?.value !== "string") return sendResponse({ ok: false, released: false, refused: release?.refused ?? "NO_RESPONSE", fetchMs });
      let value: string | null = release.value;
      const t1 = performance.now();
      let error: string | null = null;
      try {
        typeInto(el, value, msg.mechanism);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const insertMs = performance.now() - t1;
      const valueEqualsReleased = el.value === value;
      const finalLength = el.value.length;
      value = null; // drop the only reference this world held
      sendResponse({ ok: error === null, released: true, error, fetchMs, insertMs, valueEqualsReleased, finalLength, focusMoved: document.activeElement === el });
    })();
    return true;
  }

  if (msg?.kind === "E6_CLICK") {
    const el = document.querySelector(msg.selector);
    if (!(el instanceof HTMLElement)) {
      sendResponse({ ok: false, error: "NO_ELEMENT" });
      return true;
    }
    try {
      sendResponse({ ok: true, ...clickOn(el, msg.mechanism) });
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  return false;
}
