/**
 * M8.2's real-frame baseline, resolved to the machine that is running — and to no other.
 *
 * WHY THIS EXISTS. M8.2's real-frame layer compared everything against M8.1's `tr-01-run1.json`,
 * which was measured on W1. On W2 that comparison fails for two INDEPENDENT reasons, both measured
 * (see `artifacts/experiments/M8.2-qg03-visual-text-feasibility/logs/baseline-divergence-w1-vs-w2.md`):
 *
 *   1. RASTERISATION. The same browser build, viewport and DPR render the same DOM to different
 *      glyph pixels on a different GPU, so the screenshots and the tensors derived from them differ.
 *   2. CPU FLOATING-POINT KERNELS. onnxruntime 1.29.0 handed the BYTE-IDENTICAL synthetic tensor and
 *      the BYTE-IDENTICAL model produces a different output on W1 and W2 — `min` and `max` agree
 *      exactly, the summations diverge at ~1e-7, and each machine is deterministic. No screenshot is
 *      involved, so rasterisation cannot explain it. It is kernel dispatch on CPU ISA.
 *
 * So M8.2's native reference is MACHINE-LOCAL BY CONSTRUCTION. Byte-identical cross-machine native
 * output is not assumed, and this module is where that stops being an unwritten assumption.
 *
 * WHAT IT DOES NOT DO. It does not relax a single comparison. Within a workstation every assertion
 * stays exact — byte equality for tensors, deep equality for boxes and scores. What changes is only
 * WHICH record is authoritative:
 *
 *   W1       -> M8.1's historical `results/<cid>-run1.json`. Read-only. Never rewritten, never
 *               re-derived, and never consulted as authority for another machine.
 *   W2, W3.. -> `logs/<ws>-baseline-<cid>.json`, established by
 *               `browser/prepare-fixtures.mjs --establish-baseline` and completed by
 *               `tests/browser/extension/run-tr01-worker.mjs --establish-baseline`.
 *   unknown  -> REFUSES. A machine with no baseline does not borrow one. Silently selecting another
 *               machine's baseline is the failure mode this module exists to make impossible, and it
 *               would be indistinguishable from a pass.
 *
 * The git-ignored fixtures are workstation-scoped for the same reason: a tree carrying one machine's
 * screenshots cannot be read as another's.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { filePrefix, resolveWorkstation } from "./workstation.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const M81 = join(ROOT, "artifacts", "experiments", "M8.1-visual-text-screening");
const M82 = join(ROOT, "artifacts", "experiments", "M8.2-qg03-visual-text-feasibility");

/** The seven frozen frames: the development screen and the six held-out pages. */
export const FIXTURE_NAMES = Object.freeze(["dev", "H1", "H2", "H3", "H4", "H5", "H6"]);

/** The screening candidates M8 pinned. TR-01 is adopted for V1; TR-02 is the rollback candidate. */
export const CANDIDATES = Object.freeze(["TR-01", "TR-02"]);

export class BaselineError extends Error {
  constructor(message) {
    super(message);
    this.name = "BaselineError";
  }
}

/**
 * The workstation whose baseline and fixtures apply here.
 *
 * `resolveWorkstation()` already refuses an unknown host and refuses a host that disagrees with
 * `PRATIBIMB_WORKSTATION`; this is a thin pass-through so callers have one import.
 */
export const baselineWorkstation = (options) => resolveWorkstation(options);

/**
 * Where THIS machine's git-ignored fixtures live.
 *
 * Workstation-scoped: `models/fixtures/W2/screenshots/H1.png` can only ever be W2's H1. Fixtures are
 * never committed (`.gitignore` excludes `models/`) and never transferred between machines, so the
 * only way one machine's fixtures reach another is a deliberate copy — which this layout makes
 * visible and which the baseline comparison would reject anyway.
 */
export function fixturesDir(workstation = resolveWorkstation()) {
  return join(M82, "models", "fixtures", workstation.id);
}

/** The integrity record this machine writes. W1's historical `fixture-integrity.json` is NOT this path. */
export function integrityRecordPath(workstation = resolveWorkstation()) {
  return join(M82, "logs", `${filePrefix(workstation)}-fixture-integrity.json`);
}

const candidateSlug = (cid) => {
  if (!CANDIDATES.includes(cid)) throw new BaselineError(`unknown candidate ${JSON.stringify(cid)}; expected one of ${CANDIDATES.join(", ")}`);
  return cid.toLowerCase();
};

/**
 * The file that is authoritative for this candidate on this machine.
 *
 * W1's is M8.1's own run record, in its original location. Nothing here ever writes to it.
 */
export function baselinePath(cid, workstation = resolveWorkstation()) {
  const slug = candidateSlug(cid);
  return workstation.id === "W1"
    ? join(M81, "results", `${slug}-run1.json`)
    : join(M82, "logs", `${filePrefix(workstation)}-baseline-${slug}.json`);
}

/** Is a baseline available for this candidate on this machine? Never answers for another machine. */
export function hasBaseline(cid, workstation = resolveWorkstation()) {
  return existsSync(baselinePath(cid, workstation));
}

