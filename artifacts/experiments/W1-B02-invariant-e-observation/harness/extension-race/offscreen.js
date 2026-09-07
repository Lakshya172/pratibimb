/**
 * RACE VARIANT — sends immediately on script load, before any message arrives.
 *
 * This is the adversarial shape for target-discovery: if an observation mechanism
 * attaches to the offscreen target only AFTER the document exists, the send has
 * already happened and the mechanism reports nothing. That silence must not be
 * read as "no request occurred" — the collector is what decides that.
 *
 * Throwaway spike code. Loopback only.
 */
const BASE = "http://127.0.0.1:8902";

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

(async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ marker: "race-immediate", frame: "SYNTHETIC", n: 4242 }));
  const hash = await sha256Hex(bytes);
  try {
    await fetch(`${BASE}/egress-immediate`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-pratibimb-correlation-id": "race-immediate",
        "x-pratibimb-payload-sha256": hash,
      },
      body: bytes,
    });
    chrome.runtime.sendMessage({ type: "b02-race-sent", ok: true }).catch(() => {});
  } catch (e) {
    chrome.runtime.sendMessage({ type: "b02-race-sent", ok: false, error: String(e).slice(0, 120) }).catch(() => {});
  }
})();
