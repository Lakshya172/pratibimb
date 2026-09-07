/**
 * B-02 probe, offscreen document.
 *
 * Models the shape of the real design without being product code:
 *   egressSend()  - stands in for THE single egress module. Hashes the exact bytes it
 *                   is about to send, and declares that hash on the request.
 *   rogueSend()   - stands in for an unauthorised sender that bypasses the egress
 *                   module entirely. Mechanism C must be able to detect this.
 *   tamperSend()  - declares one hash and sends different bytes. Mechanism E must
 *                   catch the mismatch.
 *
 * Throwaway spike code. Loopback only. Never shipped.
 */
const BASE = "http://127.0.0.1:8902";
const auditLog = [];

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function payloadBytes(marker) {
  // Deterministic synthetic payload. No PII, no real data.
  return new TextEncoder().encode(JSON.stringify({ marker, frame: "SYNTHETIC", n: 4242 }));
}

// --- the single egress module (authorised path) --------------------------------
async function egressSend(correlationId) {
  const bytes = payloadBytes("authorised");
  const hash = await sha256Hex(bytes);
  auditLog.push({ path: "egress", correlationId, declaredHash: hash, at: Date.now() });
  const r = await fetch(`${BASE}/egress`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-pratibimb-correlation-id": correlationId,
      "x-pratibimb-payload-sha256": hash
    },
    body: bytes
  });
  return { path: "egress", status: r.status, declaredHash: hash, sentLength: bytes.length };
}

// --- an unauthorised sender that never went through the egress module ----------
async function rogueSend(correlationId) {
  const bytes = payloadBytes("unauthorised");
  // Deliberately declares nothing: no correlation id, no hash. This is what a
  // component calling fetch() directly would look like on the wire.
  const r = await fetch(`${BASE}/rogue`, { method: "POST", body: bytes });
  return { path: "rogue", status: r.status, sentLength: bytes.length };
}

// --- declares one hash, sends different bytes ----------------------------------
async function tamperSend(correlationId) {
  const verified = payloadBytes("authorised");
  const hash = await sha256Hex(verified);           // hash of the VERIFIED artifact
  const mutated = payloadBytes("authorised-MUTATED"); // but send something else
  auditLog.push({ path: "tamper", correlationId, declaredHash: hash, at: Date.now() });
  const r = await fetch(`${BASE}/egress`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-pratibimb-correlation-id": correlationId,
      "x-pratibimb-payload-sha256": hash
    },
    body: mutated
  });
  return { path: "tamper", status: r.status, declaredHash: hash, sentLength: mutated.length };
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "b02-go") return;
  const s = msg.scenario || {};
  const cid = s.correlationId || "cid-unknown";
  const run = async () => {
    const out = { correlationId: cid, sends: [] };
    const push = async (fn) => {
      try { out.sends.push(await fn(cid)); }
      catch (e) { out.sends.push({ path: fn.name, ok: false, error: String(e).slice(0, 160) }); }
    };
    if (s.egress) await push(egressSend);
    if (s.rogue) await push(rogueSend);
    if (s.tamper) await push(tamperSend);
    out.auditLog = auditLog.slice();
    return out;
  };
  run().then((result) => chrome.runtime.sendMessage({ type: "b02-result", result }));
});
