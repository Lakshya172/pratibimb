/**
 * E2 mutation check: does every rule in the classifier and binder actually carry weight in the table?
 *
 * Each mutation disables one rule, re-runs `run-e2.mjs`, and restores the file. KILLED means the
 * pre-registered table turned FAIL. A SURVIVED mutation means the table does not exercise that rule,
 * which is reported as a coverage gap rather than hidden.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "binder.mjs");

const MUTATIONS = [
  ["C1", 'if (signals.has("OTHER")) return "UNKNOWN";', "", "classifier ignores signals that name something else"],
  ["C2", 'if (signals.size > 1) return "UNKNOWN";', 'if (signals.size > 1) return [...signals][0];', "classifier picks the first of conflicting signals"],
  ["C3", 'if (cls === "NAME" && NAME_QUALIFIER.test(t)) {', "if (false) {", "classifier ignores qualified names (father's, company)"],
  ["C4", 'return f.tag === "textarea" ? "FREE_TEXT" : "UNKNOWN";', 'return "FREE_TEXT";', "classifier treats a no-signal input as free text"],
  ["T1", 'if (CRITICAL_CLASSES.has(cls) || !TIER[cls]) return {', "if (false) return {", "issuance tokenises CRITICAL and unknown classes"],
  ["B1", 'if (step.viewId !== ctx.view.viewId) return refuse("STALE_VIEW");', "", "binder ignores a stale view"],
  ["B2", 'if (ctx.currentDocumentId !== ctx.view.documentId) return refuse("STALE_BINDING");', "", "binder ignores reload / navigation"],
  ["B3", 'if (!field) return refuse("UNKNOWN_TARGET");', 'if (!field) return { decision: "BIND_OK" };', "binder accepts an unknown target"],
  ["B4", 'if (!token) return refuse("UNKNOWN_TOKEN");', 'if (!token) return { decision: "BIND_OK" };', "binder accepts an invented token"],
  ["B5", 'if (CRITICAL_CLASSES.has(token.class) || !TIER[token.class]) return needsUser("CRITICAL_NEVER_AGENT_TYPED");', "", "binder types a CRITICAL token"],
  ["B6", 'if (field.accepts === "OTP") return needsUser("CRITICAL_FIELD");', "", "binder types into an OTP field"],
  ["B7", 'if (field.accepts === "UNKNOWN") return needsUser("AMBIGUOUS_FIELD");', "", "binder guesses an ambiguous field"],
  ["B8", 'if (field.accepts !== token.class) return refuse("CLASS_MISMATCH");', "", "binder ignores class mismatch"],
  ["B9", 'if (field.origin !== token.origin) return refuse("ORIGIN_MISMATCH");', "", "binder ignores origin"],
  ["B10", 'if (ctx.consumed.has(`${step.ref}|${field.fingerprint}`)) return refuse("CONSUMED");', "", "binder allows reuse"],
  ["B11", 'if (!ctx.classOriginGrants.has(`${token.class}|${field.origin}`)) return needsUser("CLASS_ORIGIN_GRANT_REQUIRED");', "", "binder ignores the class×origin grant"],
  ["B12", 'if (token.tier === "SENSITIVE") {', "if (false) {", "binder skips the per-use human grant"],
  ["B13", "!g.used && ctx.now < g.expiresAt", "true", "binder accepts used or expired use-grants"],
  ["B14", "g.fingerprint === field.fingerprint && ", "", "binder accepts a use-grant made for another field"],
];

const runE2 = () => {
  try {
    execSync(`node "${join(HERE, "run-e2.mjs")}"`, { stdio: "pipe" });
    return "PASS";
  } catch {
    return "FAIL";
  }
};

if (runE2() !== "PASS") {
  console.error("REFUSING: the unmutated table does not pass.");
  process.exit(2);
}
const original = readFileSync(FILE, "utf8");
const logBackup = readFileSync(join(HERE, "..", "logs", "e2.json"), "utf8");
const rows = [];
try {
  for (const [id, find, replace, what] of MUTATIONS) {
    const n = original.split(find).length - 1;
    if (n !== 1) {
      rows.push({ id, what, outcome: `NOT_APPLIED (${n})` });
      continue;
    }
    writeFileSync(FILE, original.replace(find, replace));
    rows.push({ id, what, outcome: runE2() === "FAIL" ? "KILLED" : "SURVIVED" });
    writeFileSync(FILE, original);
  }
} finally {
  writeFileSync(FILE, original);
  writeFileSync(join(HERE, "..", "logs", "e2.json"), logBackup);
}
if (runE2() !== "PASS") {
  console.error("ERROR: the table does not pass after restoration.");
  process.exit(3);
}
writeFileSync(join(HERE, "..", "logs", "e2.json"), logBackup);
for (const r of rows) console.log(`${r.id.padEnd(4)} ${r.outcome.padEnd(16)} ${r.what}`);
const summary = {
  total: rows.length,
  killed: rows.filter((r) => r.outcome === "KILLED").length,
  survived: rows.filter((r) => r.outcome === "SURVIVED").map((r) => r.id),
  notApplied: rows.filter((r) => r.outcome.startsWith("NOT_APPLIED")).map((r) => r.id),
};
writeFileSync(join(HERE, "..", "logs", "e2-mutation.json"), JSON.stringify({ recordedAt: new Date().toISOString(), rows, summary }, null, 2) + "\n");
console.log(JSON.stringify(summary));
