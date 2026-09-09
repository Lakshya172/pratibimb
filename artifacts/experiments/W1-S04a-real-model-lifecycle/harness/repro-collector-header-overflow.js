// Minimal reproduction of the S-04a Firefox collector failure.
// Exactly the collector's shape: http.createServer() with default options,
// GET /sink?d=<urlencoded payload>. One server per size.
const http = require("http");

function trial(port, payloadBytes, opts) {
  return new Promise((resolve) => {
    let handlerRan = false;
    const server = http.createServer(opts || {}, (req, res) => {
      handlerRan = true;
      res.writeHead(200); res.end("ok");
    });
    server.on("clientError", (err, sock) => {
      try { sock.destroy(); } catch {}
      resolve({ payloadBytes, handlerRan, clientError: err.code || err.message });
      try { server.close(); } catch {}
    });
    server.listen(port, "127.0.0.1", () => {
      const url = "/sink?d=" + "x".repeat(payloadBytes);
      const req = http.request({ host: "127.0.0.1", port, path: url, method: "GET" }, (res) => {
        res.resume();
        res.on("end", () => { resolve({ payloadBytes, handlerRan, status: res.statusCode }); server.close(); });
      });
      req.on("error", (e) => { resolve({ payloadBytes, handlerRan, reqError: e.code || e.message }); try { server.close(); } catch {} });
      req.end();
    });
  });
}

(async () => {
  console.log("node", process.version, "http.maxHeaderSize =", http.maxHeaderSize);
  console.log("\n-- DEFAULT server options (what the S-04a collector used) --");
  for (const n of [1500, 16000, 80000, 160000]) console.log(JSON.stringify(await trial(9301 + n % 97, n)));
  console.log("\n-- WITH maxHeaderSize: 2,000,000 (the fix) --");
  for (const n of [1500, 16000, 80000, 160000]) console.log(JSON.stringify(await trial(9501 + n % 97, n, { maxHeaderSize: 2000000 })));
})();
