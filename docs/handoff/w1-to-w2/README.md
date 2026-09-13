---
id: HANDOFF-W1-W2
title: "W1 → W2 engineering handoff — manifest"
status: handoff record
date: 2026-09-13
source_commit: 75e5cd16147a087236ea206b6af635bd79fbecf2
branch: handoff/w1-to-w2
---

# W1 → W2 engineering handoff

> **What this is.** Everything W2 needs to clone this repository on a different machine and
> continue, without trusting anything that exists only on W1.
>
> **What this is not.** It adds no feature, promotes no experiment, and upgrades no claim. Every
> status below is copied from the record that established it. Where a thing cannot be transferred,
> it says so rather than pretending otherwise.

| | |
|---|---|
| **Source commit** | **`75e5cd16147a087236ea206b6af635bd79fbecf2`** (`main`, tree clean, equal to `origin/main`) |
| **Handoff branch** | `handoff/w1-to-w2` |
| **Handoff date** | 2026-09-13 |
| **Canonical remote** | `https://github.com/ronitsaha11/pratibimb.git` (`origin`, fetch and push) |
| **Tags at handoff** | `v0.1.0-foundation` · `v0.2.0-spikes` · `v0.2.1-perception-substrate` · `v0.2.2-t1-fusion-checkpoint` · `v0.2.3-qg05-t1-evaluator` — **none moved, none created** |
| **Tracked size** | 5.86 MiB packed, 863 tracked files |

## The four documents

| File | Answers |
|---|---|
| **README.md** *(this file)* | machine identity · remotes · what transferred · what did not · secret audit |
| [repository-inventory.md](repository-inventory.md) | what is in the repository, entry points, commands, what must never be hand-written |
| [evidence-index.md](evidence-index.md) | every experiment: provenance, status, limits, and what it does **not** license |
| [artifact-manifest.md](artifact-manifest.md) | checksums for what is committed, and for what is required but deliberately absent |
| [reproduction-guide.md](reproduction-guide.md) | exact W2 steps, verification results, and the recommended first task |

## W1 machine identity — observed this session

Recorded **2026-09-13T14:26:47Z** from live queries on this machine. Nothing here is inferred from
a model name.

| Field | Value |
|---|---|
| Hostname | **`LAPTOP-6E14K34L`** |
| OS | Windows 11 Home Single Language **10.0.26200**, build 26200 |
| CPU | **Intel Core 7 240H**, 16 logical processors |
| RAM | 23.64 GiB |
| Integrated GPU | Intel Graphics, driver 32.0.101.7077 |
| Discrete GPU | **NVIDIA GeForce RTX 5050 Laptop GPU** |
| **GPU UUID** | **`GPU-d9538d37-4104-412c-6c3e-0a7adbd761ad`** |
| GPU PCI / driver / compute cap | `00000000:01:00.0` · **610.74** · **12.0** |
| GPU memory | **8151 MiB** |
| Node / npm | **v24.19.0** / **12.0.2** |
| Python (Windows) | **3.13.14** |
| Docker | CLI present; **daemon NOT running** |
| WSL | **2.6.3.0**, kernel 6.6.87.2-1 — **distributions: `docker-desktop` only, Stopped. No Linux guest.** |
| `nvcc` | absent |
| Free disk, `C:` | 70.2 GB |
| Browsers present | Chrome · Edge · Firefox (system installs) · Playwright **chromium-1234** |
| Repository path | `C:\Users\RONIT\pratibimb-b31` |

**A second, stale clone exists on this machine** at `C:\Users\RONIT\OneDrive\Desktop\PratiBimb`. It
sits at the PR #40 merge with a dirty tree and does **not** contain `packages/agent`. It is not the
working clone and W2 should ignore it; it is recorded so nobody mistakes it for one.

## W1 and W2 are different physical machines

This matters more than it looks, because **both carry an RTX 5050 Laptop GPU with 8151 MiB**. The
model name identifies nothing.

| | **W1** | **W2** *(from [ENV-0004](../../../artifacts/environment/ENV-0004-w2-windows-wsl-gpu-link.md), not re-measured here)* |
|---|---|---|
| Hostname | `LAPTOP-6E14K34L` | `LAPTOP-SRCINK2B` |
| **GPU UUID** | **`GPU-d9538d37-4104-412c-6c3e-0a7adbd761ad`** | **`GPU-acde8e3a-c29b-9943-557e-04dd0b20a09a`** |
| GPU PCI / driver | `00000000:01:00.0` · 610.74 | `00000000:04:00.0` · 592.82 |
| Integrated GPU | Intel Graphics | AMD Radeon 860M |
| WSL distributions | **`docker-desktop` only** | `Ubuntu` 26.04 LTS |
| Guest Python | — (no Linux guest) | 3.14.4 only, pip 25.1.1 |
| vLLM | absent | **not installed** |

