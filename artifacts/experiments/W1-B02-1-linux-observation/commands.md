# B-02-1 — commands and raw output

All commands run **inside the WSL2 Ubuntu 26.04 guest** on 2026-09-07, as `root`.
The Windows host is only the machine WSL2 runs on; no Windows browser was involved.

## 1. Provision the Linux guest

`harness/wslinstall.sh` — apt packages, Firefox (used by S-02a, not here), and Chrome for
Testing 153.0.8010.12 headful + headless-shell from Google's official bucket. Playwright's
own browser CDN returns **HTTP 400** on this network, which is why the build it names is
fetched directly.

```bash
node --version   # v22.22.1
/opt/chrome-linux64/chrome --version   # Google Chrome for Testing 153.0.8010.12
```

## 2. GPU state — recorded because it is easy to misread

```bash
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
# NVIDIA GeForce RTX 5050 Laptop GPU, 8151 MiB, 592.82

ls /dev/dri            # No such file or directory
ls -la /dev/dxg        # crw-rw-rw- 10, 258
vulkaninfo --summary | grep -c "GPU id"   # 0
DISPLAY=:0 glxinfo -B | grep "OpenGL renderer"
# OpenGL renderer string: llvmpipe (LLVM 21.1.8, 256 bits)
```

**CUDA compute works; graphics is software-only.** B-02-1 needs neither.

## 3. The matrix

```bash
cd /root/spikes/b02
RUNS=5 node run-b02-linux.js     # -> results-linux.json
```

56 runs. Every line of raw output is in `logs/results-linux.json`. Summary:

```
case                      mode      mechanism           ground truth              falseGreen
A-authorised              headful   OBSERVED            GROUND_TRUTH_ARRIVED      False  x3
B-unauthorised            headful   OBSERVED            GROUND_TRUTH_ARRIVED      False  x3
C-tampered                headful   OBSERVED            GROUND_TRUTH_ARRIVED      False  x3
D-playwright-enforcing    headful   NOT_OBSERVED        GROUND_TRUTH_ARRIVED      True   x3
E-cdp-enforcing           headful   BLOCKED_CONFIRMED   GROUND_TRUTH_NO_ARRIVAL   False  x3
A-authorised              headless  OBSERVED            GROUND_TRUTH_ARRIVED      False  x3
B-unauthorised            headless  OBSERVED            GROUND_TRUTH_ARRIVED      False  x3
C-tampered                headless  OBSERVED            GROUND_TRUTH_ARRIVED      False  x3
D-playwright-enforcing    headless  NOT_OBSERVED        GROUND_TRUTH_ARRIVED      True   x3
E-cdp-enforcing           headless  BLOCKED_CONFIRMED   GROUND_TRUTH_NO_ARRIVAL   False  x3
race-no-attach            headful   NOT_OBSERVABLE      GROUND_TRUTH_ARRIVED      False  x5
race-late-attach          headful   NOT_OBSERVED        GROUND_TRUTH_ARRIVED      True   x5
race-auto-attach          headful   BLOCKED_CONFIRMED   GROUND_TRUTH_NO_ARRIVAL   False  x5
race-no-attach            headless  NOT_OBSERVABLE      GROUND_TRUTH_ARRIVED      False  x5
race-late-attach          headless  NOT_OBSERVED        GROUND_TRUTH_ARRIVED      True   x5
race-auto-attach          headless  BLOCKED_CONFIRMED   GROUND_TRUTH_NO_ARRIVAL   False  x5
fail-cdp-endpoint         headless  NOT_OBSERVABLE      GROUND_TRUTH_NO_ARRIVAL   False  x3
fail-fetch-enable         headless  NOT_OBSERVED        GROUND_TRUTH_ARRIVED      True   x3
```

### The three lines that carry the result

- **`D-playwright-enforcing`** — Playwright told to abort everything. It blocked nothing and
  the payload arrived, headful and headless. Same as Windows.
- **`race-late-attach` vs `race-auto-attach`** — the race is real on Linux (false green 10/10)
  and `setAutoAttach` + `waitForDebuggerOnStart` closes it (10/10).
- **`fail-fetch-enable`** — the important one. Attachment succeeded, `Fetch.enable` was
  skipped, and the mechanism reported **nothing** while the payload **shipped**. **CDP fails
  OPEN under partial instrumentation failure.** Only the collector caught it.

Collector detail, identical in both display modes:

```
B-unauthorised  [{"url":"/rogue",  "bytes":54, "declared":false, "hashMatches":null }]
C-tampered      [{"url":"/egress", "bytes":60, "declared":true,  "hashMatches":false}]
```

Auto-attached target types: `browser_ui, browser_ui, page, service_worker, other` — the
offscreen document arrives as `other`.

## 4. CI equivalence — what was actually checked

```bash
grep runs-on .github/workflows/ci.yml      # ubuntu-latest
gh run view <id> --log | grep "Image:"     # Image: ubuntu-24.04
```

This experiment ran on **Ubuntu 26.04 under WSL2**. **Not the same cell.** Recorded as
CI-relevant evidence; the CI result itself is `UNKNOWN`.

## Cleanup and data

Browser profiles are created under the guest's temp directory and deleted after each run.
Payloads are synthetic and deterministic. **No PII, no secrets, no credentials.** The harness
contacts no host other than `127.0.0.1:8902` and CDP on `127.0.0.1:9446`.
