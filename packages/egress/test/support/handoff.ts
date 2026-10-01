/**
 * A real verified handoff for the reasoner tests.
 *
 * Built by the real `sanitize()`, because a hand-made object would not be recognised by
 * `isVerifiedHandoff` — which is exactly the property `sendToReasoner` relies on, and therefore the
 * property these tests must not work around.
 */
import { buildElementGraph, frameId, type CaptureGeometry, type DomMeasurement } from "@pratibimb/perception";
import { sanitize, type ObservedField, type Vault, type VerifiedHandoff } from "@pratibimb/privacy";

export const ORIGIN = "http://127.0.0.1:8979";
export const SESSION = "egress-session-1";
export const REQUEST = "egress-request-1";
export const GOAL = "Submit my application with my registered mobile number.";
export const TODAY = new Date("2026-09-14T00:00:00Z");

/** Synthetic. Not a real person, not a real number. */
export const DEMO = { name: "Ramesh Kumar", mobile: "9000000001", aadhaar: "2345 6789 0124", dob: "1998-04-12", otp: "482913" } as const;

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

const FIELDS: ObservedField[] = [
  { id: "#name", value: DEMO.name, label: "Full name", autocomplete: "name", type: "text", origin: ORIGIN },
  { id: "#mobile", value: DEMO.mobile, label: "Mobile number", autocomplete: "tel", type: "tel", origin: ORIGIN },
  { id: "#aadhaar", value: DEMO.aadhaar, label: "Aadhaar number", type: "text", origin: ORIGIN },
  { id: "#dob", value: DEMO.dob, label: "Date of birth", type: "date", origin: ORIGIN },
  { id: "#otp", value: DEMO.otp, label: "OTP", autocomplete: "one-time-code", type: "text", origin: ORIGIN },
  { id: "#mobile_confirm", value: "", label: "Confirm mobile number", autocomplete: "tel", type: "tel", origin: ORIGIN },
];

export const verifiedHandoff = async (
  over: { readonly sessionId?: string; readonly requestId?: string } = {}
): Promise<{ handoff: VerifiedHandoff; vault: Vault }> => {
  const outcome = await sanitize(
    buildElementGraph(MEASUREMENTS, geometry, frameId("egress-demo-1")),
    GOAL,
    {
      sessionId: over.sessionId ?? SESSION,
      requestId: over.requestId ?? REQUEST,
      origin: ORIGIN,
      viewport: VIEWPORT,
      now: 1_760_000_000_000,
      today: TODAY,
    },
    { fields: FIELDS }
  );
  if (!outcome.ok) throw new Error(`test setup: sanitize refused (${outcome.refused})`);
  return { handoff: outcome.handoff, vault: outcome.vault };
};
