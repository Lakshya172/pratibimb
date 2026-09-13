# Track G — verdict

**Date:** 2026-09-13 · **Workstation:** W2 · **Verdict: the minimal host RUNS in Chrome for Testing 153
and Edge 153. Two properties are UNMEASURED.**

| Property | Result |
|---|---|
| Extension loads (both cells) | **yes** |
| ORT + T1 artifact in the offscreen document via the ADR-0001 pinned path | **yes**, `[1,12,6400]` in both |
| Offscreen document survives a service-worker restart | **yes** (forced restart) |
| Browser-attested `documentId` on content-script messages | **yes**, both cells |
| Page can reach the extension | **no** |
| Pinned `connect-src` blocks a foreign origin pre-wire | **yes**, 0 arrivals |
| Content ↔ SW ↔ offscreen round trip | p50 0.8 ms (CfT) / 1.0 ms (Edge) |
| Natural service-worker termination under automation | **UNKNOWN**: not observed in 45 s, plausibly held alive by DevTools |
| Real side-panel context | **UNMEASURED**: needs a user gesture; the tab-opened page was refused by the host's own sender check |
| Firefox | **not in scope**: D-J undecided; no Firefox on W2 |

## Consequences

- **E6 can start on this host.**
- The §14 TYPE contract's reliance on `documentId` is supported in these cells.
- The side-panel sender rule needs one refinement before a real panel is used: accept the side panel's
  own URL, since `sender.tab` differs between side-panel and tab contexts.
