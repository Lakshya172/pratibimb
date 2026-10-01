# LOOP-1 — the first complete product loop, against a real browser

> **W2 evidence, produced on 2026-09-14.** It describes a single-task prototype loop over one
> synthetic fixture. It is not a general browser agent, it does not involve a model, and no byte left
> this machine.

- **Date:** 2026-09-14 · **Workstation:** **W2** (`LAPTOP-SRCINK2B`, AMD Ryzen AI 7 350, Windows 11
  10.0.26200) · **Node** v26.4.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12**, headless, `C:\Users\OMEN\cft\chrome.exe`, launched
  by Playwright with `chromium.launch({ headless: true, executablePath })`. **No extension is loaded.**
- **GPU:** not used by this run, and therefore not recorded as evidence.
- **Log:** [`logs/w2-cft153-demo-loop.json`](logs/w2-cft153-demo-loop.json) · **Verdict:** [`decision.md`](decision.md)

## What was built

The chain the architecture has been describing, end to end, for one task:

```
OBSERVE → SANITIZE → VERIFY PAYLOAD → SEND → VALIDATE PLAN → REFRESH
        → HUMAN GRANT → REHYDRATE → ACT → VERIFY RESULT
```

| Layer | Package | Authority |
|---|---|---|
| Untrusted boundary | `@pratibimb/reasoner` | returns `unknown`; refuses to send an unverified handoff |
| Plan contract and validation | `@pratibimb/plan` | plan **structure** only; calls privacy for values |
| Sequencing | `@pratibimb/orchestrator` | one task, once; decides nothing the others decide |
| Privacy | `@pratibimb/privacy` (unchanged) | classification, vault, verifier, binding, literal check |
| Execution | `@pratibimb/agent` | freshness, hit test, permit, dispatch, VERIFY RESULT |
| Planning View | `apps/demo` | renders the run's own objects |

## Hypothesis

A client can take a real page, send a representation containing none of its values to an untrusted
reasoner, receive a plan written in opaque references, validate it, obtain one explicit human
permission, restore the value **locally**, perform exactly one click through the existing audited
path, and read the page back — and **refuse** the same flow when the reasoner returns the value
itself, without executing anything.

**What would falsify it:** any local value in the payload, the ledger, the kept plan or any pane; a
refusal that quotes the secret; a literal-echo run that rehydrates, inserts, clicks or succeeds; a
success reported without the page being read back.

## Environment

| | |
|---|---|
| Fixture | [`tests/browser/demo/fixture/application.html`](../../../tests/browser/demo/fixture/application.html), served from `http://127.0.0.1:8975/fixture/` |
| Planning View | [`apps/demo/index.html`](../../../apps/demo/index.html), served from `http://127.0.0.1:8975/` in the same origin, driving the fixture in a frame |
| Server | [`tests/browser/demo/server.mjs`](../../../tests/browser/demo/server.mjs) — static files only; no routes that write, no proxy, and **not** a reasoner endpoint |
| Runner | [`tests/browser/demo/run-demo-loop.mjs`](../../../tests/browser/demo/run-demo-loop.mjs) |
| Code under test | the **built** packages (`packages/*/dist`), imported by the page through an import map — the shipped code, not a re-implementation |
| Reasoner | `deterministicReasoner`, in-process. No model, no network request |
| Values | synthetic (SECURITY.md §2), named here by class: a two-word person name, a ten-digit Indian mobile number, a Verhoeff-valid Aadhaar number, an ISO date of birth, a six-digit OTP |
| Not present | no extension, no model, no screen capture, no OCR, no detector, no egress client |

## Expected result

1. The Planning View loads, the fixture loads, and the console stays clean.
2. The success run walks every state and ends `DONE`.
3. The payload that crosses the reasoner boundary contains none of the five local values.
4. The plan is written in references; the human is asked once; the grant is one-shot and bound.
5. The value is restored locally and matches the registered number.
6. Exactly one click is dispatched, through `guardedAct`, as E6 mechanism B, at the permitted point.
7. VERIFY RESULT returns `CONFIRMED`, read back from the page.
8. The literal-echo run is refused at VALIDATE_PLAN with `VAULT_LITERAL_ECHO`, and asks no human,
   rehydrates nothing, touches no field, dispatches nothing, and quotes nothing.
