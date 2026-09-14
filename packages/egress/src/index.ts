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
} from "./guard.js";
