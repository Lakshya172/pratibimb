/**
 * A minimal raw DevTools-protocol client that reaches the MV3 OFFSCREEN DOCUMENT and the extension's
 * service worker, which Playwright's BrowserContext does not surface as pages.
 *
 * An ESM port of the W1-B02 harness client (artifacts/experiments/W1-B02-invariant-e-observation/
 * harness/cdp.js): Node's built-in WebSocket, `/json/version` for the browser endpoint,
 * `Target.getTargets` to find the target, `Target.attachToTarget {flatten:true}`, then per-session
 * commands. Test-only; nothing here is part of the extension.
 */

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
  }

  /** Connect to the browser endpoint of a Chrome launched with `--remote-debugging-port=<port>`. */
  static async connect(port) {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((ok, fail) => {
      ws.onopen = ok;
      ws.onerror = () => fail(new Error("CDP WebSocket error"));
    });
    const c = new Cdp(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && c.pending.has(msg.id)) {
        const { ok, fail } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        if (msg.error) fail(new Error(JSON.stringify(msg.error)));
        else ok(msg.result);
      } else for (const h of c.handlers) h(msg);
    };
    return c;
  }

  on(fn) {
    this.handlers.push(fn);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((ok, fail) => {
      this.pending.set(id, { ok, fail });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          fail(new Error(`CDP timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  /** Attach to the first target whose type and url match; returns its flat session id. */
  async attach(match) {
    const { targetInfos } = await this.send("Target.getTargets");
    const t = targetInfos.find(match);
    if (!t) return null;
    const { sessionId } = await this.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    return { sessionId, target: { type: t.type, url: t.url } };
  }

  /**
   * Record every Network event of one session: each request, and how it ended (finished, failed,
   * blocked and why). The record carries URLs and outcomes, never bodies.
   */
  async recordNetwork(sessionId) {
    const requests = new Map();
    this.on((m) => {
      if (m.sessionId !== sessionId) return;
      const p = m.params ?? {};
      if (m.method === "Network.requestWillBeSent") requests.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type ?? null, outcome: "PENDING" });
      else if (m.method === "Network.responseReceived" && requests.has(p.requestId)) requests.get(p.requestId).status = p.response.status;
      else if (m.method === "Network.loadingFinished" && requests.has(p.requestId)) requests.get(p.requestId).outcome = "FINISHED";
      else if (m.method === "Network.loadingFailed" && requests.has(p.requestId)) Object.assign(requests.get(p.requestId), { outcome: "FAILED", errorText: p.errorText ?? null, blockedReason: p.blockedReason ?? null, corsError: p.corsErrorStatus?.corsError ?? null });
    });
    await this.send("Network.enable", {}, sessionId);
    return { all: () => [...requests.values()], since: (n) => [...requests.values()].slice(n) };
  }

  /** Evaluate an expression in a session; promises are awaited and the value is returned by value. */
  async evaluate(sessionId, expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) return { exception: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
    return r.result.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}
