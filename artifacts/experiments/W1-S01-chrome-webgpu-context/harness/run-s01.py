#!/usr/bin/env python3
"""
S-01 runner. THROWAWAY SPIKE CODE.

Launches a real, headful Chrome with a throwaway user-data-dir and the probe extension
loaded unpacked, waits for all four contexts to report, then records the environment.

HEADFUL ON PURPOSE. Headless Chrome and CI runners fall back to a software adapter,
which answers a different question from the one S-01 asks. The user-data-dir is created
outside the repository so no browser profile is ever committed.
"""
from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
EXT = HERE / "extension"
PORT = 8899
CDP_PORT = 9333
TIMEOUT_S = 150

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome() -> str:
    for c in CHROME_CANDIDATES:
        if c and Path(c).is_file():
            return c
    raise SystemExit("Chrome not found. Edit CHROME_CANDIDATES.")


def chrome_version(path: str) -> str:
    if platform.system() == "Windows":
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 f"(Get-Item '{path}').VersionInfo.ProductVersion"],
                capture_output=True, text=True, timeout=30)
            return out.stdout.strip()
        except Exception:  # noqa: BLE001
            return "unknown"
    try:
        return subprocess.run([path, "--version"], capture_output=True,
                              text=True, timeout=30).stdout.strip()
    except Exception:  # noqa: BLE001
        return "unknown"


def gpu_inventory() -> dict:
    info: dict = {}
    try:
        out = subprocess.run(
            ["nvidia-smi",
             "--query-gpu=name,memory.total,driver_version",
             "--format=csv,noheader"],
            capture_output=True, text=True, timeout=30)
        info["nvidia_smi"] = out.stdout.strip() or None
    except Exception as exc:  # noqa: BLE001
        info["nvidia_smi"] = f"unavailable: {exc}"
    if platform.system() == "Windows":
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "Get-CimInstance Win32_VideoController | "
                 "Select-Object Name,DriverVersion,AdapterRAM | ConvertTo-Json -Compress"],
                capture_output=True, text=True, timeout=60)
            info["win32_videocontroller"] = json.loads(out.stdout) if out.stdout.strip() else None
        except Exception as exc:  # noqa: BLE001
            info["win32_videocontroller"] = f"unavailable: {exc}"
    return info



def cdp_load_extension_and_open_control(env: dict) -> str | None:
    """Load the unpacked extension over CDP, then open the control page.

    Returns the extension id, or None if loading failed. A None here must abort the
    run: a missing extension is indistinguishable, from the collector's point of
    view, from an extension whose contexts have no WebGPU.
    """
    import asyncio
    import urllib.request

    import websockets

    ws_url = None
    for _ in range(60):
        try:
            v = json.load(urllib.request.urlopen(
                f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=2))
            ws_url = v["webSocketDebuggerUrl"]
            env["browser"]["cdp_browser_string"] = v.get("Browser")
            env["browser"]["user_agent"] = v.get("User-Agent")
            env["browser"]["v8_version"] = v.get("V8-Version")
            env["browser"]["webkit_version"] = v.get("WebKit-Version")
            break
        except Exception:  # noqa: BLE001
            time.sleep(0.5)
    if not ws_url:
        print("[run] CDP endpoint never came up")
        return None

    async def go() -> str | None:
        async with websockets.connect(ws_url, max_size=None) as ws:
            await ws.send(json.dumps({
                "id": 1, "method": "Extensions.loadUnpacked",
                "params": {"path": str(EXT)}}))
            ext = None
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                if msg.get("id") == 1:
                    if "error" in msg:
                        print(f"[run] loadUnpacked error: {msg['error']}")
                        return None
                    ext = msg["result"]["id"]
                    break
            # Give the service worker a moment to install, then open the control page.
            await asyncio.sleep(2.0)
            await ws.send(json.dumps({
                "id": 2, "method": "Target.createTarget",
                "params": {"url": f"http://127.0.0.1:{PORT}/control"}}))
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                if msg.get("id") == 2:
                    break
            return ext

    try:
        return asyncio.run(go())
    except Exception as exc:  # noqa: BLE001
        print(f"[run] CDP failure: {exc}")
        return None


