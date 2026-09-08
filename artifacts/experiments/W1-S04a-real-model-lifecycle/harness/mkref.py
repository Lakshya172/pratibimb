"""
S-04a CPU reference.

The canonical reference for an ONNX model is native ONNX Runtime on CPU. YuNet has twelve
outputs and 134,400 output floats, so embedding them verbatim in the probe is impractical
and float bit-equality across native-ORT and ORT-Web is not guaranteed anyway.

So the reference is a set of per-output STATISTICS (count, min, max, sum, and four sampled
values at fixed indices), compared in the browser with a relative tolerance. That is strong
enough to catch a wrong graph, a wrong backend, a transposed tensor or a silently truncated
output, which is what this experiment needs to detect.

Input is deterministic and synthetic: x[i] = ((i * 37) % 255) / 255.
"""
import json, hashlib
import numpy as np
import onnxruntime as ort

MODEL = "models/face_detection_yunet_2023mar.onnx"
N = 1 * 3 * 640 * 640
flat = (((np.arange(N, dtype=np.int64) * 37) % 255) / 255.0).astype(np.float32)
x = flat.reshape(1, 3, 640, 640)

sess = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
inp = sess.get_inputs()[0].name
outs = sess.run(None, {inp: x})
names = [o.name for o in sess.get_outputs()]

ref = {"model": MODEL,
       "model_sha256": hashlib.sha256(open(MODEL, "rb").read()).hexdigest(),
       "onnxruntime_python": ort.__version__,
       "input": {"shape": [1, 3, 640, 640], "formula": "((i*37)%255)/255"},
       "outputs": {}}
for n, a in zip(names, outs):
    a = np.asarray(a, dtype=np.float64).ravel()
    idx = [0, len(a) // 3, (2 * len(a)) // 3, len(a) - 1]
    ref["outputs"][n] = {
        "count": int(a.size),
        "min": float(a.min()), "max": float(a.max()), "sum": float(a.sum()),
        "sampleIdx": idx, "sampleVals": [float(a[i]) for i in idx],
    }
json.dump(ref, open("reference.json", "w"), indent=1)
print("reference written for", len(names), "outputs; total floats:", sum(v["count"] for v in ref["outputs"].values()))
print("ort python:", ort.__version__)
for n in list(ref["outputs"])[:3]:
    v = ref["outputs"][n]
    print(f"  {n:10} count={v['count']:6} min={v['min']:.6f} max={v['max']:.6f} sum={v['sum']:.4f}")
