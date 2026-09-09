"""
S-03 tiny deterministic model.

  y = x * 2 + 1   over a float32 tensor of shape [1, 262144]

Deliberately the SAME arithmetic as the S-02a WebGPU kernel and the S-02a-2 WASM kernel,
so all three execution paths are directly comparable and every one of them can be verified
element-by-element against the same CPU reference.

Two ops, two initializers, no external data, no training, no licence question. It exists to
answer "does an ORT Web session initialise and run in this context", not to represent a
workload. Throwaway spike asset.
"""
import onnx
from onnx import helper, TensorProto, numpy_helper
import numpy as np

N = 262144
two = numpy_helper.from_array(np.array([2.0], dtype=np.float32), name="two")
one = numpy_helper.from_array(np.array([1.0], dtype=np.float32), name="one")

graph = helper.make_graph(
    nodes=[
        helper.make_node("Mul", ["x", "two"], ["t"], name="mul2"),
        helper.make_node("Add", ["t", "one"], ["y"], name="add1"),
    ],
    name="pratibimb_s03_tiny",
    inputs=[helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, N])],
    outputs=[helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, N])],
    initializer=[two, one],
)
model = helper.make_model(
    graph,
    producer_name="pratibimb-s03",
    opset_imports=[helper.make_operatorsetid("", 13)],
)
model.ir_version = 9          # keep compatible with current ORT Web releases
onnx.checker.check_model(model)
onnx.save(model, "tiny.onnx")

import hashlib, os
b = open("tiny.onnx", "rb").read()
print("tiny.onnx bytes:", len(b))
print("sha256:", hashlib.sha256(b).hexdigest())
print("opset: 13   ir_version:", model.ir_version)
