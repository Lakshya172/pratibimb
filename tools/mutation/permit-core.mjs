#!/usr/bin/env node
/**
 * Mutation check for the execution-gate permit core (ADR-0008).
 *
 * Each mutation weakens exactly one enforcement in source, runs the agent test suite, and restores
 * the file. A mutation is KILLED when the suite fails. A SURVIVED mutation is reported, never
 * hidden — some are expected to survive because a second, independent layer still refuses, and
 * those are marked `layered: true` with the reason.
 *
 * Usage: node tools/mutation/permit-core.mjs            (from the repository root)
 * Output: a table on stdout and a JSON record on the last line.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "packages/agent/src";

/** @type {{ id: string, file: string, find: string, replace: string, what: string, layered?: string }[]} */
const MUTATIONS = [
  { id: "M01", file: "permit.ts", find: "if (consumed.has(p)) {", replace: "if (false) {", what: "redeem ignores prior consumption (replay)" },
  { id: "M02", file: "permit.ts", find: "  consumed.add(p);\n  const t = now();", replace: "  const t = now();", what: "redeem never consumes (not single-use)" },
  { id: "M03", file: "permit.ts", find: "if (!Number.isFinite(t) || t >= p.expiresAt) {", replace: "if (false) {", what: "redeem ignores expiry" },
  { id: "M04", file: "permit.ts", find: "if (bridgeFrameId !== p.frameId) {", replace: "if (false) {", what: "redeem ignores the bridge frame" },
  {
    id: "M05",
    file: "permit.ts",
    find: "export const isIssuedPermit = (p: unknown): p is DispatchPermit => typeof p === \"object\" && p !== null && issued.has(p);",
    replace: "export const isIssuedPermit = (p: unknown): p is DispatchPermit => typeof p === \"object\" && p !== null;",
    what: "any object is an issued permit (registry check removed)",
  },
  { id: "M08", file: "permit.ts", find: 'if (!hit || !bearsHitAgreement(hit) || hit.agreement !== "MATCH") {', replace: "if (!hit) {", what: "mint accepts an unattested or non-MATCH hit" },
  { id: "M09", file: "permit.ts", find: "if (!hitAgreementIsFor(hit, decision)) {", replace: "if (false) {", what: "mint accepts a MATCH established for another decision" },
  { id: "M10", file: "permit.ts", find: 'if (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0) {', replace: "if (false) {", what: "mint accepts a missing or invalid lifetime" },
  { id: "M11", file: "permit.ts", find: 'if (confirmationTierOf(node) === "CONFIRM_REQUIRED") {', replace: "if (false) {", what: "gate ignores the confirmation tier" },
  {
    id: "M12",
    file: "permit.ts",
    find: "  const pre = authorisationPreflight(decision);\n  if (pre) return refuse(pre);",
    replace: "  const pre = null;",
    what: "mint skips all static authorisation (validation, kind, tier)",
  },
  { id: "M13", file: "hitTest.ts", find: "  ESTABLISHED_FOR.set(result, decision);\n", replace: "", what: "hit results are no longer bound to their decision" },
  {
    id: "M14",
    file: "act.ts",
    find: "  if (!redemption.redeemed) return redemption.refusal;\n  const p = redemption.permit;",
    replace: "  const p = permit;",
    what: "ACT dispatches without honouring redemption",
  },
  {
    id: "M15",
    file: "guardedAct.ts",
    find: "  if (!planIsUsable(options?.verify)) {",
    replace: "  if (false) {",
    what: "guardedAct no longer requires a postcondition",
  },
  {
    id: "M17",
    file: "permit.ts",
    find: "if (!point || !finite(point.x, point.y) || point.x !== hit.point.x || point.y !== hit.point.y) {",
    replace: "if (!point || !finite(point.x, point.y)) {",
    what: "mint no longer compares the agreed point with the dispatch point",
    layered: "unreachable while hits are bound to their decision (M13): the hit test derives its point from that same decision",
  },
  {
    id: "M18",
    file: "permit.ts",
    find: "if (hit.observed.frameId !== frameId) {",
    replace: "if (false) {",
    what: "mint no longer compares the observed frame",
    layered: "the hit test already refuses a topmost element reported from another frame (UNKNOWN), so no MATCH can carry one",
  },
  {
    id: "M16",
    file: "guardedAct.ts",
    find: "  if (!agreesForDispatch(hit)) {",
    replace: "  if (false) {",
    what: "guardedAct proceeds past a non-MATCH hit test",
  },
];

const run = () => {
  try {
    execSync("npx vitest run packages/agent", { stdio: "pipe" });
    return "PASS";
  } catch {
    return "FAIL";
  }
};

const results = [];
if (run() !== "PASS") {
  console.error("REFUSING: the unmutated suite does not pass, so no mutation result would mean anything.");
  process.exit(2);
}
for (const m of MUTATIONS) {
  const path = `${SRC}/${m.file}`;
  const original = readFileSync(path, "utf8");
  const normalised = original.replace(/\r\n/g, "\n");
  const count = normalised.split(m.find).length - 1;
  if (count !== 1) {
    results.push({ ...m, outcome: `NOT_APPLIED (${count} matches)` });
    continue;
  }
  const mutated = normalised.replace(m.find, m.replace);
  try {
    writeFileSync(path, original.includes("\r\n") ? mutated.replace(/\n/g, "\r\n") : mutated);
    const suite = run();
    results.push({ ...m, outcome: suite === "FAIL" ? "KILLED" : "SURVIVED" });
  } finally {
    writeFileSync(path, original);
  }
}

if (run() !== "PASS") {
  console.error("ERROR: the suite does not pass after restoring every file. Inspect the working tree.");
  process.exit(3);
}

for (const r of results) {
  console.log(`${r.id}  ${r.outcome.padEnd(22)} ${r.what}${r.layered && r.outcome === "SURVIVED" ? `  [layered: ${r.layered}]` : ""}`);
}
const killed = results.filter((r) => r.outcome === "KILLED").length;
const survivedLayered = results.filter((r) => r.outcome === "SURVIVED" && r.layered).length;
const survivedUnexpected = results.filter((r) => r.outcome === "SURVIVED" && !r.layered).length;
const notApplied = results.filter((r) => r.outcome.startsWith("NOT_APPLIED")).length;
console.log(JSON.stringify({ total: results.length, killed, survivedLayered, survivedUnexpected, notApplied }));
process.exit(survivedUnexpected > 0 || notApplied > 0 ? 1 : 0);
