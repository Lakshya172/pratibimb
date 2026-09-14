/**
 * THE EVIDENCE VIEW-MODEL — "what actually left the device?", computed once and rendered twice.
 *
 * Pane 5 and the rehearsal artifact must agree, because a judge may read both. So the projection
 * lives here as pure functions over the run's own objects, with no DOM and no formatting, and both
 * consumers call it. A pane that built its own summary could show something the run never did.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE. Everything below is written to files, printed to a console
 * and shown on a projector. **No function here may return a value the vault holds**, and none of them
 * takes one except {@link sweep}, which takes the values only to look for them and reports a count.
 * `SECURITY.md` §2 forbids writing a synthetic demo value into source, so none appears here either.
 */
import { type EgressRecord, type EgressRefusal } from "@pratibimb/egress";
import { type RunRecord } from "@pratibimb/orchestrator";

/** One attempt to send, as the page recorded it. Either it went or it was refused. */
export interface EgressAttempt {
  readonly record?: EgressRecord;
  readonly refusal?: EgressRefusal;
}

/**
 * The headline a judge reads from across the room.
 *
 * `LEAKAGE_BLOCKED` is deliberately distinct from `REFUSED`: both stop the run, but only one of them
 * means the client caught the reasoner handing back a secret, and that difference is the whole point
 * of the second act.
 */
export type Headline = "CONFIRMED" | "CONFIRMED_VIA_FALLBACK" | "LEAKAGE_BLOCKED" | "REFUSED" | "NOT_CONFIRMED" | "IDLE";

export const HEADLINE_TEXT: Readonly<Record<Headline, string>> = {
  CONFIRMED: "CONFIRMED",
  CONFIRMED_VIA_FALLBACK: "CONFIRMED · FALLBACK",
  LEAKAGE_BLOCKED: "LEAKAGE BLOCKED",
  REFUSED: "REFUSED",
  NOT_CONFIRMED: "NOT CONFIRMED",
  IDLE: "",
} as const;

/** What the run reached, reduced to the one word the room needs. Never upgrades uncertainty. */
export function headlineOf(record: RunRecord | null): Headline {
  if (!record) return "IDLE";
  if (record.state === "REFUSED") {
    return record.refusal?.planRefusal?.literalSeverity === "LEAKAGE_EVENT" ? "LEAKAGE_BLOCKED" : "REFUSED";
  }
  const verification = record.act?.verification?.verification ?? null;
  if (verification !== "CONFIRMED") return "NOT_CONFIRMED";
  return record.fallback?.fellBack === true ? "CONFIRMED_VIA_FALLBACK" : "CONFIRMED";
}

/**
 * The two-sided payload proof, as far as the client can see it.
 *
 * `clientSha256` is this machine's digest of the bytes it serialized and sent. `peerSha256` is what
 * the receiving service said it got. `digestsAgree` is `null` when the peer claimed nothing —
 * *absence* of a cross-check, which is not the same as a failed one and must not be shown as one.
 *
 * The peer's number is a claim by a peer. The client's guarantee is that the bytes it scanned are
 * the bytes it sent, and that holds whatever the far end says.
 */
export interface PayloadProof {
  readonly destination: string;
  readonly transport: string;
  readonly reasoner: string;
  readonly payloadBytes: number;
  readonly clientSha256: string;
  readonly peerSha256: string | null;
  readonly peerBytes: number | null;
  readonly digestsAgree: boolean | null;
  readonly references: readonly string[];
  readonly leakCheck: "CLEAN";
  readonly responseStatus: number | null;
  readonly elapsedMs: number;
}

/** A send that never happened, and the authority that stopped it. Carries no payload, by type. */
export interface EgressBlocked {
  readonly destination: string;
  readonly cause: string;
  readonly stage: string;
  readonly severity: "LEAKAGE_EVENT" | "REFUSED";
  readonly leakedClass: string | null;
}

export interface EgressEvidence {
  readonly requestId: string;
  readonly sessionId: string;
  readonly sent: PayloadProof | null;
  readonly blocked: readonly EgressBlocked[];
  /** How many times this run attempted to put bytes on the wire. */
  readonly attempts: number;
}

