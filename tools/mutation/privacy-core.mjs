#!/usr/bin/env node
/**
 * Mutation check for the privacy foundation.
 *
 * Same shape as `permit-core.mjs`, for the same reason: a passing suite proves the tests run, not
 * that they would notice a guard being removed. Each mutation weakens exactly one enforcement in
 * source, runs the privacy suite, and restores the file. KILLED means the suite caught it. SURVIVED
 * is reported rather than hidden, and a survivor with a `layered` note is one where a second,
 * independent guard still refuses — which is a property worth knowing, not an excuse.
 *
 * Usage: node tools/mutation/privacy-core.mjs        (from the repository root)
 * Output: a table on stdout and a JSON record on the last line.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "packages/privacy/src";

/** @type {{ id: string, file: string, find: string, replace: string, what: string, layered?: string }[]} */
const MUTATIONS = [
  {
    id: "P01",
    file: "literalCheck.ts",
    find: "  if (held.held) {",
    replace: "  if (false) {",
    what: "the literal-echo check no longer compares a literal against the vault",
  },
  {
    id: "P02",
    file: "classes.ts",
    find: "export const mostProtective = (a: PiiClass, b: PiiClass): PiiClass => (RANK[b] > RANK[a] ? b : a);",
    replace: "export const mostProtective = (a: PiiClass, b: PiiClass): PiiClass => a;",
    what: "disagreement resolves to the first signal instead of the more protective class",
  },
  {
    id: "P03",
    file: "handoff.ts",
    find: '  if (typeof draft !== "object" || draft === null || !DRAFTS.has(draft)) {',
    replace: "  if (false) {",
    what: "the verifier accepts a handoff it did not assemble",
  },
  {
    id: "P04",
    file: "handoff.ts",
    find:
      "export const isVerifiedHandoff = (candidate: unknown): candidate is VerifiedHandoff =>\n" +
      '  typeof candidate === "object" && candidate !== null && VERIFIED.has(candidate);',
    replace:
      "export const isVerifiedHandoff = (candidate: unknown): candidate is VerifiedHandoff =>\n" +
      '  typeof candidate === "object" && candidate !== null;',
    what: "a forged `verified: true` object is accepted as verified",
  },
  {
    id: "P05",
    file: "handoff.ts",
    find:
      "  const leak = scanForVaultValues(serialized, context.vault);\n" +
      '  if (leak) return { verified: false, cause: "VAULT_VALUE_IN_HANDOFF", leakedClass: leak };',
    replace: "  const leak = null;",
    what: "the value-aware residual check is removed from verification",
  },
  {
    id: "P06",
    file: "vault.ts",
    find:
      '    if (TIER_OF[request.piiClass] === "CRITICAL") return { issued: false, cause: "CRITICAL_NOT_TOKENISED" };\n' +
      '    if (!isTokenisable(request.piiClass)) return { issued: false, cause: "UNKNOWN_CLASS" };',
    replace: "",
    what: "the vault issues a reference for any class, including OTP",
  },
  {
    id: "P07",
    file: "bind.ts",
    find: '  if (ctx.vault.sessionId !== ctx.sessionId) return refuse("SESSION_MISMATCH");',
    replace: "",
    what: "binding no longer checks that the vault belongs to this session",
  },
  {
    id: "P08",
    file: "bind.ts",
    find: '  if (field.origin !== descriptor.origin) return refuse("ORIGIN_MISMATCH");',
    replace: "",
    what: "binding no longer checks the origin of the field against the reference",
  },
  {
    id: "P09",
    file: "bind.ts",
    find: '  if (descriptor.consumed) return refuse("CONSUMED");',
    replace: "",
    what: "binding no longer refuses a spent reference",
    // This carried a `layered` note until the PRIV-0 security review, on the grounds that
    // `rehydrate` still refuses when the vault's own `consume()` returns false. That was the wrong
    // conclusion: `bind` is a question a caller may ask WITHOUT spending anything, so the vault's
    // guard cannot stand in for the binder's. Removing this line makes `bind` answer BIND_OK for a
    // spent reference, makes a spent SENSITIVE reference raise a human grant prompt it could never
    // honour, and lets a replay burn that grant. The note is gone and the mutation must be killed.
  },
  {
    id: "P10",
    file: "bind.ts",
    find: '  if (descriptor.tier === "SENSITIVE" && !findUseGrant(step.ref, field, ctx)) {',
    replace: "  if (false) {",
    what: "a SENSITIVE value no longer requires a per-use human grant",
  },
  {
    id: "P11",
    file: "sanitize.ts",
    find: "    const heldValue = vault.holdsLiteral(node.name);\n    if (heldValue.held) {",
    replace: "    const heldValue = { held: false, piiClass: 'UNKNOWN' };\n    if (false) {",
    what: "element names are no longer scrubbed when they contain a value",
    layered: undefined,
  },
  {
    id: "P12",
    file: "bind.ts",
    find: '  if (field.accepts !== descriptor.piiClass) return refuse("CLASS_MISMATCH");',
    replace: "",
    what: "a reference may be bound into a field of another class",
  },
];

const run = () => {
  try {
    execSync("npx vitest run packages/privacy", { stdio: "pipe" });
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
  console.log(
    `${r.id}  ${r.outcome.padEnd(22)} ${r.what}${r.layered && r.outcome === "SURVIVED" ? `  [layered: ${r.layered}]` : ""}`
  );
}
const killed = results.filter((r) => r.outcome === "KILLED").length;
const survivedLayered = results.filter((r) => r.outcome === "SURVIVED" && r.layered).length;
const survivedUnexpected = results.filter((r) => r.outcome === "SURVIVED" && !r.layered).length;
const notApplied = results.filter((r) => r.outcome.startsWith("NOT_APPLIED")).length;
console.log(JSON.stringify({ total: results.length, killed, survivedLayered, survivedUnexpected, notApplied }));
process.exit(survivedUnexpected > 0 || notApplied > 0 ? 1 : 0);
