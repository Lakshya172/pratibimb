# M13 — decision record (unit 1: CSP)

**Verdicts:**

| Item | Result |
|---|---|
| CSP v2 (ADR-0013) for CSP-governed channels | **PASS** |
| Legitimate resources | **PASS** |
| Product/evidence distinction | **MACHINE-VERIFIED** |
| Network boundary against injected code | **NOT CLOSED: F-M13-1, top-level navigation, outside CSP** |
| M13 | **STOPPED** on the stop condition "injected code can still reach an unauthorized origin" |
| J7 (Parts E–N) | **NOT RUN**, pending the owner |

## What changed

- **The policy:** the extension_pages CSP is v1 → v2 (ADR-0013 amends ADR-0001 §7):
  - `default-src 'none'`;
  - `worker-src 'self'`;
  - `style-src` by hash;
  - `object-src`, `base-uri` and `form-action` set to `'none'`.
- **The product build** can reach exactly `http://127.0.0.1:8995/v1/chat/completions`. **Evidence
  builds** can reach the collector origin.
- **Gesture harnesses** compare manifests with that one source normalised, and refuse unless the
  difference is exactly that.

## Findings

- **F-M12-1: RESOLVED** for img and iframe, and for every other CSP-governed channel (0 arrivals,
  three realms, two builds).
- **F-M13-1: OPEN.** These channels still reached the foreign origin in both builds:
  - `window.open`, `<a target=_blank>` and `open()` from an about:blank iframe, in the offscreen
    document;
  - `chrome.tabs.create` and `chrome.windows.create`, in the service worker.

  No CSP directive governs top-level navigation.

## Blockers

| Blocker | Status |
|---|---|
| B7 | OPEN (F-M13-1) |
| B1, B2, B4, B5, B6 | Unchanged from M12 |

## Owner decision required

How to treat F-M13-1 (ADR-0013 §9):

- **(a)** accept top-level navigation as a documented residual, because it requires code already
  executing in an extension realm, and continue M13 to J7;
- **(b)** fund a measured spike of a non-CSP control, e.g. `declarativeNetRequest` scoped to the
  extension as initiator, which needs a new permission and its own ADR;
- **(c)** keep M13 stopped.
