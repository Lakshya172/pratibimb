/**
 * Minimal host — content script (isolated world). Loopback test pages only.
 *
 * It accepts commands ONLY from this extension's own service worker (`sender.id` is ours and there
 * is no tab). It installs no `window.postMessage` listener and writes nothing into the page, so a
 * page has no way to command it. Reads only what a content script may read: role, accessible name,
 * geometry, enabled, CSS visibility.
 */
import { createPageAgent } from "@pratibimb/extension-transport";

import { type BoundaryReply, type BoundaryRequest, type CapabilityPayload } from "../host-lib/boundary-protocol";
import { createPagePrivacyBoundary, type PagePrivacyBoundary } from "../host-lib/page-privacy-boundary";
import type { ToContent } from "../host-lib/messages";
import { clickOn, typeInto, type ClickMechanism, type TypeMechanism } from "../host-lib/e6-mechanisms";
import { domPageSurface } from "../host-lib/page-surface-dom";
import { connectPageTransport } from "../host-lib/transport-chrome";

/**
 * Serve one request from the core realm.
 *
 * `CLASSIFY` and `FORGET` are answered directly: neither carries anything secret in either
 * direction. `CAPABILITY` is different — it says only that something is waiting, so this world goes
 * and collects it, and the collection is a **reply**, which is the one direction in MV3 the service
 * worker does not see. Whatever the capability held never appears in a message at all.
 */
async function serveBoundary(boundary: PagePrivacyBoundary, request: BoundaryRequest): Promise<BoundaryReply> {
  if (request.kind === "CLASSIFY") return boundary.classify(request.ask);
  if (request.kind === "FORGET") return boundary.forget();

  const collected = (await chrome.runtime.sendMessage({
    target: "offscreen",
    kind: "BOUNDARY_COLLECT",
    nonce: request.nonce,
    field: request.target,
  })) as { released?: boolean; payload?: CapabilityPayload; refused?: string } | undefined;

  if (collected?.released !== true || collected.payload === undefined) {
    return { ok: false, refused: collected?.refused ?? "NO_RESPONSE" };
  }
  const payload = collected.payload;
  return payload.kind === "QUESTION" ? boundary.answer(payload.texts) : boundary.release(payload.ask);
}

