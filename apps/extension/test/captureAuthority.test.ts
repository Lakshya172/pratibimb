/**
 * M3.1 — THE WORKER IS GIVEN ACCESS, NOT PIXELS.
 *
 * The browser evidence can only exercise the degraded path, because no automated harness can
 * produce the invocation `activeTab` requires — measured on W1: `<all_urls>` does not substitute
 * for it, a real click inside an extension page does not, and a keyboard command dispatched over
 * CDP never reaches Chrome's accelerator table. So the product path's logic is proved here, where
 * the browser can be faked and every branch reached.
 *
 * The assertion that matters throughout is the same one: **what came back on the granted path is a
 * string the worker cannot read an image out of.** A ticket carrying a frame is a different shape
 * from a ticket carrying a handle, and the type says so.
 */
import { describe, expect, it } from "vitest";

import { createCaptureAuthority, type CaptureBrowser } from "../host-lib/capture-authority";

const HANDLE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const FRAME = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA=";

/** A browser whose two capture APIs can be present, absent, or made to fail, independently. */
function fakeBrowser(over: Partial<CaptureBrowser> = {}, degraded = false) {
  const calls = { minted: 0, captured: 0 };
  const browser: CaptureBrowser = {
    getMediaStreamId: async () => {
      calls.minted += 1;
      return HANDLE;
    },
    ...(degraded
      ? {
          captureVisibleTab: async () => {
            calls.captured += 1;
            return FRAME;
          },
        }
      : {}),
    ...over,
  };
  return { browser, calls };
}

const authority = (browser: CaptureBrowser, now = () => 1_000) =>
  createCaptureAuthority({ browser, grantTtlMs: 60_000, now });

describe("the capture authority", () => {
  it("refuses without an invocation, and does not fall back to the worker path", async () => {
    const { browser, calls } = fakeBrowser();
    const ticket = await authority(browser).ticketFor(7);

    expect(ticket.ok).toBe(false);
    expect(ticket.ok === false && ticket.refused).toBe("NO_ACTIVE_TAB_GRANT");
    // The whole point: no grant means no frame, not a quieter way of getting one. A fallback
    // nobody chose is how a boundary comes to hold only when nothing is watching.
    expect(calls.minted).toBe(0);
    expect(calls.captured).toBe(0);
  });

  it("hands back an opaque handle after an invocation, and never a frame", async () => {
    const { browser } = fakeBrowser();
    const capture = authority(browser);
    capture.grant(7);
    const ticket = await capture.ticketFor(7);

    expect(ticket.ok && ticket.route).toBe("GESTURE_STREAM");
    expect(ticket.ok && ticket.route === "GESTURE_STREAM" && ticket.handle).toBe(HANDLE);
    // The shape is the guarantee. There is no `dataUrl` on this branch to forget to remove.
    expect(Object.keys(ticket)).toEqual(["ok", "route", "handle"]);
    expect(JSON.stringify(ticket)).not.toContain("data:image");
    expect(JSON.stringify(ticket)).not.toContain("iVBORw0KGgo");
  });

  it("checks the grant against the tab, not against having ever been invoked", async () => {
    const capture = authority(fakeBrowser().browser);
    capture.grant(7);

    expect((await capture.ticketFor(7)).ok).toBe(true);
    // A person pointing at one tab does not authorise looking at another.
    const other = await capture.ticketFor(8);
    expect(other.ok === false && other.refused).toBe("NO_ACTIVE_TAB_GRANT");
  });

  it("lets a grant expire, because an invocation is not permanent consent", async () => {
    let clock = 1_000;
    const capture = createCaptureAuthority({ browser: fakeBrowser().browser, grantTtlMs: 5_000, now: () => clock });
    capture.grant(7);
    expect(capture.granted(7)).toBe(true);

    clock += 5_001;
    expect(capture.granted(7)).toBe(false);
    const ticket = await capture.ticketFor(7);
    expect(ticket.ok === false && ticket.refused).toBe("NO_ACTIVE_TAB_GRANT");
  });

  it("reports a mint failure as itself, never as an absent grant", async () => {
    // The two are different facts and a reader needs to be able to tell them apart: one means
    // nobody asked, the other means Chrome said no to someone who did.
    const { browser } = fakeBrowser({
      getMediaStreamId: () => Promise.reject(new Error("Extension has not been invoked for the current page")),
    });
    const capture = authority(browser);
    capture.grant(7);
    const ticket = await capture.ticketFor(7);

    expect(ticket.ok === false && ticket.refused).toBe("MINT_FAILED");
    expect(ticket.ok === false && ticket.detail).toContain("has not been invoked");
  });

  it("uses the degraded path only when the build supplied one, and says which route it took", async () => {
    const { browser, calls } = fakeBrowser({}, true);
    const ticket = await authority(browser).ticketFor(7);

    expect(ticket.ok && ticket.route).toBe("WORKER_FRAME");
    expect(calls.captured).toBe(1);
    // Still no grant — the degraded path is a build decision, not a permission. And it is visibly
    // the other route, so a record that used it cannot read as if it had not.
    expect(ticket.ok && ticket.route === "WORKER_FRAME" && ticket.dataUrl).toBe(FRAME);
  });

  it("prefers the handle over the frame when both are available", async () => {
    const { browser, calls } = fakeBrowser({}, true);
    const capture = authority(browser);
    capture.grant(7);
    const ticket = await capture.ticketFor(7);

    expect(ticket.ok && ticket.route).toBe("GESTURE_STREAM");
    expect(calls.captured).toBe(0);
  });

  it("records grants as tab ids, times and a document binding, and nothing else", () => {
    const capture = authority(fakeBrowser().browser);
    capture.grant(7);
    capture.grant(9);
    // `boundTo` is null until the grant is first used: a person authorises a tab by invoking on it,
    // and which document that turns out to be is learned when a frame is actually asked for.
    expect(capture.grants()).toEqual([
      { tabId: 7, at: 1_000, boundTo: null },
      { tabId: 9, at: 1_000, boundTo: null },
    ]);
  });
});

