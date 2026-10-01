/**
 * M8.2 — THE QG-03 FEASIBILITY RULES, fixed before any cell runs.
 *
 * `artifacts/experiments/M8.2-qg03-visual-text-feasibility/protocol.md` states the rules in prose.
 * This module is the one executable reading of them, so every candidate and every cell is judged
 * by the same code:
 *
 *   summarise          median / p90 / min / max / n, nearest-rank
 *   modeVerdict /      a display mode ACCEPTs on LOAD k/k and CORRECT in every launch; a cell
 *   cellVerdict        ACCEPTs when both modes do, is CONDITIONAL when one does, else REJECT;
 *                      BLOCKED when it could not be run at all
 *   teardownPass       every cycle succeeds, outputs byte-identical, zero Memory.grow after
 *                      cycle 1, and (where measured) a fresh context reproduces the output
 *   coexistencePass    every session creates, every output equals its solo hash, recreation works
 *   slowModeLabels     descriptive only: a launch median more than 2x the lowest launch median
 *   qg03Verdict        PASS / FAIL / BLOCKED from the gate's own checklist
 *
 * Numbers and booleans only. No model, no browser, no pixels, no text.
 */

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarise(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  return { n: v.length, median: percentile(v, 50), p90: percentile(v, 90), min: v[0] ?? null, max: v.at(-1) ?? null };
}

export const CELL = Object.freeze({ accept: "ACCEPT", conditional: "CONDITIONAL", reject: "REJECT", blocked: "BLOCKED — NOT VERIFIED" });

/**
 * One display mode. `launches`: [{ loaded: bool, correct: bool }]. Expected count is the
 * protocol's (3); fewer reports than expected is a failure, never a smaller denominator.
 */
export function modeVerdict(launches, expected = 3) {
  const loaded = launches.filter((l) => l.loaded === true).length;
  const correct = launches.filter((l) => l.loaded === true && l.correct === true).length;
  const accept = launches.length === expected && loaded === expected && correct === expected;
  return { loaded: `${loaded}/${expected}`, correct: `${correct}/${expected}`, verdict: accept ? CELL.accept : CELL.reject };
}

/** A cell from its two modes. `null` for a mode means it could not be run. */
export function cellVerdict(headful, headless) {
  if (headful === null && headless === null) return CELL.blocked;
  const a = headful?.verdict === CELL.accept;
  const b = headless?.verdict === CELL.accept;
  if (headful === null || headless === null) return a || b ? CELL.conditional : CELL.reject;
  if (a && b) return CELL.accept;
  if (a || b) return CELL.conditional;
  return CELL.reject;
}

/**
 * The established teardown meaning (S-04 / S-04a / S-04a-1): linear memory cannot shrink, so the
 * test is a plateau plus exact outputs, and a fresh context where one is measured.
 * `cycles`: [{ ok, outputSha256, grows }] in order. `context`: null or { ok, freshHeap, outputSha256 }.
 */
export function teardownPass(cycles, context = null) {
  const reasons = [];
  if (cycles.length < 2) reasons.push("fewer than two cycles");
  if (!cycles.every((c) => c.ok === true)) reasons.push("a cycle failed");
  const first = cycles[0]?.outputSha256;
  if (!first || !cycles.every((c) => c.outputSha256 === first)) reasons.push("outputs differ between cycles");
  const laterGrows = cycles.slice(1).reduce((n, c) => n + (Number.isInteger(c.grows) ? c.grows : Infinity), 0);
  if (laterGrows !== 0) reasons.push(`memory grew after cycle 1 (${laterGrows})`);
  if (context !== null) {
    if (context.ok !== true) reasons.push("the recreated context failed");
    else {
      if (context.freshHeap !== true) reasons.push("the recreated context did not start from an empty heap");
      if (context.outputSha256 !== first) reasons.push("the recreated context's output differs");
    }
  }
  return { pass: reasons.length === 0, reasons };
}

