# Presenter runbook — SIH internal / inter-level selection

> **W2 (`LAPTOP-SRCINK2B`), Chrome for Testing 153.0.8010.12.** Five minutes. Three acts. One line
> to land: **the model proposes, the client decides.**

## Before the room fills

```bash
npm run typecheck
npm run demo -- --rehearse 3
```

Expect `PASS`, and three rows where success is `CONFIRMED`, refusal is `LEAKAGE_BLOCKED`, fallback is
`CONFIRMED_VIA_FALLBACK` and `unexpected=false`. If any row disagrees, **do not present that act** —
go to [Contingency](#contingency).

Then start the live system and leave it alone:

```bash
npm run demo:present
```

It prints `READY` and hands you a browser at `http://127.0.0.1:8975/`. Services and model come up in
under two seconds. Ctrl-C stops everything.

**Press `Reset` before your first act.** The rehearsal leaves the page in whatever state it ended in.

---

## The script

### 00:00–00:30 · The problem

> "Browser agents need to see your page to act on it. That means your name, your phone number, your
> Aadhaar number, your date of birth go to whatever model is doing the reasoning. PratiBimb is a
> privacy firewall that happens to power an agent."

Point at **On your device** once the run starts — the page holds all five. Point at the header: *The model
proposes. The client decides.*

### 00:30–01:00 · The goal

> "One instruction: **submit my application with my registered mobile number.** The number is on the
> page. The agent has to use it. It must never leave this laptop."

Read the **Task** card aloud. It is deliberately large.

### 01:00–01:45 · Local versus server — *the whole demo is this one comparison*

Press **Run the task**. While it runs, put a finger on each side of the boundary:

| **On your device** — Trusted | **What the reasoner sees** — Untrusted |
|---|---|
| the real mobile number | `<PII:PHONE:1>` |
| the real Aadhaar number | `<PII:AADHAAR:1>` |
| the real date of birth | `<PII:DOB:1>` |
| the real name | `<PII:NAME:1>` |
| the OTP | **no reference at all** |

> "Left is this machine. Right is what crosses the boundary. Same row, same field — a value on the
> left, an opaque reference on the right. The OTP does not even get a reference: it is classified
> CRITICAL, so it is masked with no way to ask for it back."

The reasoner side also shows the safe hint the model *does* get: `10 digits`. Enough to plan with,
not enough to be the number.

### 01:45–02:15 · The reasoner

> "That went over real HTTP to a real language model running on this laptop — Qwen2.5-0.5B, on the
> CPU, no GPU. It planned from references it cannot resolve."

**Model proposes** shows the plan it returned, and **Client decides** answers ✓ ALLOWED:

```
Fill   Confirm mobile number   with <PII:PHONE:1>
Click  Submit application
```

> "It asked for a reference to be put somewhere. It never saw a value and it never asks for one."

### 02:15–02:45 · The human

The **Human approval** card lights up and the pipeline sits on AUTHORIZE. Read it:

> "Use your registered **phone** to fill *Confirm mobile number*, then click *Submit application*? —
> this page, this field, this session, **once**. Not stored, not a standing permission."

Press **Approve once**.

### 02:45–03:15 · Local rehydration

> "The value is restored **here**, by the trusted client, after you said yes. It did not come back
> from the model — the model never had it."

**Restore & act**: `<PII:PHONE:1>` → Restored locally → Confirm mobile number filled.

### 03:15–03:45 · The action, and the result

> "Then one click, through the existing permit gate — hit-tested, freshness-checked, dispatched as a
> real pointer sequence. And the result is *read back off the page*, not assumed."

**TASK COMPLETED** is on screen, with *Privacy checks passed* and *Action verified*. The form says
*Application submitted*.

### 03:45–04:15 · What actually left

Scroll to **Data leaving device**. This is the one to linger on.

> "Two thousand six hundred and seventy-nine bytes left this device. Here is their SHA-256. Here is
> the digest the receiving service computed **independently** on the bytes it received. They match.
> Four references went; zero of the five values did."

### 04:15–04:45 · The adversarial model

Press **Compromised reasoner**.

> "Now the reasoner is hostile. It answers with the actual mobile number instead of the reference —
> the number it was never given."

### 04:45–05:00 · The line

**BLOCKED**, in red, on the client card and the banner. The device's *Mobile number* row is marked
*Returned by the model*, and the banner lists *No value restored · No action executed · No quiet fallback*.

> "The client recognised a value it holds locally and never sent. Refused before rehydration, before
> the human was asked, before anything was clicked. And it did **not** quietly fall back to a plan
> that would have worked — that would turn a caught attack into a success.
>
> **The model proposes. The client decides.**"

---

## If you have a spare minute

Press **Model outage** — a real refused connection to a dead port.

> "The model is gone. The deterministic planner answers instead, through the same validation, the
> same human grant, the same permit gate. **TASK COMPLETED — via fallback.** The security pipeline does not
> depend on the model being there — or on it being honest."

---

## Contingency

Nothing here disables a security check. If a gate refuses, **that is the product working**; say so.

| What happens | What to do |
|---|---|
| **Model will not start / weights missing** | `node artifacts/experiments/LOOP-2-local-reasoner-egress/harness/fetch-model.mjs`. If there is no time: present **Model outage** first and narrate the deterministic path. The loop is complete without the model. |
| **Port already in use** | A previous demo is still running. The runner tells you the exact command to free the port; or Ctrl-C in the other terminal. |
| **Reasoner slow or times out** | Wait — cold is ~1.2 s, warm ~0.5 s. If it hangs, press `Reset`, then **Model outage**, and say the model is a replaceable component. |
| **Page in a strange state** | `Reset`. It reloads the frame, clears the view and the egress log, and gives the document a fresh identity. |
| **Browser crashes** | Ctrl-C, `npm run demo:present` again. Under ten seconds. |
| **An unexpected refusal** | Read it out. The **Client decides** card and the banner name the stage and the cause. A refusal you did not plan is still the system doing its job — do not retry it hoping for a different answer. |
| **Extension question** | Answer honestly: this is the **direct / in-process** path. The extension host builds and loads; the loop has not been run through it. See the cheat sheet. |
| **Anything looks fabricated** | Open `artifacts/experiments/DEMO-1-sih-rehearsal/logs/` and the LOOP-2 payload artifact. Offer the runner. |

**Never** say a number, a guarantee or a capability that is not on screen. The
[judge cheat sheet](judge-cheat-sheet.md) has the defensible answers.

---

## What the rehearsal measured

**DEMO REHEARSAL MEASUREMENTS — not benchmark results.** Five rounds, one machine, one fixture, CPU
only, no GPU.

| | |
|---|---|
| Rounds, all three acts | **5 of 5 clean**, 23 of 23 checks, no unexpected failures |
| Services up and model ready | **1.6 s** |
| Success act | **1.2 s** cold, then **0.5–0.6 s** |
| Whole round (three acts + resets) | 0.6–1.8 s |
| `llama-server.exe` | 558 MB · `node.exe` 55 MB · GPU unused |

If the success act takes noticeably longer than a second when warm, something is wrong — that is the
signal to reach for the contingency table, not to press it again.

These say what "normal" looks like so you can tell a slow model from a broken one. They are not
evidence of performance and must not be quoted as such.