def main() -> int:
    chrome = find_chrome()
    ver = chrome_version(chrome)
    profile = Path(tempfile.mkdtemp(prefix="pratibimb-s01-chrome-"))

    env = {
        "experiment": "W1-S01-chrome-webgpu-context",
        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "host": {
            "os": f"{platform.system()} {platform.release()}",
            "os_version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "python": platform.python_version(),
        },
        "browser": {
            "name": "Google Chrome",
            "executable": chrome,
            "product_version": ver,
            "channel": "stable (assumed from default install path) - INFERENCE",
            "mode": "headful",
            "user_data_dir": str(profile) + "  (throwaway, outside the repository)",
        },
        "extension": {
            "manifest_version": 3,
            "path": str(EXT),
            "loaded": "unpacked via --load-extension",
            "offscreen_reason": "WORKERS",
        },
        "gpu": gpu_inventory(),
        "flags": [],
    }

    # HOW THE EXTENSION IS LOADED - and why not the obvious way.
    #
    # Chrome 152 stable REFUSES --load-extension outright:
    #   "WARNING ... extension_service.cc:423] --load-extension is not allowed in
    #    Google Chrome, ignoring."
    # and --disable-features=DisableLoadExtensionCommandLineSwitch does NOT restore
    # it in this build. The extension simply does not load, no error surfaces to the
    # harness, and every extension-context probe times out -- which would look
    # exactly like "WebGPU is unavailable in extension contexts". That false REJECT
    # is the single most dangerous failure mode of this experiment, so the loading
    # path is verified explicitly below (loadUnpacked returns the extension id).
    #
    # Supported path: the DevTools Protocol Extensions domain, unlocked by
    # --enable-unsafe-extension-debugging.
    args = [
        chrome,
        f"--user-data-dir={profile}",
        f"--remote-debugging-port={CDP_PORT}",
        "--enable-unsafe-extension-debugging",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "about:blank",
    ]
    env["flags"] = args[1:]
    env["extension"]["loaded"] = (
        "CDP Extensions.loadUnpacked (--load-extension is refused by Chrome 152 stable)"
    )
    (EXP / "environment.json").write_text(json.dumps(env, indent=2), encoding="utf-8")

    print(f"[run] chrome     : {chrome}")
    print(f"[run] version    : {ver}")
    print(f"[run] extension  : {EXT}")
    print(f"[run] profile    : {profile}")

    collector = subprocess.Popen(
        [sys.executable, str(HERE / "collector.py"), str(PORT),
         str(EXP / "results.json"), str(TIMEOUT_S)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    time.sleep(1.5)

    print("[run] launching Chrome (headful)...")
    browser = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    ext_id = cdp_load_extension_and_open_control(env)
    if not ext_id:
        print("[run] FATAL: extension did not load; aborting rather than reporting "
              "a false negative.")
        env["extension"]["load_failed"] = True
        (EXP / "environment.json").write_text(json.dumps(env, indent=2), encoding="utf-8")
    else:
        print(f"[run] extension id: {ext_id}")
        env["extension"]["id"] = ext_id
        (EXP / "environment.json").write_text(json.dumps(env, indent=2), encoding="utf-8")

    lines = []
    try:
        for line in collector.stdout:  # type: ignore[union-attr]
            line = line.rstrip()
            print(line)
            lines.append(line)
    finally:
        collector.wait(timeout=TIMEOUT_S + 30)
        try:
            browser.terminate()
            browser.wait(timeout=20)
        except Exception:  # noqa: BLE001
            browser.kill()
        # Chrome spawns children; make sure none survive to hold the profile dir.
        if platform.system() == "Windows":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(browser.pid)],
                           capture_output=True)
        time.sleep(1.5)
        shutil.rmtree(profile, ignore_errors=True)
        print(f"[run] profile removed: {not profile.exists()}")

    (EXP / "logs").mkdir(exist_ok=True)
    (EXP / "logs" / "runner.log").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return collector.returncode


if __name__ == "__main__":
    raise SystemExit(main())
