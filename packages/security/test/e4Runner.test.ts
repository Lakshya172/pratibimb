/**
 * E4 leak-instrument runner — regression guard for the defect introduced in c497aee.
 *
 * Harness: artifacts/experiments/E4-leak-instrument/harness/
 *
 * c497aee meant to hash the instrument's identity over LF-normalised text, but wrote literal line
 * breaks inside the helper's regular expression, so `run-e4.mjs` stopped parsing while the handoff
 * still listed it as runnable. These tests pin the repair. They do NOT run the experiment: running it
 * binds 127.0.0.1:8995 and rewrites the committed log, which is evidence and must not change.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HARNESS = join(REPO, "artifacts/experiments/E4-leak-instrument/harness");
const RUNNER = join(HARNESS, "run-e4.mjs");
const sha = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");

// Built from char codes so this file cannot suffer the same escape-sequence corruption it guards.
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

/** The runner's own `lf` helper, evaluated in isolation — importing the runner would start the run. */
function runnerLfHelper(readFile: (path: string, encoding: "utf8") => string): (path: string) => Buffer {
  const lines = readFileSync(RUNNER, "utf8")
    .split(LF)
    .map((l) => (l.endsWith(CR) ? l.slice(0, -1) : l));
  const helper = lines.filter((l) => l.startsWith("const lf = "));
  expect(helper).toHaveLength(1);
  return vm.runInNewContext(`${helper[0]}; lf`, { Buffer, readFileSync: readFile }) as (path: string) => Buffer;
}

describe("E4 runner — c497aee regression", () => {
  it("every E4 harness module parses", () => {
    const modules = readdirSync(HARNESS).filter((f) => f.endsWith(".mjs") || f.endsWith(".cjs"));
    expect(modules).toContain("run-e4.mjs");
    for (const m of modules) {
      const r = spawnSync(process.execPath, ["--check", join(HARNESS, m)], { encoding: "utf8" });
      expect(r.status, `${m} does not parse: ${r.stderr}`).toBe(0);
    }
  });

  it("the identity helper turns CRLF into LF and leaves LF-only text unchanged", () => {
    const mixed = `a${CR}${LF}b${LF}c${CR}${LF}`;
    expect(runnerLfHelper(() => mixed)("unused").toString("utf8")).toBe(`a${LF}b${LF}c${LF}`);
    const plain = `x${LF}y${LF}`;
    expect(runnerLfHelper(() => plain)("unused").toString("utf8")).toBe(plain);
  });

  it("applied to the committed instrument, the helper yields the recorded identities", () => {
    const lf = runnerLfHelper((p, enc) => readFileSync(p, enc));
    // e4-scanner-2 and the E4 collector, as recorded in E4-leak-instrument/decision.md and logs/e4.json.
    expect(sha(lf(join(HARNESS, "scanner.mjs")))).toBe("96979ebde6774f734fa14e4ae94dcabc33c962358874e850148cdccb0f0b6fab");
    expect(sha(lf(join(HARNESS, "collector.cjs")))).toBe("1ff60ed52539d6beb6c1f545aea15283a3cb8563eee4994b2b2b1adc4298ea77");
  });
});
