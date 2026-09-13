/**
 * E6 — PRE-REGISTERED mechanism × fixture matrix and predictions, committed before the mechanisms exist.
 *
 * Capability discovery: what can a REAL MV3 extension (the Track G host) do when it must type a value
 * or click a control, without `chrome.debugger`? Every earlier ACT / HIT-TEST / VERIFY RESULT browser
 * result used Playwright's trusted CDP input; a content script cannot produce trusted input.
 *
 * Mechanism C (`chrome.debugger` Input.insertText / Input.dispatchMouseEvent) is NOT run in this
 * session: it needs a new permission and shows a browser infobar, and the protocol allows it only if A
 * and B fail AND after explicit permission and security review. If A/B fail, C is reported as the
 * required next decision, not attempted.
 *
 * Predictions are the author's beliefs before measurement. A wrong prediction is reported as wrong.
 */
export const TYPE_MECHANISMS = {
  A_native_setter_events: "HTMLInputElement.prototype value setter, then bubbling input + change events",
  B1_execCommand_insertText: "el.focus(); document.execCommand('insertText', false, value) after selecting existing text",
  B2_setRangeText_inputEvent: "el.setRangeText(value, 0, len, 'end'), then a bubbling InputEvent('input', { inputType: 'insertText' })",
};

export const CLICK_MECHANISMS = {
  A_element_click: "el.click() on the validated element",
  B_point_pointer_sequence: "pointerdown/mousedown/pointerup/mouseup/click dispatched to document.elementFromPoint(centre)",
};

export const TYPE_FIXTURES = {
  F1_plain_tel: "<input type=tel>, no framework",
  F2_react_controlled: "React 18.3.1 controlled <input>, state mirrored to #mirror, re-render on demand",
  F3_maxlength_5: "<input maxlength=5>",
  F5_hostile_monkeypatch: "page main world patches HTMLInputElement.prototype.value setter, Document.prototype.execCommand, HTMLInputElement.prototype.setRangeText to record what passes through them",
};

export const CLICK_FIXTURES = {
  K1_plain_button: "button increments a counter on any click",
  F4_trusted_only_button: "button increments only if event.isTrusted",
  K2_transparent_overlay: "target button under a transparent div that also counts clicks",
};

/** Predicted outcome per (mechanism, fixture). "valueOk" = final value equals the synthetic canary. */
export const PREDICTIONS = {
  "A_native_setter_events|F1_plain_tel": { valueOk: true, trustedEvents: false, focusMoved: false },
  "A_native_setter_events|F2_react_controlled": { valueOk: true, reactState: true, survivesRerender: true },
  "A_native_setter_events|F3_maxlength_5": { valueOk: true, note: "programmatic set ignores maxlength (predicted: NOT truncated)" },
  "A_native_setter_events|F5_hostile_monkeypatch": { valueOk: true, pagePatchesSawValue: false },
  "B1_execCommand_insertText|F1_plain_tel": { valueOk: true, trustedEvents: true, focusMoved: true },
  "B1_execCommand_insertText|F2_react_controlled": { valueOk: true, reactState: true, survivesRerender: true },
  "B1_execCommand_insertText|F3_maxlength_5": { valueOk: false, note: "editing command honours maxlength (predicted: truncated to 5)" },
  "B1_execCommand_insertText|F5_hostile_monkeypatch": { valueOk: true, pagePatchesSawValue: false },
  "B2_setRangeText_inputEvent|F1_plain_tel": { valueOk: true, trustedEvents: false, focusMoved: false },
  "B2_setRangeText_inputEvent|F2_react_controlled": { valueOk: true, reactState: true, survivesRerender: true },
  "B2_setRangeText_inputEvent|F3_maxlength_5": { valueOk: true, note: "predicted NOT truncated" },
  "B2_setRangeText_inputEvent|F5_hostile_monkeypatch": { valueOk: true, pagePatchesSawValue: false },
  "A_element_click|K1_plain_button": { effect: true, trusted: false },
  "A_element_click|F4_trusted_only_button": { effect: false, trusted: false },
  "A_element_click|K2_transparent_overlay": { targetClicked: true, overlayClicked: false, note: "element dispatch bypasses what is on top" },
  "B_point_pointer_sequence|K1_plain_button": { effect: true, trusted: false },
  "B_point_pointer_sequence|F4_trusted_only_button": { effect: false, trusted: false },
  "B_point_pointer_sequence|K2_transparent_overlay": { targetClicked: false, overlayClicked: true, note: "point dispatch lands on what is on top" },
};

export const CELLS = ["chrome-for-testing-153", "edge-branded"];
export const RUNS = 10;
export const SYNTHETIC_CANARY = "9000000001";
