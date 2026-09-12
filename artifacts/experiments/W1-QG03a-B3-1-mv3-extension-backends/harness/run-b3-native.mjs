/**
 * QG-03a-B3-1 native CPU reference, for THIS machine.
 *
 *   node artifacts/experiments/W1-QG03a-B3-1-mv3-extension-backends/harness/run-b3-native.mjs
 *
 * Runs B2's b2_native_reference.py, which refuses (exit 3) unless onnxruntime is exactly
 * 1.29.0, with B3-1's output paths, then verifies the log it produced. The log directory
 * follows the evidence class: logs/workstation-1/ on workstation 1, logs/development-<host>/
 * anywhere else. Set PYTHON to choose the interpreter.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPERIMENT, evidenceClassFor, machineInfo, selectPngFixtures, sha256Hex, verifyNativeLog } from "./b3-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const ROOT = join(HERE, "..", "..", "..", "..");
const ev = evidenceClassFor(os.hostname());
const LOG = join(EXP, "logs", ev.logDir, "b3-native-cpu.json");
const OUT = join(HERE, "generated", ev.logDir, "native-cpu");
const SCRIPT = join(ROOT, "artifacts/experiments/W1-QG03a-B2-real-model-nms/harness/b2_native_reference.py");

console.log(`evidence class: ${ev.evidenceClass} (host ${ev.hostname})`);
const r = spawnSync(process.env.PYTHON || "python", [SCRIPT, "--experiment", EXPERIMENT, "--cell", "native-cpu", "--out-dir", OUT, "--log", LOG], { stdio: "inherit" });
if (r.status !== 0) {
  console.error(`REFUSED: the native reference exited ${r.status}${r.status === 3 ? " (onnxruntime is not 1.29.0)" : ""}`);
  process.exit(r.status || 1);
}
const log = JSON.parse(readFileSync(LOG, "utf8"));
log.evidenceClass = ev.evidenceClass;
log.machine = machineInfo();
const fixtures = selectPngFixtures(JSON.parse(readFileSync(join(ROOT, "artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/fixtures.json"), "utf8")));
const guard = verifyNativeLog(log, fixtures);
for (const row of log.rows) {
  const p = join(OUT, `${row.name}.f32`);
  if (!existsSync(p) || sha256Hex(readFileSync(p)) !== row.outputSha256) guard.failures.push(`native ${row.name}: dump missing or digest mismatch`);
}
guard.ok = guard.failures.length === 0;
log.guard = guard;
writeFileSync(LOG, JSON.stringify(log, null, 1));
console.log(`native reference: ORT ${log.ortVersion}, ${log.rows.length} fixtures, guard ${guard.ok ? "OK" : "FAILED"}`);
for (const f of guard.failures) console.log(`  FAIL ${f}`);
process.exit(guard.ok ? 0 : 1);
