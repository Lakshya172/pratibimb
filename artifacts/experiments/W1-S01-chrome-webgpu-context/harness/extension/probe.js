/*
 * PratiBimb S-01 — WebGPU capability probe.
 *
 * THROWAWAY SPIKE CODE. Not production. Not reviewed for production quality.
 * Quarantined under artifacts/experiments/ by policy (docs/operations/repository-structure.md).
 *
 * One file, loaded verbatim into four different execution contexts, so that any
 * difference in the result is attributable to the CONTEXT and not to the code:
 *   - MV3 background service worker      (importScripts)
 *   - chrome.offscreen document          (<script src>)
 *   - dedicated Worker inside offscreen  (importScripts)  <-- PratiBimb's real target
 *   - ordinary web page                  (<script src>)   <-- CONTROL
 *
 * Measurement note, stated because it changes how the numbers should be read:
 * `dispatchMs` is END-TO-END wall clock from queue.submit() to the readback buffer's
 * mapAsync() resolving. It is NOT isolated GPU kernel time. That is deliberate — it is
 * the latency a caller in PratiBimb would actually experience — but it must never be
 * quoted as a kernel benchmark.
 */

/* eslint-disable no-undef */

const PROBE_ELEMENTS = 1 << 18; // 262,144 f32 = 1 MiB in, 1 MiB out
const WARM_ITERATIONS = 20;

const WGSL = `
@group(0) @binding(0) var<storage, read>       inBuf  : array<f32>;
@group(0) @binding(1) var<storage, read_write> outBuf : array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&inBuf)) { return; }
  outBuf[i] = inBuf[i] * 2.0 + 1.0;
}
`;

function errObj(e) {
  if (!e) return null;
  return {
    name: (e && e.name) || typeof e,
    message: (e && e.message) || String(e),
    stack: e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : null
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(3));
}

function globalKind() {
  try {
    if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
      if (typeof ServiceWorkerGlobalScope !== 'undefined' &&
          self instanceof ServiceWorkerGlobalScope) return 'ServiceWorkerGlobalScope';
      if (typeof DedicatedWorkerGlobalScope !== 'undefined' &&
          self instanceof DedicatedWorkerGlobalScope) return 'DedicatedWorkerGlobalScope';
      return 'WorkerGlobalScope';
    }
    if (typeof window !== 'undefined') return 'Window';
  } catch (_) { /* ignore */ }
  return 'unknown';
}

async function readAdapterInfo(adapter) {
  // Chrome exposes adapter.info synchronously in newer builds; older builds only had
  // the async requestAdapterInfo(). Try both, record which one answered.
  try {
    if (adapter.info) {
      const i = adapter.info;
      return {
        source: 'adapter.info',
        vendor: i.vendor ?? null,
        architecture: i.architecture ?? null,
        device: i.device ?? null,
        description: i.description ?? null,
        subgroupMinSize: i.subgroupMinSize ?? null,
        subgroupMaxSize: i.subgroupMaxSize ?? null
      };
    }
  } catch (_) { /* fall through */ }
  try {
    if (typeof adapter.requestAdapterInfo === 'function') {
      const i = await adapter.requestAdapterInfo();
      return {
        source: 'requestAdapterInfo()',
        vendor: i.vendor ?? null,
        architecture: i.architecture ?? null,
        device: i.device ?? null,
        description: i.description ?? null
      };
    }
  } catch (e) {
    return { source: 'error', error: errObj(e) };
  }
  return { source: 'unavailable' };
}

