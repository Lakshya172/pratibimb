/**
 * WHICH MACHINE IS THIS? — evidence provenance, resolved from the machine, not from a literal.
 *
 * Every evidence runner in this repository used to carry `workstation: "W2"` as a hardcoded
 * string and write to a hardcoded `w2-*.json` filename. That was correct exactly once: on W2.
 * Run the same command on W1 and it silently overwrote the W2 record with W1 results **still
 * labelled W2** — which is the one thing `AGENTS.md` §5 and the handoff documents forbid, because
 * a measurement attributed to the wrong machine is worse than no measurement. It is not caught by
 * review either: the diff looks like a normal evidence refresh.
 *
 * W1 is now the only development workstation, so this had to stop being a literal.
 *
 * THREE RULES, and the second is the one that matters:
 *
 * 1. **The machine names itself.** `os.hostname()` is matched against the registry below, which is
 *    the same mapping `docs/handoff/w1-to-w2/README.md` and `artifacts/environment/` already
 *    record. Nothing is inferred from a path, a drive letter or a username.
 *
 * 2. **An unknown machine refuses.** It does not fall back to a default, and it does not guess
 *    from the previous run. Guessing is precisely how "W2" ended up on a W1 result. A third
 *    workstation announces itself by setting `PRATIBIMB_WORKSTATION`, which is a deliberate act.
 *
 * 3. **A disagreement refuses.** If the hostname is known *and* the environment says something
 *    else, that is a conflict, not an override — the environment does not get to relabel a machine
 *    this repository can already identify.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it does not read, move, or rewrite historical evidence.
 * W2's files stay exactly as they are. `assertOwnEvidencePath` only ever refuses a write.
 */
import { hostname } from "node:os";

/**
 * Hostname → workstation id.
 *
 * Source: `docs/handoff/w1-to-w2/README.md` (W1 `LAPTOP-6E14K34L`) and
 * `artifacts/environment/ENV-0002-workstation-omen-audit.md` (W2 `LAPTOP-SRCINK2B`). Adding a row
 * here is a provenance decision and belongs in the same commit as the evidence it will label.
 */
export const WORKSTATIONS = Object.freeze({
  "LAPTOP-6E14K34L": "W1",
  "LAPTOP-SRCINK2B": "W2",
});

/** `W` followed by digits. `w1`, `W-1` and `workstation1` are all refused. */
const ID_PATTERN = /^W[1-9][0-9]*$/;

const ENV_VAR = "PRATIBIMB_WORKSTATION";

export class WorkstationError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkstationError";
  }
}

/**
 * Who is running this? Returns `{ id, host, source }` or throws.
 *
 * `source` records how the answer was reached — `"registry"` or `"environment"` — so an evidence
 * file can say not just which machine it claims to be but how it knows.
 */
export function resolveWorkstation({ env = process.env, host = hostname() } = {}) {
  const known = WORKSTATIONS[host];
  const declared = (env[ENV_VAR] ?? "").trim();

  if (declared && !ID_PATTERN.test(declared)) {
    throw new WorkstationError(
      `${ENV_VAR}="${declared}" is not a workstation id. Expected W1, W2, W3 …`
    );
  }

  // A known machine and a contradicting environment is a conflict, never an override. Letting the
  // environment win here would reopen exactly the hole this module closes.
  if (known && declared && declared !== known) {
    throw new WorkstationError(
      `${ENV_VAR}="${declared}" contradicts this machine: ${host} is recorded as ${known}. ` +
        `Refusing to relabel it. Unset ${ENV_VAR}, or correct the registry in ` +
        `tests/browser/support/workstation.mjs if the machine genuinely changed identity.`
    );
  }

  if (known) return { id: known, host, source: "registry" };
  if (declared) return { id: declared, host, source: "environment" };

  throw new WorkstationError(
    `this machine (${host}) is not in the workstation registry, so evidence written here would ` +
      `carry no trustworthy provenance. Set ${ENV_VAR}=W<n> for a one-off run, or add the ` +
      `hostname to WORKSTATIONS in tests/browser/support/workstation.mjs. It is deliberate that ` +
      `there is no default.`
  );
}

/** `W1` → `w1`. The filename prefix every evidence file on that machine carries. */
export const filePrefix = (workstation) => workstation.id.toLowerCase();

/**
 * The evidence filename for this machine: `evidenceFileName(ws, "cft153-sih-rehearsal.json")`
 * gives `w1-cft153-sih-rehearsal.json` on W1 and `w2-…` on W2.
 *
 * The slug carries the browser cell and the experiment, exactly as the existing filenames do, so
 * W1 and W2 records sit side by side in the same directory instead of overwriting one another.
 */
export function evidenceFileName(workstation, slug) {
  if (typeof slug !== "string" || slug === "" || slug.includes("/") || slug.includes("\\")) {
    throw new WorkstationError(`evidence slug must be a bare filename, got ${JSON.stringify(slug)}`);
  }
  if (/^w[1-9][0-9]*-/i.test(slug)) {
    throw new WorkstationError(
      `evidence slug "${slug}" already carries a workstation prefix; pass the slug without one`
    );
  }
  return `${filePrefix(workstation)}-${slug}`;
}

/**
 * Refuse to write over another machine's evidence.
 *
 * The last line of defence, and the reason it exists: the prefix could still be got wrong by a
 * caller that builds a path by hand. A write whose basename claims a different workstation is a
 * mistake with no benign reading, so it throws rather than warns.
 */
export function assertOwnEvidencePath(path, workstation) {
  const base = String(path).split(/[\\/]/).pop() ?? "";
  const match = /^(w[1-9][0-9]*)-/i.exec(base);
  if (match && match[1].toLowerCase() !== filePrefix(workstation)) {
    throw new WorkstationError(
      `refusing to write ${base} from ${workstation.id} (${workstation.host}): that filename ` +
        `belongs to ${match[1].toUpperCase()}. Historical evidence from another workstation is ` +
        `never overwritten.`
    );
  }
  return path;
}

/** The provenance block an evidence record should embed. */
export const provenanceOf = (workstation) => ({
  workstation: workstation.id,
  host: workstation.host,
  workstationSource: workstation.source,
});