export default defineContentScript({
  matches: ["http://127.0.0.1/*"],
  runAt: "document_idle",
  main() {
    /**
     * HOW MANY TIMES THIS RAN IN THIS DOCUMENT.
     *
     * Content scripts for one document share one isolated-world global, so a second injection is
     * visible here and nowhere else. It is recorded because "two of everything" is the first thing
     * a duplicate-action symptom should be checked against, and the check has to be able to come
     * back negative — an instance count that is always 1 is evidence, not decoration.
     */
    const world = globalThis as unknown as { __pratibimbInstances?: number };
    world.__pratibimbInstances = (world.__pratibimbInstances ?? 0) + 1;
    /** E6's click mechanism is the other code path in this world that can dispatch at a page. */
    let e6Clicks = 0;

    /**
     * THE PRIVACY BOUNDARY LIVES HERE, because the page's values do.
     *
     * One per document. It opens a vault per run, destroys it when the run ends, and nothing it
     * sends upward has ever contained a value — the last check before any reply leaves is the vault
     * being asked whether it recognises the reply itself.
     */
    const privacy = createPagePrivacyBoundary();

    const measure = () =>
      Array.from(document.querySelectorAll("a, button, input, select, textarea, label, [role]")).map((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
          name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 60),
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          cssHidden: s.display === "none" || s.visibility === "hidden" || r.width === 0 || r.height === 0,
        };
      });

    chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || sender.tab) {
        sendResponse({ refused: "SENDER_NOT_ACCEPTED" });
        return false;
      }
      const msg = raw as ToContent | { kind: "E6_TYPE"; mechanism: TypeMechanism; selector: string; nonce: string } | { kind: "E6_CLICK"; mechanism: ClickMechanism; selector: string } | { kind: "BOUNDARY"; body: BoundaryRequest };
      /**
       * M1 — THE AUTHORISED LOCAL WRITE.
       *
       * The worker has just said that a capability is waiting. It did not say what the value is, and
       * this message does not contain one. So this world goes and asks the core realm directly, and
       * the answer to that question comes back to this content script and to nobody else.
       *
       * What is written here has already been through every gate: the privacy layer released it for
       * this reference, a human approved it for this field on this page, and the capability names
       * this exact document. This world checks none of that — it could not, and pretending otherwise
       * would put an authority in the least defensible place in the system. It checks only that the
       * target is a field it can write, writes once, and reports booleans.
       *
       * THIS IS NOT AN AGENT ACTION. No permit, no hit test, no pointer, nothing dispatched. It is
       * the trusted client restoring a value the user already owns, which is why there is no TYPE in
       * `EXECUTABLE_ACTIONS` and why this path cannot be reached by a plan on its own.
       */
      if (msg.kind === "BOUNDARY") {
        void serveBoundary(privacy, msg.body).then(sendResponse, (error: unknown) =>
          sendResponse({ ok: false, refused: error instanceof Error ? error.message.slice(0, 120) : "BOUNDARY_THREW" })
        );
        return true;
      }
      if (msg.kind === "E6_TYPE") {
        // EXPERIMENT E6. Fetch the value from the offscreen document against a nonce armed for THIS
        // tab/frame/document, insert it, and report booleans and timings — never the value itself.
        void (async () => {
          const el = document.querySelector(msg.selector);
          if (!(el instanceof HTMLInputElement)) return sendResponse({ ok: false, error: "NO_INPUT" });
          const t0 = performance.now();
          const release = (await chrome.runtime.sendMessage({ target: "offscreen", kind: "E6_RELEASE", nonce: msg.nonce, target2: msg.selector })) as { value?: string; refused?: string };
          const fetchMs = performance.now() - t0;
          if (typeof release?.value !== "string") return sendResponse({ ok: false, released: false, refused: release?.refused ?? "NO_RESPONSE", fetchMs });
          let value: string | null = release.value;
          const t1 = performance.now();
          let error: string | null = null;
          try {
            typeInto(el, value, msg.mechanism);
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          }
          const insertMs = performance.now() - t1;
          const valueEqualsReleased = el.value === value;
          const finalLength = el.value.length;
          value = null; // drop the only reference this world held
          sendResponse({ ok: error === null, released: true, error, fetchMs, insertMs, valueEqualsReleased, finalLength, focusMoved: document.activeElement === el });
        })();
        return true;
      }
      if (msg.kind === "DISPATCH_AUDIT") {
        sendResponse({
          ok: true,
          instances: world.__pratibimbInstances ?? 0,
          e6Clicks,
          transport: agent.audit(),
        });
        return false;
      }
      if (msg.kind === "E6_CLICK") {
        e6Clicks += 1;
        const el = document.querySelector(msg.selector);
        if (!(el instanceof HTMLElement)) {
          sendResponse({ ok: false, error: "NO_ELEMENT" });
          return false;
        }
        try {
          sendResponse({ ok: true, ...clickOn(el, msg.mechanism) });
        } catch (e) {
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return false;
      }
      if (msg.kind === "MEASURE") {
        sendResponse({ elements: measure() });
        return false;
      }
      if (msg.kind === "ROUNDTRIP") {
        void (async () => {
          const samples: number[] = [];
          let last: unknown = null;
          for (let i = 0; i < Math.min(Math.max(1, msg.samples), 200); i += 1) {
            const t0 = performance.now();
            last = await chrome.runtime.sendMessage({ kind: "RELAY_ECHO", sentAt: Date.now() });
            samples.push(performance.now() - t0);
          }
          sendResponse({ samples, last });
        })();
        return true;
      }
      sendResponse({ refused: "UNKNOWN_KIND" });
      return false;
    });

    // EXPERIMENT D-E6-4: the page transport. One agent per document, so the cycles this document has
    // answered stay with it across a service-worker restart — and the port carries the browser's
    // attestation of which document that is. It answers hit tests, one dispatch per cycle at the
    // exact authorised point, and observations. It has no selector to click and no page-facing input.
    const agent = createPageAgent(domPageSurface);
    connectPageTransport(agent);

    void chrome.runtime.sendMessage({ kind: "HELLO" });
  },
});