async function runCompute(device, iterations) {
  const n = PROBE_ELEMENTS;
  const bytes = n * 4;

  const input = new Float32Array(n);
  for (let i = 0; i < n; i++) input[i] = i % 1000;

  const inBuf = device.createBuffer({
    size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(inBuf, 0, input);

  const outBuf = device.createBuffer({
    size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const readBuf = device.createBuffer({
    size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });

  const module = device.createShaderModule({ code: WGSL });
  const info = await module.getCompilationInfo?.();
  const shaderErrors = info
    ? info.messages.filter((m) => m.type === 'error').map((m) => m.message)
    : [];

  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module, entryPoint: 'main' }
  });

  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inBuf } },
      { binding: 1, resource: { buffer: outBuf } }
    ]
  });

  const timings = [];
  let verified = null;
  let checksum = null;

  for (let it = 0; it < iterations; it++) {
    const t0 = performance.now();

    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(n / 64));
    pass.end();
    enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, bytes);
    device.queue.submit([enc.finish()]);

    await readBuf.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();

    timings.push(performance.now() - t0);

    if (it === 0) {
      // Correctness against a known-good reference computed on the CPU.
      let ok = true;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const expect = (i % 1000) * 2 + 1;
        if (out[i] !== expect) { ok = false; break; }
        sum += out[i];
      }
      verified = ok;
      checksum = ok ? sum : null;
    }
  }

  inBuf.destroy(); outBuf.destroy(); readBuf.destroy();

  const cold = Number(timings[0].toFixed(3));
  const warm = timings.slice(1).sort((a, b) => a - b);

  return {
    elements: n,
    iterations,
    outputCorrect: verified,
    checksum,
    shaderCompileErrors: shaderErrors,
    coldDispatchMs: cold,
    warmDispatchMs: {
      count: warm.length,
      p50: percentile(warm, 50),
      p95: percentile(warm, 95),
      min: warm.length ? Number(warm[0].toFixed(3)) : null,
      max: warm.length ? Number(warm[warm.length - 1].toFixed(3)) : null
    }
  };
}

async function acquire(powerPreference) {
  const out = { powerPreference: powerPreference || 'default' };
  const t0 = performance.now();
  let adapter = null;
  try {
    adapter = await navigator.gpu.requestAdapter(
      powerPreference ? { powerPreference } : undefined
    );
  } catch (e) {
    out.requestAdapterError = errObj(e);
  }
  out.requestAdapterMs = Number((performance.now() - t0).toFixed(3));
  out.adapterAvailable = !!adapter;
  return { out, adapter };
}

/**
 * @param {string} contextName human label for the execution context
 * @returns {Promise<object>} a fully self-describing result record
 */