/**
 * Load the baseline, normalised to the shape the golden layer and the harnesses already compare
 * against: `inputs[name].{ input, inputSha256, boxes }` and `heldOut.perImage`.
 *
 * W1's record is returned as it is — it already has that shape, and re-deriving it would mean this
 * module, not M8.1, decided what W1 measured.
 *
 * `requireBoxes` (default true) says which part of the baseline the caller actually compares:
 *
 *   true  — the caller compares BOXES, so the WASM stage must be complete. A baseline still carrying
 *           native-derived boxes is REFUSED, never used: the harnesses compare WASM detections with
 *           their scores, and a native box set would fail for a reason unrelated to the code under
 *           test. A half-established baseline must not be mistaken for a comparable one.
 *   false — the caller compares only the input tensor and the native output, which is all
 *           `prepare-fixtures.mjs` measures. Passing `false` narrows WHAT is verified to what was
 *           actually measured; it does not relax how exactly it is compared.
 *
 * This distinction is load-bearing for TR-02: it is the rollback candidate, no product harness runs
 * it through ORT WASM, and its W1 WASM reference came from M8.2's own browser cells. So TR-02 has a
 * native stage on W2 and no WASM stage, and that is reported rather than papered over.
 */
export function loadBaseline(cid, workstation = resolveWorkstation(), { requireBoxes = true } = {}) {
  const path = baselinePath(cid, workstation);
  if (!existsSync(path)) {
    throw new BaselineError(
      `no M8.2 baseline for ${cid} on ${workstation.id} (${workstation.host}).\n` +
        `  expected: ${path}\n` +
        "  This machine does NOT fall back to another workstation's baseline: M8.2's native reference is\n" +
        "  machine-local (CPU kernel dispatch), so another machine's record cannot verify this one.\n" +
        "  Establish it:\n" +
        "    1. CHROME_PATH=<cft> REF_PYTHON=<measurement venv python> \\\n" +
        "         node artifacts/experiments/M8.2-qg03-visual-text-feasibility/browser/prepare-fixtures.mjs --establish-baseline\n" +
        "    2. TR01_PROBE=1 npm run build -w @pratibimb/extension\n" +
        "    3. CHROME_PATH=<cft> node tests/browser/extension/run-tr01-worker.mjs --establish-baseline"
    );
  }
  const record = JSON.parse(readFileSync(path, "utf8"));
  if (requireBoxes && workstation.id !== "W1" && record.establishment?.wasmStageComplete !== true) {
    throw new BaselineError(
      `the ${workstation.id} baseline for ${cid} at ${path} is INCOMPLETE: its boxes are native-derived and the\n` +
        "  WASM stage has not run, so its boxes are not the quantity you are comparing.\n" +
        (cid === "TR-02"
          ? "  TR-02 is the rollback candidate: no product harness runs it through ORT WASM, and its W1 WASM\n" +
            "  reference came from M8.2's own browser cells. Establishing a TR-02 WASM stage means re-running\n" +
            "  those cells on this machine. It is refused rather than approximated.\n"
          : "  Complete it with `run-tr01-worker.mjs --establish-baseline`.\n") +
        "  It is refused rather than used, because a native-derived box set compared against WASM\n" +
        "  detections would fail for a reason that has nothing to do with the code under test."
    );
  }
  for (const name of FIXTURE_NAMES) {
    const entry = record.inputs?.[name];
    const usable = entry && typeof entry.inputSha256 === "string" && entry.input && (!requireBoxes || Array.isArray(entry.boxes));
    if (!usable) throw new BaselineError(`the baseline at ${path} has no usable entry for ${name}`);
  }
  return record;
}

/**
 * The two hashes the integrity check compares, read through the shape difference between records.
 *
 * M8.1's W1 record nests the native output under `native.outputSha256`; a baseline established here
 * stores it flat as `nativeOutputSha256`. Both are the same measurement, and neither is recomputed —
 * these accessors only read. A record that carries neither throws, rather than comparing `undefined`
 * with `undefined` and reporting agreement.
 */
export function inputShaOf(baseline, name) {
  const sha = baseline.inputs?.[name]?.inputSha256;
  if (typeof sha !== "string") throw new BaselineError(`baseline has no input sha256 for ${name}`);
  return sha;
}

export function nativeOutputShaOf(baseline, name) {
  const entry = baseline.inputs?.[name];
  const sha = entry?.native?.outputSha256 ?? entry?.nativeOutputSha256;
  if (typeof sha !== "string") throw new BaselineError(`baseline has no native output sha256 for ${name}`);
  return sha;
}

/**
 * The frames whose fixtures are present for this machine, as `[name, { png, native, input }]` paths.
 * Absence is reported, never filled in from somewhere else.
 */
export function fixturePaths(cid, workstation = resolveWorkstation()) {
  const dir = fixturesDir(workstation);
  return FIXTURE_NAMES.map((name) => [
    name,
    {
      png: join(dir, "screenshots", `${name}.png`),
      native: join(dir, cid, `native-${name}.f32`),
      input: join(dir, cid, `input-${name}.f32`),
    },
  ]);
}

/** True only if every frame's screenshot and native map exist for this machine and candidate. */
export function haveFixtures(cid, workstation = resolveWorkstation()) {
  return fixturePaths(cid, workstation).every(([, p]) => existsSync(p.png) && existsSync(p.native));
}
