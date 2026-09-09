"""
S-04a-1b -- MINIMAL SYNTHETIC INT8 REPRODUCERS.

The SmolVLM int8 encoder is 1146 nodes. Before bisecting it, establish whether the defect is
a property of the MODEL or of the BACKEND, using the smallest graphs that exercise the exact
operator pattern the model uses:

    DynamicQuantizeLinear -> MatMulInteger

plus a plain fp32 MatMul as a non-quantised control (task section 9), and ConvInteger, which
the model uses once at the patch embedding.

Every graph is generated from this file, so nothing is vendored and everything is
reproducible. Deterministic inputs, no randomness.

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

M, K, N = 8, 64, 32          # small but not degenerate
OPSET = 14                   # same opset as the real model
IR = 7


def det_f32(shape, scale=1.0, shift=0.0):
    n = int(np.prod(shape))
    a = np.array([((i * 37) % 255) / 255 for i in range(n)], dtype=np.float32)
    return (a * scale + shift).astype(np.float32).reshape(shape)


def det_i8(shape, seed=7):
    n = int(np.prod(shape))
    a = np.array([((i * seed) % 251) - 125 for i in range(n)], dtype=np.int8)
    return a.reshape(shape)


def det_u8(shape, seed=11):
    n = int(np.prod(shape))
    a = np.array([(i * seed) % 256 for i in range(n)], dtype=np.uint8)
    return a.reshape(shape)


def save(model, name):
    model.ir_version = IR
    onnx.checker.check_model(model)
    p = os.path.join(OUT, name)
    onnx.save(model, p)
    print("  wrote %-34s %8d bytes" % (name, os.path.getsize(p)))
    return p


def mk(graph):
    return helper.make_model(graph, opset_imports=[helper.make_opsetid("", OPSET)])


specs = {}

# ---------------------------------------------------------------------------------------
# 1. MatMulInteger alone.  uint8 A x int8 B -> int32.  Zero points supplied explicitly.
#    This is the operator the model calls 73 times.
# ---------------------------------------------------------------------------------------
B_i8 = det_i8((K, N), seed=13)
a_zp = np.array(128, dtype=np.uint8)
b_zp = np.zeros((), dtype=np.int8)
g = helper.make_graph(
    nodes=[helper.make_node("MatMulInteger", ["A_u8", "B_i8", "a_zp", "b_zp"], ["Y_i32"], name="mmi")],
    name="micro_matmulinteger",
    inputs=[helper.make_tensor_value_info("A_u8", TensorProto.UINT8, [M, K])],
    outputs=[helper.make_tensor_value_info("Y_i32", TensorProto.INT32, [M, N])],
    initializer=[numpy_helper.from_array(B_i8, "B_i8"),
                 numpy_helper.from_array(a_zp, "a_zp"),
                 numpy_helper.from_array(b_zp, "b_zp")],
)
save(mk(g), "matmulinteger.onnx")
specs["matmulinteger"] = {"file": "matmulinteger.onnx",
                          "inputs": {"A_u8": {"kind": "u8", "shape": [M, K]}}}

# ---------------------------------------------------------------------------------------
# 2. DynamicQuantizeLinear alone -- float32 in, (uint8, scale, zero_point) out.
#    Called 50 times by the model. Its three outputs are checked independently.
# ---------------------------------------------------------------------------------------
g = helper.make_graph(
    nodes=[helper.make_node("DynamicQuantizeLinear", ["X"], ["Q", "S", "ZP"], name="dql")],
    name="micro_dql",
    inputs=[helper.make_tensor_value_info("X", TensorProto.FLOAT, [M, K])],
    outputs=[helper.make_tensor_value_info("Q", TensorProto.UINT8, [M, K]),
             helper.make_tensor_value_info("S", TensorProto.FLOAT, []),
             helper.make_tensor_value_info("ZP", TensorProto.UINT8, [])],
)
save(mk(g), "dynamicquantizelinear.onnx")
specs["dynamicquantizelinear"] = {"file": "dynamicquantizelinear.onnx",
                                  "inputs": {"X": {"kind": "f32", "shape": [M, K]}}}

# ---------------------------------------------------------------------------------------
# 3. The MODEL'S ACTUAL PATTERN: DynamicQuantizeLinear -> MatMulInteger -> Cast -> scale.
#    This is what a quantised Linear layer looks like in this export.
# ---------------------------------------------------------------------------------------
B_i8b = det_i8((K, N), seed=17)
b_scale = np.array(0.0123, dtype=np.float32)
g = helper.make_graph(
    nodes=[
        helper.make_node("DynamicQuantizeLinear", ["X"], ["Q", "S", "ZP"], name="dql"),
        helper.make_node("MatMulInteger", ["Q", "B_i8", "ZP", "b_zp"], ["Y_i32"], name="mmi"),
        helper.make_node("Cast", ["Y_i32"], ["Y_f32"], to=TensorProto.FLOAT, name="cast"),
        helper.make_node("Mul", ["Y_f32", "S"], ["Y_s"], name="mul_a_scale"),
        helper.make_node("Mul", ["Y_s", "b_scale"], ["Y"], name="mul_b_scale"),
    ],
    name="micro_dql_mmi",
    inputs=[helper.make_tensor_value_info("X", TensorProto.FLOAT, [M, K])],
    outputs=[helper.make_tensor_value_info("Y", TensorProto.FLOAT, [M, N])],
    initializer=[numpy_helper.from_array(B_i8b, "B_i8"),
                 numpy_helper.from_array(np.zeros((), dtype=np.int8), "b_zp"),
                 numpy_helper.from_array(b_scale, "b_scale")],
)
save(mk(g), "dql_matmulinteger.onnx")
specs["dql_matmulinteger"] = {"file": "dql_matmulinteger.onnx",
                              "inputs": {"X": {"kind": "f32", "shape": [M, K]}}}

# ---------------------------------------------------------------------------------------
# 4. NON-QUANTISED CONTROL (task section 9): the same shapes as fp32 MatMul.
#    If this is correct on WebGPU and (3) is not, quantisation is implicated directly.
# ---------------------------------------------------------------------------------------
B_f32 = (det_i8((K, N), seed=17).astype(np.float32)) * 0.0123
g = helper.make_graph(
    nodes=[helper.make_node("MatMul", ["X", "B_f32"], ["Y"], name="mm")],
    name="micro_matmul_fp32",
    inputs=[helper.make_tensor_value_info("X", TensorProto.FLOAT, [M, K])],
    outputs=[helper.make_tensor_value_info("Y", TensorProto.FLOAT, [M, N])],
    initializer=[numpy_helper.from_array(B_f32, "B_f32")],
)
save(mk(g), "matmul_fp32.onnx")
specs["matmul_fp32"] = {"file": "matmul_fp32.onnx",
                        "inputs": {"X": {"kind": "f32", "shape": [M, K]}}}

# ---------------------------------------------------------------------------------------
# 5. ConvInteger -- used once by the model, at the patch embedding.
# ---------------------------------------------------------------------------------------
CIN, COUT, KS, HW = 3, 4, 3, 8
W_i8 = det_i8((COUT, CIN, KS, KS), seed=19)
g = helper.make_graph(
    nodes=[helper.make_node("ConvInteger", ["X_u8", "W_i8", "x_zp", "w_zp"], ["Y_i32"],
                            name="ci", kernel_shape=[KS, KS], strides=[1, 1], pads=[0, 0, 0, 0])],
    name="micro_convinteger",
    inputs=[helper.make_tensor_value_info("X_u8", TensorProto.UINT8, [1, CIN, HW, HW])],
    outputs=[helper.make_tensor_value_info("Y_i32", TensorProto.INT32, [1, COUT, HW - KS + 1, HW - KS + 1])],
    initializer=[numpy_helper.from_array(W_i8, "W_i8"),
                 numpy_helper.from_array(np.array(128, dtype=np.uint8), "x_zp"),
                 numpy_helper.from_array(np.zeros((), dtype=np.int8), "w_zp")],
)
save(mk(g), "convinteger.onnx")
specs["convinteger"] = {"file": "convinteger.onnx",
                        "inputs": {"X_u8": {"kind": "u8", "shape": [1, CIN, HW, HW]}}}

with open(os.path.join(HERE, "micro-specs.json"), "w", encoding="utf8") as f:
    json.dump(specs, f, indent=1)
print("\nwrote micro-specs.json with", len(specs), "graphs")
