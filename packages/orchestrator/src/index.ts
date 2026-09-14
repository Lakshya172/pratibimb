/**
 * `@pratibimb/orchestrator` — one task, once, through every existing gate.
 *
 * It owns sequencing and nothing else. Privacy is `@pratibimb/privacy`, plan structure is
 * `@pratibimb/plan`, the reasoner boundary is `@pratibimb/reasoner`, and the click is `guardedAct` in
 * `@pratibimb/agent`. This package creates no vault, no sanitizer, no verifier, no rehydration path
 * and no click executor, and it cannot reach a page except through the ports it is handed.
 */
export {
  TERMINAL_STATES,
  resultOf,
  runTask,
  succeeded,
  type RefusalStage,
  type RunOptions,
  type RunRecord,
  type RunRefusal,
  type RunState,
  type RunTimings,
  type Transition,
} from "./machine.js";

export { type ClientPorts, type GrantDecision, type GrantRequest, type Observation } from "./ports.js";
