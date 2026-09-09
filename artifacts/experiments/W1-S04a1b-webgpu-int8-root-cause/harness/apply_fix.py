"""
S-04a-1b -- CANDIDATE FIX: rewrite DequantizeLinear as Cast -> Sub -> Mul.

Root cause established by bisection and a single-node reproducer: ORT Web's WebGPU (JSEP)
DequantizeLinear kernel returns wrong values, at every rank, size and parameter form tested,
on 1.27.0, 1.29.0 and 1.30.0-dev. WASM is bit-exact throughout.

Two controls show the defect is the kernel and nothing around it:
    Cast(uint8 -> float32) alone        EXACT on WebGPU
    Cast -> Sub(zp) -> Mul(scale)       EXACT on WebGPU
    DequantizeLinear (same maths)       WRONG on WebGPU

So the operator can be replaced by its own definition. For per-tensor quantisation,
DequantizeLinear(x, scale, zero_point) is exactly (float(x) - float(zero_point)) * scale.

This rewrites the model's single DequantizeLinear node that way. It is applied to a
LOCALLY GENERATED artifact -- the pinned upstream weights are untouched, nothing is vendored,
and the transformation is reproducible from this script.

Per-tensor only. A per-channel node would need the scale broadcast along its axis, and the
script refuses rather than guessing.

Throwaway spike code.
"""
import json
import os

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

HERE = os.path.dirname(os.path.abspath(__file__))
import sys
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "models", "smolvlm_vision_encoder_int8.onnx")
OUT_DIR = os.path.join(HERE, "sliced")
os.makedirs(OUT_DIR, exist_ok=True)
DST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(OUT_DIR, "vision_encoder_int8_dqlfix.onnx")

m = onnx.load(SRC)
g = m.graph
init = {i.name: i for i in g.initializer}

targets = [n for n in g.node if n.op_type == "DequantizeLinear"]
print("DequantizeLinear nodes found:", len(targets))

rewritten = 0
for n in list(targets):
    if len(n.input) < 2:
        print("  SKIP (no scale):", n.name)
        continue
    if any(a.name == "axis" for a in n.attribute):
        print("  REFUSING per-channel node (axis set):", n.name)
        continue
    x_name, scale_name = n.input[0], n.input[1]
    zp_name = n.input[2] if len(n.input) > 2 else None

    if scale_name not in init:
        print("  REFUSING: scale is not an initializer for", n.name)
        continue
    scale_arr = numpy_helper.to_array(init[scale_name])
    if scale_arr.size != 1:
        print("  REFUSING: scale is not per-tensor for", n.name, scale_arr.shape)
        continue

    zp_val = 0.0
    if zp_name and zp_name in init:
        zp_arr = numpy_helper.to_array(init[zp_name])
        if zp_arr.size != 1:
            print("  REFUSING: zero_point is not per-tensor for", n.name)
            continue
        zp_val = float(zp_arr.reshape(-1)[0])

    base = (n.name or "dql") + "_fix"
    cast_out, sub_out = base + "_cast", base + "_sub"
    zpf_name, scf_name = base + "_zpf", base + "_scalef"

    g.initializer.append(numpy_helper.from_array(np.array(zp_val, dtype=np.float32), zpf_name))
    g.initializer.append(numpy_helper.from_array(
        np.array(float(scale_arr.reshape(-1)[0]), dtype=np.float32), scf_name))

    new_nodes = [
        helper.make_node("Cast", [x_name], [cast_out], to=TensorProto.FLOAT, name=base + "_cast_n"),
        helper.make_node("Sub", [cast_out, zpf_name], [sub_out], name=base + "_sub_n"),
        helper.make_node("Mul", [sub_out, scf_name], [n.output[0]], name=base + "_mul_n"),
    ]
    idx = list(g.node).index(n)
    g.node.remove(n)
    for k, nn in enumerate(new_nodes):
        g.node.insert(idx + k, nn)
    rewritten += 1
    print("  rewrote %s  (zero_point=%g, scale=%g)" % (n.name, zp_val, float(scale_arr.reshape(-1)[0])))

print("rewritten:", rewritten)
onnx.checker.check_model(m)
onnx.save(m, DST, save_as_external_data=False)
print("wrote %s (%.2f MB)" % (os.path.basename(DST), os.path.getsize(DST) / 1048576))

remaining = [n for n in m.graph.node if n.op_type == "DequantizeLinear"]
print("DequantizeLinear remaining in fixed model:", len(remaining))

with open(os.path.join(HERE, "fix-manifest.json"), "w", encoding="utf8") as f:
    json.dump({"source": os.path.basename(SRC), "output": os.path.basename(DST),
               "nodes_rewritten": rewritten, "remaining_dequantizelinear": len(remaining),
               "transform": "DequantizeLinear(x,scale,zp) -> Mul(Sub(Cast(x,float32), float(zp)), scale)",
               "scope": "per-tensor only; per-channel nodes are refused, not guessed"}, f, indent=1)
print("wrote fix-manifest.json")
