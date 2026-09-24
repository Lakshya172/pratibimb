/**
 * M3.1 — WHO IS ALLOWED TO LOOK AT A TAB, AND WHAT THE WORKER IS GIVEN WHEN THEY ARE.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE ROUTE TABLE, MEASURED ON W1 BEFORE ANY OF THIS WAS DESIGNED
 *
 *   route                                            mints  pixels avoid worker  harness can trigger
 *   ──────────────────────────────────────────────  ─────  ───────────────────  ───────────────────
 *   captureVisibleTab, worker, <all_urls>             yes          NO                   yes
 *   captureVisibleTab, worker, activeTab              yes          NO                   no
 *   captureVisibleTab, extension page, activeTab      yes          NO                   no
 *   getMediaStreamId,  worker, activeTab              yes         **YES**               no
 *   getMediaStreamId,  extension page + in-page click  NO           —                   yes
 *   getMediaStreamId,  offscreen document        no such API        —                    —
 *   _execute_action command dispatched over CDP        NO           —                   yes
 *
 * Two facts fall out, and the whole design follows from them.
 *
 * **There IS a worker-free pixel route.** `getMediaStreamId` returns an opaque ~40-character
 * string. The worker holds that string and nothing else; the offscreen document turns it into
 * pixels itself, through `getUserMedia`, which never passes through a message. It is the same
 * shape as M2's value release: the worker carries a handle, the other realm goes and collects.
 *
 * **It requires a human invoking this extension on that tab, and nothing substitutes for it.**
 * `<all_urls>` does not unlock `getMediaStreamId` — measured, it still answers "Extension has not
 * been invoked for the current page". A real click inside an extension page does not either:
 * `activeTab` is about the tab a person pointed at, not about where the click happened. A keyboard
 * command dispatched over CDP does not reach Chrome's accelerator table at all.
 *
 * So the grant is real or there is no capture. This file is the place that knows the difference.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHAT THE DEGRADED PATH IS FOR, AND WHY IT IS NAMED RATHER THAN HIDDEN
 *
 * No automated harness can produce a toolbar click, so an evidence run cannot exercise the gesture
 * route. `CAPTURE_VIA_WORKER` exists for exactly that, is off unless a build asks for it, and is
 * called what it is: **the worker sees the frame on this path.** A run that used it says so in its
 * own record, and the three-act evidence reports which route each act took.
 *
 * The product default is the gesture route. With no grant it REFUSES — it does not quietly fall
 * back to the path that shows the worker a screenshot, because a fallback nobody chose is how a
 * boundary becomes decorative.
 */

/** An opaque handle to a tab's pixels. A string the worker carries and cannot read anything out of. */
export type CaptureHandle = string;

export interface CaptureGrant {
  readonly tabId: number;
  readonly at: number;
}

/**
 * How a frame is being obtained. Recorded on every pass, so a reader never has to infer it.
 *
 * `GESTURE_STREAM` — a person invoked the extension on this tab; the worker holds an opaque id.
 * `WORKER_FRAME`   — the degraded path; the worker holds the frame. Evidence runs only.
 */
export type CaptureRoute = "GESTURE_STREAM" | "WORKER_FRAME";

export interface CaptureRefusal {
  readonly ok: false;
  readonly refused: "NO_ACTIVE_TAB_GRANT" | "MINT_FAILED" | "WORKER_CAPTURE_DISABLED" | "CAPTURE_FAILED";
  readonly detail: string;
}

export type CaptureTicket =
  | { readonly ok: true; readonly route: "GESTURE_STREAM"; readonly handle: CaptureHandle }
  /** The degraded path's payload: a data URL. Present ONLY when the worker path is enabled. */
  | { readonly ok: true; readonly route: "WORKER_FRAME"; readonly dataUrl: string }
  | CaptureRefusal;

/**
 * The `chrome.*` surface this needs, typed structurally so the authority is testable in Node.
 *
 * `captureVisibleTab` is OPTIONAL, and that is the structural half of the boundary rather than a
 * convenience: a product build supplies no such function, so the built bundle contains no
 * reference to it and the degraded path is absent rather than unreachable. A test reads the built
 * artifact and asserts exactly that.
 */
export interface CaptureBrowser {
  getMediaStreamId(options: { targetTabId: number }): Promise<string>;
  captureVisibleTab?: (options: { format: "png" }) => Promise<string>;
}

