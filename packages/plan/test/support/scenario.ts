/**
 * The demo page, as data, for plan-validation tests.
 *
 * The same synthetic values the privacy suite and the browser fixture use (SECURITY.md §2), with one
 * addition the demo needs: **an empty "Confirm mobile number" field**. The registered number is
 * already on the page; the task is to restore it into the empty confirmation field and submit. An
 * empty field is what makes the restoration observable — filling a field that already holds the
 * value would prove nothing.
 *
 * Everything here goes through the real `sanitize()`, so the vault, the handoff and the references
 * in these tests are the ones the shipped code produces. Nothing is hand-assembled.
 */
import {
  buildElementGraph,
  frameId,
  type CaptureGeometry,
  type DomMeasurement,
  type ElementGraph,
} from "@pratibimb/perception";
import {
  classOriginKey,
  fingerprintOf,
  sanitize,
  type BindView,
  type ObservedField,
  type UseGrant,
  type Vault,
  type VerifiedHandoff,
  type ViewField,
} from "@pratibimb/privacy";

import { type PlanValidationContext } from "../../src/index.js";

export const ORIGIN = "http://127.0.0.1:8972";
export const SESSION = "plan-session-1";
export const REQUEST = "plan-request-1";
export const DOCUMENT = "plan-doc-1";
export const GOAL = "Submit my application with my registered mobile number.";
export const TODAY = new Date("2026-09-14T00:00:00Z");
export const NOW = 1_760_000_000_000;

/** Synthetic. Not a real person, not a real number. */
export const DEMO = {
  name: "Ramesh Kumar",
  mobile: "9000000001",
  aadhaar: "2345 6789 0124",
  dob: "1998-04-12",
  otp: "482913",
} as const;

const VIEWPORT = { w: 1024, h: 768, dpr: 1, zoom: 1, scrollX: 0, scrollY: 0 };

const geometry: CaptureGeometry = {
  dpr: 1,
  zoom: 1,
  viewportCss: { w: VIEWPORT.w, h: VIEWPORT.h },
  captureSize: { w: VIEWPORT.w, h: VIEWPORT.h },
  scroll: { x: 0, y: 0 },
  origin: ORIGIN,
};

const MEASUREMENTS: DomMeasurement[] = [
  { selector: "#name", role: "textbox", name: "Full name", rect: { x: 320, y: 140, w: 300, h: 32 }, enabled: true, cssHidden: false, parentIndex: -1 },
  { selector: "#mobile", role: "textbox", name: "Mobile number", rect: { x: 320, y: 190, w: 300, h: 32 }, enabled: true, cssHidden: false, parentIndex: -1 },
  { selector: "#aadhaar", role: "textbox", name: "Aadhaar number", rect: { x: 320, y: 240, w: 300, h: 32 }, enabled: true, cssHidden: false, parentIndex: -1 },
  { selector: "#dob", role: "textbox", name: "Date of birth", rect: { x: 320, y: 290, w: 300, h: 32 }, enabled: true, cssHidden: false, parentIndex: -1 },
  { selector: "#otp", role: "textbox", name: "OTP", rect: { x: 320, y: 340, w: 300, h: 32 }, enabled: true, cssHidden: false, parentIndex: -1 },
  { selector: "#mobile_confirm", role: "textbox", name: "Confirm mobile number", rect: { x: 320, y: 390, w: 300, h: 32 }, enabled: true, cssHidden: false, parentIndex: -1 },
  { selector: "#submit", role: "button", name: "Submit application", rect: { x: 320, y: 450, w: 180, h: 40 }, enabled: true, cssHidden: false, parentIndex: -1 },
];

export const demoGraph = (frame = frameId("plan-demo-1")): ElementGraph =>
  buildElementGraph(MEASUREMENTS, geometry, frame);

export const demoFields = (): ObservedField[] => [
  { id: "#name", value: DEMO.name, label: "Full name", autocomplete: "name", type: "text", origin: ORIGIN },
  { id: "#mobile", value: DEMO.mobile, label: "Mobile number", autocomplete: "tel", type: "tel", origin: ORIGIN },
  { id: "#aadhaar", value: DEMO.aadhaar, label: "Aadhaar number", type: "text", origin: ORIGIN },
  { id: "#dob", value: DEMO.dob, label: "Date of birth", type: "date", origin: ORIGIN },
  { id: "#otp", value: DEMO.otp, label: "OTP", autocomplete: "one-time-code", type: "text", origin: ORIGIN },
  // Empty: nothing to protect, so it receives no reference. It is where the value goes back.
  { id: "#mobile_confirm", value: "", label: "Confirm mobile number", autocomplete: "tel", type: "tel", origin: ORIGIN },
];

