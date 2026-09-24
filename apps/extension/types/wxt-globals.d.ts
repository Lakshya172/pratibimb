/**
 * The ambient globals the extension source actually uses, declared from packages the frozen stack
 * already installs — so `apps/extension` can enter the TypeScript graph WITHOUT a new dependency
 * and WITHOUT depending on a generated directory.
 *
 * WHY THIS FILE EXISTS. `apps/extension` had no `tsconfig.json` and was absent from the root
 * project references, so `npm run typecheck` checked none of it: a type error in an extension
 * entrypoint was caught by nothing. A probe measured the gap at **81 errors, every one of them a
 * missing `chrome` name or namespace** and none of any other kind.
 *
 * WHY NOT `@types/chrome`. Adding a dependency is an ADR decision (`AGENTS.md` §4.6), and it is not
 * needed: `@wxt-dev/browser` already ships the WebExtension API surface as `export namespace
 * Browser`, and WXT — which IS in the frozen stack (`constitution.md` §5) — installs it. This file
 * only gives that surface the global name the source uses.
 *
 * WHY NOT WXT'S OWN GENERATED TYPES. `apps/extension/.wxt/` is git-ignored, so a typecheck that
 * depended on it would fail on a fresh clone until something had run `wxt prepare`. Every symbol
 * below is therefore declared from a published module path instead, and this file is checked in.
 *
 * IT DECLARES NOTHING THE SOURCE DOES NOT USE. The four nested types are the complete set, taken by
 * grep rather than by guess. Adding an entry here is a deliberate act, not a convenience.
 */
import type { Browser } from "@wxt-dev/browser";

export {};

declare global {
  /**
   * In an MV3 Chrome build the `browser` namespace WXT types and the `chrome` global the source
   * calls are the same object. This names it, and nothing more.
   */
  const chrome: typeof Browser;

  namespace chrome {
    namespace runtime {
      type MessageSender = Browser.runtime.MessageSender;
      type Port = Browser.runtime.Port;
      type ContextType = Browser.runtime.ContextType;
    }
    namespace offscreen {
      type Reason = Browser.offscreen.Reason;
    }
  }

  /** WXT's entrypoint wrappers, from their published module paths rather than from `.wxt/`. */
  const defineBackground: typeof import("wxt/utils/define-background").defineBackground;
  const defineContentScript: typeof import("wxt/utils/define-content-script").defineContentScript;
}
