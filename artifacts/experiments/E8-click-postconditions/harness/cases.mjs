/**
 * E8 (click half) — PRE-REGISTERED scripted click plan, the postcondition each click would get from a
 * LOCAL role rule, and the predicted verification outcome.
 *
 * Committed before the harness exists. No model is involved: the plan is fixed.
 *
 * The local rule may use ONLY the postcondition kinds that exist on `main`
 * (FOCUS_ON_TARGET · TARGET_ENABLED · TARGET_NAME). TARGET_NAME and TARGET_ENABLED need an expected
 * value that only page-specific knowledge could supply — a planner's claim, which the architecture does
 * not let produce CONFIRMED — so the local rule uses FOCUS_ON_TARGET for every clickable role.
 *
 * Separately, a page-side EFFECT ORACLE records whether the thing the click was FOR actually happened.
 * The oracle is the harness's knowledge of its own fixture and is never available to the product. It
 * exists to answer the question the postcondition cannot: does CONFIRMED mean the intended effect?
 */
export const LOCAL_RULE = {
  textbox: "FOCUS_ON_TARGET",
  button: "FOCUS_ON_TARGET",
  checkbox: "FOCUS_ON_TARGET",
  radio: "FOCUS_ON_TARGET",
  label: "FOCUS_ON_TARGET",
  listbox: "FOCUS_ON_TARGET",
  link: "FOCUS_ON_TARGET",
};

export const ACTIONS = [
  { id: "A1_textbox_fullname", selector: "#fullname", intent: "focus the Full name field", effect: "focused:#fullname", predict: "CONFIRMED", predictEffect: true },
  { id: "A2_textbox_mobile", selector: "#mobile", intent: "focus the Mobile number field", effect: "focused:#mobile", predict: "CONFIRMED", predictEffect: true },
  { id: "A3_label_dob", selector: "#dob-label", intent: "focus Date of birth via its label", effect: "focused:#dob", predict: "NOT_CONFIRMED", predictCause: "FOCUS_ELSEWHERE", predictEffect: true },
  { id: "A4_checkbox_same_address", selector: "#same-address", intent: "tick Same as permanent address", effect: "checked:#same-address", predict: "CONFIRMED", predictEffect: true },
  { id: "A5_checkbox_page_refuses", selector: "#sms", intent: "tick SMS updates (the page cancels the toggle)", effect: "checked:#sms", predict: "CONFIRMED", predictEffect: false },
  { id: "A6_radio_urban", selector: "#urban", intent: "select Urban", effect: "checked:#urban", predict: "CONFIRMED", predictEffect: true },
  { id: "A7_disclosure_address", selector: "#show-address", intent: "reveal the address fields", effect: "visible:#line1", predict: "CONFIRMED", predictEffect: true },
  { id: "A8_toggle_renames_itself", selector: "#alt-toggle", intent: "reveal the alternate-number field", effect: "visible:#alt", predict: "UNKNOWN", predictCause: "TARGET_IDENTITY_CHANGED", predictEffect: true },
  { id: "A9_next_removes_target", selector: "#next", intent: "go to step 2", effect: "visible:#submit", predict: "UNKNOWN", predictCause: "TARGET_ABSENT_AFTER_ACTION", predictEffect: true },
  { id: "A10_select_state", selector: "#state", intent: "open the State list", effect: "focused:#state", predict: "CONFIRMED", predictEffect: true },
  { id: "A11_help_link", selector: "#help", intent: "open Help", effect: "hash:#help", predict: "NOT_CONFIRMED", predictCause: "ACTION_NOT_DISPATCHED", predictEffect: false },
];

export const RUNS_PER_ACTION = 10;
export const VIEWPORT = { width: 1024, height: 900 };