**Do not collapse these.** The W2 UUID above is quoted from the committed ENV-0004 record; it was
not measured on this machine and is not re-attested here. The W1 UUID was measured here today.

### The directory prefix `W1-` is not provenance

**This is the single most likely way to get provenance wrong in this repository.** Most experiment
directories begin `W1-`, and that prefix is an early naming convention, **not** a machine label.
Several `W1-`prefixed experiments state that they ran on **workstation 2**, including
`W1-S01b-playwright-extension-loading`, `W1-S02a-firefox-linux-webgpu` and
`W1-S02a2b-chrome-mv3-wasm-csp`.

**Authoritative provenance is what the record itself states** — the `Workstation:` line in its
`decision.md`, or its `environment.json`. Seven experiment directories carry **no workstation
statement at all**; those are **UNKNOWN** and must not be assumed to be either machine.
[evidence-index.md](evidence-index.md) marks each one.

Nothing was relabelled to produce this handoff. Where a record is silent, the handoff says
UNKNOWN.

## What transferred

Everything already tracked in Git is transferred by `git clone` — all source, tests, harnesses,
committed experiment outputs, ADRs, gates, governance records and fixtures. See
[repository-inventory.md](repository-inventory.md).

This handoff **adds** only these documents, plus one standalone preflight script
(`scripts/verify-handoff.mjs`) that checks W2's prerequisites and prints what is missing. No
product code changed.

## What was deliberately excluded, and why

| Excluded | Size / identity | Why | How W2 obtains it |
|---|---|---|---|
| **`artifacts/models/t1-ui-head/t1-ui-head.onnx`** | 302,960 B · sha256 `ba6d9e93…5179d0` | `.gitignore` excludes `*.onnx` and `artifacts/models/` by policy, and **ADR-0003 records its licence and provenance as not yet assembled** — so "legally appropriate to store" is unestablished, not merely unchecked | retrain from the recipe, or copy out of band — see [artifact-manifest.md](artifact-manifest.md). **The extension build hard-fails without it.** |
| ORT runtime assets | 27,797,172 B wasm + 819,591 B bundle | 28 MB, referenced by pinned hash rather than vendored (ADR-0001) | `npm ci` — from `onnxruntime-web@1.29.0` |
| `node_modules/` | ~191 packages | build output | `npm ci` |
| Playwright browser binaries | — | licensing and size | `npx playwright install chromium`, or `CHROME_PATH` |
| `artifacts/datasets/` | `t1-ui-rendered@4bbc57de`, 200 samples | deterministic and regenerable | `node tools/dataset/build-dataset.mjs --counts=120,40,40` |
| Harness `generated/` trees | ~1.9 GB across experiments | reproducible from committed recipes; `.gitignore` lists each with its reason | rerun the harness |
| Browser profiles, caches, Docker volumes, Python venvs | — | machine-local state, and profiles carry browsing data | not transferred, by design |
| Raw `.f32` / `.rgba` dumps | ~100–338 MB per experiment | digests are committed; the bytes are not | rerun the harness |

**No secrets, credentials, cookies, tokens or personal data were transferred.** None were found —
see below.

## Security / secret audit

Run on the full tracked tree at `75e5cd16` before any commit on this branch.

