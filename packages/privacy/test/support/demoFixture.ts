/**
 * The synthetic demo application form, as data.
 *
 * These values are **synthetic and invented for this repository** (SECURITY.md §2). They exist so
 * the privacy boundary has something real to protect: a test that sanitizes an empty string proves
 * nothing. The same values back the browser fixture, so the unit suite and the smoke test are about
 * the same form.
 *
 * The Aadhaar number is `…0124`, which passes the Verhoeff checksum. `…0123` is kept beside it as a
 * negative vector: it must fail, and the validator is never adjusted to make it pass.
 */
import {
  buildElementGraph,
  frameId,
  type CaptureGeometry,
  type DomMeasurement,
  type ElementGraph,
  type FrameId,
} from "@pratibimb/perception";

import type { ObservedField, SanitizeContext } from "../../src/index.js";

export const ORIGIN = "http://127.0.0.1:8971";

/** Synthetic values. Not real people, not real numbers. */
export const DEMO = {
  name: "Ramesh Kumar",
  mobile: "9000000001",
  aadhaar: "2345 6789 0124",
  aadhaarInvalid: "2345 6789 0123",
  dob: "1998-04-12",
  otp: "482913",
} as const;

/** Every secret the vault is expected to hold, for leak sweeps. */
export const SECRETS: readonly string[] = [DEMO.name, DEMO.mobile, DEMO.aadhaar, DEMO.dob];

export const GOAL = "Submit my application with my registered mobile number.";

/** A fixed reference day, so date validation never depends on when the suite runs. */
export const TODAY = new Date("2026-09-14T00:00:00Z");

export const VIEWPORT = { w: 1024, h: 768, dpr: 1, zoom: 1, scrollX: 0, scrollY: 0 };

const geometry: CaptureGeometry = {
  dpr: 1,
  zoom: 1,
  viewportCss: { w: VIEWPORT.w, h: VIEWPORT.h },
  captureSize: { w: VIEWPORT.w, h: VIEWPORT.h },
  scroll: { x: 0, y: 0 },
  origin: ORIGIN,
};

const measurements: DomMeasurement[] = [
  { selector: "#name", role: "textbox", name: "Full name", rect: { x: 320, y: 180, w: 300, h: 32 }, enabled: true, cssHidden: false, parentIndex: -1 },
  { selector: "#mobile", role: "textbox", name: "Mobile number", rect: { x: 320, y: 240, w: 300, h: 32 }, enabled: true, cssHidden: false, parentIndex: -1 },
  { selector: "#aadhaar", role: "textbox", name: "Aadhaar number", rect: { x: 320, y: 300, w: 300, h: 32 }, enabled: true, cssHidden: false, parentIndex: -1 },
  { selector: "#dob", role: "textbox", name: "Date of birth", rect: { x: 320, y: 360, w: 300, h: 32 }, enabled: true, cssHidden: false, parentIndex: -1 },
  { selector: "#otp", role: "textbox", name: "OTP", rect: { x: 320, y: 420, w: 300, h: 32 }, enabled: true, cssHidden: false, parentIndex: -1 },
  { selector: "#submit", role: "button", name: "Submit application", rect: { x: 320, y: 480, w: 180, h: 40 }, enabled: true, cssHidden: false, parentIndex: -1 },
  { selector: "#status", role: "status", name: "Not submitted", rect: { x: 320, y: 540, w: 300, h: 24 }, enabled: true, cssHidden: false, parentIndex: -1 },
];

export const demoGraph = (frame: FrameId = frameId("privacy-demo-1")): ElementGraph =>
  buildElementGraph(measurements, geometry, frame);

/** What the client read locally. The only place raw values enter the package. */
export const demoFields = (): ObservedField[] => [
  { id: "#name", value: DEMO.name, label: "Full name", autocomplete: "name", type: "text", origin: ORIGIN },
  { id: "#mobile", value: DEMO.mobile, label: "Mobile number", autocomplete: "tel", type: "tel", origin: ORIGIN },
  { id: "#aadhaar", value: DEMO.aadhaar, label: "Aadhaar number", type: "text", origin: ORIGIN },
  { id: "#dob", value: DEMO.dob, label: "Date of birth", type: "date", origin: ORIGIN },
  { id: "#otp", value: DEMO.otp, label: "OTP", autocomplete: "one-time-code", type: "text", origin: ORIGIN },
];

export const demoContext = (over: Partial<SanitizeContext> = {}): SanitizeContext => ({
  sessionId: "session-1",
  requestId: "request-1",
  origin: ORIGIN,
  viewport: VIEWPORT,
  now: 1_760_000_000_000,
  today: TODAY,
  ...over,
});

/** Fingerprint as `sanitize` computes it: selector, role, accessible name. */
export const demoFingerprint = (selector: string): string => {
  const measurement = measurements.find((m) => m.selector === selector);
  if (!measurement) throw new Error(`test setup: no measurement for ${selector}`);
  return `${measurement.selector}|${measurement.role}|${measurement.name}`;
};
