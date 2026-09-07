---
id: W1-S01b
title: "S-01b — Playwright extension loading and egress interception coverage"
status: recorded
date: 2026-09-07
label: FACT (observations) / INFERENCE (assessment)
verdict: CONDITIONAL
---

# S-01b — Can Playwright load the MV3 extension *and* intercept its egress?

## Hypothesis

S-01 recorded that Chrome 152 stable refuses `--load-extension`, and raised S-01b:

> *Does Playwright's bundled Chromium still honour `--load-extension`, so the egress
> interception suite can run in CI?*

**This spike deliberately widens that question**, because the narrow version is not the one
the project actually needs answered. `docs/security/security-invariants.md` states that
Invariant E is enforced four ways, and mechanism (2) is:

> A **Playwright test** that installs a request interceptor and asserts **zero requests**
> under each injected failure.

Loading the extension is a *precondition* for that test, not the capability the test needs.
The capability it needs is:

1. the unpacked MV3 extension **loads**, **and**
2. Playwright can **observe** a network request issued from the extension's background
   contexts, **and**
3. Playwright can **block** such a request.

If (1) holds but (2) or (3) fails, the suite still runs, still goes green, and asserts
nothing — a **vacuous pass on the project's central security claim**. That is a worse
outcome than a suite that fails to start, so the spike tests all three.

Per `docs/architecture/constitution.md` §5, PratiBimb's inference and payload assembly live
in an **offscreen document + dedicated worker**, not in the service worker. The offscreen
document is therefore the context the interception suite must cover.

**Hypothesis:** a Playwright-driven Chromium browser loads the unpacked MV3 extension and
its context-level request interception covers every extension context.

## Environment

Full detail in [`environment.json`](environment.json). Summary:

| Field | Value |
|---|---|
| Machine | HP OMEN 16-ap0xxx · AMD Ryzen AI 7 350 w/ Radeon 860M · RTX 5050 8151 MiB |
| OS | Windows 11 Home Single Language 10.0.26200 |
| Node | v26.4.0 |
| Playwright | **1.63.0** |
| Chrome (branded, stable) | 152.0.7977.77 |
| Edge (branded, stable) | 152.0.4191.66 |
| Playwright bundled Chromium | **could not be executed — see below** |
| Collector | `http://127.0.0.1:8901`, loopback only, not shipped |

> **This is a Windows machine and the CI target for the egress suite is `ubuntu-latest`.**
> Nothing recorded here is a fact about Linux. See *Scope* below.

### Three variants could not be run, and why — FACT

1. **`npx playwright install chromium` fails.** Both `cdn.playwright.dev` and
   `playwright.azureedge.net` return **HTTP 400** for
   `builds/chromium/1243/chromium-win64.zip`. Attempted twice; the npm registry was
   reachable in the same session, so general network egress works.
2. **Chrome for Testing 153.0.8010.12** — the build Playwright names for chromium v1243 —
   was obtained instead from Google's official `chrome-for-testing-public` bucket
   (`sha256 415968b0…34c1`) and placed at Playwright's expected path. It **does not start**:
   *"The application has failed to start because its side-by-side configuration is
   incorrect."* Reproduced after a clean re-extraction. Most likely a missing Visual C++
   runtime assembly. **Not remediated** — installing a system-wide redistributable is a
   human decision, not a spike action.
3. **Headless** needs a separate `chrome-headless-shell-1243` build, behind the same
   failing endpoint.

**Consequence: the literal S-01b question — "does Playwright's *bundled* Chromium honour
`--load-extension`" — is NOT answered by this spike.** It remains `UNKNOWN`. What follows
is measured against branded Chrome and branded Edge, driven by Playwright 1.63.0.

## Expected result

If the dossier's enforcement plan is sound, every launched browser loads the extension and
every extension-originated request is visible to `context.on("request")` and blockable by
`context.route()`.

## Actual result — FACT

### Matrix (`logs/results-matrix.json`)

| Variant | Launched | Extension loaded | Requests Playwright saw | Requests that actually arrived |
|---|---|---|---|---|
| A · Playwright bundled Chromium, headed | ❌ `spawn UNKNOWN` | — | — | — |
| B · Playwright bundled Chromium, headed, blocking | ❌ `spawn UNKNOWN` | — | — | — |
| C · Playwright bundled Chromium, headless | ❌ executable missing | — | — | — |
| **D · branded Chrome 152 stable** | ✅ | **❌ NO** | 0 | 0 |
| **E · branded Edge 152 stable** | ✅ | **✅ YES** | **2** | **3** |

**Variant D reproduces S-01's finding on a second machine and a second automation stack:**
Chrome 152 stable launches under Playwright but silently ignores `--load-extension`. No
service worker, no background page, no extension id.

**Variant E is the finding.** Edge 152 stable **does** honour `--load-extension` under
Playwright. The extension loaded (id `kapobnekdfajlhifmcpdgfpenmifefbg`), the service
worker registered, and both probe fetches executed. But Playwright observed **two** of the
**three** requests that reached the collector. The one it missed was the one from the
**offscreen document**.

