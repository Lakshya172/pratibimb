/**
 * Typed messages for the minimal host, and the sender checks every receiver applies.
 *
 * Three rules, enforced by `isFromContentScript` / `isFromExtensionPage`:
 * 1. every message must come from THIS extension (`sender.id === chrome.runtime.id`);
 * 2. a content-script message must carry the browser-provided tab, frame and origin, and the origin
 *    must be a loopback test page;
 * 3. there is no page-facing channel at all: no `externally_connectable`, no `window.postMessage`
 *    listener. A page cannot command the extension.
 *
 * No message type carries a value. The vault stub holds synthetic canaries and never sends them.
 * The one exception is `E4_EMIT` (experiment E4-offscreen): it carries a harness-built loopback
 * request whose bytes are E4's synthetic, seeded canaries — never a vault value.
 */

import { type BoundaryRequest } from "./boundary-protocol";

export type ToSw =
  | { readonly kind: "HELLO" }
  | { readonly kind: "RELAY_ECHO"; readonly sentAt: number }
  | { readonly kind: "HOST_STATUS" }
  /**
   * The offscreen document asking the worker to carry one boundary request to a tab.
   *
   * The body is `BoundaryRequest`, whose members are enumerated in `boundary-protocol.ts` and
   * contain no value field in either direction. What the worker carries is a value-free element
   * graph, references, targets, identities and grants — and, for a capability, a nonce and a field
   * name. Whatever a capability actually holds is collected by the content script as a reply this
   * worker never sees.
   */
  | {
      readonly kind: "TO_PAGE_BOUNDARY";
      readonly tabId: number;
      readonly frameId: number;
      readonly body: BoundaryRequest;
    };

export type ToOffscreen =
  | { readonly target: "offscreen"; readonly kind: "ECHO" }
  | { readonly target: "offscreen"; readonly kind: "STATE" }
  | { readonly target: "offscreen"; readonly kind: "ORT_SMOKE" }
  | { readonly target: "offscreen"; readonly kind: "CSP_PROBE"; readonly allowed: string; readonly foreign: string }
  | {
      readonly target: "offscreen";
      readonly kind: "E4_EMIT";
      readonly url: string;
      readonly method: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly bodyB64: string | null;
    };

export type ToContent =
  | { readonly kind: "MEASURE" }
  | { readonly kind: "ROUNDTRIP"; readonly samples: number }
  /**
   * TEST AND EVIDENCE ONLY: what this document's page agent actually did.
   *
   * Counts, refusal codes, the ids the core realm minted, a structural selector and two page-clock
   * timestamps. There is no field here that could hold a page value, and the boundary's own
   * outgoing check would withhold the reply if there were.
   */
  | { readonly kind: "DISPATCH_AUDIT" }
  /** One request for the privacy boundary that lives in this world. See `boundary-protocol.ts`. */
  | { readonly kind: "BOUNDARY"; readonly body: BoundaryRequest };

export interface SenderIdentity {
  readonly tabId: number | null;
  readonly frameId: number | null;
  readonly documentId: string | null;
  readonly origin: string | null;
  readonly documentIdAvailable: boolean;
}

export function identityOf(sender: chrome.runtime.MessageSender): SenderIdentity {
  const s = sender as chrome.runtime.MessageSender & { documentId?: string; origin?: string };
  return {
    tabId: sender.tab?.id ?? null,
    frameId: typeof sender.frameId === "number" ? sender.frameId : null,
    documentId: typeof s.documentId === "string" ? s.documentId : null,
    origin: typeof s.origin === "string" ? s.origin : null,
    documentIdAvailable: typeof s.documentId === "string",
  };
}

export const isFromThisExtension = (sender: chrome.runtime.MessageSender): boolean => sender.id === chrome.runtime.id;

export function isFromContentScript(sender: chrome.runtime.MessageSender): boolean {
  const id = identityOf(sender);
  return (
    isFromThisExtension(sender) &&
    id.tabId !== null &&
    id.frameId !== null &&
    typeof id.origin === "string" &&
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(id.origin)
  );
}

/** An extension page (offscreen document, side panel): this extension, and no tab. */
export const isFromExtensionPage = (sender: chrome.runtime.MessageSender): boolean =>
  isFromThisExtension(sender) && !sender.tab && typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
