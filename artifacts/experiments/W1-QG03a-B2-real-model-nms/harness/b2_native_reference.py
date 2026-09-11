"""
QG-03a-B2 — native ONNX Runtime CPU reference for the same 20 PNG captures.

  python artifacts/experiments/W1-QG03a-B2-real-model-nms/harness/b2_native_reference.py

This is a third numerical point beside the browser WASM and WebGPU cells, with native code
and no browser. Before running, it verifies the model's identity (size and SHA-256) and each
PNG's committed digest. The input tensor comes from the Pillow reference path, whose bytes
W1-QG03a-A proved equal to the browser's. That equality is re-checked here through the
tensor digest the analysis compares.

As in W1-QG03a's reference script, a stub `head` module supplies the two constants
qg03b_fixtures.pil_stages reads, because head.py imports torch, which is not installed.

Raw outputs go to harness/generated/native-cpu/ (gitignored). The log records the digests.
"""
import hashlib
import json
import os
import sys
import time
import types

import numpy as np
import onnxruntime as ort
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
EXP = os.path.join(HERE, "..")
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "detector"))
_head = types.ModuleType("head")
_head.INPUT_SIZE = 640  # tools/detector/head.py:44
_head.PAD_VALUE = 114.0 / 255.0  # tools/detector/head.py:55
sys.modules["head"] = _head
import qg03b_fixtures as ref  # noqa: E402

MODEL = os.path.join(ROOT, "artifacts", "models", "t1-ui-head", "t1-ui-head.onnx")
MODEL_SHA = "ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0"
QG = os.path.join(ROOT, "artifacts", "experiments", "W1-QG03b2a-chromium-jpeg-capture")
OUT = os.path.join(HERE, "generated", "native-cpu")


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    blob = open(MODEL, "rb").read()
    if len(blob) != 302960 or sha(blob) != MODEL_SHA:
        print(f"MODEL IDENTITY MISMATCH: {len(blob)} bytes {sha(blob)} - refusing")
        sys.exit(2)
    fx = [f for f in json.load(open(os.path.join(QG, "fixtures.json"), encoding="utf-8"))["fixtures"] if f["encoding"] == "capture-png"]
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    opts.inter_op_num_threads = 1
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ort.InferenceSession(MODEL, opts, providers=["CPUExecutionProvider"])
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for f in fx:
        path = os.path.join(QG, "harness", "captured", f["file"])
        png = open(path, "rb").read()
        if sha(png) != f["encodedSha256"]:
            raise SystemExit(f"fixture {f['file']} hash mismatch")
        img = Image.open(path)
        img.load()
        s = ref.pil_stages(img)
        tensor = np.ascontiguousarray(s["tensor"].astype("<f4"))
        t0 = time.perf_counter()
        out = sess.run(None, {sess.get_inputs()[0].name: tensor})[0]
        ms = (time.perf_counter() - t0) * 1000
        o = np.ascontiguousarray(out.astype("<f4"))
        again = np.ascontiguousarray(sess.run(None, {sess.get_inputs()[0].name: tensor})[0].astype("<f4"))
        open(os.path.join(OUT, f"{f['source']}.f32"), "wb").write(o.tobytes())
        rows.append({
            "name": f["source"],
            "pngSha256": f["encodedSha256"],
            "tensorSha256": sha(tensor.tobytes()),
            "dims": list(o.shape),
            "outputBytes": o.nbytes,
            "outputSha256": sha(o.tobytes()),
            "deterministic": sha(again.tobytes()) == sha(o.tobytes()),
            "inferMs": [round(ms, 2)],
            "dumpVerified": True,
        })
        print(f"{f['source']:<28} tensor {rows[-1]['tensorSha256'][:12]} out {rows[-1]['outputSha256'][:12]} {ms:.1f} ms")
    log = {
        "experiment": "W1-QG03a-B2-real-model-nms",
        "cell": "native-cpu",
        "browser": "none",
        "backendRequested": "cpu",
        "backendObserved": "cpu",
        "backendLabelVerified": True,
        "userAgent": f"onnxruntime {ort.__version__} (python {sys.version.split()[0]}), CPUExecutionProvider, 1 thread",
        "ortVersion": ort.__version__,
        "model": {"path": "artifacts/models/t1-ui-head/t1-ui-head.onnx", "bytes": 302960, "sha256": MODEL_SHA},
        "fixtures": [{"name": f["source"], "file": f["file"], "sha256": f["encodedSha256"], "captureSize": f["captureSize"], "viewportCss": f["viewportCss"], "dpr": f["dpr"]} for f in fx],
        "rows": rows,
    }
    os.makedirs(os.path.join(EXP, "logs"), exist_ok=True)
    json.dump(log, open(os.path.join(EXP, "logs", "b2-native-cpu.json"), "w", encoding="utf-8"), indent=1)
    print(f"wrote logs/b2-native-cpu.json ({len(rows)} fixtures)")


if __name__ == "__main__":
    main()
