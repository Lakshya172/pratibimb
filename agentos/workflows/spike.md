# Workflow: Capability Spike

> **Purpose: turn an `UNKNOWN` into a `FACT`.**
> **Throwaway code. Permanent evidence.**
> Exit gate: `agentos/gates/QG-01-capability-spike.md`

---

## Entry condition

An item is listed as `UNKNOWN` in `docs/architecture/constitution.md` section 9, or as a `UNKNOWN`
cell in `agentos/registry/feasibility-matrix.md`.

## Rules

1. **Spike code is throwaway and must be labelled so.** It does not ship, it is not
   reviewed for quality, and it never becomes production code by accident.
2. **The artifact is the deliverable, not the code.** Every spike produces a file under
   `artifacts/experiments/` recording: the question, the machine, the OS, the browser and
   version, the backend, the runtime library version, the date, the raw output, and the
   verdict.
3. **A spike answers exactly one question.** If it needs to answer two, run two spikes.
4. **A null result is a result.** "WebGPU adapter is null in the Firefox event page" is
   worth more than a week of architecture built on the assumption that it is not.
5. **No spike result is generalised.** Chrome WebGPU working tells you nothing about
   Firefox WASM. Fill the cell you tested and no other.

## Steps

```
1  State the question, and the decision it unblocks
2  Record the environment BEFORE running anything
3  Build the smallest thing that answers it
4  Run it. Capture raw output verbatim.
5  Write artifacts/experiments/SPIKE-NNNN-<slug>.md
6  Update agentos/registry/feasibility-matrix.md or docs/architecture/constitution.md section 9
7  If the answer invalidates a dossier assumption, raise an ADR
8  Delete or clearly quarantine the spike code
```

## Week-one spike set — the ordered list

**Nothing else in the project starts until S-01 and S-02 resolve.**

| # | Question | Unblocks |
|---|---|---|
| **S-01** | Does `navigator.gpu.requestAdapter()` return a real adapter inside a Chrome `chrome.offscreen` document? | Every WebGPU number in the dossier |
| **S-02** | Same, inside a Firefox MV3 event page | Firefox parity story |
| **S-03** | Can an ORT Web session be created and run in each context, on each backend? | The whole perception tier |
| **S-04** | Can three ORT Web sessions coexist in one WASM heap in an offscreen document? Does teardown reclaim? | Tier design; the known landmine |
| **S-05** | Real `tabs.captureVisibleTab` rate limits under `activeTab` | The change gate |
| **S-06** | Coordinate contract at DPR 1.0/1.5/2.0 and 100%/125% zoom | The executor |
| **S-07** | **Thin end-to-end thread**: dumb redact → server → one click. Skeleton, no ML. | Extension messaging, coordinate spaces, vLLM guided-decoding quirks |
| **S-08 .. S-27** | The twenty feasibility cells (5 models x 4 contexts) | Model adoption |

> **If S-01 or S-02 returns null, every WebGPU number in this document becomes the WASM
> number and the entire performance story changes.** That is not a failure of the spike;
> that is the spike doing its job in week one instead of week five.

## Owning reviewers

`ml-engineer` (models, runtimes) · `browser-engineer` (contexts, coordinates, capture) ·
`performance-engineer` (measurement discipline)

## Exit

QG-01. The cell or the section-9 line is updated from `UNKNOWN` to `FACT` with an artifact
path, **or** it stays `UNKNOWN` and the dependent work does not start.
