"""
QG-03 step 1 - artifact identity, and the trusted reference the browsers are judged against.

  python tools/detector/qg03_reference.py

Nothing in the browser matrix means anything without this file. A browser cell can only
report "correct" relative to something already known to be correct, and the thing it is
compared against has to be produced under conditions that are stated rather than assumed.

--------------------------------------------------------------------------------------
THE FAILURE THIS FILE EXISTS TO PREVENT

The first ONNX export verification in this project reported `max |ORT - torch| = 40.4` and
looked like a broken artifact. It was not. `torch.onnx.export` restores the module's
ORIGINAL training mode when it returns, and the module it had been handed was an
`ExportWrapper` constructed one line earlier - which defaults to `training=True`. That flag
propagated back into the wrapped model, so the "reference" was computed with BatchNorm
running on batch statistics. In eval mode the same artifact matched to 5.6e-03.

The artifact was right the whole time and the measurement was wrong. That is the worst
shape a defect can take, because it accuses the wrong component.

So eval mode is not assumed here, and not established by convention. It is:

  * asserted on the model AND on every submodule, immediately before the reference runs
  * asserted AGAIN after the reference runs, in case something toggled it mid-flight
  * recorded in the emitted summary as `evalMode.asserted`
  * guarded by a committed test, so deleting the assertion fails CI

`packages/perception/test/qg03Reference.test.ts` is the guard. If you remove the assertion
below, that test fails.

--------------------------------------------------------------------------------------
THE CORRECTNESS CRITERION IS PRE-REGISTERED

The tolerances below were fixed BEFORE any browser was launched, and are derived from the
model's own arithmetic rather than from whatever the first run happened to produce:

  class channels   1e-4 absolute.  These are sigmoid outputs in 0..1. fp32 convolution
                   accumulation differences between SIMD kernels land around 1e-6, so this
                   is ~100x the expected noise and still 3 orders below any threshold the
                   detector uses.

  box channels     0.25 model px.  w = exp(clamp(tw, max=6)) * 8, so exp AMPLIFIES logit
                   error proportionally: a 1e-5 error in tw becomes a 1e-5 RELATIVE error
                   in w, which at w~440 is 4.4e-3 absolute. The torch-vs-ORT export
                   measurement recorded 5.6e-3 max on exactly this channel. 0.25 model px
                   is ~45x that, and roughly a third of a CSS pixel after unletterboxing a
                   960-wide capture.

  determinism      BITWISE identical across repeated runs in one session. Not a tolerance.
                   A detector whose output moves between identical calls cannot be
                   regression-tested at all, and the change gate downstream would fire on
                   noise.

If a cell exceeds these, the honest response is to report the cell as failing and find out
why - not to widen the band until it passes.
"""

import argparse
import hashlib
import json
import os
import sys

import numpy as np
import torch
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from data import letterbox_image  # noqa: E402
from head import CLASSES, INPUT_SIZE, NUM_CLASSES, STRIDE, ExportWrapper, UiHead  # noqa: E402
from targets import letterbox_params  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
MODEL_DIR = os.path.join(ROOT, "artifacts", "models", "t1-ui-head")
DATA_DIR = os.path.join(ROOT, "artifacts", "datasets", "t1-ui-v1")
EXP = os.path.join(ROOT, "artifacts", "experiments", "W1-QG03-t1-detector-runtime")
GEN = os.path.join(EXP, "harness", "generated")

# ---- the pre-registered correctness criterion -----------------------------------------
TOL_CLASS_ABS = 1e-4
TOL_BOX_ABS = 0.25

# ---- the shipped decode's thresholds, mirrored from uiDetectorHead.ts ------------------
# Duplicated deliberately rather than imported: importing across the boundary is what
# packages/perception/test/trainingBoundary.test.ts forbids, and a Python re-implementation
# that AGREES with the TypeScript is itself evidence. If the two ever diverge, the browser
# comparison catches it, which a shared constant could not.
SHIPPED_SCORE_THRESHOLD = 0.25
SHIPPED_NMS_IOU = 0.5
SHIPPED_MAX_DETECTIONS = 300


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def assert_eval_mode(module, when):
    """
    The regression assertion. Checks the module AND every submodule.

    `module.eval()` sets `training=False` recursively, but the defect this guards against
    did not come from forgetting to call eval() - it came from something else setting the
    flag back afterwards. So the flag is READ, not set, and read on every submodule,
    because BatchNorm is what the flag actually changes.
    """
    offenders = [name or "<root>" for name, m in module.named_modules() if m.training]
    if offenders:
        raise AssertionError(
            "QG-03 reference refused: module is in TRAINING mode {} the reference run "
            "({} submodules: {}). BatchNorm would use batch statistics and the reference "
            "would be wrong while looking authoritative - this is the exact defect that "
            "produced the bogus 40.4 export discrepancy.".format(when, len(offenders), offenders[:6])
        )


