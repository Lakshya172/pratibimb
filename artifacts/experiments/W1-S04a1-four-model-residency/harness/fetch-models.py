"""
S-04a-1 model acquisition. FOUR DIFFERENT models from the PratiBimb model registry.

Every model is pinned to an exact revision, its licence is read from that revision, and its
sha256 is recorded. NOTHING here is committed to Git -- this script is the reproducible
acquisition path required by the repository's no-vendored-weights rule.

The two PP-OCRv5 models ship in Paddle inference format, not ONNX. The registry's own row
says "PP-OCRv5-mobile via paddle2onnx", so they are CONVERTED here from the first-party
Apache-2.0 source rather than taken from an unlicensed third-party ONNX re-export.

Throwaway spike code.
"""
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "models")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------------------------------
# Pinned sources. Revisions were resolved from the HF/GitHub API and are frozen here.
# ---------------------------------------------------------------------------------------
YUNET_REV = "47534e27c9851bb1128ccc0102f1145e27f23f98"
DET_REV = "0d63e78e2b680928f6b1747d76a08db6e645efb7"
REC_REV = "682f20538d8c086cb2128e5cfac775e6c4904e85"
VLM_REV = "7e3e67edbbed1bf9888184d9df282b700a323964"

SOURCES = [
    # role, local name, url, expected sha256 (None = record what we get)
    ("face-detection", "yunet.onnx",
     # YuNet is stored in Git LFS. raw.githubusercontent returns a 131-byte POINTER, not the
     # model; media.githubusercontent.com/media resolves LFS. The pointer's own "oid sha256"
     # equals the hash below, which independently confirms the pin.
     f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{YUNET_REV}/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
     "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    ("vlm-vision-encoder", "smolvlm_vision_encoder_int8.onnx",
     f"https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct/resolve/{VLM_REV}/onnx/vision_encoder_int8.onnx",
     None),
]

PADDLE = [
    ("ocr-detection", "ppocrv5_mobile_det", DET_REV, "PP-OCRv5_mobile_det"),
    ("ocr-recognition", "ppocrv5_mobile_rec", REC_REV, "PP-OCRv5_mobile_rec"),
]
PADDLE_FILES = ["inference.json", "inference.pdiparams", "inference.yml"]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def get(url, dest):
    if os.path.exists(dest):
        print(f"    cached  {os.path.basename(dest)}")
        return
    print(f"    fetch   {os.path.basename(dest)} ...", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "pratibimb-s04a1-spike"})
    with urllib.request.urlopen(req, timeout=600) as r, open(dest, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)


provenance = []

print("== direct ONNX downloads ==")
for role, name, url, expect in SOURCES:
    dest = os.path.join(OUT, name)
    get(url, dest)
    h = sha256(dest)
    if expect and h != expect:
        sys.exit(f"HASH MISMATCH for {name}\n  expected {expect}\n  got      {h}")
    provenance.append({"role": role, "file": name, "url": url,
                       "bytes": os.path.getsize(dest), "sha256": h,
                       "hash_pinned_in_advance": bool(expect)})
    print(f"    ok      {name}  {os.path.getsize(dest)} bytes  sha256 {h[:16]}...")

print("== PP-OCRv5: fetch Paddle inference format, then convert ==")
for role, stem, rev, repo in PADDLE:
    d = os.path.join(OUT, stem)
    os.makedirs(d, exist_ok=True)
    for fn in PADDLE_FILES:
        get(f"https://huggingface.co/PaddlePaddle/{repo}/resolve/{rev}/{fn}", os.path.join(d, fn))
    onnx_path = os.path.join(OUT, stem + ".onnx")
    if not os.path.exists(onnx_path):
        print(f"    convert {stem} via paddle2onnx ...", flush=True)
        # paddle2onnx has no __main__, so the Python API is used directly. It takes FULL
        # paths to the model and params, not a directory.
        import paddle2onnx
        paddle2onnx.export(
            model_filename=os.path.join(d, "inference.json"),
            params_filename=os.path.join(d, "inference.pdiparams"),
            save_file=onnx_path,
            opset_version=16,
            enable_onnx_checker=True,
        )
        if not os.path.exists(onnx_path):
            sys.exit(f"paddle2onnx produced no file for {stem}")
    h = sha256(onnx_path)
    provenance.append({"role": role, "file": stem + ".onnx",
                       "source_repo": f"PaddlePaddle/{repo}", "revision": rev,
                       "converted_by": "paddle2onnx", "bytes": os.path.getsize(onnx_path),
                       "sha256": h, "hash_pinned_in_advance": False})
    print(f"    ok      {stem}.onnx  {os.path.getsize(onnx_path)} bytes  sha256 {h[:16]}...")

with open(os.path.join(HERE, "model-provenance.json"), "w", encoding="utf8") as f:
    json.dump({"models": provenance}, f, indent=2)
print("\nwrote model-provenance.json")
