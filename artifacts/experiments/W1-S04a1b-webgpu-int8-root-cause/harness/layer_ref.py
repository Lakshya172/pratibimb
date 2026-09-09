"""
S-04a-1b -- CPU reference for every instrumented checkpoint, from native onnxruntime 1.29.0.

Records per checkpoint the statistics the task asks for: shape, dtype, min, max, mean, sum,
sumAbs, and representative samples at fixed indices. These tensors are large (up to
1024 x 768), so full values are not stored; the sample indices are fixed so the browser can
report the same elements.

Throwaway spike code.
"""
import json
import os

import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, "sliced", "vision_encoder_int8_instrumented.onnx")
ck = json.load(open(os.path.join(HERE, "checkpoints.json"), encoding="utf8"))

PIX = [1, 1, 3, 512, 512]
MASK = [1, 1, 512, 512]


def det_f32(shape):
    n = int(np.prod(shape))
    return np.array([((i * 37) % 255) / 255 for i in range(n)], dtype=np.float32).reshape(shape)


sess = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
feeds = {"pixel_values": det_f32(PIX),
         "pixel_attention_mask": np.ones(MASK, dtype=bool)}
names = [o.name for o in sess.get_outputs()]
res = sess.run(None, feeds)

label_of = {c["tensor"]: c["label"] for c in ck["checkpoints"]}
out = {"reference_runtime": "onnxruntime " + ort.__version__,
       "input_shapes": {"pixel_values": PIX, "pixel_attention_mask": MASK},
       "checkpoints": {}}

for nm, arr in zip(names, res):
    a = np.asarray(arr)
    flat = a.astype(np.float64).ravel()
    n = flat.size
    idx = sorted(set([0, n // 7, n // 3, n // 2, (2 * n) // 3, n - 1])) if n else []
    out["checkpoints"][nm] = {
        "label": label_of.get(nm, "final" if nm == "image_features" else nm),
        "dtype": str(a.dtype),
        "shape": list(a.shape),
        "count": int(n),
        "min": float(flat.min()) if n else 0.0,
        "max": float(flat.max()) if n else 0.0,
        "mean": float(flat.mean()) if n else 0.0,
        "sum": float(flat.sum()) if n else 0.0,
        "sumAbs": float(np.abs(flat).sum()) if n else 0.0,
        "sampleIdx": idx,
        "sampleVals": [float(flat[i]) for i in idx],
    }

order = [c["label"] for c in ck["checkpoints"]] + ["final"]
by_label = {v["label"]: (k, v) for k, v in out["checkpoints"].items()}
print("%-20s %-22s %12s %12s %12s" % ("checkpoint", "shape", "min", "max", "sumAbs"))
for lb in order:
    if lb not in by_label:
        continue
    k, v = by_label[lb]
    print("%-20s %-22s %12.5g %12.5g %12.6g" % (lb, str(v["shape"]), v["min"], v["max"], v["sumAbs"]))

with open(os.path.join(HERE, "layer-reference.json"), "w", encoding="utf8") as f:
    json.dump(out, f)
print("\nwrote layer-reference.json (%d checkpoints)" % len(out["checkpoints"]))
