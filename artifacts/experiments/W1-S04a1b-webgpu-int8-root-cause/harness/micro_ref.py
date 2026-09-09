"""
S-04a-1b -- CPU reference for the minimal int8 reproducers, from native onnxruntime 1.29.0,
the same version as ORT Web 1.29.0.

Unlike S-04a-1 these outputs are SMALL (at most 8x32), so the full tensor is recorded and the
browser comparison is EXACT, element by element -- no aggregate statistic, no tolerance to
argue about. That is deliberate: task section 12 forbids relaxing the criterion, and with
tensors this small there is no need to.

Throwaway spike code.
"""
import json
import os

import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
MICRO = os.path.join(HERE, "micro")
specs = json.load(open(os.path.join(HERE, "micro-specs.json"), encoding="utf8"))


def make(kind, shape):
    n = int(np.prod(shape))
    if kind == "u8":
        return np.array([(i * 11) % 256 for i in range(n)], dtype=np.uint8).reshape(shape)
    if kind == "i8":
        return np.array([((i * 7) % 251) - 125 for i in range(n)], dtype=np.int8).reshape(shape)
    return np.array([((i * 37) % 255) / 255 for i in range(n)], dtype=np.float32).reshape(shape)


out = {"reference_runtime": "onnxruntime " + ort.__version__, "graphs": {}}
for name, spec in specs.items():
    sess = ort.InferenceSession(os.path.join(MICRO, spec["file"]), providers=["CPUExecutionProvider"])
    feeds = {k: make(v["kind"], v["shape"]) for k, v in spec["inputs"].items()}
    res = sess.run(None, feeds)
    names = [o.name for o in sess.get_outputs()]
    rec = {"file": spec["file"], "inputs": spec["inputs"], "outputs": {}}
    for nm, arr in zip(names, res):
        a = np.asarray(arr)
        rec["outputs"][nm] = {
            "dtype": str(a.dtype),
            "shape": list(a.shape),
            # FULL tensor -- these are small enough for an exact comparison
            "values": a.ravel().tolist(),
        }
    out["graphs"][name] = rec
    shown = {nm: (str(np.asarray(v).dtype), list(np.asarray(v).shape)) for nm, v in zip(names, res)}
    print("%-24s -> %s" % (name, shown))

with open(os.path.join(HERE, "micro-reference.json"), "w", encoding="utf8") as f:
    json.dump(out, f)
print("\nwrote micro-reference.json (reference runtime: onnxruntime %s)" % ort.__version__)
