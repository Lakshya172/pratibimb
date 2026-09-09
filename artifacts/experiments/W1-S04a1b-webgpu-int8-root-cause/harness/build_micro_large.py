"""
S-04a-1b -- LARGE variants of the micro graphs.

The small graphs may never reach a GPU kernel at all. ORT Web's WebGPU EP partitions
unsupported or trivially small work back to CPU, and the small fp32 MatMul produced
*identical* float rounding on wasm and webgpu (76/256 exact, worstAbs 1.907e-06 in both) --
which is what a shared CPU kernel looks like, not two independent implementations.

These are sized so a real GPU matmul kernel must engage, which turns "webgpu fell back" from
an assumption into something testable: if the large fp32 MatMul still rounds identically to
wasm, the webgpu session is not using GPU kernels for it.

Run after build_micro.py. Throwaway spike code.
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
LM, LK, LN = 256, 512, 256


def det_i8(shape, seed=7):
    n = int(np.prod(shape))
    return np.array([((i * seed) % 251) - 125 for i in range(n)], dtype=np.int8).reshape(shape)


def save(model, name):
    model.ir_version = IR
    onnx.checker.check_model(model)
    p = os.path.join(OUT, name)
    onnx.save(model, p)
    print("  wrote %-34s %8d bytes" % (name, os.path.getsize(p)))


def mk(graph):
    return helper.make_model(graph, opset_imports=[helper.make_opsetid("", OPSET)])


# 6. large fp32 MatMul -- the fallback detector
B_f32_l = det_i8((LK, LN), seed=23).astype(np.float32) * np.float32(0.0037)
g = helper.make_graph(
    nodes=[helper.make_node("MatMul", ["X", "B_f32"], ["Y"], name="mm")],
    name="micro_matmul_fp32_large",
    inputs=[helper.make_tensor_value_info("X", TensorProto.FLOAT, [LM, LK])],
    outputs=[helper.make_tensor_value_info("Y", TensorProto.FLOAT, [LM, LN])],
    initializer=[numpy_helper.from_array(B_f32_l, "B_f32")],
)
save(mk(g), "matmul_fp32_large.onnx")
specs["matmul_fp32_large"] = {"file": "matmul_fp32_large.onnx",
                              "inputs": {"X": {"kind": "f32", "shape": [LM, LK]}}}

# 7. large DynamicQuantizeLinear -> MatMulInteger -- the model's pattern, at real size
B_i8_l = det_i8((LK, LN), seed=29)
g = helper.make_graph(
    nodes=[
        helper.make_node("DynamicQuantizeLinear", ["X"], ["Q", "S", "ZP"], name="dql"),
        helper.make_node("MatMulInteger", ["Q", "B_i8", "ZP", "b_zp"], ["Y_i32"], name="mmi"),
        helper.make_node("Cast", ["Y_i32"], ["Y_f32"], to=TensorProto.FLOAT, name="cast"),
        helper.make_node("Mul", ["Y_f32", "S"], ["Y_s"], name="mul_a_scale"),
        helper.make_node("Mul", ["Y_s", "b_scale"], ["Y"], name="mul_b_scale"),
    ],
    name="micro_dql_mmi_large",
    inputs=[helper.make_tensor_value_info("X", TensorProto.FLOAT, [LM, LK])],
    outputs=[helper.make_tensor_value_info("Y", TensorProto.FLOAT, [LM, LN])],
    initializer=[numpy_helper.from_array(B_i8_l, "B_i8"),
                 numpy_helper.from_array(np.zeros((), dtype=np.int8), "b_zp"),
                 numpy_helper.from_array(np.array(0.0037, dtype=np.float32), "b_scale")],
)
save(mk(g), "dql_matmulinteger_large.onnx")
specs["dql_matmulinteger_large"] = {"file": "dql_matmulinteger_large.onnx",
                                    "inputs": {"X": {"kind": "f32", "shape": [LM, LK]}}}

with open(os.path.join(HERE, "micro-specs.json"), "w", encoding="utf8") as f:
    json.dump(specs, f, indent=1)
print("\nmicro-specs.json now has", len(specs), "graphs")
