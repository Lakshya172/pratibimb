"""
S-04a-1b -- narrowing the DequantizeLinear defect to an actionable shape.

The single-node reproducer fails on WebGPU at every rank and size. The remaining question is
WHICH form of the operator is broken, because that decides whether there is a model-level fix
or only a backend exclusion:

  scalar      rank-0 scale and zero_point   <- what the model actually has
  rank1       shape [1] scale and zero_point, semantically identical per-tensor
  perchannel  axis-based, shape [C]
  noZeroPoint zero_point omitted entirely (defaults to 0)

If rank-1 works where rank-0 fails, the defect is in scalar handling and a re-export is a
real fix. If all forms fail, the operator is unusable on this backend and the honest outcome
is to exclude WebGPU for this model.

Throwaway spike code.
"""
import json
import os

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "micro")
specs = json.load(open(os.path.join(HERE, "micro-specs.json"), encoding="utf8"))

OPSET, IR = 14, 7
SHAPE = (1, 128, 128)
SCALE = 0.08602941
ZP = 116


def save(model, name):
    model.ir_version = IR
    onnx.checker.check_model(model)
    onnx.save(model, os.path.join(OUT, name))
    print("  wrote %-34s %8d bytes" % (name, os.path.getsize(os.path.join(OUT, name))))


def build(name, scale_arr, zp_arr, axis=None, omit_zp=False):
    inputs = ["X_q", "scale"] + ([] if omit_zp else ["zp"])
    kw = {} if axis is None else {"axis": axis}
    init = [numpy_helper.from_array(scale_arr, "scale")]
    if not omit_zp:
        init.append(numpy_helper.from_array(zp_arr, "zp"))
    g = helper.make_graph(
        nodes=[helper.make_node("DequantizeLinear", inputs, ["Y"], name="dql", **kw)],
        name="repro_" + name,
        inputs=[helper.make_tensor_value_info("X_q", TensorProto.UINT8, list(SHAPE))],
        outputs=[helper.make_tensor_value_info("Y", TensorProto.FLOAT, list(SHAPE))],
        initializer=init,
    )
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", OPSET)])
    save(m, name + ".onnx")
    specs[name] = {"file": name + ".onnx", "inputs": {"X_q": {"kind": "u8", "shape": list(SHAPE)}}}


# rank-0 scalar -- exactly what the model has
build("dqlv_scalar", np.array(SCALE, dtype=np.float32), np.array(ZP, dtype=np.uint8))
# rank-1 [1] -- semantically identical per-tensor quantisation
build("dqlv_rank1", np.array([SCALE], dtype=np.float32), np.array([ZP], dtype=np.uint8))
# zero_point omitted entirely (defaults to 0)
build("dqlv_noZeroPoint", np.array(SCALE, dtype=np.float32), None, omit_zp=True)
# per-channel along axis 1
C = SHAPE[1]
build("dqlv_perchannel",
      np.full((C,), SCALE, dtype=np.float32),
      np.full((C,), ZP, dtype=np.uint8),
      axis=1)

with open(os.path.join(HERE, "micro-specs.json"), "w", encoding="utf8") as f:
    json.dump(specs, f, indent=1)
print("\nmicro-specs.json now has", len(specs), "graphs")