def synth_input():
    """
    A deterministic input that needs no image and no file.

    Integer arithmetic divided by 255, so Python float64 -> float32 and JavaScript double
    -> Float32Array produce IDENTICAL bits. Anything involving a resize, a decode or a
    trig function would not.
    """
    n = 3 * INPUT_SIZE * INPUT_SIZE
    i = np.arange(n, dtype=np.int64)
    return (((i * 37) % 255) / 255.0).astype(np.float32).reshape(1, 3, INPUT_SIZE, INPUT_SIZE)


def real_input(sample):
    """A real rendered frame, letterboxed by the SAME code path training used."""
    img = Image.open(os.path.join(DATA_DIR, sample["framePath"]))
    canvas = letterbox_image(img)
    u8 = np.asarray(canvas, dtype=np.uint8)  # HWC RGB
    x = (u8.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
    return np.ascontiguousarray(x), u8


def iou_xywh_corner(a, b):
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[0] + a[2], b[0] + b[2])
    y2 = min(a[1] + a[3], b[1] + b[3])
    if x2 <= x1 or y2 <= y1:
        return 0.0
    inter = (x2 - x1) * (y2 - y1)
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)


def shipped_decode(out):
    """
    A line-for-line mirror of decodeHeadOutput + nms in uiDetectorHead.ts.

    Every tie-break is reproduced, including the ones that look incidental:

      * best class uses STRICTLY greater, starting from 0, so the LOWEST class index wins a
        tie - and ties are not hypothetical when two logits saturate.
      * NMS sorts by score descending, ties broken by ORIGINAL INDEX ascending.
      * the max-detections break happens AFTER the push and BEFORE that item suppresses
        anything, so the 300th kept box suppresses nothing.

    If any of these were "cleaned up" here, a browser cell could report a mismatch that was
    really a difference between this file and the shipped code.
    """
    _, channels, anchors = out.shape
    assert channels == 4 + NUM_CLASSES
    flat = out.reshape(channels, anchors)

    items = []
    for a in range(anchors):
        best = -1
        best_score = 0.0
        for c in range(NUM_CLASSES):
            s = float(flat[4 + c, a])
            if s > best_score:
                best_score = s
                best = c
        if best < 0 or best_score < SHIPPED_SCORE_THRESHOLD:
            continue
        cx, cy, w, h = (float(flat[k, a]) for k in range(4))
        if not all(np.isfinite(v) for v in (cx, cy, w, h, best_score)):
            raise AssertionError("non-finite value at anchor {}".format(a))
        if w <= 0 or h <= 0:
            continue
        if best_score > 1:
            raise AssertionError("score above 1 at anchor {}".format(a))
        items.append({"box": [cx - w / 2, cy - h / 2, w, h], "label": CLASSES[best], "score": best_score})

    order = sorted(range(len(items)), key=lambda i: (-items[i]["score"], i))
    suppressed = set()
    kept = []
    for i in order:
        if i in suppressed:
            continue
        kept.append(items[i])
        if len(kept) >= SHIPPED_MAX_DETECTIONS:
            break
        for j in order:
            if j == i or j in suppressed:
                continue
            if items[j]["label"] != items[i]["label"]:
                continue
            if iou_xywh_corner(items[i]["box"], items[j]["box"]) > SHIPPED_NMS_IOU:
                suppressed.add(j)
    return kept


def project_to_capture(decoded, scale, pad_x, pad_y, content_w, content_h):
    """clipToContent then modelToCapture, mirroring projectToCapture in uiDetectorHead.ts."""
    out = []
    for d in decoded:
        x, y, w, h = d["box"]
        x1 = max(x, pad_x)
        y1 = max(y, pad_y)
        x2 = min(x + w, pad_x + content_w)
        y2 = min(y + h, pad_y + content_h)
        if x2 <= x1 or y2 <= y1:
            continue  # entirely inside the letterbox padding - describes nothing real
        out.append(
            {
                "box": [(x1 - pad_x) / scale, (y1 - pad_y) / scale, (x2 - x1) / scale, (y2 - y1) / scale],
                "label": d["label"],
                "score": d["score"],
            }
        )
    return out


