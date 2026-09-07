/**
 * S-02 shared WebGPU probe. Identical code runs in the Firefox MV3 event page and in an
 * ordinary page (the control), so a null adapter can be attributed to the extension
 * context rather than to the machine.
 *
 * Follows the pre-registered procedure in
 * artifacts/experiments/W1-S02-firefox-webgpu-context/README.md step 2.
 *
 * Throwaway spike code. No product code.
 */
globalThis.runProbe = async function runProbe(contextName) {
  const out = {
    context: contextName,
    startedAt: new Date().toISOString(),
    userAgent: (globalThis.navigator && navigator.userAgent) || null,
    isSecureContext: globalThis.isSecureContext ?? null,
    globalKind: typeof ServiceWorkerGlobalScope !== "undefined" ? "service-worker"
              : typeof WorkerGlobalScope !== "undefined" ? "worker"
              : typeof window !== "undefined" ? "window" : "unknown",
    navigatorGpuPresent: false,
    adapterDefault: null,
    adapterHighPerformance: null,
    adapterAvailable: false,
    adapterInfo: null,
    isFallbackAdapter: null,
    deviceCreated: false,
    requestDeviceMs: null,
    computeRan: false,
    compute: null,
    teardown: null,
    reacquire: null,
    uncapturedErrors: [],
    error: null,
  };

  try {
    out.navigatorGpuPresent = typeof navigator !== "undefined" && "gpu" in navigator && !!navigator.gpu;
    if (!out.navigatorGpuPresent) {
      out.conclusion = "navigator.gpu ABSENT in this context";
      return out;
    }

    const ask = async (powerPreference) => {
      const t0 = performance.now();
      let adapter = null, err = null;
      try {
        adapter = powerPreference
          ? await navigator.gpu.requestAdapter({ powerPreference })
          : await navigator.gpu.requestAdapter();
      } catch (e) { err = String(e).slice(0, 200); }
      const ms = Math.round((performance.now() - t0) * 10) / 10;
      let info = null;
      if (adapter) {
        const ai = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
        info = ai ? { vendor: ai.vendor, architecture: ai.architecture, device: ai.device, description: ai.description } : null;
      }
      return { powerPreference: powerPreference || "default", adapterAvailable: !!adapter, requestAdapterMs: ms, info, error: err, _adapter: adapter };
    };

    const d = await ask(null);
    const hp = await ask("high-performance");
    out.adapterDefault = { ...d, _adapter: undefined };
    out.adapterHighPerformance = { ...hp, _adapter: undefined };
    const adapter = d._adapter || hp._adapter;
    out.adapterAvailable = !!adapter;
    if (!adapter) {
      out.conclusion = "navigator.gpu present but requestAdapter returned NULL in this context";
      return out;
    }
    out.adapterInfo = d.info || hp.info;
    out.isFallbackAdapter = adapter.isFallbackAdapter ?? null;

    const t1 = performance.now();
    const device = await adapter.requestDevice();
    out.requestDeviceMs = Math.round((performance.now() - t1) * 10) / 10;
    out.deviceCreated = !!device;
    device.addEventListener?.("uncapturederror", (e) => out.uncapturedErrors.push(String(e.error).slice(0, 200)));

    // --- trivial compute shader, verified element-by-element against a CPU reference ---
    const N = 262144;
    const input = new Int32Array(N);
    for (let i = 0; i < N; i++) input[i] = i % 1024;

    const shaderErrors = [];
    const module = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read>       inp : array<i32>;
        @group(0) @binding(1) var<storage, read_write> outp: array<i32>;
        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
          let i = gid.x;
          if (i < arrayLength(&inp)) { outp[i] = inp[i] * 2 + 1; }
        }`,
    });
    const ci = await module.getCompilationInfo?.();
    if (ci) for (const m of ci.messages) if (m.type === "error") shaderErrors.push(m.message);

    const inBuf = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(inBuf, 0, input);
    const outBuf = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readBuf = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: outBuf } }],
    });

    const dispatch = async () => {
      const t = performance.now();
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(N / 64));
      pass.end();
      enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, input.byteLength);
      device.queue.submit([enc.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ);
      const res = new Int32Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      return { ms: Math.round((performance.now() - t) * 10) / 10, res };
    };

    const cold = await dispatch();
    let mismatches = 0, firstMismatch = null;
    for (let i = 0; i < N; i++) {
      const expected = input[i] * 2 + 1;
      if (cold.res[i] !== expected) {
        mismatches++;
        if (firstMismatch === null) firstMismatch = { i, expected, got: cold.res[i] };
      }
    }
    const warm = [];
    for (let k = 0; k < 10; k++) warm.push((await dispatch()).ms);
    warm.sort((a, b) => a - b);

    out.computeRan = true;
    out.compute = {
      elements: N,
      outputCorrect: mismatches === 0,
      mismatches,
      firstMismatch,
      shaderCompileErrors: shaderErrors,
      coldDispatchMs: cold.ms,
      warmDispatchMs: { count: warm.length, p50: warm[Math.floor(warm.length / 2)], min: warm[0], max: warm[warm.length - 1] },
    };

    // --- teardown, then re-acquire, to prove the context is not one-shot ---
    const t2 = performance.now();
    device.destroy();
    let lost = null;
    try { lost = await Promise.race([device.lost, new Promise((r) => setTimeout(() => r(null), 2000))]); } catch {}
    out.teardown = { destroyMs: Math.round((performance.now() - t2) * 10) / 10, lost: lost ? { reason: lost.reason, message: lost.message } : null };

    const a2 = await navigator.gpu.requestAdapter();
    const d2 = a2 ? await a2.requestDevice() : null;
    out.reacquire = { adapterAvailable: !!a2, deviceCreated: !!d2 };
    d2?.destroy();

    out.conclusion = out.compute.outputCorrect
      ? "adapter + device + correct compute output in this context"
      : "adapter + device, but compute output INCORRECT";
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e).slice(0, 500);
    out.conclusion = "threw";
  }
  out.finishedAt = new Date().toISOString();
  return out;
};
