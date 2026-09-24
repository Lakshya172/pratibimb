/**
 * Minimal host — service worker. Creates the offscreen document and routes messages.
 *
 * Holds NO values and NO secrets: MV3 terminates an idle service worker, so anything kept here is
 * lost on termination by design. `bootId` exists only so an evidence run can tell whether this
 * worker was restarted.
 */
import { createServiceWorkerRouter, relayRefused, TRANSPORT_CHANNEL, TRANSPORT_PORT_NAME } from "@pratibimb/extension-transport";

import { createCaptureAuthority } from "../host-lib/capture-authority";
import { identityOf, isFromContentScript, isFromExtensionPage, type SenderIdentity, type ToSw } from "../host-lib/messages";
import { adaptPort, isFromOffscreenDocument } from "../host-lib/transport-chrome";

export default defineBackground(() => {
  const bootId = crypto.randomUUID();
  /**
   * EXPERIMENT D-E6-4: the page transport's router. Stateless — it holds no permit, no value and no
   * decision, and adds only the browser's attestation of which document answered. `bootId` is what
   * ties a delivery to the worker that relayed its hit test, so a restart cannot finish an
   * interrupted attempt.
   */
  const transport = createServiceWorkerRouter({ bootId });
  const bootedAt = Date.now();
  const hellos: { at: number; identity: SenderIdentity }[] = [];
  /**
   * M3.1 — THE CAPTURE AUTHORITY.
   *
   * `activeTab` is granted by an invocation and by nothing else: a toolbar click, a context menu
   * item, a keyboard command. It is the browser's way of saying a PERSON pointed at this tab, and
   * it is the only grant that lets this extension mint a capture handle without asking for every
   * origin. Measured on W1: `<all_urls>` does not substitute for it, a click inside an extension
   * page does not, and a keyboard command dispatched over CDP does not reach Chrome at all.
   *
   * With a grant, `getMediaStreamId` returns an opaque handle and the offscreen document turns it
   * into pixels itself. **This context never holds a frame on that path.** Without one it refuses,
   * unless the build explicitly enabled the degraded worker path for an evidence run.
   */
  const capture = createCaptureAuthority({
    browser: {
      getMediaStreamId: (o) => chrome.tabCapture.getMediaStreamId(o),
      // ABSENT in a product build. `__M3_WORKER_FRAME__` is substituted at build time, so the
      // bundler drops this property and every reference to `captureVisibleTab` with it -- the
      // degraded path is not in the artifact, rather than in it and refused.
      ...(__M3_WORKER_FRAME__ ? { captureVisibleTab: (o: { format: "png" }) => chrome.tabs.captureVisibleTab(o) } : {}),
    },
    grantTtlMs: 5 * 60_000,
  });
  chrome.action?.onClicked.addListener((tab) => {
    if (typeof tab.id === "number") capture.grant(tab.id);
  });
  /**
   * A GRANT BELONGS TO A DOCUMENT, NOT TO A TAB NUMBER.
   *
   * Chrome revokes `activeTab` the moment the tab navigates, so a person who authorised one page
   * has not authorised the next one to load in the same tab. Mirroring that here keeps the
   * authority's answer the same as the browser's: a refusal after a reload says
   * NO_ACTIVE_TAB_GRANT, which is true, rather than minting and collecting a confusing
   * MINT_FAILED from Chrome.
   *
   * `status === "loading"` needs no `tabs` permission; only `url` and `title` are gated.
   */
  chrome.tabs?.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") capture.revoke(tabId, "NAVIGATION");
  });
  chrome.tabs?.onRemoved.addListener((tabId) => capture.revoke(tabId, "TAB_CLOSED"));

  /**
   * TEST-ONLY: everything this worker actually saw.
   *
   * The claim "no page value crosses the service worker" is worth very little as a reading of the
   * code and a great deal as a recording of the traffic. So every message delivered to this
   * context's listeners, every message it sends to a tab, and every frame on a transport port is
   * kept here, and an evidence run scans the lot against the fixture's own values. If a value ever
   * crossed, it is in this list — which is the point: the worker is being asked to incriminate
   * itself, and the test passes only when it cannot.
   *
   * Bounded, in memory, reachable only through the DevTools protocol, and gone when MV3 terminates
   * this worker. No page can read it.
   */
  const seen: { at: number; way: "in" | "to-tab" | "port"; message: unknown }[] = [];
  const note = (way: "in" | "to-tab" | "port", message: unknown): void => {
    if (seen.length < 2_000) seen.push({ at: Date.now(), way, message });
  };

  async function ensureOffscreen(): Promise<number> {
    const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (existing.length === 0) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: "PratiBimb minimal host: ORT inference and the synthetic vault stub",
      });
    }
    return (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length;
  }

  // A test-only control plane: evidence runs call these through the DevTools protocol. They are not
  // reachable from any web page.
  (globalThis as Record<string, unknown>).__host = {
    bootId,
    bootedAt,
    hellos,
    ensureOffscreen,
    toOffscreen: async (msg: object) => {
      await ensureOffscreen();
      return chrome.runtime.sendMessage({ target: "offscreen", ...msg });
    },
    toTab: (tabId: number, msg: object) => {
      note("to-tab", msg);
      return chrome.tabs.sendMessage(tabId, msg);
    },
    /** TEST-ONLY: everything this worker saw, for an evidence run to scan. */
    seen,
    forgetSeen: () => {
      seen.length = 0;
      return true;
    },
    offscreenContexts: async () => (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length,
    // EXPERIMENT D-E6-4: how many documents currently hold a transport port, for diagnosis only.
    transportConnections: () => transport.connectionCount(),
    /**
     * M1: drive one product run in the core realm, and carry a human's answer to it.
     *
     * The worker starts nothing and decides nothing here. `runTask` hands the request to the
     * offscreen document and waits; `grantPeek` reads what a person is being asked, which contains a
     * token and a field label and no value; `grantDecide` carries an answer that came from outside
     * this extension entirely. An automated run's operator answers through these, exactly as the
     * demo rehearsal's `auto` mode answers on the page.
     */
    runTask: async (request: object) => {
      await ensureOffscreen();
      return chrome.runtime.sendMessage({ target: "offscreen", kind: "RUN_TASK", request });
    },
    grantPeek: async () => {
      await ensureOffscreen();
      return chrome.runtime.sendMessage({ target: "offscreen", kind: "GRANT_PEEK" });
    },
    /**
     * TEST-ONLY: arm one boundary capability outside a run, so an evidence run can present it
     * wrongly. Reachable only through the DevTools protocol, exactly as `e6Arm` is; no page can
     * reach it, and the capability it arms carries a reference and a target, never a value.
     */
    armBoundaryCapability: async (tabId: number, target: string, ttlMs: number) => {
      const hello = [...hellos].reverse().find((h) => h.identity.tabId === tabId);
      if (!hello || hello.identity.documentId === null || hello.identity.frameId === null) return { refused: "NO_DOCUMENT_FOR_TAB" };
      await ensureOffscreen();
      const r = (await chrome.runtime.sendMessage({
        target: "offscreen", kind: "ARM_BOUNDARY_CAPABILITY", tabId, frameId: hello.identity.frameId, documentId: hello.identity.documentId, field: target, ttlMs,
      })) as { nonce?: string };
      return { nonce: r.nonce ?? null, documentId: hello.identity.documentId, tabId };
    },
    /**
     * TEST-ONLY: what the page agent in a document actually did.
     *
     * The question this answers is the one a DISPATCH reply cannot: **how many times did the
     * isolated world put events into this document?** A reply says a dispatch was answered; this
     * says how many were performed. Counts, refusal codes, minted ids and page-clock timestamps.
     */
    pageAudit: (tabId: number, frameId: number) =>
      chrome.tabs.sendMessage(tabId, { kind: "DISPATCH_AUDIT" }, { frameId }),
    /**
     * TEST-ONLY: what the authority would answer for this tab, with the handle withheld.
     *
     * The handle is an opaque id and carries nothing, but a harness has no reason to hold one, so
     * what comes back is its LENGTH. A probe that returned the handle would be the one place in
     * this system where a capture credential left the extension.
     */
    ticketProbe: async (tabId: number, documentId?: string) => {
      const ticket = await capture.ticketFor(tabId, documentId ?? null);
      if (!ticket.ok) return { ok: false, refused: ticket.refused, detail: ticket.detail };
      return ticket.route === "GESTURE_STREAM"
        ? { ok: true, route: ticket.route, handleLength: ticket.handle.length }
        : { ok: true, route: ticket.route, dataUrlLength: ticket.dataUrl.length };
    },
    /**
     * TEST-ONLY: drive the product route end to end for the most recent grant.
     *
     * Mints a handle here and hands the STRING to the offscreen document, which turns it into an
     * `ImageBitmap` itself. This is the step M3.1 implemented and could not run, so it is exercised
     * on its own before the full loop, in order that a failure names which half broke.
     */
    consumeProbe: async () => {
      const latest = capture.grants().at(-1);
      if (!latest) return { ok: false, error: "NO_GRANT" };
      const ticket = await capture.ticketFor(latest.tabId);
      if (!ticket.ok) return { ok: false, error: ticket.refused, detail: ticket.detail };
      if (ticket.route !== "GESTURE_STREAM") return { ok: false, error: "NOT_THE_STREAM_ROUTE", route: ticket.route };
      await ensureOffscreen();
      // The tab's own CSS size, so the probe asks for the frame shape the product asks for.
      const tab = await chrome.tabs.get(latest.tabId).catch(() => null);
      return chrome.runtime.sendMessage({
        target: "offscreen",
        kind: "STREAM_CONSUME",
        streamId: ticket.handle,
        ...(tab?.width && tab?.height ? { maxWidth: tab.width, maxHeight: tab.height } : {}),
      });
    },
    /** TEST AND EVALUATION ONLY: one perception pass through the product realm. */
    perceiveOnce: async (tabId: number, frameId: number) => {
      await ensureOffscreen();
      return chrome.runtime.sendMessage({ target: "offscreen", kind: "PERCEIVE_ONCE", tabId, frameId });
    },
    /** TEST-ONLY: the grants a human produced, and whether the degraded path is compiled in. */
    captureState: () => ({ grants: capture.grants(), workerFrameEnabled: __M3_WORKER_FRAME__ }),
    /** TEST-ONLY: the lifecycle this tab is in, and whether a person has to act. */
    captureStatus: (tabId: number, documentId?: string) => capture.status(tabId, documentId ?? null),
    /**
     * TEST-ONLY: record a grant as an invocation would.
     *
     * This does NOT fabricate a browser permission -- `getMediaStreamId` still refuses unless
     * Chrome itself saw an invocation, which is the point. It exists so a harness can show that the
     * authority's own gate opens and the browser's does not, which is a different fact from the
     * authority never having been asked.
     */
    noteGrant: (tabId: number) => {
      capture.grant(tabId);
      return capture.grants().length;
    },
    /**
     * M3.1 ROUTE SURFACE — which realm has which capture API.
     *
     * Reports the SHAPE of the surface and calls nothing. The route table it produced is recorded
     * in `host-lib/capture-authority.ts` and in the M3.1 evidence; the probe that ATTEMPTED each
     * route was a one-off and is not carried in a product bundle, because a bundle that can call
     * `captureVisibleTab` is a bundle that can capture.
     */
    routeSurface: () => ({
      tabCapture: typeof chrome.tabCapture === "object",
      getMediaStreamId: typeof chrome.tabCapture?.getMediaStreamId === "function",
      actionOnClicked: typeof chrome.action?.onClicked === "object",
      grants: capture.grants().length,
    }),
    /** TEST-ONLY: what an invocation recorded, if a human ever produced one. */
    activeTabGrants: () => capture.grants(),
    /** TEST-ONLY: mint a stream id for a tab the action was invoked on. */
    mintStreamId: async (tabId: number) => {
      try {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
        return { ok: true, length: streamId.length };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    /** TEST-ONLY: present a capability to a tab exactly as the core realm would. */
    presentCapability: (tabId: number, frameId: number, nonce: string, target: string) =>
      chrome.tabs.sendMessage(tabId, { kind: "BOUNDARY", body: { kind: "CAPABILITY", nonce, target } }, { frameId }),
    grantDecide: async (granted: boolean) => {
      await ensureOffscreen();
      return chrome.runtime.sendMessage({ target: "offscreen", kind: "GRANT_DECIDE", granted });
    },
    // EXPERIMENT E6: arm a single-use value release for the latest document seen in a tab. The worker
    // handles only the nonce and the document identity — never the value.
    e6Arm: async (tabId: number, ttlMs: number, selector = "#t") => {
      const hello = [...hellos].reverse().find((h) => h.identity.tabId === tabId);
      if (!hello || hello.identity.documentId === null || hello.identity.frameId === null) return { refused: "NO_DOCUMENT_FOR_TAB" };
      await ensureOffscreen();
      const r = (await chrome.runtime.sendMessage({
        target: "offscreen", kind: "E6_ARM", tabId, frameId: hello.identity.frameId, documentId: hello.identity.documentId, ref: "<PII:PHONE:1>", selector, ttlMs,
      })) as { armed: boolean; nonce?: string; refused?: string };
      // The nonce is minted by the core realm, not here. This worker asks for a capability and is
      // told what it is called; it cannot name one into existence.
      return { nonce: r.nonce ?? null, documentId: hello.identity.documentId, armed: r };
    },
  };

  // EXPERIMENT D-E6-4. A content script opens a port; the browser attests who it is through
  // `port.sender`. A port we cannot fully attest, or one from an origin outside loopback, is dropped.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== TRANSPORT_PORT_NAME) return;
    const adapted = adaptPort(port);
    // Same recording, for the one channel that is not a runtime message.
    const watched = {
      ...adapted,
      postMessage: (message: unknown) => {
        note("port", message);
        adapted.postMessage(message as never);
      },
      onMessage: (listener: (message: unknown) => void) =>
        adapted.onMessage((message) => {
          note("port", message);
          listener(message);
        }),
    };
    if (!transport.acceptPort(watched)) port.disconnect();
  });

  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    note("in", raw);
    const msg = raw as ToSw & { target?: string };

    // EXPERIMENT D-E6-4: relay one page request for the core realm. Only the offscreen document may
    // ask; a tab, the side panel or anything else is refused before a page is touched.
    if (typeof raw === "object" && raw !== null && (raw as { channel?: unknown }).channel === TRANSPORT_CHANNEL) {
      if (!isFromOffscreenDocument(sender)) {
        sendResponse(relayRefused("SENDER_NOT_ACCEPTED", bootId));
        return false;
      }
      void transport.relay(raw).then(sendResponse);
      return true;
    }

    if (msg?.target === "offscreen") return false; // addressed to the offscreen document, not here

    /**
     * Carry one privacy-boundary request to the bound document.
     *
     * THE WORKER IS THE POSTMAN AND IT IS NOT GIVEN THE LETTER. What passes through here is a
     * value-free element graph on the way down, spans and descriptors and counts on the way back,
     * and — for a capability — a nonce and a field name. Whatever a capability holds is collected by
     * the content script as a reply this context never sees. Only the offscreen document may ask,
     * and it may only ask for a tab.
     */
    /**
     * M3 — CAPTURE ONE FRAME, BECAUSE NOTHING ELSE CAN.
     *
     * MEASURED on W1 (`REALM_PROBE`): an offscreen document has no `chrome.tabs` at all, and a
     * content script has none either. `captureVisibleTab` exists in exactly one realm, so the
     * perception realm has to ask this one for a frame.
     *
     * **This is the single hop where a page's pixels are in a worker, and it is stated rather than
     * hidden.** M2's guarantee — no page value in any service-worker message — does not extend to
     * pixels, because Chrome offers no door that avoids this context without a user gesture. What
     * IS enforced here is that the hop is the only one:
     *
     *   - the bytes are handed straight to the sender and this context keeps no reference;
     *   - the traffic recorder notes the SHAPE of this exchange and never its payload, because a
     *     diagnostic that stored every frame would be the leak it exists to detect;
     *   - only the offscreen document may ask, and it may only ask for the active tab.
     */
    /**
     * M3.1 — HAND THE PERCEPTION REALM ITS ACCESS, NOT ITS PIXELS.
     *
     * On the product path what leaves here is an opaque `getMediaStreamId` handle: a string this
     * context cannot read an image out of, which the offscreen document redeems for pixels through
     * `getUserMedia`. The media never passes through a message and never passes through here.
     *
     * On the degraded path -- off unless the build asked for it -- `captureVisibleTab` runs in this
     * context and this context holds the frame. That path is named `WORKER_FRAME` in every record
     * that mentions it, and the recorder below notes its SHAPE and never its payload, because a
     * diagnostic that stored every frame would be the leak it exists to detect.
     */
    if (msg?.kind === "CAPTURE_FRAME") {
      if (!isFromOffscreenDocument(sender)) {
        sendResponse({ ok: false, refused: "SENDER_NOT_ACCEPTED" });
        return false;
      }
      const ask = raw as { tabId: number; documentId?: string };
      void capture.ticketFor(ask.tabId, ask.documentId ?? null).then((ticket) => {
        note("to-tab", {
          kind: "CAPTURE_TICKET",
          ok: ticket.ok,
          route: ticket.ok ? ticket.route : null,
          refused: ticket.ok ? null : ticket.refused,
          // A handle is an opaque id and is recorded in full; a frame is recorded as a length.
          handle: ticket.ok && ticket.route === "GESTURE_STREAM" ? ticket.handle : null,
          dataUrlLength: ticket.ok && ticket.route === "WORKER_FRAME" ? ticket.dataUrl.length : null,
        });
        sendResponse(ticket);
      });
      return true;
    }

    if (msg?.kind === "TO_PAGE_BOUNDARY") {
      if (!isFromOffscreenDocument(sender)) {
        sendResponse({ ok: false, refused: "SENDER_NOT_ACCEPTED" });
        return false;
      }
      const ask = raw as { tabId: number; frameId: number; body: unknown };
      note("to-tab", ask.body);
      chrome.tabs
        .sendMessage(ask.tabId, { kind: "BOUNDARY", body: ask.body }, { frameId: ask.frameId })
        .then(sendResponse)
        .catch((error: unknown) => sendResponse({ ok: false, refused: error instanceof Error ? error.message : String(error) }));
      return true;
    }

    if (msg?.kind === "HOST_STATUS" && isFromExtensionPage(sender)) {
      /**
       * The side panel is told whether a person needs to act.
       *
       * ADR-0009 accepts that a fresh invocation is required after navigation and says it is "not a
       * defect to be hidden". The smallest way not to hide it is to report the lifecycle on the one
       * control surface that already exists, so the panel can say so instead of a capture silently
       * refusing somewhere a person cannot see.
       */
      void (async () => {
        const n = await ensureOffscreen();
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
        const captureStatus = typeof active?.id === "number" ? capture.status(active.id) : null;
        sendResponse({ bootId, bootedAt, offscreenContexts: n, hellos: hellos.length, captureStatus });
      })();
      return true;
    }
    if (!isFromContentScript(sender)) {
      sendResponse({ refused: "SENDER_NOT_ACCEPTED" });
      return false;
    }
    if (msg.kind === "HELLO") {
      hellos.push({ at: Date.now(), identity: identityOf(sender) });
      sendResponse({ bootId, identity: identityOf(sender) });
      return false;
    }
    if (msg.kind === "RELAY_ECHO") {
      void ensureOffscreen()
        .then(() => chrome.runtime.sendMessage({ target: "offscreen", kind: "ECHO" }))
        .then((echo) => sendResponse({ bootId, echo, identity: identityOf(sender) }));
      return true;
    }
    sendResponse({ refused: "UNKNOWN_KIND" });
    return false;
  });
});