async function pratibimbWebGPUProbe(contextName) {
  const result = {
    context: contextName,
    globalKind: globalKind(),
    href: (typeof location !== 'undefined' && location.href) || null,
    isSecureContext: (typeof isSecureContext !== 'undefined') ? isSecureContext : null,
    userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || null,
    hardwareConcurrency:
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || null,
    startedAt: new Date().toISOString(),
    navigatorGpuPresent: false,
    adapterAvailable: false,
    deviceCreated: false,
    computeRan: false,
    repeatable: null,
    error: null
  };

  try {
    result.navigatorGpuPresent =
      typeof navigator !== 'undefined' && typeof navigator.gpu !== 'undefined';

    if (!result.navigatorGpuPresent) {
      result.conclusion = 'navigator.gpu is NOT exposed in this context';
      return result;
    }

    result.preferredCanvasFormat =
      typeof navigator.gpu.getPreferredCanvasFormat === 'function'
        ? navigator.gpu.getPreferredCanvasFormat()
        : null;
    result.wgslLanguageFeatures =
      navigator.gpu.wgslLanguageFeatures ? [...navigator.gpu.wgslLanguageFeatures] : null;

    // --- adapter -----------------------------------------------------------
    const def = await acquire(null);
    result.adapterDefault = def.out;
    const hp = await acquire('high-performance');
    result.adapterHighPerformance = hp.out;

    // Record BOTH adapters' identity. On a hybrid-graphics laptop the default and the
    // high-performance adapter can be different physical GPUs, and which one Chrome
    // hands an extension is a load-bearing fact for the perception tier's latency.
    if (def.adapter) result.adapterDefault.info = await readAdapterInfo(def.adapter);
    if (hp.adapter) result.adapterHighPerformance.info = await readAdapterInfo(hp.adapter);

    const adapter = def.adapter || hp.adapter;
    result.adapterAvailable = !!adapter;
    if (!adapter) {
      result.conclusion =
        'navigator.gpu exists but requestAdapter() returned null in this context';
      return result;
    }

    result.adapterUsedForDevice = def.adapter ? 'default' : 'high-performance';
    result.adapterInfo = await readAdapterInfo(adapter);
    result.adapterFeatures = [...adapter.features].sort();
    result.adapterLimits = {
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
      maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
      maxTextureDimension2D: adapter.limits.maxTextureDimension2D
    };
    result.isFallbackAdapter = adapter.isFallbackAdapter ?? null;

    // --- device ------------------------------------------------------------
    const td = performance.now();
    let device;
    try {
      device = await adapter.requestDevice();
    } catch (e) {
      result.requestDeviceError = errObj(e);
      result.conclusion = 'adapter obtained but requestDevice() failed';
      return result;
    }
    result.requestDeviceMs = Number((performance.now() - td).toFixed(3));
    result.deviceCreated = true;

    const uncaptured = [];
    device.addEventListener('uncapturederror', (ev) => {
      uncaptured.push(errObj(ev.error));
    });

    // --- compute -----------------------------------------------------------
    result.compute = await runCompute(device, WARM_ITERATIONS);
    result.computeRan = result.compute.outputCorrect === true;
    result.uncapturedErrors = uncaptured;

    // --- teardown and repeatability ----------------------------------------
    // Does destroying the device and acquiring a fresh one work? If a context can
    // only ever create one device, tier teardown in PratiBimb is affected.
    const tDestroy = performance.now();
    device.destroy();
    let lostReason = null;
    try {
      const lost = await Promise.race([
        device.lost,
        new Promise((r) => setTimeout(() => r(null), 1500))
      ]);
      lostReason = lost ? { reason: lost.reason, message: lost.message } : 'timeout';
    } catch (e) { lostReason = errObj(e); }
    result.teardown = {
      destroyMs: Number((performance.now() - tDestroy).toFixed(3)),
      lost: lostReason
    };

    try {
      const again = await acquire(null);
      if (again.adapter) {
        const d2 = await again.adapter.requestDevice();
        const c2 = await runCompute(d2, 5);
        d2.destroy();
        result.repeat = {
          adapterAvailable: true,
          outputCorrect: c2.outputCorrect,
          coldDispatchMs: c2.coldDispatchMs,
          warmP50Ms: c2.warmDispatchMs.p50
        };
        result.repeatable = c2.outputCorrect === true;
      } else {
        result.repeat = { adapterAvailable: false };
        result.repeatable = false;
      }
    } catch (e) {
      result.repeat = { error: errObj(e) };
      result.repeatable = false;
    }

    result.conclusion = result.computeRan && result.repeatable
      ? 'WebGPU fully functional in this context'
      : 'WebGPU partially functional in this context - see fields';
  } catch (e) {
    result.error = errObj(e);
    result.conclusion = 'probe threw';
  } finally {
    result.finishedAt = new Date().toISOString();
  }

  return result;
}

async function reportProbe(collectorBase, contextName) {
  let payload;
  try {
    payload = await pratibimbWebGPUProbe(contextName);
  } catch (e) {
    payload = { context: contextName, fatal: errObj(e) };
  }
  try {
    await fetch(collectorBase + '/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    // Last resort: the collector may be down. Log so it appears in the Chrome log.
    console.error('[S-01] failed to POST result', contextName, e);
  }
  return payload;
}

if (typeof self !== 'undefined') {
  self.pratibimbWebGPUProbe = pratibimbWebGPUProbe;
  self.reportProbe = reportProbe;
}
