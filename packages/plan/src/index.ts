/**
 * `@pratibimb/plan` — the plan contract and the validator between the reasoner and the page.
 *
 * It owns plan **structure** and nothing else. Whether a value may be restored is
 * `@pratibimb/privacy`'s question, asked here and never re-answered; whether one live action may be
 * dispatched is `guardedAct`'s, and this package cannot dispatch anything.
 *
 * `EXECUTABLE_ACTIONS` is untouched and remains `["click"]`. `insert` is a request to the trusted
 * client, not an agent action: there is no TYPE action, and nothing in this package types.
 */
export {
  MAX_PLAN_STEPS,
  PLAN_OPERATIONS,
  isParsedPlan,
  parsePlan,
  type ClickStep,
  type InsertStep,
  type ParseOutcome,
  type ParseRefusalCause,
  type Plan,
  type PlanOperation,
  type PlanProvenance,
  type PlanStep,
} from "./schema.js";

export {
  literalMarker,
  redactPlan,
  type SafeClickStep,
  type SafeInsertStep,
  type SafePlan,
  type SafeStep,
} from "./display.js";

export {
  validatePlan,
  type PlanRefusal,
  type PlanRefusalCause,
  type PlanValidation,
  type PlanValidationContext,
  type ValidatedClick,
  type ValidatedInsert,
  type ValidatedLiteralInsert,
  type ValidatedReferenceInsert,
  type ValidatedStep,
} from "./validate.js";
