/**
 * The QG-03 reference, and the guard against the defect that already happened once.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG BEFORE, AND WHY A COMMENT WOULD NOT HAVE PREVENTED IT
 *
 * The first ONNX export verification reported `max |ORT - torch| = 40.4` and looked like a
 * broken artifact. It was not. `torch.onnx.export` restores the module's ORIGINAL training
 * mode when it returns, and the module handed to it was an `ExportWrapper` constructed one
 * line earlier — which defaults to `training=True`. That flag propagated back into the
 * wrapped model, so the reference ran with BatchNorm on batch statistics. In eval mode the
 * same artifact agreed to 5.6e-03.
 *
 * The artifact was right; the measurement was wrong. That is the worst shape a defect can
 * take, because it accuses the wrong component and the "fix" would have been to retrain a
 * model that had nothing wrong with it.
 *
 * A comment saying "remember to call eval()" would not have caught it — eval() WAS called.
 * Something set the flag back afterwards. So the guard is:
 *
 *   1. the reference generator READS every submodule's training flag, before and after
 *   2. it records that it did so, in a committed file
 *   3. this test fails if that code is removed, or if the record says otherwise
 *
 * The tests below deliberately assert on the SOURCE of the Python, not only on its output.
 * An output-only check passes forever against a stale committed file after the assertion
 * has been deleted.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEAD_CONTRACT, PROVISIONAL_THRESHOLDS, UI_CLASSES } from "@pratibimb/perception";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const REF_PATH = join(REPO, "artifacts/experiments/W1-QG03-t1-detector-runtime/reference-summary.json");
const GEN_PY = join(REPO, "tools/detector/qg03_reference.py");
const TRAIN_PY = join(REPO, "tools/detector/train.py");

describe("the eval-mode assertion cannot be silently removed", () => {
  it("the reference generator exists", () => {
    expect(existsSync(GEN_PY), `${GEN_PY} is the only thing standing between the browser matrix and a reference computed in training mode`).toBe(true);
  });

  it("it READS the training flag on every submodule rather than merely calling eval()", () => {
    const py = readFileSync(GEN_PY, "utf8");
    expect(py).toMatch(/def assert_eval_mode\(/);
    // named_modules() is the load-bearing part: the flag that matters lives on BatchNorm,
    // not on the root module, and a root-only check would have passed during the original
    // defect.
    expect(py, "the assertion must inspect submodules, not just the root module").toMatch(
      /named_modules\(\)[\s\S]{0,120}\.training/
    );
    expect(py).toMatch(/raise AssertionError/);
  });

  it("it asserts BOTH before and after the reference runs", () => {
    const py = readFileSync(GEN_PY, "utf8");
    expect(py).toMatch(/assert_eval_mode\(model, "before"\)/);
    expect(py).toMatch(/assert_eval_mode\(model, "after"\)/);
    expect(py).toMatch(/assert_eval_mode\(wrapper, "before"\)/);
    expect(py).toMatch(/assert_eval_mode\(wrapper, "after"\)/);
  });

  it("the trainer still re-establishes eval mode AFTER export, where the flag was restored", () => {
    const py = readFileSync(TRAIN_PY, "utf8");
    expect(py, "torch.onnx.export restores the module's prior training mode on return").toMatch(
      /torch\.onnx\.export/
    );
    const afterExport = py.slice(py.indexOf("torch.onnx.export"));
    expect(afterExport, "eval() must be re-applied after the export call").toMatch(/model\.eval\(\)/);
  });
});

describe("the committed reference describes a trustworthy measurement", () => {
  const ref = existsSync(REF_PATH) ? JSON.parse(readFileSync(REF_PATH, "utf8")) : null;

  it("the reference summary is committed", () => {
    expect(ref, `${REF_PATH} missing — run: python tools/detector/qg03_reference.py`).toBeTruthy();
  });

  it("it records that eval mode was asserted", () => {
    expect(ref.evalMode.asserted).toBe(true);
    expect(ref.evalMode.guardedBy).toContain("qg03Reference.test.ts");
  });

  it("the correctness criterion was pre-registered, not fitted to the result", () => {
    expect(ref.criterion.preRegistered).toBe(true);
    expect(ref.criterion.preRegisteredBefore).toMatch(/before any browser|any browser was launched/i);
    expect(typeof ref.criterion.classChannelsMaxAbs).toBe("number");
    expect(typeof ref.criterion.boxChannelsMaxAbs).toBe("number");
    expect(ref.criterion.determinism).toMatch(/bitwise/i);
  });

  it("the recorded torch-vs-ONNX agreement is inside that criterion", () => {
    for (const c of ref.cases) {
      expect(
        c.torchVsOnnxEvalMode.classChannelsMaxAbs,
        `case ${c.name}: the ONNX artifact disagrees with the torch model it came from`
      ).toBeLessThanOrEqual(ref.criterion.classChannelsMaxAbs);
      expect(c.torchVsOnnxEvalMode.boxChannelsMaxAbs).toBeLessThanOrEqual(ref.criterion.boxChannelsMaxAbs);
    }
  });

  it("the artifact the reference describes is the one the committed QG-05 evidence names", () => {
    const gate = JSON.parse(
      readFileSync(join(REPO, "artifacts/gates/T1-detector-training/qg05-detector-evaluation.json"), "utf8")
    );
    // artifacts/models/ is gitignored, so the gate JSON is the tracked authority on which
    // artifact the project has published evidence for. A reference generated against a
    // different .onnx would make every browser cell describe an unpublished model.
    expect(ref.artifact.sha256).toBe(gate.model.artifact.sha256);
    expect(ref.artifact.revision).toBe(gate.model.revision);
  });

  it("the ONNX schema matches the frozen tensor contract", () => {
    expect(ref.schema.inputShape).toEqual([1, 3, HEAD_CONTRACT.inputSize, HEAD_CONTRACT.inputSize]);
    expect(ref.schema.inputType).toBe("tensor(float)");
    expect(ref.schema.outputType).toBe("tensor(float)");
    // [1, 4+C, A] — the channel count is fixed by the contract; A is not.
    expect(ref.schema.outputShape[0]).toBe(1);
    expect(ref.schema.outputShape[1]).toBe(4 + UI_CLASSES.length);
    expect(ref.schema.inputCount).toBe(1);
    expect(ref.schema.outputCount).toBe(1);
  });

  it("the reference's postprocessing is the SHIPPED postprocessing, not a variant", () => {
    // The Python mirror is only evidence if it mirrors the real thresholds. If someone
    // changes PROVISIONAL_THRESHOLDS without regenerating the reference, every browser
    // box comparison would silently be against the old operating point.
    for (const c of ref.cases) {
      expect(c.shippedDecode.threshold).toBe(PROVISIONAL_THRESHOLDS.score);
      expect(c.shippedDecode.nmsIou).toBe(PROVISIONAL_THRESHOLDS.nmsIou);
      expect(c.shippedDecode.maxDetections).toBe(PROVISIONAL_THRESHOLDS.maxDetections);
    }
  });

  it("the preprocessing contract agrees with the shipped head contract", () => {
    expect(ref.contract.padValue).toBeCloseTo(HEAD_CONTRACT.padValue, 12);
    expect(ref.contract.layout).toBe(HEAD_CONTRACT.inputLayout);
    expect(ref.contract.channelOrder).toBe(HEAD_CONTRACT.channelOrder);
    expect(ref.contract.classes).toEqual([...UI_CLASSES]);
  });

  it("at least one case uses a real rendered frame and one uses no image at all", () => {
    // The synthetic case isolates the graph from image decoding; the real cases exercise
    // the pixels the model was actually trained on. Either alone would leave a gap.
    expect(ref.cases.some((c: { kind: string }) => /SYNTHETIC/.test(c.kind))).toBe(true);
    expect(ref.cases.some((c: { kind: string }) => /REAL/.test(c.kind))).toBe(true);
  });
});
