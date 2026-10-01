/**
 * `@pratibimb/egress` — the single module through which bytes leave this machine.
 *
 * It exists because `SECURITY.md` §5 names *"egress can bypass the single egress module"* as a
 * stop condition, and a stop condition needs a module to be about. Everything network-facing goes
 * through `sendVerified`; no other package performs a `fetch`, and tests scan for it.
 *
 * It owns the socket and the ordering. It owns no privacy decision: verification is
 * `isVerifiedHandoff`'s and the residual scan is `scanForVaultValues`'s, both called here and
 * neither re-answered.
 */
export {
  DEFAULT_EGRESS_TIMEOUT_MS,
  isLoopback,
  sendVerified,
  type EgressOutcome,
  type EgressRecord,
  type EgressRefusal,
  type EgressRefusalCause,
  type EgressRequest,
  type EgressTransport,
  type PeerReceipt,
} from "./guard.js";

/**
 * M10.7 — one MASK-VERIFIED WebP frame, through the same choke point: attested → loopback → hash pin →
 * still-WebP container → send. Not a general egress primitive; no product caller.
 */
export {
  FRAME_SHA_HEADER,
  sendMaskVerifiedFrame,
  type FrameEgressOutcome,
  type FrameEgressRecord,
  type FrameEgressRefusal,
  type FrameEgressRefusalCause,
  type FrameEgressRequest,
} from "./frame.js";
export { inspectWebp, type WebpInspection } from "./webpContainer.js";

/**
 * M11 — the production frame-handoff CONTRACT (ADR-0012, PROPOSED): the QG-04 body builder and its
 * server-side parser, the v1.2 manifest check, and the fail-closed decision. Pure; no network; no
 * product caller. Frame egress is DISABLED and cannot be admitted today.
 */
export {
  ADMISSIBLE_FRAME_STATE,
  HANDOFF_CONTRACT,
  bodyMatchesPin,
  buildHandoffBody,
  canonicalJson,
  checkManifest,
  createSentRegistry,
  decideHandoff,
  isAdmittedFrameVerdict,
  parseHandoffBody,
  type FrameEgressSwitch,
  type FrameRefusal,
  type HandoffBody,
  type HandoffConfig,
  type HandoffDecision,
  type HandoffInput,
  type ManifestCheck,
  type ManifestRefusal,
  type SentRegistry,
  type StopCause,
  type VerificationState,
} from "./handoffContract.js";

/**
 * M12 — QG-04 enforcement: whole-body attestation, the production sender's gates (no transport), the
 * production configuration (no origin, no authentication) and the server's request check.
 */
export {
  FRAME_EGRESS_STATE,
  PRODUCTION_HANDOFF_CONFIG,
  QG04_PROTOCOL,
  attestHandoffBody,
  attestedBody,
  isHandoffAttestation,
  sendProductionHandoff,
  validateQg04Request,
  type AttestRefusal,
  type AttestedState,
  type HandoffAttestation,
  type HandoffAuthentication,
  type ProductionHandoffConfig,
  type ProductionSendOutcome,
  type ProductionSendRefusal,
  type RuntimeIdentity,
} from "./qg04.js";
