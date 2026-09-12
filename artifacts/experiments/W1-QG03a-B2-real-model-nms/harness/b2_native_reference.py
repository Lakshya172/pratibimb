"""
QG-03a-B2 — native ONNX Runtime CPU reference for the same 20 PNG captures.
Also QG-03a-B3-1's native reference (through B3-1's run-b3-native.mjs).

  python artifacts/experiments/W1-QG03a-B2-real-model-nms/harness/b2_native_reference.py
  python .../b2_native_reference.py --experiment <name> --cell native-cpu --out-dir <dir> --log <file>

This is a third numerical point beside the browser WASM and WebGPU cells, with native code
and no browser. Before running, it verifies the model's identity (size and SHA-256) and each
PNG's committed digest. The input tensor comes from the Pillow reference path, whose bytes
W1-QG03a-A proved equal to the browser's. That equality is re-checked here through the
tensor digest the analysis compares.

ORT VERSION GUARD. The reference is only comparable to the browser cells at the version they
run: onnxruntime 1.29.0, the ORT Web pin. The check runs before anything else is imported;
any other version exits 3 and writes nothing. (QG-03b-2a's reference was Python ORT 1.20.1,
which is one reason its workstation-1 detector numbers cannot close QG-03a-B.) The output is
also refused (exit 4) unless it is [1, 12, 6400] and entirely finite.

With no arguments every path is B2's, so B2's workflow is unchanged.

As in W1-QG03a's reference script, a stub `head` module supplies the two constants
qg03b_fixtures.pil_stages reads, because head.py imports torch, which is not installed.

Raw outputs go to harness/generated/native-cpu/ (gitignored). The log records the digests.
"""
import sys

import onnxruntime as ort

REQUIRED_ORT_VERSION = "1.29.0"


def require_ort_version(found):
    if found != REQUIRED_ORT_VERSION:
        sys.stderr.write(
            f"ORT VERSION MISMATCH: onnxruntime {found} is installed; this reference requires "
            f"{REQUIRED_ORT_VERSION}. Refusing; nothing was written.\n"
        )
        sys.exit(3)


require_ort_version(ort.__version__)

import argparse  # noqa: E402
import hashlib  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import platform  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

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
OUTPUT_SHAPE = [1, 12, 6400]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def parse_args(argv):
    p = argparse.ArgumentParser(description="native ONNX Runtime CPU reference (QG-03a-B2 / B3-1)")
    p.add_argument("--experiment", default="W1-QG03a-B2-real-model-nms")
    p.add_argument("--cell", default="native-cpu")
    p.add_argument("--out-dir", default=os.path.join(HERE, "generated", "native-cpu"))
    p.add_argument("--log", default=os.path.join(EXP, "logs", "b2-native-cpu.json"))
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
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
    os.makedirs(args.out_dir, exist_ok=True)
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
        if list(o.shape) != OUTPUT_SHAPE or not bool(np.isfinite(o).all()):
            sys.stderr.write(f"OUTPUT REFUSED for {f['source']}: shape {list(o.shape)}, finite {bool(np.isfinite(o).all())}\n")
            sys.exit(4)
        again = np.ascontiguousarray(sess.run(None, {sess.get_inputs()[0].name: tensor})[0].astype("<f4"))
        open(os.path.join(args.out_dir, f"{f['source']}.f32"), "wb").write(o.tobytes())
        rows.append({
            "name": f["source"],
            "pngSha256": f["encodedSha256"],
            "tensorSha256": sha(tensor.tobytes()),
            "dims": list(o.shape),
            "outputBytes": o.nbytes,
            "outputSha256": sha(o.tobytes()),
            "deterministic": sha(again.tobytes()) == sha(o.tobytes()),
            "finite": True,
            "inferMs": [round(ms, 2)],
            "dumpVerified": True,
        })
        print(f"{f['source']:<28} tensor {rows[-1]['tensorSha256'][:12]} out {rows[-1]['outputSha256'][:12]} {ms:.1f} ms")
    log = {
        "experiment": args.experiment,
        "cell": args.cell,
        "browser": "none",
        "backendRequested": "cpu",
        "backendObserved": "cpu",
        "backendLabelVerified": True,
        "userAgent": f"onnxruntime {ort.__version__} (python {sys.version.split()[0]}), CPUExecutionProvider, 1 thread",
        "ortVersion": ort.__version__,
        "ortVersionRequired": REQUIRED_ORT_VERSION,
        "hostname": platform.node(),
        "model": {"path": "artifacts/models/t1-ui-head/t1-ui-head.onnx", "bytes": 302960, "sha256": MODEL_SHA},
        "fixtures": [{"name": f["source"], "file": f["file"], "sha256": f["encodedSha256"], "captureSize": f["captureSize"], "viewportCss": f["viewportCss"], "dpr": f["dpr"]} for f in fx],
        "rows": rows,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.log)), exist_ok=True)
    json.dump(log, open(args.log, "w", encoding="utf-8"), indent=1)
    print(f"wrote {args.log} ({len(rows)} fixtures)")


if __name__ == "__main__":
    main()
