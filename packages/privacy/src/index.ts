/**
 * `@pratibimb/privacy` — the privacy firewall: the client-side boundary a value must cross before
 * anything outside the machine learns that it exists.
 *
 * The product thesis is that PratiBimb is a privacy firewall that happens to power an agent. This
 * package is that firewall's enforcement half:
 *
 *     local values → classify → validate → tokenise (or mask) → verified handoff → ledger
 *                                      ↘ memory-only vault ↘ bind + human grant → rehydrate
 *
 * WHAT IT IS NOT. A **reconstruction**, not the recovery of an earlier implementation — see the
 * package README for the provenance of that claim. It is a prototype: the vault is memory-only and
 * not production storage, the name detector is a demo-safe shape test and not name recognition,
 * there is no egress client so the ledger records intent rather than transmission, and no claim is
 * made here about general PII recall or non-inferability.
 *
 * It changes nothing in `@pratibimb/perception`.
 */
export {
  PII_CLASSES,
  TIER_OF,
  TOKENISABLE_CLASSES,
  asPiiClass,
  isTokenisable,
  mostProtective,
  mostProtectiveOf,
  protectionRank,
  type FieldClass,
  type PiiClass,
  type Tier,
} from "./classes.js";

export {
  isAadhaarNumber,
  isDateOfBirth,
  isDemoSafeName,
  isIndianMobile,
  isOtpShaped,
  normaliseAadhaar,
  normaliseIndianMobile,
  verhoeffValid,
} from "./validators.js";

export {
  classifyField,
  classifyObserved,
  classifyValue,
  type Classification,
  type ObservedField,
  type ObservedFieldShape,
} from "./classify.js";

export { OrdinalCounter, formatToken, isToken, parseToken, type ParsedToken } from "./tokens.js";

export { fieldRoleOf, hintFor, type Hint, type HintKind } from "./hints.js";

export { containsSecret, digitFold, textFold } from "./normalise.js";
