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
  /**
   * The document the grant was first USED for, or `null` before its first use.
   *
   * A person authorises a page, not a tab number. Chrome revokes `activeTab` on navigation and the
   * authority mirrors that — but mirroring is a listener, and a listener is a thing that can be
   * missed. Binding on first use means a frame for a different document is refused by this
   * authority's own bookkeeping even if the revocation never arrived.
   */
  boundTo: string | null;
}

/**
 * Where a tab stands, in one word.
 *
 * ADR-0009 §0 accepts the cost this enumerates: *"a fresh user invocation may be required after
 * navigation/reload because activeTab authorization is revoked — this is a deliberate fail-closed
 * behavior, not a defect to be hidden."* So the states are named, reported, and surfaced rather
 * than collapsed into a boolean that a caller would have to guess the meaning of.
 */
export type CaptureLifecycle =
  /** Nobody has invoked the extension on this tab. */
  | "NO_GRANT"
  /** Invoked, and no frame taken yet. */
  | "GRANTED"
  /** Invoked and bound to the document now asking. A frame can be taken. */
  | "STREAM_AVAILABLE"
  /** Bound to a different document than the one now asking: the page changed under the grant. */
  | "DOCUMENT_CHANGED"
  /** Navigation, a tab close, or the TTL dropped it. */
  | "REVOKED";

/** The states a person has to act on. Everything else proceeds without asking anyone. */
export const REQUIRES_REAUTH: readonly CaptureLifecycle[] = ["NO_GRANT", "DOCUMENT_CHANGED", "REVOKED"];

export interface CaptureStatus {
  readonly tabId: number;
  readonly lifecycle: CaptureLifecycle;
  /** True when a person must invoke the extension again before a frame can be taken. */
  readonly requiresReauth: boolean;
  /** The document this tab's grant is bound to, if it has been used. */
  readonly boundTo: string | null;
  /** Why the last grant went away, when it did. */
  readonly revokedBecause: "NAVIGATION" | "TAB_CLOSED" | null;
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
  readonly refused:
    | "NO_ACTIVE_TAB_GRANT"
    | "DOCUMENT_CHANGED"
    | "HANDLE_ALREADY_ISSUED"
    | "MINT_FAILED"
    | "WORKER_CAPTURE_DISABLED"
    | "CAPTURE_FAILED";
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
 * `degradedEncodedFrame` is OPTIONAL, and that is the structural half of the boundary rather than
 * a convenience: a product build supplies no such function, so the built bundle contains no
 * reference to it and the degraded path is absent rather than unreachable. A test reads the built
 * artifact and asserts exactly that.
 *
 * IT IS DELIBERATELY NOT NAMED AFTER A CHROME API. The degraded supplier in `background.ts` is the
 * only code that knows which API it calls, and that supplier is compiled out of a product build.
 * Naming the property `captureVisibleTab` put that API's name into the product artifact, where a
 * reader auditing the bundle had to be told it was a check rather than a capability. A neutral
 * name means the artifact makes the point by itself.
 */
export interface CaptureBrowser {
  getMediaStreamId(options: { targetTabId: number }): Promise<string>;
  degradedEncodedFrame?: (options: { format: "png" }) => Promise<string>;
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
  /** Where this tab stands, for a caller that needs to say so rather than just act on it. */
  status(tabId: number, documentId?: string | null): CaptureStatus;
  /**
   * Drop every grant for a tab.
   *
   * **Chrome revokes `activeTab` when the tab navigates**, and an authority that did not model
   * that would keep answering "granted" for a document nobody authorised — then mint, and be
   * refused by the browser with a confusing error. Matching the browser's own lifetime means the
   * refusal says `NO_ACTIVE_TAB_GRANT`, which is the true reason, instead of `MINT_FAILED`.
   */
  revoke(tabId: number, because?: "NAVIGATION" | "TAB_CLOSED"): number;
  /**
   * Obtain a ticket for one frame, or refuse.
   *
   * `documentId` is the document the frame is wanted FOR. The first ticket binds the grant to it;
   * a later ticket naming a different one is refused, because the person authorised that page.
   */
  ticketFor(tabId: number, documentId?: string | null): Promise<CaptureTicket>;
  /** Grants recorded, for the evidence record. Tab ids, times and document bindings; nothing else. */
  readonly grants: () => readonly CaptureGrant[];
}

export function createCaptureAuthority(options: CaptureAuthorityOptions): CaptureAuthority {
  const now = options.now ?? (() => Date.now());
  const grants: CaptureGrant[] = [];
  const revokedBecause = new Map<number, "NAVIGATION" | "TAB_CLOSED">();
  /**
   * Handles this authority has already handed out.
   *
   * Chrome mints these and they should never repeat. Refusing a repeat is defensive rather than
   * expected — but a capture handle that came back twice would be a capability that could be
   * replayed, and the cost of noticing is a `Set`.
   */
  const issued = new Set<string>();

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

    status(tabId: number, documentId: string | null = null): CaptureStatus {
      const grant = liveGrant(tabId);
      const because = revokedBecause.get(tabId) ?? null;
      let lifecycle: CaptureLifecycle;
      if (grant === null) lifecycle = because === null ? "NO_GRANT" : "REVOKED";
      else if (grant.boundTo === null) lifecycle = "GRANTED";
      else if (documentId !== null && grant.boundTo !== documentId) lifecycle = "DOCUMENT_CHANGED";
      else lifecycle = "STREAM_AVAILABLE";
      return {
        tabId,
        lifecycle,
        requiresReauth: REQUIRES_REAUTH.includes(lifecycle),
        boundTo: grant?.boundTo ?? null,
        revokedBecause: grant === null ? because : null,
      };
    },

    grant(tabId: number): void {
      // A second invocation of the same tab is not an error and is not a second authorisation: the
      // most recent one is what counts, and the older entries simply age out.
      if (grants.length < 1_000) grants.push({ tabId, at: now(), boundTo: null });
      revokedBecause.delete(tabId);
    },

    revoke(tabId: number, because: "NAVIGATION" | "TAB_CLOSED" = "NAVIGATION"): number {
      let dropped = 0;
      for (let i = grants.length - 1; i >= 0; i -= 1) {
        if ((grants[i] as CaptureGrant).tabId !== tabId) continue;
        grants.splice(i, 1);
        dropped += 1;
      }
      if (dropped > 0) revokedBecause.set(tabId, because);
      return dropped;
    },

    async ticketFor(tabId: number, documentId: string | null = null): Promise<CaptureTicket> {
      const grant = liveGrant(tabId);

      /**
       * THE PRODUCT PATH. A live grant, bound to the document being asked about, an opaque handle,
       * and nothing in this realm that could be read as an image.
       */
      if (grant !== null) {
        if (documentId !== null && grant.boundTo !== null && grant.boundTo !== documentId) {
          // The page changed under the grant. A person authorised the document they were looking
          // at, not whatever loaded next in the same tab.
          return {
            ok: false,
            refused: "DOCUMENT_CHANGED",
            detail:
              `This tab's grant is bound to document ${grant.boundTo} and a frame was asked for ` +
              `${documentId}. A fresh invocation is required, which is the accepted cost in ADR-0009 §0.`,
          };
        }
        try {
          const handle = await options.browser.getMediaStreamId({ targetTabId: tabId });
          if (issued.has(handle)) {
            return {
              ok: false,
              refused: "HANDLE_ALREADY_ISSUED",
              detail: "the browser returned a capture handle this authority has already handed out",
            };
          }
          issued.add(handle);
          if (documentId !== null) grant.boundTo = documentId;
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
      const degraded = options.browser.degradedEncodedFrame;
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