/**
 * M5 — A GRANT BELONGS TO A DOCUMENT, NOT TO A TAB NUMBER.
 *
 * Chrome revokes `activeTab` when the tab navigates. An authority that did not model that would go
 * on answering "granted" for a page nobody authorised, mint a handle, and be refused by the browser
 * with an error about invocation — true, but three layers away from the actual reason.
 */
describe("grant revocation", () => {
  it("drops a tab's grants and says how many", () => {
    const capture = authority(fakeBrowser().browser);
    capture.grant(7);
    capture.grant(7);
    capture.grant(9);

    expect(capture.revoke(7)).toBe(2);
    expect(capture.granted(7)).toBe(false);
    // Another tab's authorisation is not collateral.
    expect(capture.granted(9)).toBe(true);
  });

  it("refuses for the right reason after a navigation", async () => {
    const { browser, calls } = fakeBrowser();
    const capture = authority(browser);
    capture.grant(7);
    capture.revoke(7);

    const ticket = await capture.ticketFor(7);
    // NO_ACTIVE_TAB_GRANT, not MINT_FAILED: the authority knows it has no grant, so it never asks
    // Chrome and never has to translate Chrome's answer back into the real reason.
    expect(ticket.ok === false && ticket.refused).toBe("NO_ACTIVE_TAB_GRANT");
    expect(calls.minted).toBe(0);
  });

  it("revoking a tab that was never granted is not an error", () => {
    expect(authority(fakeBrowser().browser).revoke(99)).toBe(0);
  });
});

/**
 * POST-M5 — THE LIFECYCLE, NAMED.
 *
 * ADR-0009 §0 accepts the cost these tests describe: *"a fresh user invocation may be required after
 * navigation/reload because activeTab authorization is revoked — this is a deliberate fail-closed
 * behavior, not a defect to be hidden."* So the states are asserted rather than inferred, and
 * `requiresReauth` is a field a caller can show a person instead of a boolean it has to interpret.
 */
