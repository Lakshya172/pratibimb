# S-01 — exact reproduction

## Prerequisites

- Google Chrome (this run: **152.0.7977.82**, stable, Windows)
- Python 3.11+ with `websockets` (`pip install websockets`)
- A machine with a real GPU. **Do not run this on a CI runner or headless** — a software
  adapter answers a different question.

## Run

```bash
cd artifacts/experiments/W1-S01-chrome-webgpu-context/harness
python run-s01.py
```

Writes, one directory up:
- `environment.json` — machine, browser build, GPU inventory, extension id, exact flags
- `results.json` — raw probe records from all four contexts
- `logs/runner.log`

## Three repetitions, as reported

```bash
cd artifacts/experiments/W1-S01-chrome-webgpu-context/harness
for i in 1 2 3; do
  python run-s01.py
  cp ../results.json "../logs/results-run$i.json"
  sleep 2
done
```

Aggregate into `metrics.json` with the script in the PR description, or re-derive from the
three `logs/results-run*.json` files — they are the primary record.

## What the runner does

1. Starts `collector.py` on `127.0.0.1:8899` (serves the control page, receives results).
2. Launches **headful** Chrome with a throwaway `--user-data-dir` in the system temp
   directory, `--remote-debugging-port=9333` and `--enable-unsafe-extension-debugging`.
3. Loads `harness/extension/` over CDP via `Extensions.loadUnpacked`, **and aborts if no
   extension id comes back**.
4. Opens `http://127.0.0.1:8899/control` (the control page).
5. Waits for all four contexts to report, then terminates Chrome and deletes the profile.

## Why not `--load-extension`

Chrome 152 stable refuses it:

```
[WARNING:chrome\browser\extensions\extension_service.cc:423]
--load-extension is not allowed in Google Chrome, ignoring.
```

`--disable-features=DisableLoadExtensionCommandLineSwitch` does not restore it in this
build. Confirmed independently by inspecting the throwaway profile's
`Default/Preferences`, which listed **0 installed extensions**.

To reproduce that observation:

```bash
chrome.exe --user-data-dir=<tmp> --load-extension=<ext> \
           --enable-logging=stderr --v=0 about:blank 2> chrome-err.log
grep -i "load-extension" chrome-err.log
```

## Cleanup

The runner deletes its own Chrome profile. Nothing is written inside the repository except
the artifact files listed above. **No browser profile, capture, or personal data is ever
committed** — see `SECURITY.md`.
