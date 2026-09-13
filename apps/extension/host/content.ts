/**
 * Minimal host — content script (isolated world). Loopback test pages only.
 *
 * It accepts commands ONLY from this extension's own service worker (`sender.id` is ours and there
 * is no tab). It installs no `window.postMessage` listener and writes nothing into the page, so a
 * page has no way to command it. Reads only what a content script may read: role, accessible name,
 * geometry, enabled, CSS visibility.
 */
import type { ToContent } from "../host-lib/messages";

export default defineContentScript({
  matches: ["http://127.0.0.1/*"],
  runAt: "document_idle",
  main() {
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
      const msg = raw as ToContent;
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

    void chrome.runtime.sendMessage({ kind: "HELLO" });
  },
});
