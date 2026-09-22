/**
 * WHAT THE TRUSTED CLIENT ALREADY KNOWS — the M1 stand-in for a user's own stored details.
 *
 * READ THIS BEFORE BELIEVING ANYTHING ABOUT IT. These are synthetic canaries (SECURITY.md §2),
 * compiled into the host, exactly as `vaultStub` in the offscreen document already was. There is no
 * profile UI, no import, no storage and no encryption behind them, and M1 does not claim any. They
 * exist so the privacy layer, the vault and the release path have real values to work on inside the
 * extension.
 *
 * WHY THEY ARE NOT READ FROM THE PAGE, WHICH IS THE INTERESTING PART. In MV3 a content script's
 * `chrome.runtime.sendMessage` is delivered to **every** listening context, the service worker
 * included — `background.ts` has a line whose only job is to say "not for me", which is the proof.
 * So a value read from the page cannot reach the offscreen core realm without being present in a
 * message the service worker receives, and "the secret is never present in a service-worker message"
 * is an M1 invariant. Rather than weaken the invariant, M1 does not read page values at all: the
 * agent fills in what the client already holds, and the page's own field contents are never
 * collected, never tokenised and never transmitted.
 *
 * That is a narrower agent than the demo's — see `artifacts/experiments/M1-extension-loop/decision.md`
 * for the boundary and the two ways out of it — and it is the honest one for this milestone.
 */
import { type ObservedField } from "@pratibimb/privacy";

/**
 * The details a user of the M1 fixture would already have given this client, keyed by the field each
 * one belongs to. `#mobile_confirm` is deliberately absent: it is what the run has to fill in.
 */
const SYNTHETIC_PROFILE: readonly Omit<ObservedField, "origin">[] = Object.freeze([
  { id: "#name", value: "Ramesh Kumar", label: "Full name", type: "text", autocomplete: "name" },
  { id: "#mobile", value: "9000000001", label: "Mobile number", type: "tel", autocomplete: "tel" },
  { id: "#aadhaar", value: "2345 6789 0124", label: "Aadhaar number", type: "text" },
  { id: "#dob", value: "1998-04-12", label: "Date of birth", type: "date" },
  { id: "#otp", value: "482913", label: "OTP", type: "text", autocomplete: "one-time-code" },
]);

/**
 * The client's own details, stamped with the origin this run is bound to.
 *
 * `sanitize()` refuses a field whose origin is not the run's origin, so the stamp is what keeps one
 * page's run from using details held for another.
 */
export const clientHeldFields = (origin: string): readonly ObservedField[] =>
  SYNTHETIC_PROFILE.map((field) => ({ ...field, origin }));

/** Sizes only, for the host's `STATE` reply. Never the contents. */
export const clientHeldFieldCount = (): number => SYNTHETIC_PROFILE.length;