| Check | Result |
|---|---|
| `bash scripts/check-secrets.sh` (repository scanner, staged files) | **clean** |
| OpenAI / GitHub / HuggingFace / AWS / Slack token patterns across all tracked files | **0 matches** |
| `-----BEGIN … PRIVATE KEY-----` | **0 matches** |
| `Authorization: Bearer …` | **0 matches** (outside this table's own text) |
| Absolute local paths `C:\Users\<name>` in tracked files | **18 pre-existing files** — see below |
| Cookies, auth headers, browsing data | none tracked; `.gitignore` excludes `**/browsing-history*`, `**/vault-dump*`, `captures/`, browser profiles |
| Model access tokens / cloud credentials | none; `.gitignore` excludes `.hf_token`, `.huggingface/`, `credentials.json`, `service-account*.json` |

`.env.example` is tracked and contains no values, which is its purpose.

### The absolute-path finding, and a correction to my own first pass

A first sweep of this repository reported **0** absolute local paths. **That was wrong.** The
pattern searched for single backslashes, and the paths that exist are JSON- and log-escaped
(`C:\\Users\\…`), so every one of them was missed. Re-run correctly:

**18 tracked files contain `C:\Users\RONIT\…` or `C:\Users\OMEN\…`**, including
`artifacts/environment/ENV-0002-…`, `artifacts/experiments/ENV-0001-…`, several
`commands.md` files, `artifacts/adr/ADR-0001/gate-run.log` and
`W1-QG03a-B3-1-…/decision.md`. They are run transcripts, environment records and
reproduction commands — the paths are *what was actually run*.

**Assessment: not a secret, and not remediated here.** What leaks is a Windows account name that
is the repository owner's own first name, in a repository they publish under their own account.
No credential, token, cookie or third-party identifier is exposed. **Rewriting 18 historical
evidence files to tidy a username would be editing the record** — this project's rule is that
evidence stays as written. It is recorded here so the next reader knows it is known rather than
missed.

This handoff's own documents add two more occurrences, both deliberate: the W1 repository path and
the stale-clone path, in the machine-identity section, where the whole point is to say exactly
which directory is which.

**If the owner ever wants those paths gone**, that is a deliberate scrubbing decision about
historical artifacts, with its own PR and its own justification — not a side effect of a handoff.

## Verification at handoff

Every command below was run on W1 at this commit. Exact results in
[reproduction-guide.md](reproduction-guide.md).

| Command | Result |
|---|---|
| `npm ci` | **OK** — 191 packages |
| `python scripts/verify-repo.py` | **PASS** — 0 failures, 0 warnings |
| `npm run pin:check` | **OK** — `ort-wasm-simd-threaded.jsep.wasm` `db816fad…a44dea` |
| `npx tsc -b --force` | **clean** |
| `npm test` | **806 passed · 0 failed · 15 skipped** (821 total, 41 files) |
| `npm run build` in `apps/extension` | **OK** — 28.99 MB output, chrome-mv3 |

**One thing this exposed, and it is a genuine handoff finding.** The W1 `node_modules` tree was
**incomplete relative to the lockfile**: `wxt` was present in `package-lock.json` but absent from
`node_modules`, so `npx wxt build` failed by resolving a temporary copy from the npm cache. A clean
`npm ci` fixed it and the extension then built. **W2 should use `npm ci`, never `npm install`** —
the failure mode is silent and looks like a broken config.

## Known stale documentation

Recorded as forward corrections. **Nothing historical was rewritten** — the project's rule is that
a superseded statement stays as written and gains a dated note, because editing it destroys the
record of what was believed when a decision was taken.

| Document | Stale statement | Correction |
|---|---|---|
| `agentos/blockers.md` · **B-03** *Impact* | *"the second workstation has **neither Docker nor WSL**"* | stale since ENV-0003. **Already corrected in-place by a dated update** in the same entry, which the field itself points to. No further action |
| `artifacts/gates/T1-detector-training/README.md` · item 12 | *"Browser correctness verified — **NOT DONE**, only Python `onnxruntime` CPU"* | **stale.** Superseded by QG-03a-B3-1 (four cells in the real MV3 extension, W1) and recorded in `AUDIT-0002`. **The gate record is frozen; moving an item is an owner decision**, so it is flagged, not edited |
| `agentos/registry/model-registry.md` | *"Every row below is currently `PINNED-UNVERIFIED`. No model has been downloaded, pinned, licence-verified, or run."* | **already carries its own dated supersession note** directly above, recording that four models were downloaded, pinned and run (S-04a-1). The original sentence is deliberately preserved |
| `docs/adr/ADR-0007` §8 | the residual *"`act()` remains exported and callable without a hit test"* | **closed** by ADR-0008 / PR #63: `act` now takes only a permit and `validateAndAct` is removed. ADR-0007 is left as written; ADR-0008 records the amendment |
| `packages/agent/test/actOnMvpFixture.test.ts` | its rects once claimed a source that held none | **already corrected** in PR #62, and now machine-checked by `mvpFixtureGeometry.test.ts` |
| Experiment directory names `W1-*` | imply workstation 1 | **not provenance.** Several state workstation 2. Renaming 30+ directories would break every cross-reference and commit link in the repository, so the convention stays and the caveat is documented here and in [evidence-index.md](evidence-index.md) |

## No claim was upgraded

The detector remains **UNADOPTED**. E9 and E1 remain **NOT RUN**. The MV3 host remains
**experimental**. SANITIZE, the privacy verifier, production egress, the vault, RE-HYDRATE,
production TYPE and any orchestrator loop **do not exist**. The W-A real-data collection gate
remains **CLOSED**. E7 did not reach GO; E2's pass is not generalisation evidence; E4's pass is an
instrument property and not a privacy claim; E8 showed landing is not the effect. Every one of
those is restated from the merged record, not re-derived here.
