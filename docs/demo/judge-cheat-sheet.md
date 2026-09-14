# Judge cheat sheet

> Every answer below is something the demo on W2 **actually does**, or something this repository
> measured. Where the honest answer is "we have not shown that", it says so. Nothing here may be
> upgraded under questioning.

---

### 1. Where is the AI?

On this laptop. **Qwen2.5-0.5B-Instruct**, Q4_K_M, running under llama.cpp bound to `127.0.0.1`, CPU
only — the GPU is not used. The demo reaches it over real HTTP, which is why pane 5 can show you the
exact bytes and their digest.

It is a **replaceable component, not a security authority**. Swap it for any other model behind the
same interface and nothing after the boundary changes.

### 2. What does the server receive?

Pane 3, live. The page structure, the goal in the user's words, and one opaque reference per
sensitive field — `<PII:PHONE:1>`, `<PII:AADHAAR:1>`, `<PII:DOB:1>`, `<PII:NAME:1>` — each with a
**safe hint**: length, character kind, and field role. `len 10 · numeric · tel` is enough to plan
with and is not the number.

The OTP gets **no reference at all**. It is classified CRITICAL, so it is masked with no token, which
means there is no way for the reasoner to even ask for it.

### 3. How do you know the secret did not leave?

Three independent things, and you can check all of them:

1. **The bytes are scanned before they go.** The egress module serializes once and that same string
   is scanned against the values the vault actually holds — exactly, and under normalisation — then
   hashed, recorded and sent. There is no path where one thing is checked and another transmitted.
2. **Two parties agree on the digest.** Pane 5 shows this client's SHA-256 of what it sent beside the
   digest the receiving service computed on what it got. In the rehearsal both were
   `26d7c09f78e318eb…`.
3. **The body is on disk.** `artifacts/experiments/LOOP-2-local-reasoner-egress/logs/w2-outbound-payload.json`
   is the exact request body as the receiving end got it — 2 679 bytes, four references, **zero of
   five values**. The runner refuses to write that file unless the value check passed.

### 4. What happens if the model returns the secret?

Press **Compromised reasoner** and watch. The service answers with the real mobile number instead of
the reference. The client refuses at plan validation with `VAULT_LITERAL_ECHO`: **0 rehydrations,
0 clicks, nothing executed**, and the value is never quoted in the record, the log or the screen.

It also does **not** fall back to a plan that would have worked. A model that *failed* may be
replaced by the deterministic planner; a model that *misbehaved* may not — falling back there would
convert a caught attack into a success.

### 5. Can the model type arbitrary values?

No. The executable action allowlist is `["click"]`. **There is no TYPE action.**

`insert` is a request to the *trusted client*, not an agent action: the value never enters a plan, a
permit or the reasoner, and the restoration is done locally by the client after a human grant. The
model can ask for a reference to be placed somewhere; it cannot supply text to type.

### 6. Can the model bypass the permission system?

No, and the reason is structural rather than procedural. The dispatch permit is unforgeable — a
module-private `WeakSet`, so a permit-shaped object made anywhere else is not a permit. The human
confirmation works the same way and is **spent as the permit is minted**, so it cannot be replayed.
The click goes through `guardedAct` and through nothing else; the orchestrator contains no dispatch
of any kind.

The model's output is `unknown` until a parser turns it into a plan, and the parser is the only way
that happens.

### 7. What happens if the model crashes?

Press **Model outage**. The client makes a real request to an address with nothing behind it, the
connection is genuinely refused, and the deterministic planner answers instead — through the same
validation, the same human grant, the same permit gate. **CONFIRMED · FALLBACK.**

`MODEL_PATH = EXPERIMENTAL`. `FALLBACK_PATH = VERIFIED`.

### 8. Why is the model so small?

Because the argument does not need a big one, and a small one makes the point better: if a 0.5B model
on a CPU can plan this from references alone, the privacy boundary is not buying its safety with
capability.

We are honest about what it cost. Given the bare schema it produced **schema-valid nonsense** —
inserting a name into a button, clicking a text field, inventing references that did not exist. It
took enum-constrained decoding plus one worked example to plan correctly. That table is in
`artifacts/experiments/LOOP-2-local-reasoner-egress/README.md`. Every one of those wrong plans was a
refusal rather than an incident, which is the actual point.

### 9. Why is Firefox not shown?

It is not implemented. The demo is Chrome for Testing 153 on this machine, and that is the only
browser any of this has been demonstrated in. Cross-browser support is not in scope for this
section and we are not claiming it.

### 10. Is this production-ready?

**No**, and we will not claim otherwise. It is a single-task prototype on synthetic data:

- one goal, one fixture, five synthetic values — **no claim of general PII recall**
- one loopback destination, no TLS, no authentication, no adversarial network — **not production
  egress security**
- a memory-only vault, not production storage
- three authorisation lifetimes that are stated by callers with **no measurement behind any of them**

### 11. Why not use a screenshot-only agent architecture?

Because a screenshot *is* the leak. Sending pixels of this page sends the name, the number, the
Aadhaar number and the OTP in one image, and you cannot redact what you have not classified. Working
from structure means the sensitive spans are identified **before** anything leaves, which is what
makes a reference substitution possible at all.

There is no VLM, no screen capture and no OCR anywhere in this demo.

### 12. What is the key contribution?

**The reasoner is untrusted, and the client is where the decisions are.**

The model plans over typed references it cannot resolve; the value is restored locally, only after a
human agrees, only for that field and that session, once; the action is click-only through an
unforgeable permit; and the result is read back off the page rather than assumed. When the reasoner
returns a secret, the client refuses and nothing runs.

**The model proposes. The client decides.**

---

## Where we are honest

| Claim | Status |
|---|---|
| A real HTTP request reaches a model on 127.0.0.1 | **PROVEN** |
| The request body carries references and no vault value | **PROVEN** |
| Client and receiving service agree on the digest of the exact bytes | **PROVEN** |
| A hostile response is refused and does not fall back | **PROVEN** |
| The model can widen no capability — no TYPE, eval or navigation | **PROVEN** |
| Model plan → validate → grant → rehydrate → guarded click → verified | **EXPERIMENTALLY VERIFIED** |
| An unavailable model falls back through the same gates | **EXPERIMENTALLY VERIFIED** |
| Demo reliability — 5 rounds, 15 acts, no unexpected failures | **PROVISIONAL — small sample** |
| Model plans this task reliably | **PROVISIONAL** — one goal, careful prompting |
| Latency figures | **PROVISIONAL** — rehearsal measurements, not a benchmark |
| **Full extension end-to-end** | **NOT PROVEN** — see below |
| Production deployment, TLS, adversarial network, general PII recall | **DEFERRED** |

### The extension, asked directly

**EXTENSION E2E = NOT PROVEN.** The demo drives a same-origin frame through the demo app's own page
adapter. No content script, service worker, offscreen document or side panel takes part. A separate
headed smoke run shows only that the built MV3 host loads and its service worker boots.

If a judge asks whether this runs as a browser extension today: **it does not**, and the integration
is real work that has not been done. The privacy architecture, the permit gate and the transport
layer it would use all exist and are tested; they have not been wired together end to end.
