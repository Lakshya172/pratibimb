/**
 * B-02 independent loopback collector — the GROUND TRUTH.
 *
 * Deliberately knows nothing about Playwright or CDP. It records what actually
 * arrived on the wire and recomputes the SHA-256 of the received body, so a
 * declared hash can be checked against the bytes that were really transmitted.
 *
 * Throwaway spike code. 127.0.0.1 only. Never shipped.
 */
const http = require("http");
const crypto = require("crypto");

function start(port) {
  const arrivals = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const actualHash = crypto.createHash("sha256").update(body).digest("hex");
      const declaredHash = req.headers["x-pratibimb-payload-sha256"] || null;
      arrivals.push({
        at: Date.now(),
        method: req.method,
        url: req.url,
        bytes: body.length,
        correlationId: req.headers["x-pratibimb-correlation-id"] || null,
        declaredHash,
        actualHash,
        hashMatches: declaredHash ? declaredHash === actualHash : null,
        declaredAtAll: Boolean(declaredHash),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r({ server, arrivals })));
}
module.exports = { start };