9. All five panes render the run's own facts, and no server-facing pane shows a value.

## Two runs, one code path

The runs differ by **one argument** to `deterministicReasoner`. There is no demo-only branch and no
UI-only refusal — both go through the same `validatePlan` → `checkLiteral`.

| | SUCCESS | REFUSAL |
|---|---|---|
| Reasoner returns | `<PII:PHONE:1>` | the phone number itself |
| Path | IDLE→OBSERVE→SANITIZE→VERIFY_PAYLOAD→SEND→VALIDATE_PLAN→AWAIT_GRANT→REHYDRATE→ACT→VERIFY_RESULT→**DONE** | IDLE→OBSERVE→SANITIZE→VERIFY_PAYLOAD→SEND→VALIDATE_PLAN→**REFUSED** |
| Human asked | yes, once | **no** |
| Rehydrated | 1 reference, locally | **nothing** |
| Clicks dispatched | 1 | **0** |
| Page afterwards | "Application submitted", submit disabled | "Not submitted", field still empty |
| VERIFY RESULT | **CONFIRMED** | no action was dispatched |

**Why the hostile reasoner has to be handed the number.** It cannot derive it from the handoff — the
handoff contains no values, which is the thing being demonstrated. The page reads the registered
number out of its own DOM and gives it to the simulated attacker. That necessity is the evidence.

## Actual result

**PASS** — 31 of 31 checks. Recorded in the log; the table below is the summary.

| Group | Result |
|---|---|
| Success walks every state and ends DONE | **yes** |
| Plan used the reference, not a value | **yes** |
| Grant was explicit, one-shot, and bound to reference, field, origin and session | **yes** |
| Value restored locally, and it was the right value | **yes** |
| Went through the audited path (hit-test MATCH, permit, EXECUTED) | **yes** |
| Dispatch was **E6 mechanism B** at the **exact permitted point** | **yes** |
| VERIFY RESULT returned CONFIRMED, read back from the page | **yes** |
| Refusal stopped at VALIDATE_PLAN with `VAULT_LITERAL_ECHO` / `LEAKAGE_EVENT` | **yes** |
| Refusal asked no human, rehydrated nothing, touched nothing, dispatched nothing | **yes** |
| Refusal kept only `⟨literal:PHONE⟩` and dropped the raw response bytes | **yes** |
| No local value in the payload, ledger, plan, refusal, grant, or any server-facing pane | **yes** |
| The **local** pane does show the value — the contrast is the demo | **yes** |
| OTP never received a reference | **yes** |
| Console clean | **yes** |
| All five panes render the run's own facts | **yes** |

### Latency — W2, single sample each, not a benchmark

| Stage | SUCCESS | REFUSAL |
|---|---|---|
| observe | 6 ms | 1 ms |
| sanitize | 7 ms | 3 ms |
| verify payload | 0 ms | 0 ms |
| send | 1 ms | 1 ms |
| validate plan | 1 ms | 0 ms |
| grant | 0 ms (auto-approved in this run) | — |
| rehydrate | 1 ms | — |
| refresh | 2 ms | — |
| act (gate + dispatch) | 7 ms | — |
| verify result | 1 ms | — |
| **total** | **26 ms** | **5 ms** |

One sample per stage on one machine. The reasoner is in-process, so `send` measures a function call
and **not** a network round trip; a real model would dominate this table entirely.

## What ran through the extension: nothing

**The loop is NOT PROVEN through the real extension path**, and the evidence above must not be
described as extension end-to-end proof.

| Path | How the loop actually ran |
|---|---|
| Observation, insertion, hit test, dispatch | `apps/demo/src/pageAdapter.ts`, driving a **same-origin frame directly**. It imports no `chrome.*` API and nothing from `@pratibimb/extension-transport`. |
| Content script · service worker · offscreen document · side panel | **took no part** |
| Browser | headless, **no extension loaded** |

Running the loop through the extension needs a content-script surface, a side-panel host for the
Planning View, and a host-side command surface that does not exist — the offscreen control plane is
reachable only from inside the offscreen realm. That is integration work, not a test, and it was out
of scope for this section.