export interface CaptureAuthorityOptions {
  readonly browser: CaptureBrowser;
  /** How long an invocation keeps a tab capturable. A grant is not permanent consent. */
  readonly grantTtlMs: number;
  readonly now?: () => number;
}

export interface CaptureAuthority {
  /** Record that a person invoked the extension on this tab. */
  grant(tabId: number): void;
  /** Is there a live grant for this tab? */
  granted(tabId: number): boolean;
  /**
   * Drop every grant for a tab.
   *
   * **Chrome revokes `activeTab` when the tab navigates**, and an authority that did not model
   * that would keep answering "granted" for a document nobody authorised — then mint, and be
   * refused by the browser with a confusing error. Matching the browser's own lifetime means the
   * refusal says `NO_ACTIVE_TAB_GRANT`, which is the true reason, instead of `MINT_FAILED`.
   */
  revoke(tabId: number): number;
  /** Obtain a ticket for one frame, or refuse. */
  ticketFor(tabId: number): Promise<CaptureTicket>;
  /** Grants recorded, for the evidence record. Tab ids and times; nothing else. */
  readonly grants: () => readonly CaptureGrant[];
}

export function createCaptureAuthority(options: CaptureAuthorityOptions): CaptureAuthority {
  const now = options.now ?? (() => Date.now());
  const grants: CaptureGrant[] = [];

  const liveGrant = (tabId: number): CaptureGrant | null => {
    for (let i = grants.length - 1; i >= 0; i -= 1) {
      const grant = grants[i] as CaptureGrant;
      if (grant.tabId !== tabId) continue;
      return now() - grant.at <= options.grantTtlMs ? grant : null;
    }
    return null;
  };

  return {
    grants: () => grants.slice(),
    granted: (tabId) => liveGrant(tabId) !== null,

    grant(tabId: number): void {
      if (grants.length < 1_000) grants.push({ tabId, at: now() });
    },

    revoke(tabId: number): number {
      let dropped = 0;
      for (let i = grants.length - 1; i >= 0; i -= 1) {
        if ((grants[i] as CaptureGrant).tabId !== tabId) continue;
        grants.splice(i, 1);
        dropped += 1;
      }
      return dropped;
    },

    async ticketFor(tabId: number): Promise<CaptureTicket> {
      /**
       * THE PRODUCT PATH. A live grant, an opaque handle, and nothing in this realm that could be
       * read as an image. What comes back is a string the worker passes on unexamined.
       */
      if (liveGrant(tabId) !== null) {
        try {
          const handle = await options.browser.getMediaStreamId({ targetTabId: tabId });
          return { ok: true, route: "GESTURE_STREAM", handle };
        } catch (cause) {
          return { ok: false, refused: "MINT_FAILED", detail: String((cause as Error)?.message ?? cause) };
        }
      }

      /**
       * NO GRANT, NO FALLBACK. Falling through to the path that hands this realm a screenshot
       * would make the boundary decorative: it would hold whenever nothing was watching and yield
       * the moment it mattered. A run with no invocation behind it perceives structurally, which
       * is the tier the client then honestly declares.
       */
      const degraded = options.browser.captureVisibleTab;
      if (degraded === undefined) {
        return {
          ok: false,
          refused: "NO_ACTIVE_TAB_GRANT",
          detail:
            "No live activeTab grant for this tab. A frame is obtained only after a person invokes " +
            "this extension on it; there is no permission that substitutes for that, which was " +
            "measured rather than assumed.",
        };
      }

      try {
        const dataUrl = await degraded({ format: "png" });
        return { ok: true, route: "WORKER_FRAME", dataUrl };
      } catch (cause) {
        return { ok: false, refused: "CAPTURE_FAILED", detail: String((cause as Error)?.message ?? cause) };
      }
    },
  };
}

/**
 * Whether this build compiled in the degraded worker path.
 *
 * Substituted by `wxt.config.ts` at build time rather than read at runtime, so a product bundle
 * does not contain the branch at all — the same rule `#e6-probe` follows. Declared here so every
 * file that reads it shares one declaration.
 */
declare global {
  // eslint-disable-next-line no-var
  var __M3_WORKER_FRAME__: boolean;
}
