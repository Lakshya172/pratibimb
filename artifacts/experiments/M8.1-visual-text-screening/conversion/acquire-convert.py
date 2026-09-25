"""
M8.1 — acquire the PINNED source of one screening candidate, verify it, and convert it to ONNX twice.

Owner decisions (2026-09-25, Ronit Saha): D1 approves TR-01 PP-OCRv4_mobile_det and TR-02
PP-OCRv3_mobile_det for screening; D2 approves the existing isolated measurement-only Paddle venv
(CPython 3.12.14, paddlepaddle 3.1.0, paddle2onnx 2.1.0, onnxruntime 1.29.0) for acquisition,
conversion and validation only.

WHAT THIS REFUSES TO DO
- use any repository or revision but the ones M8 pinned (candidate-matrix.md, TR-01 / TR-02)
- accept a file whose hash differs from the hash recorded BEFORE the download: the git blob SHA-1
  HuggingFace lists for every file at that revision, and the LFS sha256 for the weights
- touch a recognition model — any repository name containing "_rec" is refused outright
- use a pre-converted ONNX from anywhere
- convert with any call but M7.1's, which is W1-S04a-1's: paddle2onnx.export(opset_version=16,
  enable_onnx_checker=True)

Reproducibility: the conversion runs TWICE, each in a fresh interpreter, into two files. The record
says whether they are byte-identical. If they are not, the candidate is BLOCKED / NOT EVALUABLE.

Nothing produced here is committed: models/ is git-ignored (no vendored weights). The console
output of paddle2onnx is kept in the log with this machine's paths replaced by placeholders.

Usage (measurement venv python):  python acquire-convert.py TR-01|TR-02
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
EXP = os.path.dirname(HERE)
MODELS = os.path.join(EXP, "models")
LOGS = os.path.join(EXP, "logs")

# Pinned in M8 (candidate-matrix.md) and re-read from the HF API at the revision before this was
# written. blob = git blob SHA-1 of the file at the revision; lfs = the LFS object's sha256.
CANDIDATES = {
    "TR-01": {
        "repo": "PaddlePaddle/PP-OCRv4_mobile_det",
        "revision": "3cc09f3a5b424e8e010abc7a4271aea12999c2f7",
        "stem": "tr01_ppocrv4_mobile_det",
        "files": {
            "README.md": {"bytes": 12441, "blob": "9b1435280d01c2cbd03822888296ca2994be03b7"},
            "config.json": {"bytes": 2871, "blob": "536c77b962c533d4cab24799ac4199909bf492ea"},
            "inference.json": {"bytes": 229777, "blob": "6cd678f39460a27372f8fe570e4e12e7a383418f"},
            "inference.yml": {"bytes": 903, "blob": "ce0997f275b851cea7136967324accac9a1e9110"},
            "inference.pdiparams": {
                "bytes": 4692937,
                "lfs": "54a85087b4d31fa3ea4e4aba100169a1ec3e3274cd3352b9068b3cfccbca7829",
            },
        },
    },
    "TR-02": {
        "repo": "PaddlePaddle/PP-OCRv3_mobile_det",
        "revision": "58f4e5b132e34e516486fb0d0266c662feb48ca1",
        "stem": "tr02_ppocrv3_mobile_det",
        "files": {
            "README.md": {"bytes": 12268, "blob": "a512aa5795d7935c0161d704320f53ee68941814"},
            "config.json": {"bytes": 2817, "blob": "a0551981b9f859eefe85e312390c77e1582ca0cf"},
            "inference.json": {"bytes": 221079, "blob": "bd735fe01d250f9d22fc7d2e6cc614c66875a56d"},
            "inference.yml": {"bytes": 885, "blob": "8592eccf27798d9fab75c8b740caf1010ee993c9"},
            "inference.pdiparams": {
                "bytes": 2377917,
                "lfs": "7e9518c6ab706fe87842a8de1c098f990e67f9212b67c9ef8bc4bca6dc17b91a",
            },
        },
    },
}

CALL = (
    "paddle2onnx.export(model_filename=inference.json, params_filename=inference.pdiparams, "
    "save_file=..., opset_version=16, enable_onnx_checker=True)"
)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git_blob_sha1(path):
    data = open(path, "rb").read()
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def scrub(text):
    """Replace this machine's paths with placeholders; keep everything else paddle2onnx said."""
    for real, name in ((EXP, "<EXP>"), (os.path.expanduser("~"), "<HOME>"), (sys.prefix, "<VENV>")):
        text = text.replace(real, name).replace(real.replace("\\", "/"), name)
    return text