export const fingerprint = (selector: string): string => {
  const m = MEASUREMENTS.find((x) => x.selector === selector);
  if (!m) throw new Error(`test setup: no measurement for ${selector}`);
  return fingerprintOf(m.selector, m.role, m.name);
};

const ACCEPTS: Readonly<Record<string, ViewField["accepts"]>> = {
  "#name": "NAME",
  "#mobile": "PHONE",
  "#aadhaar": "AADHAAR",
  "#dob": "DOB",
  "#otp": "OTP",
  "#mobile_confirm": "PHONE",
  "#submit": "UNKNOWN",
};

export const demoView = (viewId = REQUEST): BindView => ({
  viewId,
  documentId: DOCUMENT,
  fields: new Map(
    MEASUREMENTS.map((m) => [
      m.selector,
      { accepts: ACCEPTS[m.selector] ?? "UNKNOWN", origin: ORIGIN, fingerprint: fingerprint(m.selector) },
    ])
  ),
});

export interface Scenario {
  readonly handoff: VerifiedHandoff;
  readonly vault: Vault;
  readonly phoneRef: string;
  readonly aadhaarRef: string;
  readonly ctx: PlanValidationContext;
  readonly useGrants: UseGrant[];
}

/** Run the real sanitizer and assemble the validation context the way the orchestrator does. */
export const scenario = async (over: Partial<PlanValidationContext> = {}): Promise<Scenario> => {
  const outcome = await sanitize(
    demoGraph(),
    GOAL,
    { sessionId: SESSION, requestId: REQUEST, origin: ORIGIN, viewport: VIEWPORT, now: NOW, today: TODAY },
    { fields: demoFields() }
  );
  if (!outcome.ok) throw new Error(`test setup: sanitize refused (${outcome.refused})`);

  const refFor = (piiClass: string): string => {
    const span = outcome.handoff.redactions.find((r) => r.class === piiClass && r.method === "token_reference");
    if (!span) throw new Error(`test setup: no reference for ${piiClass}`);
    return span.token;
  };

  const useGrants: UseGrant[] = [];
  const ctx: PlanValidationContext = {
    vault: outcome.vault,
    sessionId: SESSION,
    requestId: REQUEST,
    origin: ORIGIN,
    view: demoView(),
    currentDocumentId: DOCUMENT,
    classOriginGrants: new Set(
      outcome.handoff.redactions
        .filter((r) => r.method === "token_reference")
        .map((r) => classOriginKey(r.class, ORIGIN))
    ),
    useGrants,
    now: NOW,
    redactedTargets: new Set(outcome.handoff.redactions.map((r) => r.targetId)),
    actionableTargets: new Set(MEASUREMENTS.map((m) => m.selector)),
    today: TODAY,
    ...over,
  };

  return { handoff: outcome.handoff, vault: outcome.vault, phoneRef: refFor("PHONE"), aadhaarRef: refFor("AADHAAR"), ctx, useGrants };
};

/** A well-formed plan object, as an untrusted response would arrive. */
export const rawPlan = (steps: readonly unknown[], over: Record<string, unknown> = {}): unknown => ({
  planVersion: "1",
  goal: GOAL,
  steps,
  provenance: { requestId: REQUEST, sessionId: SESSION, viewId: REQUEST, origin: ORIGIN },
  ...over,
});

export const grantFor = (ref: string, selector: string, over: Partial<UseGrant> = {}): UseGrant => ({
  ref,
  piiClass: "PHONE",
  fingerprint: fingerprint(selector),
  origin: ORIGIN,
  sessionId: SESSION,
  purpose: "Use of PHONE for \"Confirm mobile number\"",
  actionContext: `insert into ${selector}, then click #submit`,
  grantedAt: NOW - 1_000,
  expiresAt: NOW + 60_000,
  used: false,
  ...over,
});
