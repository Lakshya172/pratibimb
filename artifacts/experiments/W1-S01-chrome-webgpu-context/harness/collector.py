#!/usr/bin/env python3
"""
S-01 result collector. THROWAWAY SPIKE CODE.

Binds 127.0.0.1 only. Receives probe results from the extension contexts and serves
the CONTROL page (an ordinary web page running the identical probe file, so that a
difference between page and extension is attributable to the context).

The control page is served the extension's own probe.js verbatim, so there is exactly
one copy of the probe logic in this experiment.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROBE_JS = HERE / "extension" / "probe.js"

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE.parent / "results.json"
TIMEOUT_S = int(sys.argv[3]) if len(sys.argv) > 3 else 120

RESULTS: list[dict] = []
LOGS: list[dict] = []
DONE = threading.Event()
LOCK = threading.Lock()

CONTROL_HTML = """<!doctype html>
<meta charset="utf-8"><title>S-01 control</title>
<body><pre id="o">running control probe...</pre>
<script src="/probe.js"></script>
<script>
(async () => {
  const r = await reportProbe('http://127.0.0.1:%d', 'ordinary-web-page-CONTROL');
  document.getElementById('o').textContent = JSON.stringify(r, null, 2);
  await fetch('/control-done', { method: 'POST' });
})();
</script></body>
""" % PORT


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def _send(self, code=200, body=b"", ctype="text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802
        self._send(204)

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/probe.js"):
            self._send(200, PROBE_JS.read_bytes(), "application/javascript; charset=utf-8")
        elif self.path.startswith("/control"):
            self._send(200, CONTROL_HTML.encode("utf-8"), "text/html; charset=utf-8")
        elif self.path.startswith("/status"):
            with LOCK:
                body = json.dumps({"results": len(RESULTS), "done": DONE.is_set()})
            self._send(200, body.encode(), "application/json")
        else:
            self._send(404, b"not found")

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        if self.path.startswith("/result"):
            try:
                payload = json.loads(raw.decode("utf-8"))
            except Exception as exc:  # noqa: BLE001
                payload = {"context": "UNPARSEABLE", "error": str(exc),
                           "raw": raw.decode("utf-8", "replace")[:2000]}
            with LOCK:
                RESULTS.append(payload)
            ctx = payload.get("context", "?")
            print(f"  [collector] result <- {ctx}"
                  f"  gpu={payload.get('navigatorGpuPresent')}"
                  f"  adapter={payload.get('adapterAvailable')}"
                  f"  device={payload.get('deviceCreated')}"
                  f"  compute={payload.get('computeRan')}", flush=True)
            self._send(200, b'{"ok":true}', "application/json")
        elif self.path.startswith("/log"):
            try:
                entry = json.loads(raw.decode("utf-8"))
            except Exception:  # noqa: BLE001
                entry = {"raw": raw.decode("utf-8", "replace")[:500]}
            with LOCK:
                LOGS.append(entry)
            print(f"  [collector] log    <- {entry.get('stage')}: "
                  f"{str(entry.get('detail'))[:120]}", flush=True)
            self._send(200, b'{"ok":true}', "application/json")
        elif self.path.startswith("/done") or self.path.startswith("/control-done"):
            with LOCK:
                have = {r.get("context") for r in RESULTS}
            # The run is complete once all four contexts have reported.
            expected = {"mv3-service-worker", "offscreen-document",
                        "offscreen-dedicated-worker", "ordinary-web-page-CONTROL"}
            if expected.issubset(have):
                DONE.set()
            self._send(200, b'{"ok":true}', "application/json")
        else:
            self._send(404, b"not found")

    def log_message(self, *_args):  # silence default access logging
        return


def main() -> int:
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    print(f"[collector] listening on http://127.0.0.1:{PORT} "
          f"(timeout {TIMEOUT_S}s)", flush=True)

    deadline = time.time() + TIMEOUT_S
    while time.time() < deadline and not DONE.is_set():
        time.sleep(0.25)

    srv.shutdown()
    with LOCK:
        payload = {
            "collected_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "complete": DONE.is_set(),
            "timed_out": not DONE.is_set(),
            "logs": LOGS,
            "results": RESULTS,
        }
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[collector] wrote {OUT} ({len(RESULTS)} result(s), "
          f"complete={DONE.is_set()})", flush=True)
    return 0 if DONE.is_set() else 2


if __name__ == "__main__":
    raise SystemExit(main())
