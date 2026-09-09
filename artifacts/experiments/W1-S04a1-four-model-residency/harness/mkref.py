"""
S-04a-1 correctness reference.

The canonical reference for an ONNX model is native ONNX Runtime on CPU. This runs the four
models with fixed, deterministic inputs through onnxruntime 1.29.0 -- deliberately the same
version as ORT Web 1.29.0, so a comparison isolates the web runtime rather than a version
delta -- and records per output: count, min, max, sum and four values at fixed indices.

Deterministic input formula, identical to S-04a: x[i] = ((i * 37) % 255) / 255

Throwaway spike code.
"""
import json
import os

import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, "models")

# Fixed shapes chosen for the dynamic-axis models. Recorded here because the shape is part
# of the measurement: a different shape is a different working set.
SPEC = {
    "face": {
        "file": "yunet.onnx",
        "feeds": {"input": ("float32", [1, 3, 640, 640])},
    },
    "ocr_det": {
        "file": "ppocrv5_mobile_det.onnx",
        # DBNet-style detector. 640x640 matches the YuNet frame size.
        "feeds": {"x": ("float32", [1, 3, 640, 640])},
    },
    "ocr_rec": {
        "file": "ppocrv5_mobile_rec.onnx",
        # PP-OCRv5 recognition operates on 48px-high text crops.
        "feeds": {"x": ("float32", [1, 3, 48, 320])},
    },
    "vlm_vision": {
        "file": "smolvlm_vision_encoder_int8.onnx",
        "feeds": {
            "pixel_values": ("float32", [1, 1, 3, 512, 512]),
            # all-ones BOOL mask: every pixel attended, so the NonZero-driven output shape is
            # stable. The model rejects int64 here -- it wants tensor(bool).
            "pixel_attention_mask": ("ones_bool", [1, 1, 512, 512]),
        },
    },
}


def make(kind, shape):
    n = int(np.prod(shape))
    if kind == "ones_bool":
        return np.ones(n, dtype=bool).reshape(shape)
    a = np.array([((i * 37) % 255) / 255 for i in range(n)], dtype=np.float32)
    return a.reshape(shape)


out = {"reference_runtime": "onnxruntime " + ort.__version__, "models": {}}

for name, spec in SPEC.items():
    path = os.path.join(MODELS, spec["file"])
    sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    feeds = {k: make(kind, shape) for k, (kind, shape) in spec["feeds"].items()}
    res = sess.run(None, feeds)
    names = [o.name for o in sess.get_outputs()]

    rec = {"file": spec["file"],
           "input_shapes": {k: v[1] for k, v in spec["feeds"].items()},
           "input_kinds": {k: v[0] for k, v in spec["feeds"].items()},
           "outputs": {}}
    for nm, arr in zip(names, res):
        a = np.asarray(arr).astype(np.float64).ravel()
        idx = [0, len(a) // 3, (2 * len(a)) // 3, len(a) - 1] if len(a) else []
        rec["outputs"][nm] = {
            "count": int(a.size),
            "shape": list(np.asarray(arr).shape),
            "min": float(a.min()) if a.size else 0.0,
            "max": float(a.max()) if a.size else 0.0,
            "sum": float(a.sum()) if a.size else 0.0,
            # sumAbs is the PASS/FAIL statistic. Raw `sum` is recorded but not used as a
            # criterion: for vlm_vision it is 0.03% of n*scale, i.e. almost total
            # cancellation, so it is dominated by cancellation rather than by error.
            # sumAbs cannot cancel, so per-element error accumulates into it instead.
            "sumAbs": float(np.abs(a).sum()) if a.size else 0.0,
            "sumSq": float((a * a).sum()) if a.size else 0.0,
            "sampleIdx": idx,
            "sampleVals": [float(a[i]) for i in idx],
        }
    out["models"][name] = rec
    tot = sum(v["count"] for v in rec["outputs"].values())
    print("%-11s %-34s outputs=%d floats=%d" % (name, spec["file"], len(names), tot))

with open(os.path.join(HERE, "reference.json"), "w", encoding="utf8") as f:
    json.dump(out, f, indent=1)
print("\nwrote reference.json  (reference runtime: onnxruntime %s)" % ort.__version__)
