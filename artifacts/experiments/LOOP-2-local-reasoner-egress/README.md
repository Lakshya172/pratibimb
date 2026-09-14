# LOOP-2 — a local model, a real network, and the first proof of what leaves

> **W2 evidence, 2026-09-14.** A single-task prototype. The model is a replaceable component and not
> a security authority; the client is still the enforcement point.

- **Workstation:** **W2** (`LAPTOP-SRCINK2B`, AMD Ryzen AI 7 350, 16 cores, Windows 11 10.0.26200) ·
  **Node** v26.4.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12**, headless, no extension loaded
- **GPU: not used.** The llama.cpp **CPU x64** build was chosen deliberately, so these numbers are
  the ones a judging machine without a GPU would see. No CUDA runtime was downloaded.
- **Log:** [`logs/w2-cft153-reasoner-loop.json`](logs/w2-cft153-reasoner-loop.json) ·
  **The outbound bytes:** [`logs/w2-outbound-payload.json`](logs/w2-outbound-payload.json) ·
  **Verdict:** [`decision.md`](decision.md)

## Approval, and why this record starts with it

E9 stopped at the weight-download boundary because **no record of approval existed**, and
`agentos/blockers.md` still names "download approval" as a required owner decision. That gate was
respected here: work paused before any download, the requirement was reported, and the owner gave
**explicit approval for this model, this quantisation and this runtime** on 2026-09-14. Nothing was
downloaded before that.

| | |
|---|---|
| Model | `Qwen/Qwen2.5-0.5B-Instruct-GGUF` |
| Revision | **`9217f5db79a29953eb74d5343926648285ec7e67`** (pinned; never `main`) |
| File | `qwen2.5-0.5b-instruct-q4_k_m.gguf` · **Q4_K_M** · **491.4 MB** · sha256 `74a4da8c9fdbcd15…` |
| Licence | **Apache-2.0 — VERIFIED AT THE REVISION**, by fetching the `LICENSE` file at `9217f5db…` and reading it (11 343 B), not by trusting the card tag. SECURITY.md §7. |
| Runtime | llama.cpp **`b10956`**, `llama-bin-win-cpu-x64` (18.4 MB), **MIT** |
| Download | 351.8 s for the weights, on this connection |
| Committed | **No.** `.gitignore` excludes `*.gguf` and `models/`. Acquisition is scripted and recorded in `models/qwen2.5-0.5b-instruct-gguf/acquisition.json`. |

## Hypothesis

A small open-weight text model, reached over a **real** network boundary, can plan this task from a
representation that contains none of the user's values — and the client can prove, from the actual
HTTP request body, that none of them left. Replacing the deterministic planner with it changes
nothing about who is in charge: every answer still goes through plan validation, privacy binding, a
human grant and the existing permit gate, and a model that misbehaves is refused rather than
accommodated.

**What would falsify it:** any vault value in the outgoing bytes; a client digest that does not match
what the server received; a model plan reaching a page without validation, a grant or a permit; a
hostile response being silently replaced by a working plan; or the security pipeline needing to be
weakened to get the model to work.

## Environment

| | |
|---|---|
| Acquisition | [`harness/fetch-model.mjs`](harness/fetch-model.mjs) — pins the revision, verifies the licence at it, hashes the bytes |
| Service | [`tests/browser/demo/reasoner-service.mjs`](../../../tests/browser/demo/reasoner-service.mjs) — a recording front on `127.0.0.1:8978` in front of `llama-server` on `127.0.0.1:8977` |
| Runner | [`tests/browser/demo/run-reasoner-loop.mjs`](../../../tests/browser/demo/run-reasoner-loop.mjs) |
| Code under test | the **built** packages the Planning View imports |
| Not present | no extension, no GPU, no VLM, no screen capture, no OCR, no detector |

## Expected result

1. A real HTTP request reaches a model service on this machine, and its body carries **reference
   tokens and no values**.
2. The client's egress digest and the server's independently computed digest **agree**.
3. The model's plan is validated, granted, rehydrated, clicked and read back: **CONFIRMED**.
4. A service that answers with a value the client holds locally is **refused at VALIDATE_PLAN**, and
   **does not fall back** — falling back would replace a caught leakage event with a success.
5. An unavailable model **falls back** to the deterministic planner, through the same validation, and
   the loop completes.

## Actual result

**PASS** — 17 of 17 checks.

| Run | Outcome |
|---|---|
| **MODEL** | `DONE` · **CONFIRMED** · 2 040 ms · plan `insert <PII:PHONE:1> → #mobile_confirm`, `click #submit` |
| **REFUSAL** | `REFUSED` at `VALIDATE_PLAN` · `VAULT_LITERAL_ECHO` · **`fellBack: false`** · 0 rehydrations, 0 clicks, page untouched |
| **FALLBACK** | `DONE` · **CONFIRMED** · `DETERMINISTIC_FALLBACK`, through every gate |

### The payload proof — the actual HTTP request body