What *was* checked, as a narrow host regression:
[`logs/w2-cft153-extension-load.json`](logs/w2-cft153-extension-load.json) — the built MV3 host still
loads in **Chrome for Testing 153, headed** (`launchPersistentContext` with
`--disable-extensions-except` + `--load-extension`), its service worker boots, and the manifest's
pinned `connect-src` and loopback-only host permission are intact. `loopExercisedThroughExtension` is
recorded as `false` in that file.

## Three things the runs caught

1. **The gate refused to click an offscreen control.** The first browser attempt failed at ACT with
   `TARGET_ABSENT_AFTER_REFRESH`: the submit button was below the frame's viewport, so perception
   marked it OFFSCREEN and the gate would not attest a point it could not see. The frame was made
   tall enough. The check was not weakened.
2. **The gate refused a fractional dispatch point.** Browsers truncate `MouseEvent.clientX`, so the
   box centre of a real layout can never be dispatched exactly, and the exactness check correctly
   refused to fire. The orchestrator now fixes an integer point **before** the permit is minted, so
   the permit names a point the browser can reproduce; every other gate still runs against it.
3. **A unit test caught a leak in our own record.** The refusal never quoted the echoed secret, but
   the run record held the raw reasoner response — so a log, a screenshot or the Planning View would
   have put the leaked value back on screen. The raw bytes are now parsed and dropped, and what is
   kept is a projection in which a literal is replaced by its class.

## Conclusion

On W2, in Chrome for Testing 153.0.8010.12, the complete chain ran against a real page: a
representation containing none of the page's values crossed the reasoner boundary, a plan written in
opaque references came back, the client validated it, one human permission authorised one use of one
value, the value was restored locally, one click went through the existing permit gate, and the page
was read back — `CONFIRMED`. The same code path, given a reasoner that returned the value instead of
the reference, refused before anything happened and left the page untouched.

The claim this supports is narrow and worth stating exactly: **the privacy boundary holds while a
real task completes through it, and it stops the task when the boundary is violated.** It is one
task, one page, one action, one machine, and one deterministic planner standing where a model will
go.

## The hardening pass, and the two defects it found

A review of this section against the frozen contracts, before any reasoner work, corrected two things
in the code it had just built. Both were places where a layer had quietly become more opinionated
than the contract allows.

1. **`validatePlan` refused every literal.** `docs/architecture/action-schema.md` calls a schema that
   cannot express a non-sensitive literal *"a functional defect"* — *search for Chandrayaan-3, select
   Punjab, enter 2026* has to be expressible — and answers it with three checks, not a prohibition.
   The validator now accepts a literal that passes all three (no redaction token on the target,
   nothing PII-shaped, not a value the vault holds) as a distinct `source: "literal"` step that needs
   no vault reference, no rehydration and no human grant, because there is no secret to release. The
   three refusals are unchanged and re-asserted at the same target.
2. **The orchestrator had a second field classifier.** `machine.ts` decided what a field accepts with
   a handful of regular expressions over accessible names, and that answer fed `bind()`'s class
   check — two classifiers that could disagree about what a field is, with the weaker one deciding.
   It now calls `classifyField`, privacy's own D1 channel, which reads the autocomplete attribute,
   the input type, the name and the label, and returns `UNKNOWN` when signals conflict.
   `packages/orchestrator/test/boundaries.test.ts` scans the source so it cannot come back.

## Reproducibility

```bash
npm run typecheck
CHROME_PATH="C:\Users\OMEN\cft\chrome.exe" node tests/browser/demo/run-demo-loop.mjs
```

To click through it by hand: `node tests/browser/demo/server.mjs`, then open
`http://127.0.0.1:8975/`. Deterministic: fixed fixture, fixed port, fixed viewport, no network beyond
loopback, no model, no detector, no timers.

## What this does not establish

- **Nothing about a model.** The reasoner is a deterministic planner in the same realm.
- **Nothing about network egress.** There is no egress client; the ledger records intent, and
  INV-01/INV-02 remain SPEC. `transport: "IN_PROCESS"` is recorded so no artifact can imply otherwise.
- **Nothing about a general agent.** One goal, one page, one action, no retry, no recovery, no
  multi-step loop.
- **Nothing about production privacy.** The vault is a memory-only prototype; the name detector is a
  shape test; no general PII recall or non-inferability is claimed.
- **Nothing about the extension.** No extension was loaded. `apps/extension` is untouched.
- **One machine, one browser.** W2, Chrome for Testing 153.0.8010.12.
