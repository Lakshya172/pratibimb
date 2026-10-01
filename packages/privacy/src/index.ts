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
  createVaultView,
  type AsyncLiteralOracle,
  type HeldLiteral,
  type LiteralOracle,
  type VaultFacade,
  type VaultReader,
  type VaultView,
  type VaultViewContext,
} from "./vaultView.js";

export {
  isVerifiedHandoff,
  scanForVaultValues,
  scanForVaultValuesAsync,
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
  buildHandoffDraft,
  classifyObservation,
  fingerprintOf,
  sanitize,
  type AssembleContext,
  type ClassifyContext,
  type ClassifyOutcome,
  type HandoffParts,
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
  type RehydrateContext,
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

/**
 * The canonical visual redaction geometry — the frozen union (dilate 4 px, merge at IoU > 0.3), clipped
 * to the visual-only region. The one implementation; the RE-1 scorer imports it rather than copying it.
 */
export {
  REDACTION_UNION,
  clipTo,
  dilate,
  failClosedMask,
  maskCoverage,
  mergeOverlapping,
  overlapRatio,
  rectArea,
  redactionMask,
  toAxisAligned,
  type Quad,
  type Rect,
  type RedactionBox,
} from "./redactionGeometry.js";

/**
 * The fail-closed text finding (ADR-0011 §3) and the visual redaction plan it drives. A detector can
 * only produce UNREAD_REGION, which has no class to declare safe and is always redacted; any tier
 * failure or malformed report masks every visual-only region whole (INV-23).
 */
export {
  READ_TEXT_KEYS,
  REDACT_UNREAD,
  TEXT_FINDING_KIND,
  UNREAD_REGION_KEYS,
  findingRequiresRedaction,
  mustRedact,
  parseTextFinding,
  planVisualRedaction,
  unreadRegion,
  type ReadText,
  type RegionMask,
  type TextFinding,
  type TextFindingParse,
  type TextRegionFailureStatus,
  type TextRegionReport,
  type UnreadRegion,
  type UnreadRegionInput,
  type VisualRedactionPlan,
  type VisualRegion,
} from "./textFinding.js";

/**
 * The pixel mask: a constant-colour opaque fill over integer capture-pixel rectangles, in place.
 * Never blur, never pixelation, never partial alpha.
 */
export {
  MASK_FILL,
  PixelMaskError,
  assertRgbaFrame,
  fillOpaque,
  wipeFrame,
  type PixelRect,
  type RgbaFrame,
} from "./pixelRedaction.js";

/**
 * M10.7 — the masked-frame artifact: the decoded-mask check (steps 1–2 of the frozen verifier) and
 * the MASK-VERIFIED attestation egress asks for. Pixels, geometry and digests; no browser codec.
 */
export {
  MASK_INTERIOR_INSET_PX,
  WEBP_MASK_TOLERANCE,
  WEBP_QUALITY,
  attestMaskedFrame,
  checkDecodedMask,
  hasWebpSignature,
  isMaskVerifiedFrame,
  sha256HexOfBytes,
  type AttestInput,
  type AttestOutcome,
  type AttestRefusalCode,
  type DecodedMaskCheck,
  type DecodedMaskRect,
  type MaskedFrameManifest,
  type MaskVerifiedFrame,
} from "./maskedArtifact.js";