def convert_once(src, out):
    """One conversion in a fresh interpreter, so the second run shares no in-process state."""
    code = (
        "import paddle2onnx, sys\n"
        "paddle2onnx.export(model_filename=sys.argv[1], params_filename=sys.argv[2], save_file=sys.argv[3], "
        "opset_version=16, enable_onnx_checker=True)\n"
    )
    if os.path.exists(out):
        os.remove(out)  # never cached: every run is a fresh conversion
    t0 = time.perf_counter()
    proc = subprocess.run(
        [sys.executable, "-c", code, os.path.join(src, "inference.json"), os.path.join(src, "inference.pdiparams"), out],
        capture_output=True,
        text=True,
    )
    ms = (time.perf_counter() - t0) * 1000
    console = scrub((proc.stdout or "") + (proc.stderr or ""))
    return {
        "exit": proc.returncode,
        "ms": round(ms, 1),
        "produced": os.path.exists(out),
        "sha256": sha256(out) if os.path.exists(out) else None,
        "bytes": os.path.getsize(out) if os.path.exists(out) else None,
        "warnings": [l for l in console.splitlines() if re.search(r"warn|deprecat", l, re.I)],
        "console": console.splitlines()[-40:],
    }


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in CANDIDATES:
        sys.exit("usage: acquire-convert.py TR-01|TR-02")
    cid = sys.argv[1]
    c = CANDIDATES[cid]
    if "_rec" in c["repo"].lower():
        sys.exit("REFUSING: recognition models are out of scope")
    src = os.path.join(MODELS, c["stem"] + "_src")
    os.makedirs(src, exist_ok=True)
    os.makedirs(LOGS, exist_ok=True)

    # Part A — pinned source, fetched at the revision, verified against hashes recorded beforehand.
    source = {}
    for name, want in c["files"].items():
        path = os.path.join(src, name)
        url = f"https://huggingface.co/{c['repo']}/resolve/{c['revision']}/{name}"
        with urllib.request.urlopen(url) as r, open(path, "wb") as f:
            f.write(r.read())
        got = {"bytes": os.path.getsize(path), "blob": git_blob_sha1(path), "sha256": sha256(path)}
        if got["bytes"] != want["bytes"]:
            sys.exit(f"REFUSING: {name} is {got['bytes']} B, pinned {want['bytes']} B")
        if "lfs" in want and got["sha256"] != want["lfs"]:
            sys.exit(f"REFUSING: {name} sha256 {got['sha256']} != pinned LFS {want['lfs']}")
        if "blob" in want and got["blob"] != want["blob"]:
            sys.exit(f"REFUSING: {name} git blob {got['blob']} != pinned {want['blob']}")
        source[name] = {**got, "verifiedAgainst": "lfs sha256" if "lfs" in want else "git blob sha1"}

    readme = open(os.path.join(src, "README.md"), encoding="utf8").read()
    front = readme.split("---")[1] if readme.startswith("---") else ""
    licence = re.search(r"^license:\s*(\S+)", front, re.M)
    model_name = re.search(r"^\s*model_name:\s*(\S+)", open(os.path.join(src, "inference.yml"), encoding="utf8").read(), re.M)
    identity = {
        "licenceAtRevision": licence.group(1) if licence else None,
        "licenceEvidence": "README.md front-matter at the pinned revision (no LICENSE file in the repository)",
        "inferenceYmlModelName": model_name.group(1) if model_name else None,
        "matchesRepo": bool(model_name) and c["repo"].endswith("/" + model_name.group(1)),
    }
    if identity["licenceAtRevision"] != "apache-2.0":
        sys.exit(f"REFUSING: licence at revision is {identity['licenceAtRevision']}")
    if not identity["matchesRepo"]:
        sys.exit(f"REFUSING: inference.yml names {identity['inferenceYmlModelName']}, not {c['repo']}")

    # Part B — two independent conversions.
    import onnx  # noqa: E402
    import onnxruntime  # noqa: E402
    import paddle  # noqa: E402
    import paddle2onnx  # noqa: E402

    runs = [convert_once(src, os.path.join(MODELS, f"{c['stem']}.run{i}.onnx")) for i in (1, 2)]
    ok = all(r["exit"] == 0 and r["produced"] for r in runs)
    reproducible = ok and runs[0]["sha256"] == runs[1]["sha256"]
    graph = None
    if ok:
        final = os.path.join(MODELS, f"{c['stem']}.onnx")
        with open(os.path.join(MODELS, f"{c['stem']}.run1.onnx"), "rb") as a, open(final, "wb") as b:
            b.write(a.read())
        m = onnx.load(final)
        onnx.checker.check_model(m)
        ops = {}
        for n in m.graph.node:
            ops[n.op_type] = ops.get(n.op_type, 0) + 1
        dims = lambda t: [d.dim_param or d.dim_value for d in t.type.tensor_type.shape.dim]  # noqa: E731
        graph = {
            "opset": [{"domain": o.domain, "version": o.version} for o in m.opset_import],
            "producer": f"{m.producer_name} {m.producer_version}",
            "ir_version": m.ir_version,
            "nodes": len(m.graph.node),
            "initializers": len(m.graph.initializer),
            "opTypes": dict(sorted(ops.items())),
            "inputs": [{"name": i.name, "elemType": i.type.tensor_type.elem_type, "dims": dims(i)} for i in m.graph.input],
            "outputs": [{"name": o.name, "elemType": o.type.tensor_type.elem_type, "dims": dims(o)} for o in m.graph.output],
        }

    record = {
        "experiment": "M8.1-visual-text-screening",
        "candidate": cid,
        "source": {"repo": c["repo"], "revision": c["revision"], "files": source},
        "identity": identity,
        "toolchain": {
            "python": sys.version.split()[0],
            "paddlepaddle": paddle.__version__,
            "paddle2onnx": paddle2onnx.__version__,
            "onnx": onnx.__version__,
            "onnxruntime": onnxruntime.__version__,
        },
        "call": CALL,
        "conversions": runs,
        "converted": ok,
        "reproducible": reproducible,
        "output": {"sha256": runs[0]["sha256"], "bytes": runs[0]["bytes"]} if ok else None,
        "graph": graph,
        "status": "CONVERTED, REPRODUCIBLE" if reproducible else "BLOCKED / NOT EVALUABLE",
    }
    with open(os.path.join(LOGS, f"{cid.lower()}-conversion.json"), "w", encoding="utf8") as f:
        json.dump(record, f, indent=2)
    print(json.dumps({k: record[k] for k in ("candidate", "identity", "toolchain", "output", "reproducible", "status")}, indent=2))
    sys.exit(0 if reproducible else 1)


if __name__ == "__main__":
    main()
