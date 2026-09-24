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

  it("records grants as tab ids and times, and nothing else", () => {
    const capture = authority(fakeBrowser().browser);
    capture.grant(7);
    capture.grant(9);
    expect(capture.grants()).toEqual([
      { tabId: 7, at: 1_000 },
      { tabId: 9, at: 1_000 },
    ]);
  });
});
