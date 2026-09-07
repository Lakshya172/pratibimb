# S-02a — commands and raw output

All commands run **inside the WSL2 Ubuntu 26.04 guest**, 2026-09-07.

## 1. Firefox — Mozilla official build, deliberately not apt

Ubuntu 26.04's `firefox` package is `1:1snap1-0ubuntu8`, a **snap transitional stub** that
does not work well under WSL2. The official linux64 tarball was used instead:

```bash
wget -q -O /tmp/firefox.tar.xz "https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US"
tar -C /opt -xJf /tmp/firefox.tar.xz
/opt/firefox/firefox --version
# Mozilla Firefox 155.0.1
```

**Same version as the Windows S-02 cell**, which makes the comparison a platform comparison
rather than a version comparison.

## 2. GPU state — the measurement §8 requires be kept separate

```bash
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
# NVIDIA GeForce RTX 5050 Laptop GPU, 8151 MiB, 592.82      <- CUDA COMPUTE path

ls /dev/dri                               # No such file or directory
vulkaninfo --summary | grep -c "GPU id"   # 0
DISPLAY=:0 glxinfo -B | grep "OpenGL renderer"
# OpenGL renderer string: llvmpipe (LLVM 21.1.8, 256 bits)  <- SOFTWARE graphics
```

**`nvidia-smi` working is not evidence that Firefox WebGPU is hardware-backed.** In this
guest the graphics stack has no hardware path at all.

## 3. The three variants, in the order fixed before any data existed

```bash
cd /root/spikes/s02
export DISPLAY=:0
RUNS=3 node run-s02a-linux.js     # -> results-linux.json
```

### Variant 1 — `defaults-headful` (no preference touched)

```
{ "liveness": true, "timedOut": false, "summary": [
  "ordinary-web-page-CONTROL: gpu=false adapter=false device=false correct=undefined",
  "firefox-mv3-event-page:   gpu=false adapter=false device=false correct=undefined" ] }
```
Identical in runs 1, 2 and 3. Probe conclusion in both contexts:
`navigator.gpu ABSENT in this context`.

### Variant 2 — `defaults-headless` (no preference touched)

Identical to variant 1 in all three runs. `gpu=false` everywhere.

### Variant 3 — `webgpu-forced-headful` (`dom.webgpu.enabled=true`)

```
{ "liveness": true, "timedOut": false, "summary": [
  "ordinary-web-page-CONTROL: gpu=true adapter=true device=true correct=true",
  "firefox-mv3-event-page:   gpu=true adapter=true device=true correct=true" ] }
```

Detail, event page, all three runs:

```
gpu=True adapter=True device=True fallback=None
adapterInfo: {"vendor": "", "architecture": "", "device": "", "description": ""}
correct=True mismatches=0 cold=93..102ms p50=101ms uncaptured=0
reacquire: {"adapterAvailable": true, "deviceCreated": true}
```

**`adapterInfo` is empty and `isFallbackAdapter` is null** — Firefox does not expose the
adapter, so the backend cannot be identified from inside the page.

## 4. Why the liveness beacon exists

Firefox MV3 gates `host_permissions` behind user-granted origin controls, so the extension's
`fetch` to the collector is refused. The probe therefore reports through a tab-navigation
beacon carrying the full payload, and fires a `/alive` beacon **first**. That distinction
matters: **"the event page never ran" and "the event page ran and found no adapter" are
completely different results**, and at defaults the result is the latter — `liveness: true`
in every run, with `gpu=false` reported.

This affects **reporting only**, never what is measured.

## Cleanup and data

Fresh temporary profile per run, deleted afterwards. Payload is a synthetic `Int32Array` of
`i % 1024` verified against a CPU reference. **No PII, no secrets, no credentials.** The
harness contacts no host other than `127.0.0.1:8903`.
