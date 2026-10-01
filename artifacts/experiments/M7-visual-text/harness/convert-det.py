"""
M7.1 — reconstruct the ONNX form of the PINNED PP-OCRv5_mobile_det, and nothing else.

Owner decision (M7, option A): install Paddle conversion tooling on W1 as MEASUREMENT-ONLY
tooling, solely to re-derive the artifact W1-S04a-1 measured and re-run its frozen validation.

WHAT THIS REFUSES TO DO
- use any revision but 0d63e78e2b680928f6b1747d76a08db6e645efb7
- use a pre-converted ONNX from anywhere
- touch the recognition model
- convert with any call other than W1-S04a-1's own: `paddle2onnx.export(..., opset_version=16,
  enable_onnx_checker=True)` — copied from `W1-S04a1-four-model-residency/harness/fetch-models.py`

Source hashes are PINNED IN ADVANCE here (the pdiparams hash is also the LFS hash HuggingFace itself
declares for that revision), so a changed source refuses rather than converting silently.

Nothing produced here is committed: `*.onnx`, `*.pdiparams` and `models/` are git-ignored, per the
repository's no-vendored-weights rule. This script IS the reproducible acquisition path.

Run with the isolated measurement venv (Python 3.12, paddlepaddle 3.1.0, paddle2onnx 2.1.0) —
`paddle2onnx 2.1.0` publishes no cp313 wheel, which is why a 3.12 interpreter was needed.
"""
import hashlib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "models", "ppocrv5_mobile_det_src")
OUT = os.path.join(ROOT, "models", "ppocrv5_mobile_det.onnx")

REVISION = "0d63e78e2b680928f6b1747d76a08db6e645efb7"
PINNED_SOURCE = {
    # pdiparams: equals HuggingFace's X-Linked-ETag (LFS sha256) for the pinned revision.
    "inference.pdiparams": "afa1820cb16c1fd0dad589d0f8b389139061c1ef6d68019685fd07be997dda5b",
    "inference.json": "05feef1acb00aa4cd7362b15f7f501fc4f99d7b1fa73c1c871e0c7b1504b0f5c",
    "inference.yml": "98069072e1b6b37d727fd9d9f11725faa46d6ea0de012f2ed26caea011c37699",
}

# What W1-S04a-1 recorded for its converted artifact (model-provenance.json).
S04A1_RECORDED = {
    "bytes": 4819576,
    "sha256": "5f353dec11fcfc7c6dc35e066eff2a047b584d9d1ed61b3deb8c0d31e164705b",
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


for name, expected in PINNED_SOURCE.items():
    got = sha256(os.path.join(SRC, name))
    if got != expected:
        sys.exit(f"REFUSING: {name} is not the pinned source\n  expected {expected}\n  got      {got}")
print(f"source verified at revision {REVISION[:12]}")

import onnx  # noqa: E402
import paddle  # noqa: E402
import paddle2onnx  # noqa: E402

if os.path.exists(OUT):
    os.remove(OUT)  # never "cached": every run is a fresh conversion
t0 = time.perf_counter()
paddle2onnx.export(
    model_filename=os.path.join(SRC, "inference.json"),
    params_filename=os.path.join(SRC, "inference.pdiparams"),
    save_file=OUT,
    opset_version=16,
    enable_onnx_checker=True,
)
convert_ms = (time.perf_counter() - t0) * 1000
if not os.path.exists(OUT):
    sys.exit("paddle2onnx produced no file")

digest = sha256(OUT)
size = os.path.getsize(OUT)
model = onnx.load(OUT)
graph = model.graph
record = {
    "source_repo": "PaddlePaddle/PP-OCRv5_mobile_det",
    "revision": REVISION,
    "source_sha256": PINNED_SOURCE,
    "toolchain": {
        "python": sys.version.split()[0],
        "paddlepaddle": paddle.__version__,
        "paddle2onnx": paddle2onnx.__version__,
        "onnx": onnx.__version__,
    },
    "call": "paddle2onnx.export(model_filename=inference.json, params_filename=inference.pdiparams, "
    "save_file=..., opset_version=16, enable_onnx_checker=True)",
    "convert_ms": round(convert_ms, 1),
    "output": {"bytes": size, "sha256": digest},
    "s04a1_recorded": S04A1_RECORDED,
    "byte_identical_to_s04a1": digest == S04A1_RECORDED["sha256"],
    "size_identical_to_s04a1": size == S04A1_RECORDED["bytes"],
    "graph": {
        "opset": [{"domain": o.domain, "version": o.version} for o in model.opset_import],
        "producer": f"{model.producer_name} {model.producer_version}",
        "ir_version": model.ir_version,
        "nodes": len(graph.node),
        "initializers": len(graph.initializer),
        "inputs": [(i.name, [d.dim_param or d.dim_value for d in i.type.tensor_type.shape.dim]) for i in graph.input],
        "outputs": [(o.name, [d.dim_param or d.dim_value for d in o.type.tensor_type.shape.dim]) for o in graph.output],
    },
}
with open(os.path.join(ROOT, "logs", "m7.1-conversion.json"), "w", encoding="utf8") as f:
    json.dump(record, f, indent=2)
print(json.dumps(record, indent=2))