def tensor_stats(a):
    f = a.reshape(-1).astype(np.float64)
    return {
        "count": int(f.size),
        "min": float(f.min()),
        "max": float(f.max()),
        "sum": float(f.sum()),
        "sumAbs": float(np.abs(f).sum()),
        "finite": bool(np.isfinite(f).all()),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", default="dev-0000,dev-0003", help="dataset sample ids for the real-frame cases")
    args = ap.parse_args()

    os.makedirs(GEN, exist_ok=True)

    # ---- 1. artifact identity ---------------------------------------------------------
    card_path = os.path.join(MODEL_DIR, "model-card.json")
    onnx_path = os.path.join(MODEL_DIR, "t1-ui-head.onnx")
    pt_path = os.path.join(MODEL_DIR, "t1-ui-head.pt")
    for p in (card_path, onnx_path, pt_path):
        if not os.path.exists(p):
            print("missing: {}\nRun: python tools/detector/train.py".format(p), file=sys.stderr)
            sys.exit(1)

    card = json.load(open(card_path, "r", encoding="utf-8"))
    onnx_sha = sha256_file(onnx_path)
    onnx_bytes = os.path.getsize(onnx_path)

    print("artifact identity")
    print("  file        {}".format(os.path.relpath(onnx_path, ROOT)))
    print("  bytes       {}".format(onnx_bytes))
    print("  sha256      {}".format(onnx_sha))
    print("  card sha256 {}".format(card["artifact"]["sha256"]))

    if onnx_sha != card["artifact"]["sha256"] or onnx_bytes != card["artifact"]["bytes"]:
        print(
            "\nREFUSED: the local .onnx is not the artifact the model card describes.\n"
            "Benchmarking a different file than the one the evidence names is how a matrix\n"
            "becomes fiction. Re-run training, or restore the artifact.",
            file=sys.stderr,
        )
        sys.exit(1)

    # The gate JSON is TRACKED IN GIT; the model card is not (artifacts/models/ is ignored).
    # So the tracked file is the authority on which revision the project has published
    # evidence for, and the untracked card must agree with it.
    gate_path = os.path.join(ROOT, "artifacts", "gates", "T1-detector-training", "qg05-detector-evaluation.json")
    gate = json.load(open(gate_path, "r", encoding="utf-8"))
    if gate["model"]["artifact"]["sha256"] != onnx_sha:
        print(
            "\nREFUSED: the local artifact does not match the COMMITTED QG-05 evidence.\n"
            "  committed: {}\n  local:     {}".format(gate["model"]["artifact"]["sha256"], onnx_sha),
            file=sys.stderr,
        )
        sys.exit(1)
    if gate["model"]["revision"] != card["revision"]:
        print("\nREFUSED: revision mismatch between the model card and committed evidence.", file=sys.stderr)
        sys.exit(1)
    print("  revision    {}  (agrees with committed QG-05 evidence)".format(card["revision"]))

    # ---- 2. rebuild the model, and PROVE it is in eval mode ---------------------------
    model = UiHead()
    state = torch.load(pt_path, map_location="cpu", weights_only=True)
    model.load_state_dict(state["model"] if "model" in state else state)
    model.eval()
    wrapper = ExportWrapper(model)
    wrapper.eval()
    assert_eval_mode(model, "before")
    assert_eval_mode(wrapper, "before")
    torch.use_deterministic_algorithms(True, warn_only=True)

    # ---- 3. ONNX session, and its declared schema ------------------------------------
    import onnxruntime as ortpy

    so = ortpy.SessionOptions()
    so.graph_optimization_level = ortpy.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ortpy.InferenceSession(onnx_path, so, providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    outp = sess.get_outputs()[0]
    schema = {
        "inputName": inp.name,
        "inputShape": list(inp.shape),
        "inputType": inp.type,
        "outputName": outp.name,
        "outputShape": list(outp.shape),
        "outputType": outp.type,
        "inputCount": len(sess.get_inputs()),
        "outputCount": len(sess.get_outputs()),
    }
    print("\nonnx schema")
    for k, v in schema.items():
        print("  {:<12} {}".format(k, v))

    manifest = json.load(open(os.path.join(DATA_DIR, "manifest.json"), "r", encoding="utf-8"))
    by_id = {s["id"]: s for s in manifest["samples"]}

    cases = []

    def run_case(name, x, extra):
        with torch.no_grad():
            t = wrapper(torch.from_numpy(x)).numpy()
        o = sess.run(None, {inp.name: x})[0]

        # torch-vs-ONNX, in eval mode, recorded per channel group rather than as one number:
        # box and class channels have different scales and mixing them hides the box error.
        d = np.abs(t.astype(np.float64) - o.astype(np.float64))
        box_diff = float(d[:, :4, :].max())
        cls_diff = float(d[:, 4:, :].max())

        scale, pad_x, pad_y = letterbox_params(extra["capture"]["w"], extra["capture"]["h"])
        content_w = extra["capture"]["w"] * scale
        content_h = extra["capture"]["h"] * scale
        decoded = shipped_decode(o)
        capture_boxes = project_to_capture(decoded, scale, pad_x, pad_y, content_w, content_h)
        css_to_cap = extra["capture"]["w"] / extra["viewportCss"]["w"]
        css_boxes = [
            {
                "box": [round(v / css_to_cap, 6) for v in b["box"]],
                "label": b["label"],
                "score": round(b["score"], 9),
            }
            for b in capture_boxes
        ]

        in_bytes = x.astype("<f4").tobytes()
        out_bytes = o.astype("<f4").tobytes()
        with open(os.path.join(GEN, "input-{}.f32".format(name)), "wb") as f:
            f.write(in_bytes)
        with open(os.path.join(GEN, "expected-{}.f32".format(name)), "wb") as f:
            f.write(out_bytes)

        case = {
            "name": name,
            "inputSha256": sha256_bytes(in_bytes),
            "inputStats": tensor_stats(x),
            "outputShape": list(o.shape),
            "outputSha256": sha256_bytes(out_bytes),
            "outputStats": tensor_stats(o),
            "torchVsOnnxEvalMode": {"boxChannelsMaxAbs": box_diff, "classChannelsMaxAbs": cls_diff},
            "geometry": {
                "capture": extra["capture"],
                "viewportCss": extra["viewportCss"],
                "letterbox": {"scale": scale, "padX": pad_x, "padY": pad_y,
                              "contentW": content_w, "contentH": content_h},
                "cssToCapture": css_to_cap,
            },
            "shippedDecode": {
                "threshold": SHIPPED_SCORE_THRESHOLD,
                "nmsIou": SHIPPED_NMS_IOU,
                "maxDetections": SHIPPED_MAX_DETECTIONS,
                "detectionCount": len(css_boxes),
                "cssBoxes": css_boxes,
            },
        }
        case.update(extra.get("meta", {}))
        cases.append(case)
        print(
            "  {:<12} torch-vs-onnx box {:.3e}  cls {:.3e}   detections {}".format(
                name, box_diff, cls_diff, len(css_boxes)
            )
        )
        return case

    print("\nreference cases (torch eval mode vs onnxruntime CPU)")

    # Case 1: no image at all. Isolates the graph from every decoding and resampling
    # difference a browser could introduce.
    run_case(
        "synth",
        synth_input(),
        {
            "capture": {"w": 960, "h": 640},
            "viewportCss": {"w": 960, "h": 640},
            "meta": {"kind": "SYNTHETIC — deterministic formula, no image decode, no resize"},
        },
    )

    # Case 2+: real rendered frames, letterboxed by the training code path. The uint8
    # letterboxed image is written out so a browser can normalise the SAME pixels rather
    # than resample the PNG itself - that keeps ORT numerics separate from canvas
    # resampling, which is measured on its own further down the harness.
    for sid in [s.strip() for s in args.samples.split(",") if s.strip()]:
        if sid not in by_id:
            print("unknown sample id: {}".format(sid), file=sys.stderr)
            sys.exit(1)
        s = by_id[sid]
        x, u8 = real_input(s)
        with open(os.path.join(GEN, "letterboxed-{}.u8".format(sid)), "wb") as f:
            f.write(u8.tobytes())
        png = os.path.join(DATA_DIR, s["framePath"])
        with open(os.path.join(GEN, "frame-{}.png".format(sid)), "wb") as f:
            f.write(open(png, "rb").read())
        run_case(
            sid,
            x,
            {
                "capture": s["captureSize"],
                "viewportCss": s["viewportCss"],
                "meta": {
                    "kind": "REAL rendered frame, letterboxed by tools/detector/data.py",
                    "sampleId": sid,
                    "split": s["split"],
                    "framePath": s["framePath"],
                    "framePngSha256": sha256_file(png),
                    "annotations": len(s["annotations"]),
                },
            },
        )

    # ---- 4. eval mode again, AFTER everything ran -------------------------------------
    assert_eval_mode(model, "after")
    assert_eval_mode(wrapper, "after")

    summary = {
        "gate": "QG-03 — trusted reference for the T1 detector browser/backend matrix",
        "generatedAt": __import__("datetime").datetime.now().astimezone().isoformat(),
        "warning": (
            "This is a CPU reference produced by onnxruntime-python on one machine. It is "
            "the thing browsers are compared AGAINST; it is not itself browser evidence, "
            "and it says nothing about accuracy on real screens."
        ),
        "artifact": {
            "path": "artifacts/models/t1-ui-head/t1-ui-head.onnx",
            "bytes": onnx_bytes,
            "sha256": onnx_sha,
            "modelId": card["modelId"],
            "revision": card["revision"],
            "tracked": False,
            "trackedEvidence": "artifacts/gates/T1-detector-training/qg05-detector-evaluation.json",
        },
        "schema": schema,
        "contract": {
            "input": card["tensorContract"]["input"],
            "layout": card["tensorContract"]["layout"],
            "channelOrder": card["tensorContract"]["channelOrder"],
            "normalization": card["tensorContract"]["normalization"],
            "padValue": card["tensorContract"]["padValue"],
            "output": card["tensorContract"]["output"],
            "preprocessingVersion": card["preprocessing"],
            "postprocessingVersion": card["postprocessing"],
            "classes": CLASSES,
            "stride": STRIDE,
        },
        "evalMode": {
            "asserted": True,
            "how": (
                "every named_module()'s .training flag READ (not set) immediately before and "
                "immediately after the reference run; a single True aborts the run"
            ),
            "why": (
                "torch.onnx.export restores the module's original training mode on return. "
                "An ExportWrapper constructed fresh defaults to training=True, which "
                "propagates into the wrapped model and puts BatchNorm on batch statistics. "
                "That produced a bogus 40.4 'export discrepancy' against a correct artifact."
            ),
            "guardedBy": "packages/perception/test/qg03Reference.test.ts",
        },
        "criterion": {
            "preRegistered": True,
            "preRegisteredBefore": "any browser was launched for this gate",
            "classChannelsMaxAbs": TOL_CLASS_ABS,
            "boxChannelsMaxAbs": TOL_BOX_ABS,
            "boxUnits": "model pixels",
            "determinism": "BITWISE identical across repeated runs within one session",
            "shapeMatch": "exact",
            "rationale": (
                "class channels are sigmoid outputs and fp32 SIMD accumulation noise is ~1e-6, "
                "so 1e-4 is ~100x noise; box channels pass through exp(), which turns a 1e-5 "
                "logit error into a 1e-5 relative error (4.4e-3 absolute at w~440), and the "
                "measured torch-vs-ORT figure on that channel was 5.6e-3, so 0.25 model px is "
                "~45x that and about a third of a CSS pixel after unletterboxing."
            ),
        },
        "cases": cases,
    }

    out_path = os.path.join(EXP, "reference-summary.json")
    os.makedirs(EXP, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print("\nwrote {}".format(os.path.relpath(out_path, ROOT)))
    print("wrote binaries to {} (generated, not committed)".format(os.path.relpath(GEN, ROOT)))

    worst_box = max(c["torchVsOnnxEvalMode"]["boxChannelsMaxAbs"] for c in cases)
    worst_cls = max(c["torchVsOnnxEvalMode"]["classChannelsMaxAbs"] for c in cases)
    print("\ntorch(eval) vs onnxruntime-python: box {:.3e} model px, class {:.3e}".format(worst_box, worst_cls))
    if worst_cls > TOL_CLASS_ABS or worst_box > TOL_BOX_ABS:
        print(
            "REFUSED: the ONNX artifact does not agree with the torch model it came from, "
            "in eval mode. The browsers cannot be judged against a reference that is itself "
            "in doubt.",
            file=sys.stderr,
        )
        sys.exit(1)
    print("reference ACCEPTED as trustworthy.")


if __name__ == "__main__":
    main()
