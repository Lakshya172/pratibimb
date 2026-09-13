# E6 — verdict

**Date:** 2026-09-13 · **Workstation:** W2 · **Pre-registered:** `3111459` · **Cells:** CfT 153, Edge 153

**Verdict:**
- **TYPE: GO** (no extra permission; plain and React-controlled inputs, 10/10 in both cells).
- **CLICK: PARTIAL** (works on ordinary handlers; untrusted, so `isTrusted`-checking pages refuse it).
- **Mechanism C (`chrome.debugger`): NOT RUN.**

| Gate criterion | Result |
|---|---|
| Correct value on a plain input, 10/10, no extra permission | **yes**: A, B1, B2 |
| React controlled state updated and persists after re-render | **yes**: A, B1, B2 |
| Value stays on the trusted side until insertion | **yes**: release bound to a browser-attested `documentId`; refused after reload 6/6; page patches saw 0 |
| Click accepted by a page that requires `isTrusted` | **no**: A and B, 0/10 |
| Click respects what is on top at the point | **B yes, A no** (A went through an overlay) |
| All 36 pre-registered prediction groups | **matched** |

## Decisions this record makes necessary

| # | Decision | Recommendation from the evidence |
|---|---|---|
| **D-E6-1** | TYPE mechanism for V1 | **B1 `execCommand('insertText')`**: trusted input event, focus, honours `maxlength`. State its deprecation risk |
| **D-E6-2** | Click dispatch binding for the permit (ADR-0008 §6) | **Point-based (B)**. Element dispatch bypasses overlays and would empty HIT-TEST agreement of meaning |
| **D-E6-3** | Pages that honour only trusted clicks | Out of scope for V1 → NEEDS_USER; **or** a `chrome.debugger` ADR (new permission, infobar), **not attempted here** |
| **D-E6-4** | Re-base the ACT evidence | MVP-1 and MVP-2 used trusted CDP input. The extension transport needs its own ACT/HIT-TEST/VERIFY run before those results are quoted for the product |

## Not done

No production TYPE subsystem, no RE-HYDRATE, no production vault, no `chrome.debugger`, no real site,
no real value.