### The decisive test — can Playwright *block* it? (`logs/results-block.json`)

A route handler aborted **every** request to the collector, from every context. Three runs,
identical every time:

| | Service worker fetch | Offscreen document fetch |
|---|---|---|
| Seen by `context.on("request")` | ✅ yes | **❌ no** |
| Aborted by `context.route()` | ✅ yes | **❌ no** |
| Result inside the extension | `TypeError: Failed to fetch` | **`status 200`** |
| Arrived at the collector anyway | no | **YES — all 3 runs** |

> **With an abort-everything route handler installed, the offscreen document's POST still
> reached the network, in three runs out of three.**

### Why — target visibility (`logs/results-targets.json`)

| Surface | Sees the offscreen document? |
|---|---|
| `context.pages()` | ❌ `["about:blank"]` only |
| `context.serviceWorkers()` | ❌ background service worker only |
| `context.backgroundPages()` | ❌ empty |
| **CDP `Target.getTargets`** | ✅ **yes** — `type: "background_page"`, url `chrome-extension://…/offscreen.html` |

The offscreen document exists as a Chrome DevTools Protocol target. **Playwright's
`BrowserContext` does not surface it**, so `context.route()` and `context.on("request")`
never attach to it.

## Findings

**Finding 1 — the planned egress interception mechanism has a coverage gap over exactly the
context PratiBimb sends from.** `context.route()` covers the MV3 service worker and does not
cover the MV3 offscreen document. The constitution places payload assembly and inference in
the offscreen document. A suite written the obvious way would assert "zero outbound
requests", pass, and be blind to the send path. **This is a false-negative risk on
Invariant E, not a convenience problem.**

**Finding 2 — the gap looks addressable, but choosing the remedy is not a spike decision.**
CDP sees the target that Playwright hides, so a CDP-level interception (attaching to the
offscreen target and using `Fetch.enable`) is a plausible vehicle, as is asserting against a
loopback collector — which is what caught this. Both change *how Invariant E is enforced*,
which is a security-architecture decision for the `privacy-security-engineer` and the human
architect. **This spike proposes nothing and changes nothing.**

**Finding 3 — branded Edge honours `--load-extension` where branded Chrome does not**, at
the same Chromium major version (152). This is a *usable* fact for local testing and it
widens S-01's finding: the refusal is a Chrome behaviour, not a Chromium-152 behaviour.

**Finding 4 — a ground-truth collector caught what the automation framework missed.** Had
this spike trusted Playwright's own report, it would have concluded "2 requests, both
blocked" and recorded a clean pass. The loopback collector is the only reason the leak was
visible. **Any future egress suite should keep an independent arrival check** rather than
trusting the interceptor alone.

## Corrections made during the spike

Recorded rather than hidden, per `agentos/workflows/spike.md`:

- The first runner attached its route handler *after* launch, so the service worker's
  `/ready` fetch could race it. The blocking runner was rewritten to abort on `**/*` and to
  compare against collector arrivals rather than against observation counts, which removes
  the race from the conclusion. The offscreen result is unchanged under both designs.
- The first attempt treated "Playwright observed 2, collector received 3" as a possible
  harness timing artifact. It is not: the blocking test isolates it, and it reproduces 3/3.

## Conclusion

**CONDITIONAL.** A Playwright-driven browser *can* load the unpacked MV3 extension — on
branded Edge 152, not on branded Chrome 152, and unknown on Playwright's own bundled
Chromium, which could not be executed here. But **the interception mechanism the Invariant E
suite depends on does not cover the offscreen document**, which is the context PratiBimb
sends from. As planned, the suite cannot enforce Invariant E for PratiBimb's real send path.

**Invariant E is not weakened by this result and no change to it is proposed.** Enforcement
mechanisms (1) lint rule, (3) manifest CSP and (4) payload hash pin are untouched. Mechanism
(2) has a measured coverage gap and needs a decision it is not this spike's place to make.

## Reproducibility

```bash
cd artifacts/experiments/W1-S01b-playwright-extension-loading/harness
npm install playwright@1.63.0
node run-s01b.js          # the five-variant matrix     -> results.json
node run-s01b-block.js    # the decisive blocking test  -> results-block.json  (3 runs)
node run-s01b-targets.js  # target visibility via CDP   -> results-targets.json
```

Requires branded Microsoft Edge installed for variants D/E. The harness contacts **no
external host**; everything goes to `127.0.0.1:8901`. Full commands and raw output in
[`commands.md`](commands.md). Verdict and follow-ups in [`decision.md`](decision.md).

## Scope

Measured on **one machine**, on **Windows**, against **branded browsers**, with
**Playwright 1.63.0**. The egress suite's CI target is `ubuntu-latest` with Playwright's own
Chromium — **a different cell, and still `UNKNOWN`**. Per
`docs/architecture/constitution.md` and `AGENTS.md` §5, this fills the cell it tested and no
other.
