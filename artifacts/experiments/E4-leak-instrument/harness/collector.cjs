/**
 * E4 loopback collector — the GROUND TRUTH, derived from B-02's.
 *
 * Source: `artifacts/experiments/W1-B02-invariant-e-observation/harness/collector.js` (B-02,
 * recorded on workstation 2). That file is historical evidence and is NOT edited.
 *
 * WHAT IS IDENTICAL: the transport (a Node `http` server bound to 127.0.0.1 only), the body
 * accumulation, the SHA-256 recomputed over the bytes that actually arrived, and the declared-hash
 * and correlation-id headers.
 *
 * WHAT IS ADDED, and why it is the only addition: B-02 answered "did bytes arrive, and do they equal
 * a declared hash?", so it kept a hash and discarded the bytes. E4 must ask "do the arrived bytes
 * contain a canary?", which needs the bytes. So each arrival also keeps the request line, the raw
 * header list and the body. Nothing else changes, and the scanner never sees anything the collector
 * did not receive.
 *
 * Throwaway experiment code. 127.0.0.1 only. Never shipped.
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
        // ── E4 addition: the received bytes themselves ──
        rawHeaders: req.rawHeaders.slice(),
        body,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r({ server, arrivals })));
}
module.exports = { start };
