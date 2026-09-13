/**
 * The one error the transport throws, and why it is a bare code.
 *
 * ACT keeps only `error.name` and **drops the message** (INV-21, `act.ts`), because a bridge message
 * can quote page markup. So the message here is the code itself: it says exactly what refused,
 * carries nothing derived from the page, and stays useful in a log that keeps only names.
 *
 * A refusal from the hit-test bridge becomes `UNKNOWN`, and a refusal from the action bridge becomes
 * `EXECUTION_ERROR` → `UNKNOWN`. Both are the safe direction: the core never reads a transport
 * refusal as a dispatch that did not happen, because a bridge cannot prove that.
 */
import { type TransportRefusalCode } from "./contracts.js";

export class TransportRefusal extends Error {
  override readonly name = "TransportRefusal";
  readonly code: TransportRefusalCode;

  constructor(code: TransportRefusalCode) {
    super(code);
    this.code = code;
  }
}

export const refuse = (code: TransportRefusalCode): never => {
  throw new TransportRefusal(code);
};
