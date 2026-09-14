/**
 * `@pratibimb/reasoner` — the untrusted boundary, and the deterministic stand-in behind it.
 *
 * The package exists so that "the server is untrusted" is a fact about the types rather than a
 * sentence in a document: `ReasonerClient.propose` returns `unknown`, `sendToReasoner` refuses to
 * send anything but a handoff the privacy verifier produced, and nothing here can reach a page.
 *
 * There is no model in this phase and no network request. Replacing the deterministic planner with a
 * small open-weight text model on loopback is a change of one implementation of `ReasonerClient`;
 * everything after this boundary — parse, validate, bind, grant, rehydrate, act, verify — is
 * unchanged by that swap, which is the property the boundary is for.
 */
export {
  DEFAULT_REASONER_TIMEOUT_MS,
  sendToReasoner,
  type ReasonerClient,
  type ReasonerRequest,
  type ReasonerResponse,
  type ReasonerTransport,
  type SendOptions,
  type SendRefusalCause,
} from "./contract.js";

export { deterministicReasoner, type DeterministicOptions, type ReasonerMode } from "./deterministic.js";
