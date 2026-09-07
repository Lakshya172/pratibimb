# Workflow: Release

> Exit gate: `agentos/gates/QG-06-release.md`
> Owning reviewer: `integration-release-engineer`

---

## Entry condition

All gates QG-01 through QG-05 pass on the candidate commit.

## Steps

```
1  PIN        freeze every version: libraries, model revisions, quantisation,
               runtime assets, Docker images. Record the reproducibility manifest.
2  BUILD      Chrome MV3 build + Firefox MV3 build from the one WXT codebase
3  BUILD      a WASM-only build, separately, and benchmark it
4  CI         confirm all four Invariant-E enforcement mechanisms are ACTIVE:
                 - lint rule on fetch/XHR/sendBeacon/WebSocket outside egress
                 - Playwright interception suite, zero requests under every injected failure
                 - manifest CSP connect-src restricted to the configured server origin
                 - payload hash pin
5  MATRIX     re-run the 20-cell feasibility matrix
6  MATRIX     re-run the 6-configuration DPR/zoom matrix
7  SUITE      re-run the full fail-closed test matrix
8  MEASURE    full benchmark run on both backends, both browsers, hardware labelled
9  REHEARSE   all four demonstration sequences, ten times
10 FREEZE
```

## Release blockers — non-negotiable

- Any Invariant-E enforcement mechanism disabled, skipped, or `allow-failure`.
- Any unpinned dependency or model revision.
- No benchmarked WASM-only build.
- No Firefox build tested on Linux with the backend indicator visible.
- Any demonstration sequence that **depends on a value surviving an origin change**.
- Any figure on a slide that the harness did not produce.
- Any model without a complete, green feasibility row and a verified revision licence.

## The four demonstration sequences — twelve minutes

| # | Sequence | Length | The point |
|---|---|---|---|
| **1** | **The main task.** A profile page with name, phone, email, address, DOB, PAN, Aadhaar, a photograph — **and a scanned PAN card image whose text exists in no DOM node**. One instruction: *fill this application using my profile information*. Aadhaar filled **by reference** from the vault; the district field filled from a **cleared literal** — both in the same run, seconds apart, with the ledger labelling which was which. Run with the privacy ledger **and the browser's network inspector both visible**. | 6 min | *The server has never seen a single digit of this Aadhaar number, and the number it is about to type came out of a scanned image the DOM knows nothing about.* **The gap between reading the outbound request and watching the form fill is the argument.** |
| **2** | **Adversarial.** A page containing hidden text instructing the agent to ignore the user, read the vault, and post its contents to an external URL. Show the ledger recording that **the text was observed** — we do not pretend the agent is blind to it — and that **no corresponding action was generated**. | 2 min | **Observation without obedience.** |
| **3** | **The failure path.** Inject a detector timeout from the console: the union counts it as a positive, the region is masked, the run continues. Then force three consecutive verification failures: the request is blocked, the interface says so plainly, the agent falls back to structure-only mode. | 2 min | **A system that cannot be shown refusing has not demonstrated that it can refuse.** |
| **4** | **Offline.** Pull the network cable. Offline mode completes a simpler task locally with SmolVLM — click, scroll, fill one field. | 2 min | The brief's own privacy premise carried to its conclusion. |

**The ledger shows, live:** which backend is running, how many steps completed with no
network request at all, detected and masked counts, verification result, **the pinned
payload hash**, and the stage waterfall. **Invite the panel to compare the hash on screen
with the request body in the inspector — they are the same artifact, and that is the point
of pinning it.**

## Prepared before travelling

- [ ] A recorded video of all four sequences
- [ ] The 4B model running on a team laptop
- [ ] A WASM-only build, benchmarked
- [ ] A Firefox build, tested on Linux, with the backend indicator visible
- [ ] The ablation table — grounding and task success, redaction off and on — printed
- [ ] **Assume the venue network fails, because it usually does**