Captured by the receiving service, not reconstructed by the sender.

| | |
|---|---|
| Bytes received | **2 679** |
| Tokens present | `<PII:AADHAAR:1>` `<PII:DOB:1>` `<PII:NAME:1>` `<PII:PHONE:1>` |
| Vault values present | **0 of 5** — checked exactly, against the values the vault actually held |
| Client digest | `26d7c09f78e318eb…` |
| Server digest | `26d7c09f78e318eb…` |
| Agree | **yes** |

Two parties computed that digest separately.

**The exact body is committed** as [`logs/w2-outbound-payload.json`](logs/w2-outbound-payload.json) —
the bytes as the receiving service got them, not a reconstruction by the sender — so it can be read
rather than taken on trust. The runner **refuses to write that file unless the value check passed**,
so the artifact guards itself. The per-request working captures under `logs/captures/` are not
committed: `.gitignore` excludes `captures/` to keep screen captures out of the repository, and that
rule was left alone rather than routed around.

### Latency — **small sample, not a benchmark**

Six warm repetitions on one machine, one fixture, one quantisation, CPU only. **No statistical
generalisation is claimed.**

| | |
|---|---|
| Service startup, including model load | **2 124 ms** |
| Cold run, whole loop | **2 040 ms** (of which `send` 2 020 ms) |
| Warm runs | 579, 587, 595, 609, 616, 623 ms |
| p50 · p95 · max | **609 · 623 · 623 ms** |

Per-stage on the cold run: observe 3 · sanitize 7 · verify payload 0 · **send 2 020** · validate 0 ·
grant 0 · rehydrate 1 · refresh 1 · act 4 · verify result 1 ms. The reasoner dominates completely;
every enforcement stage together is under 20 ms.

### Resource

Peak RSS via `tasklist`, sampled once. Indicative, not profiled.

| | |
|---|---|
| `llama-server.exe` | **557 MB** |
| `node.exe` | 130 MB |
| GPU memory | **not used by this run** |

## What the model actually does, measured rather than assumed

A 0.5B model given the bare schema produced **schema-valid nonsense**: inserting a name into a
button, clicking a text field, inventing `token:PII:NAME:1`. Three changes fixed it, and the record
is kept because the failure is as informative as the success:

| Prompting | Result |
|---|---|
| Bare JSON schema | schema-valid, semantically wrong, invented references |
| Enum-constrained `target` and `ref` + role/empty structure | real tokens, still wrong field, still wrong click |
| **+ one worked example in another domain** | **5/5 correct**, p50 475 ms at the adapter |

None of that is a security control. It is how a small model is made useful, and every output still
goes through the validator — which is why the wrong plans earlier in that table were refusals rather
than incidents.

## Two things this run caught in our own code

1. **`Buffer` is not a browser global.** The egress guard used `Buffer.byteLength`; in the browser it
   threw, and because the `try` wrapped record construction as well as the `fetch`, the
   `ReferenceError` surfaced as **`TRANSPORT_FAILED`** — a defect in our module wearing a network
   failure's clothes. The `try` now covers the `fetch` and nothing else, lengths come from
   `TextEncoder`, and two tests pin both.
2. **The prompt's worked example leaked a token shape.** It used `<PII:EMAIL:1>`, a reference the
   handoff never issued, and the guard refused the entire request. The guard was right; the example
   changed. The decoder's enum means the model can still only name references that exist.

## Conclusion

On W2, a small open-weight model on loopback planned a real task; a real HTTP request carried
**four opaque references and none of the five values**; the client and the server agreed on the digest
of the exact bytes; the plan went through validation, a human grant, local rehydration and the
existing permit gate to a page-confirmed result. A service that answered with a secret was refused
before anything happened and was **not** quietly replaced by a plan that would have worked. An absent
service fell back to the deterministic planner through the same gates.

**The model gained no authority.** It cannot type, navigate, execute, bypass the human, reach the
vault, or be believed.

## What this does not establish

- **Not a benchmark.** Six warm runs, one machine, one fixture, one goal, one quantisation, CPU only.
- **Not production egress security.** One loopback destination, one service, no TLS, no authentication,
  no adversarial network.
- **Not general PII recall.** Five synthetic values on one fixture.
- **Not extension end-to-end.** Nothing ran through the extension — see `decision.md`.
- **Not a claim that this model is good.** It is the smallest thing that worked, and it needed careful
  prompting to work at all. `MODEL_PATH = EXPERIMENTAL`; `FALLBACK_PATH = VERIFIED`.

## Reproducibility

```bash
node artifacts/experiments/LOOP-2-local-reasoner-egress/harness/fetch-model.mjs
npm run typecheck
CHROME_PATH="C:\Users\OMEN\cft\chrome.exe" node tests/browser/demo/run-reasoner-loop.mjs
```

To drive it by hand: `node tests/browser/demo/reasoner-service.mjs` and
`node tests/browser/demo/server.mjs`, then tick **local model** at `http://127.0.0.1:8975/`.
