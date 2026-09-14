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
 * WHAT IT ENFORCES, in the narrow sense that "enforce" is honest here: a sensitive value does not
 * reach the handoff, and it is enforced twice — the assembler writes only references and shape
 * hints, and the verifier then scans the finished bytes against the vault's own contents and refuses
 * if anything survived, whichever code path put it there.
 *
 * WHAT IT IS NOT. A **reconstruction**, not the recovery of an earlier implementation — see the
 * package README for the provenance of that claim. It is a prototype: the vault is memory-only and
 * not production storage, the name detector is a demo-safe shape test and not name recognition,
 * there is no egress client so the ledger records intent rather than transmission, and no claim is
 * made here about general PII recall or non-inferability.
 *
 * It changes nothing in `@pratibimb/perception`: `VerifiedHandoff` is built from perception's own
 * `SanitizedHandoff` shape by widening one field, in this package.
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

export {
  Vault,
  createVault,
  type RefDescriptor,
  type StoreOutcome,
  type StoreRefusalCause,
  type StoreRequest,
  type VaultSessionContext,
} from "./vault.js";

export {
  isVerifiedHandoff,
  scanForVaultValues,
  serializeHandoff,
  verifyHandoff,
  type HandoffBody,
  type HandoffDraft,
  type HandoffRequest,
  type Redaction,
  type VerificationContext,
  type VerificationOutcome,
  type VerificationRefusalCause,
  type VerifiedHandoff,
} from "./handoff.js";

export {
  EgressLedger,
  createLedger,
  sha256Hex,
  type LedgerEntry,
  type LedgerOutcome,
  type LedgerRefusalCause,
} from "./ledger.js";

export {
  fingerprintOf,
  sanitize,
  type SanitizeContext,
  type SanitizeInput,
  type SanitizeOutcome,
  type SanitizeRefusalCause,
  type SanitizeReport,
} from "./sanitize.js";

export {
  bind,
  classOriginKey,
  findUseGrant,
  rehydrate,
  type BindCause,
  type BindContext,
  type BindDecision,
  type BindStep,
  type BindView,
  type RehydrateOutcome,
  type UseGrant,
  type ViewField,
} from "./bind.js";

export {
  checkLiteral,
  type LiteralCause,
  type LiteralContext,
  type LiteralFinding,
  type LiteralSeverity,
  type LiteralVerdict,
} from "./literalCheck.js";