/** Project the run's egress attempts into the shape both the pane and the artifact print. */
export function egressEvidenceOf(record: RunRecord | null, attempts: readonly EgressAttempt[]): EgressEvidence | null {
  if (!record) return null;
  const sentAttempt = attempts.find((attempt) => attempt.record !== undefined)?.record ?? null;
  const blocked = attempts
    .filter((attempt) => attempt.refusal !== undefined)
    .map((attempt) => {
      const refusal = attempt.refusal as EgressRefusal;
      return {
        destination: refusal.destination,
        cause: refusal.cause,
        stage: refusal.stage,
        severity: refusal.severity,
        leakedClass: refusal.leakedClass ?? null,
      };
    });

  return {
    requestId: record.requestId,
    sessionId: record.sessionId,
    attempts: attempts.length,
    blocked,
    sent: sentAttempt
      ? {
          destination: sentAttempt.destination,
          transport: sentAttempt.transport,
          reasoner: sentAttempt.reasoner,
          payloadBytes: sentAttempt.payloadBytes,
          clientSha256: sentAttempt.payloadSha256,
          peerSha256: sentAttempt.peerReceipt?.sha256 ?? null,
          peerBytes: sentAttempt.peerReceipt?.bytes ?? null,
          digestsAgree: sentAttempt.peerReceipt?.agrees ?? null,
          references: sentAttempt.references,
          leakCheck: sentAttempt.leakCheck,
          responseStatus: sentAttempt.responseStatus,
          elapsedMs: sentAttempt.elapsedMs,
        }
      : null,
  };
}

/** How a sweep came out. Counts and classes only — never the text that was searched for. */
export interface SweepResult {
  readonly checked: number;
  readonly found: number;
  readonly clean: boolean;
  /** Positional indices of the values that were found, so a failure can be located without quoting it. */
  readonly foundAt: readonly number[];
  /**
   * Whether the whole subject could be searched.
   *
   * `false` means a cycle was pruned, so `clean` is a statement about what was reachable and not
   * about everything that exists. A caller that needs certainty must treat this as "not checked"
   * rather than as "checked and clean".
   */
  readonly complete: boolean;
}

/**
 * Serialize for searching, surviving the shapes a real run record actually has.
 *
 * A run record is assembled from live objects, and an earlier version of this function threw
 * `Converting circular structure to JSON` on one. Throwing here is the worst possible failure mode:
 * mid-demo it takes out the evidence pane, and a caller that caught it would be one line away from
 * reporting a leak check as clean *because* it could not run. So cycles are pruned and the pruning
 * is reported instead.
 */
const searchable = (subject: unknown): { readonly text: string; readonly complete: boolean } => {
  if (typeof subject === "string") return { text: subject, complete: true };
  const seen = new WeakSet<object>();
  let complete = true;
  const text =
    JSON.stringify(subject, (_key, value: unknown) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          complete = false;
          return "[circular]";
        }
        seen.add(value);
      }
      return value;
    }) ?? "";
  return { text, complete };
};

/**
 * Look for any of `secrets` inside `subject`, and report **counts, never content**.
 *
 * Used to assert the negative that matters: the serialized handoff, the ledger and the whole run
 * record contain none of the values the page holds. A helper that returned what it found would put
 * the leak into the caller's log, which is the failure it exists to detect.
 *
 * This is a presentation-layer check, deliberately independent of `scanForVaultValues`. Privacy's
 * scanner is the authority and runs inside the egress guard before anything is sent; this one asks
 * the same question again, later, of the things that are about to be *displayed and written down*.
 */
export function sweep(subject: unknown, secrets: readonly string[]): SweepResult {
  const { text, complete } = searchable(subject);
  const candidates = secrets.filter((secret) => secret.trim() !== "");
  const foundAt: number[] = [];
  candidates.forEach((secret, index) => {
    if (text.includes(secret)) foundAt.push(index);
  });
  return { checked: candidates.length, found: foundAt.length, clean: foundAt.length === 0, foundAt, complete };
}