/**
 * `solo`: { model: sha }. `rounds`: [{ model: sha }] from the coexistence phase and the post-recreate
 * round. `created`: { model: bool } for both creation passes.
 */
export function coexistencePass({ solo, rounds, created, errors = [] }) {
  const reasons = [];
  const models = Object.keys(solo ?? {});
  if (models.length < 3) reasons.push("fewer than three models ran solo");
  for (const [m, ok] of Object.entries(created ?? {})) if (ok !== true) reasons.push(`${m} failed to create`);
  if (!rounds || rounds.length === 0) reasons.push("no coexistence rounds");
  for (const [i, r] of (rounds ?? []).entries()) {
    for (const m of models) if (r[m] !== solo[m]) reasons.push(`round ${i + 1}: ${m} output differs from solo`);
  }
  if (errors.length) reasons.push(`${errors.length} error(s)`);
  return { pass: reasons.length === 0, reasons };
}

/** Descriptive only. Returns, per launch median, whether it is > 2x the lowest launch median. */
export function slowModeLabels(launchMedians) {
  const finite = launchMedians.filter((m) => Number.isFinite(m));
  if (finite.length === 0) return { floor: null, labels: launchMedians.map(() => null), slow: 0 };
  const floor = Math.min(...finite);
  const labels = launchMedians.map((m) => (Number.isFinite(m) ? m > 2 * floor : null));
  return { floor, labels, slow: labels.filter((x) => x === true).length };
}

export const QG03 = Object.freeze({ pass: "PASS", fail: "FAIL", blocked: "BLOCKED" });

/**
 * The gate's checklist (agentos/gates/README.md), items 1-7; item 8 (ADR) is not triggered by a
 * feasibility study and is reported as such by the caller.
 *
 * `cells` maps the four required cell names to a CELL value. A required cell that is BLOCKED makes
 * the candidate BLOCKED unless something else has already FAILED — a measured failure is not
 * hidden behind a missing measurement.
 */
export const REQUIRED_CELLS = Object.freeze(["Chrome WebGPU", "Chrome WASM", "Firefox WebGPU", "Firefox WASM (Linux)"]);
export const WASM_COLUMNS = Object.freeze(["Chrome WASM", "Firefox WASM (Linux)"]);

export function qg03Verdict({ pinned, licence, cells, coexistence, teardown, benchmarkArtifact }) {
  const blocked = REQUIRED_CELLS.filter((c) => !cells?.[c] || cells[c] === CELL.blocked);
  const filled = REQUIRED_CELLS.every((c) => cells?.[c] && cells[c] !== CELL.blocked);
  const checklist = {
    "1 revision pinned in the registry": pinned === true,
    "2 licence read at the pinned revision": licence === true,
    "3 all four cells filled": filled,
    "4 each cell records all four values": filled,
    "5 the WASM columns pass": WASM_COLUMNS.every((c) => cells?.[c] === CELL.accept),
    "6a coexistence verified": coexistence === true,
    "6b teardown reclaims memory": teardown === true,
    "7 benchmark artifact under artifacts/benchmarks/": benchmarkArtifact === true,
  };
  const failedMeasured = [];
  for (const c of WASM_COLUMNS) if (cells?.[c] && cells[c] !== CELL.blocked && cells[c] !== CELL.accept) failedMeasured.push(`${c} is ${cells[c]}`);
  if (coexistence === false) failedMeasured.push("coexistence failed");
  if (teardown === false) failedMeasured.push("teardown failed");
  if (pinned === false) failedMeasured.push("revision not pinned");
  if (licence === false) failedMeasured.push("licence not verified");
  let verdict = QG03.pass;
  if (failedMeasured.length) verdict = QG03.fail;
  else if (!Object.values(checklist).every(Boolean)) verdict = QG03.blocked;
  return { verdict, checklist, blockedCells: blocked, failures: failedMeasured };
}