describe("the capture lifecycle", () => {
  it("walks NO_GRANT → GRANTED → STREAM_AVAILABLE", async () => {
    const capture = authority(fakeBrowser().browser);
    expect(capture.status(7).lifecycle).toBe("NO_GRANT");
    expect(capture.status(7).requiresReauth).toBe(true);

    capture.grant(7);
    expect(capture.status(7).lifecycle).toBe("GRANTED");
    // Invoked but not yet used: nothing more is needed from the person.
    expect(capture.status(7).requiresReauth).toBe(false);

    await capture.ticketFor(7, "doc-a");
    expect(capture.status(7, "doc-a").lifecycle).toBe("STREAM_AVAILABLE");
    expect(capture.status(7, "doc-a").boundTo).toBe("doc-a");
  });

  it("binds on first use, and refuses a frame for a different document", async () => {
    const { browser, calls } = fakeBrowser();
    const capture = authority(browser);
    capture.grant(7);
    expect((await capture.ticketFor(7, "doc-a")).ok).toBe(true);

    // The page changed under the grant. A person authorised the document they were looking at.
    const after = await capture.ticketFor(7, "doc-b");
    expect(after.ok === false && after.refused).toBe("DOCUMENT_CHANGED");
    expect(capture.status(7, "doc-b").lifecycle).toBe("DOCUMENT_CHANGED");
    expect(capture.status(7, "doc-b").requiresReauth).toBe(true);
    // And it never asked the browser, so nothing was minted for the wrong page.
    expect(calls.minted).toBe(1);
  });

  it("says why a grant went away, and needs a new one", () => {
    const capture = authority(fakeBrowser().browser);
    capture.grant(7);
    capture.revoke(7, "NAVIGATION");

    const status = capture.status(7);
    expect(status.lifecycle).toBe("REVOKED");
    expect(status.revokedBecause).toBe("NAVIGATION");
    expect(status.requiresReauth).toBe(true);

    // A fresh invocation clears it — which is exactly the accepted cost, working.
    capture.grant(7);
    expect(capture.status(7).lifecycle).toBe("GRANTED");
    expect(capture.status(7).revokedBecause).toBeNull();
  });

  it("distinguishes a closed tab from a navigation", () => {
    const capture = authority(fakeBrowser().browser);
    capture.grant(7);
    capture.revoke(7, "TAB_CLOSED");
    expect(capture.status(7).revokedBecause).toBe("TAB_CLOSED");
  });

  it("treats repeated invocation as one authorisation, not two", async () => {
    const capture = authority(fakeBrowser().browser);
    capture.grant(7);
    capture.grant(7);
    capture.grant(7);
    // Duplicate grants are safe: the most recent counts, and the tab is authorised once.
    expect(capture.status(7).lifecycle).toBe("GRANTED");
    expect((await capture.ticketFor(7, "doc-a")).ok).toBe(true);
  });

  it("refuses a handle the browser has already handed out", async () => {
    // Chrome mints these and they should never repeat. If one did, it would be a capability that
    // could be replayed, so noticing costs a Set and not noticing costs the boundary.
    const { browser } = fakeBrowser();
    const capture = authority(browser);
    capture.grant(7);
    capture.grant(8);
    expect((await capture.ticketFor(7, "doc-a")).ok).toBe(true);

    const repeat = await capture.ticketFor(8, "doc-b");
    expect(repeat.ok === false && repeat.refused).toBe("HANDLE_ALREADY_ISSUED");
  });

  it("keeps one tab's authorisation out of another's", async () => {
    const capture = authority(fakeBrowser().browser);
    capture.grant(7);
    await capture.ticketFor(7, "doc-a");

    expect(capture.status(8).lifecycle).toBe("NO_GRANT");
    const other = await capture.ticketFor(8, "doc-a");
    expect(other.ok === false && other.refused).toBe("NO_ACTIVE_TAB_GRANT");
  });
});
