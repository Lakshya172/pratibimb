# E8 (click half) — do local postconditions confirm clicks, and does CONFIRMED mean the effect?

> **Headline:**
> - UNKNOWN does **not** dominate: 1 of 10 dispatched click actions.
> - The problem is the opposite one: **CONFIRMED is mostly a landing signal, not an effect signal.**
>   With the postcondition kinds on `main`, only **3 of 10** dispatched actions have a postcondition
>   that tests the effect they were for.
> - **One is CONFIRMED although the effect did not happen**: a checkbox whose click the page cancels.

- **Date:** 2026-09-13 · **Workstation:** W2 (`LAPTOP-SRCINK2B`) · **Cell:** Chrome for Testing
  153.0.8010.12 headless via Playwright, `page.mouse.click` (trusted CDP input, the MVP-1/MVP-2
  mechanism; **not** an extension's, which is E6), 127.0.0.1
- **Pre-registered:** click plan, local rule and predicted outcomes at `0009184`; unchanged when run
- **Log:** [`logs/e8.json`](logs/e8.json) · **Verdict:** [`decision.md`](decision.md)

## Hypothesis

On a demo-style form, locally derived postconditions yield enough CONFIRMED results that a scripted
click plan is not dominated by UNKNOWN.

## Environment

- **Pipeline:** `main` @ `eb4604b` `guardedAct` (VALIDATE → HIT-TEST → ACT → VERIFY RESULT). No retries, no model.
- **Hit-test bridge:** raw `elementFromPoint`, MVP-2 templates copied verbatim.
- **Local rule:** only the kinds on `main` are available (`FOCUS_ON_TARGET`, `TARGET_ENABLED`, `TARGET_NAME`). The last two need an expected value that only page-specific knowledge could supply (a planner claim, which may not produce CONFIRMED), so **every clickable role gets `FOCUS_ON_TARGET`**.
- **Effect oracle:** the harness's knowledge of its own fixture (focused / checked / visible / hash). **Never available to the product.** It exists only to test what CONFIRMED means.
- **Design:** 11 actions × 10 fresh-page runs = 110.

## Expected result

Pre-registered predictions per action in `harness/cases.mjs`.

## Actual result

Every action gave the same outcome in all 10 runs.

| Action | Role | Verification | Intended effect happened? | Does the postcondition test the effect? | Predicted? |
|---|---|---|---|---|---|
| A1 Full name textbox | textbox | CONFIRMED | yes | **yes** (focus is the effect) | ✓ |
| A2 Mobile textbox | textbox | CONFIRMED | yes | **yes** | ✓ |
| A3 click the "Date of birth" **label** | label | **NOT_CONFIRMED** `FOCUS_ELSEWHERE` | **yes** (focus moved to the input) | no: wrong rule for labels | ✓ |
| A4 checkbox "Same as permanent address" | checkbox | CONFIRMED | yes | **no**: landing only | ✓ |
| **A5 checkbox the page cancels** | checkbox | **CONFIRMED** | **NO** | **no, a false confirmation of effect** | ✓ |
| A6 radio "Urban" | radio | CONFIRMED | yes | no: landing only | ✓ |
| A7 "Show address fields" disclosure | button | CONFIRMED | yes | no: landing only | ✓ |
| A8 toggle that renames itself | button | CONFIRMED | yes | no: landing only | **✗** predicted UNKNOWN `TARGET_IDENTITY_CHANGED` |
| A9 "Next step" removes itself | button | **UNKNOWN** `TARGET_ABSENT_AFTER_ACTION` | **yes** | no | ✓ |
| A10 State select | listbox | CONFIRMED | yes | **yes** (focus) | ✓ |
| A11 Help link | link | NOT_CONFIRMED `ACTION_NOT_DISPATCHED` (confirmation tier) | no | — | ✓ |

**Totals over 110 runs:** 100 dispatched · 80 CONFIRMED · 20 NOT_CONFIRMED (10 of them A11, never dispatched) · 10 UNKNOWN ·
**10 CONFIRMED with the effect absent** (A5) · **20 not confirmed with the effect present** (A3, A9).
Predictions matched for 10 of 11 actions.

**The A8 miss, explained from source:** `verifyResult.ts` re-identifies the acted element by stable
selector and raises `TARGET_IDENTITY_CHANGED` **only when its role changes**, never its name. A toggle
that renames itself is therefore confirmed. My prediction assumed names were compared.

The consequence worth stating: a button that, *after* the click, keeps its selector and role but is now
named something else entirely is still confirmed by `FOCUS_ON_TARGET`. That is often the intended
effect, which is presumably why names are not compared. It also means post-click identity is
selector + role.

## Conclusion

1. **UNKNOWN is not the bottleneck** on this plan: 1 of 10 dispatched actions (A9).
2. **CONFIRMED overstates what was established.** For checkboxes, radios, disclosures and toggles,
   `FOCUS_ON_TARGET` confirms the click *landed*, not that the state it was for arrived. A5 demonstrates
   the failure directly: the page refused the toggle, and verification said CONFIRMED.
3. **Narrowly defined postconditions would close it.** Each is derived locally from the pre-click
   observation (never from a planner), and **each needs a field the element graph does not carry today**:

| Proposed kind | Applies to | Local expectation | Needs in `DomMeasurement` / `ElementNode` |
|---|---|---|---|
| `CHECKED_STATE_IS` | checkbox, radio | checkbox: `!checkedBefore`; radio: `true` | `checked` |
| `EXPANDED_STATE_IS` | controls with `aria-expanded` | `!expandedBefore` | `expanded` |
| `FOCUS_ON_LABELLED_CONTROL` | label with `for` | focus on the control the label names | the label→control relation |

   **A9-style navigation** (the control removes itself) has no local expectation that is not generic
   change detection, which is out of bounds. It stays UNKNOWN, then a bounded re-observe, then NEEDS_USER.
4. These are perception-contract changes plus verifier kinds, for an owner decision, **not** applied here.

## Reproducibility

```bash
npm run typecheck    # main's API; the harness refuses to run against the permit branch
CHROME_PATH="<chrome for testing>" node artifacts/experiments/E8-click-postconditions/harness/run-e8.mjs
```

The TYPE half of E8 (`VALUE_MATCHES_REF`) needs E6 and is not part of this record.
