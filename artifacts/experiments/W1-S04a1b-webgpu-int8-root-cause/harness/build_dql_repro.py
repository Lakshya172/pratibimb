"""
S-04a-1b -- MINIMAL REPRODUCER for the WebGPU DequantizeLinear defect.

Layer-wise bisection put the first divergence at exactly one node:

    /vision_model/embeddings/position_embedding/Gather_output_0_DequantizeLinear
    DequantizeLinear(uint8 x, scalar float scale=0.08602941, scalar uint8 zero_point=116)
    input shape [1, 1024, 768], per-tensor, no axis attribute

Every checkpoint before it is bit-exact on WebGPU, including the uint8 Gather that feeds it.
Its output is wrong by ~1.5e9 relative, on both graphOptimizationLevel "all" and "disabled".

These graphs isolate that operator and vary one thing at a time, so the failure can be
characterised rather than merely reproduced:

  rank      1-D / 2-D / 3-D at the model's own shape
  size      small vs the model's 786432 elements
  signed    uint8 vs int8
  zeropoint the model's 116 vs 0
  scale     scalar (per-tensor) -- the model's case

Throwaway spike code.
"""
import json
import os

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "micro")
os.makedirs(OUT, exist_ok=True)
specs = json.load(open(os.path.join(HERE, "micro-specs.json"), encoding="utf8"))

OPSET, IR = 14, 7
SCALE = np.float32(0.08602941)   # the model's actual scale
ZP = 116                         # the model's actual zero point


def save(model, name):
    model.ir_version = IR
    onnx.checker.check_model(model)
    onnx.save(model, os.path.join(OUT, name))
    print("  wrote %-40s %8d bytes" % (name, os.path.getsize(os.path.join(OUT, name))))


def dql(name, shape, signed=False, zp=ZP, scale=SCALE):
    et = TensorProto.INT8 if signed else TensorProto.UINT8
    zp_arr = np.array(zp, dtype=np.int8 if signed else np.uint8)
    g = helper.make_graph(
        nodes=[helper.make_node("DequantizeLinear", ["X_q", "scale", "zp"], ["Y"], name="dql")],
        name="repro_" + name,
        inputs=[helper.make_tensor_value_info("X_q", et, list(shape))],
        outputs=[helper.make_tensor_value_info("Y", TensorProto.FLOAT, list(shape))],
        initializer=[numpy_helper.from_array(np.array(scale, dtype=np.float32), "scale"),
                     numpy_helper.from_array(zp_arr, "zp")],
    )
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", OPSET)])
    save(m, name + ".onnx")
    specs[name] = {"file": name + ".onnx",
                   "inputs": {"X_q": {"kind": "i8" if signed else "u8", "shape": list(shape)}}}


# the exact failing shape and dtype from the model
dql("dql_model_shape", (1, 1024, 768))
# rank sweep at a small size
dql("dql_1d_small", (256,))
dql("dql_2d_small", (16, 16))
dql("dql_3d_small", (1, 16, 16))
# size sweep at rank 3
dql("dql_3d_medium", (1, 128, 128))
# signedness
dql("dql_3d_small_int8", (1, 16, 16), signed=True)
# zero point
dql("dql_3d_small_zp0", (1, 16, 16), zp=0)
dql("dql_model_shape_zp0", (1, 1024, 768), zp=0)

with open(os.path.join(HERE, "micro-specs.json"), "w", encoding="utf8") as f:
    json.dump(specs, f, indent=1)
print("\nmicro-specs.json now has", len(specs), "graphs")
