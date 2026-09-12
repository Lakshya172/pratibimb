# W-A — design / pre-registration

> **Design only. No data, no measurement, no claim.** Written before collection so the rules
> cannot be chosen to suit a result. Read [README.md](README.md) first.

---

## 1. What item 11 requires, exactly

From `docs/testing/benchmark-contract.md` Rule 2, the **Visual context — 25%** row:

> Element mAP@0.5, element recall, grounding accuracy. **Reported twice: on clean frames and
> on redacted frames.** Evidence source: ScreenSpot-v2 web subset plus **300 self-labelled
> Indian government and banking screens**, including scanned-document pages where the DOM is
> empty.

Three consequences follow immediately, and all three are recorded rather than worked around:

1. **The redacted half is blocked on T2**, which does not exist. No amount of data produces
   it. Whether item 11 may be closed on the clean half alone, with the redacted half
   explicitly deferred, is an **owner scoping decision** (§11-D1).
2. **"Acceptable" is undefined.** No numeric acceptance criterion for item 11 exists in this
   repository. **Owner decision, required before sealing** (§11-D2).
3. **The DOM-empty subset is load-bearing**, not a nice-to-have: it is the one case the
   admissible DOM-only floor cannot cover, so it is where the detector earns its place.

---

## 2. Source A — ScreenSpot-v2

| | |
|---|---|
| Required subset | the **web** subset only. Mobile and desktop-application subsets are out of scope for T1 |
| Licence | **UNKNOWN in this repository.** No record states it |
| Provenance method | the project's own rule: read the licence **at a pinned revision**, record URL and date. A licence claimed on a dataset card, in a README or in the dossier is **UNKNOWN until this is done** |
| Local processing | **to be confirmed by that reading**, not assumed |
| Derived annotations | **to be confirmed by that reading**, not assumed |

**The structural problem, and it is not small.** ScreenSpot-style benchmarks are
*instruction-grounding* sets: each sample pairs a screenshot with an instruction and **the
single target element's box**. Our metrics are **exhaustive**: element recall needs every
evaluatable element on the screen, and mAP@0.5 counts every unmatched prediction as a false
positive. **An instruction-level set cannot produce element recall or mAP@0.5 as published** —
against one target box, a detector that correctly finds forty real controls scores thirty-nine
false positives.

> **This is stated as an INFERENCE about the dataset's structure, not as a repository FACT:
> nothing in this repository records ScreenSpot-v2's schema.** It must be verified at the
> pinned revision **before** any plan depends on it.

If verification confirms it, ScreenSpot-v2 can contribute in exactly one of three ways, and
the choice is an owner decision (§11-D3):

- **(a) Re-label a subset exhaustively** under the §4 protocol — then it is a second
  `REAL_LABELLED`-grade corpus that happens to come from ScreenSpot, and its licence must
  permit derived annotations.
- **(b) Report a separate, clearly-named point-grounding figure** on it — a different metric,
  not item 11's, never averaged with item 11's.
- **(c) Scope it out of item 11 with the reason recorded**, leaving the 300 screens as the
  evidence source.

**Option (b) must never be presented as the dossier's grounding accuracy.** The project's
grounding accuracy is *per-prediction precision* (`groundedHits / predictions`, read from
`evaluator.ts`); published ScreenSpot leaderboard numbers — including the Qwen3-VL 0.958 /
0.940 figures quoted in `model-registry.md` — are *instruction-level*. They are different
quantities and must never appear in the same column.

---

## 3. Source B — the 300 self-labelled screens

### 3.1 Composition (to be approved, not assumed)

| axis | requirement |
|---|---|
| Domain | Indian **government** and **banking** web interfaces, per the contract's wording |
| DOM-present | the majority, since that is the normal path |
| **DOM-empty / scanned** | a **named, reported subset**, because it is the case the DOM-only floor cannot serve. Its size is an **owner decision** (§11-D4) |
| Viewport | **must span the measured scale range**, including viewports wider than the 960–1280 band the detector was trained on — otherwise W-A silently inherits C4's blind spot |
| DPR / zoom | at least DPR 1 and 1.5, and at least one non-100% zoom, since the coordinate contract covers both |
| Browser | Chromium and Firefox, per the feasibility matrix's own axes |
| Capture | **`captureVisibleTab({format:"png"})` only**, per ADR-0002. No JPEG, no WebP, no re-encode |
| Scroll | recorded per sample (`Sample.scroll`), because annotations are CSS-viewport boxes at a specific scroll offset |

### 3.2 Inclusion and exclusion

**Include:** publicly reachable, unauthenticated pages; pages reachable after a *test* login
to an account created for this purpose; and synthetic-data forms filled with **fabricated**
values.

**Exclude, without exception:** any screen containing a **real person's** data, including the
collector's own; any authenticated view of a real account; anything behind a paywall, consent
wall or ToS clause forbidding automated capture; and any page whose terms of service have not
been read. **Whether a given site's terms permit capture is a legal question this design does
not answer** (§11-D5).

---

## 4. Annotation protocol

### 4.1 What counts as an actionable element

The eight frozen `EvalClass` values — `button`, `link`, `textbox`, `checkbox`, `radio`,
`select`, `tab`, `icon`. **Text and images are deliberately excluded**, as the fusion gate
records: OCR and the DOM describe those better. The class list is **not extended by this
workstream**; extending it changes the trained model's contract.

### 4.2 Boundaries — the rules that decide agreement

| case | rule |
|---|---|
| Element box | the element's **CSS border box** as the DOM reports it, in CSS viewport px, at the recorded scroll offset |
| Nested controls | annotate the **innermost actionable** element. A card containing a button is not a button |
| Duplicates | every instance is its own annotation, even when visually identical |
| Composite widgets | a `select` is one annotation; its open popup is a **different capture**, not extra annotations on this one |
| Icon inside a button | **one** annotation, class `button`, unless the icon is independently actionable |
| Disabled controls | annotated, with the class they would have. The detector sees pixels, not `:disabled` |
| Ambiguous | **do not guess.** Route to adjudication (§4.4); if adjudication cannot decide, the sample is **excluded with the reason recorded** — never silently dropped |
| Off-screen | `visibility: "OFFSCREEN"`. Known from the DOM, never captured. Excluded from scoring by the evaluator, and the count is reported |
| Clipped | `visibility: "CLIPPED"`, box = the **full CSS box**, per the frozen definition. See §7 |
| DOM-empty / scanned | annotated **visually**, by a human, against what a user could click. There is no DOM to derive from; the annotator **is** the ground truth, which makes §4.3 mandatory, not optional |
| Dynamic UI | capture is a **single instant**. Annotations describe that instant. Animations, hovers and transient popups are either settled before capture or the sample is excluded |
| Scrolling | one capture = one scroll offset. **Scrolled variants of the same page are the same page** for split purposes (§5) |

### 4.3 Agreement, adjudication, provenance

- **Written guidelines first**, with worked examples for every row of §4.2, frozen before
  labelling starts.
- **Double annotation** of an overlap subset, with **inter-annotator agreement reported** —
  box agreement at IoU 0.5 and class agreement. **The acceptable level is an owner decision**
  (§11-D6); a figure below it means the guidelines are defective, not the annotators.
- **Adjudication** by a third party, recorded per disputed annotation.
- **Provenance per sample** via the existing field: `REAL_LABELLED { source, annotator }`.
  `source` identifies the page; `annotator` identifies who labelled it. A single-annotator
  dataset is **allowed but must be declared**, because it is a weaker claim.

---

## 5. Splits and leakage

### 5.1 The rule

Three splits, `train` / `dev` / `test`, with **the consumed historical test split closed
forever** — it is not reused, not re-scored, and not described as independent. W-A's **test
split is new, sealed, and read exactly once**, for the final reported figure, and only after
the selection rule is locked.

### 5.2 Why the existing guard is not enough

`assertNoLeakage` enforces two things: no sample id in two splits, and no two samples with an
identical **content fingerprint** — geometry plus annotations, ignoring the id. For synthetic
renders that is sufficient. **For real screens it is not**: the same page captured at a
different scroll offset, viewport or zoom produces a *different* fingerprint and would pass,
while being near-duplicate content. A detector that has seen the page's dev capture is not
being tested on its test capture.

### 5.3 The additional discipline

A **dataset-construction guard** — not an evaluator change:

1. **Split by page identity, then by origin.** Every capture of the same page lands in one
   split; **all pages from one origin land in one split**, so template reuse across a
   portal's pages cannot straddle the boundary.
2. **Assign splits before labelling**, from a recorded seed, so annotation effort cannot
   drift toward the split someone hopes to do well on.
3. **Seal the test split**: `sealDataset` records the hash; the hash is committed; the frames
   are stored outside Git (§6); **the test manifest is not opened** until §6's conditions are
   met. Reading it is a recorded event with a date and a reason.
4. **Refuse silently-changed data**: the evaluator already drifts-checks on `datasetHash`, so
   a manifest edited after sealing fails rather than scores.
5. **Report the split sizes and the page/origin counts**, not just the sample counts — 300
   captures of 12 pages is a different dataset from 300 captures of 300 pages, and the
   distinction must not be hidden in a total.

---

## 6. Threshold discipline

- **DEV selects the threshold. TEST is evaluated once. No sweep on TEST, ever.**
- The frozen rule — *maximise `F1(element recall, grounding accuracy)` on the DEV split, ties
  to the higher threshold* — **can be applied unchanged to a real-data dev split.** It is
  defined over two metrics the evaluator computes for any provenance, it introduces no
  constant, and it names no dataset. **No owner decision is required to apply it.**
- Two things do require decisions, both **before** the test read:
  - If the selected threshold lands on a **grid boundary**, the frozen rule itself says the
    grid chose rather than the rule, and the grid must be extended and the selection repeated.
    That is the rule's own instruction, not a new decision — but it must be honoured.
  - **0.55 stays frozen** unless the rule, run on the new real dev split, selects something
    else. If it does, the new value **supersedes 0.55 for real data** and the synthetic 0.55
    is not retroactively revised. Whether the shipped constant
    `PROVISIONAL_THRESHOLDS.score = 0.25` then moves is a **separate** owner decision
    (§11-D7); it stays at 0.25 until a rule-selected threshold exists from an unread split.
- **The consumed historical test split is never re-scored and never called independent.**

---

## 7. Metrics to report

Exactly what the evaluator already emits, plus the context that makes it readable:

| reported | why |
|---|---|
| **element mAP@0.5** | contract Rule 2 |
| **element recall** | contract Rule 2, read **against the measured CLIPPED ceiling**, never against 1.0 |
| **grounding accuracy** | contract Rule 2 — and labelled as **per-prediction precision**, so it is never confused with instruction-level grounding |
| operating point, and the rule that selected it | provenance of the number |
| dataset name, version, **hash**, split, sample / page / origin counts | `RunContext` already carries these |
| the **DOM-empty subset reported separately** | it is the case the floor cannot cover |
| excluded `OFFSCREEN` count, rejected-prediction count | the evaluator counts them; silence would hide them |
| predictions per screen | the single most diagnostic number for a precision-limited detector |
| **clean vs redacted**, if and when T2 exists | contract Rule 2, currently unproducible |
| model id, revision, backend, browser, preprocessing | `RunContext`, already mandatory |

**Uncertainty:** the benchmark contract requires p50/p95 **for latency only** and states no
uncertainty requirement for the visual-context metric. A 300-screen figure has real sampling
error, and reporting a bare point estimate invites exactly the question a panel should ask —
so **adding an interval is recommended, and requires an owner decision** (§11-D8) because it
adds a reporting obligation the contract does not currently impose. **No acceptance threshold
is invented here.**

**The existing gate criterion, stated exactly as it is:** item 11 reads *"Acceptable detector
metrics"*, currently *"FAIL — grounding accuracy 0.055 is unusable"*. The feasibility matrix
phrases it as *"acceptable metrics and usable grounding"*. **That is the whole of it — it is
qualitative, and there is no number behind it.**

---

## 8. CLIPPED handling

The evaluator excludes `OFFSCREEN` and scores `CLIPPED` against the **full CSS box**. On the
synthetic dev split this produced a measured recall ceiling of **94.4%** — 51 clipped
annotations, median visible fraction 0.368, **42 of them arithmetically unreachable at
IoU 0.5 by any detector**.

**This workstream does not fix it.** The rule is frozen, and changing a metric definition
while a held-out figure is being interpreted makes the figure uninterpretable. W-A therefore:

1. **measures the ceiling on the real data** — clipped count, visible-area distribution, and
   how many annotations are unreachable — and reports recall against it;
2. **reports the ceiling next to the figure**, never instead of it;
3. **raises a separate governance decision** (§11-D9) if real screens turn out to be far more
   clipped than synthetic ones, which is plausible on long government forms. The options —
   score CLIPPED against the visible extent, or exclude it as `OFFSCREEN` is excluded — both
   **change the metric**, and so belong to a versioned evaluator change with its own gate,
   **never to this evaluation run**.

---

## 9. Privacy and redaction

The project's posture is already strict: the runtime vault is **memory only** (INV-04), must
never touch `localStorage`, `IndexedDB`, `chrome.storage`, logs or server storage (INV-05),
and **no component may log secret plaintext** (INV-21). A dataset of real screens must not be
the exception that undoes that.

### 9.1 Rules

| question | answer |
|---|---|
| May a captured frame contain real personal data? | **No.** §3.2 excludes it at the source — fabricated values, test accounts, public pages. Redaction is a **second** line of defence, never the first |
| May raw frames be retained? | **Only outside Git, in a named location, with access recorded** — and only after §11 approval. `Sample.framePath` is optional, so the **manifest and annotations can be committed with no pixels at all**, which is the default |
| Are raw frames ever committed? | **No.** Precedent: C3's raw outputs are gitignored and archived outside Git |
| Where does redaction happen? | At **ingest**, before the frame reaches any durable store, and re-verified before anything is shared |
| Can redaction itself leak? | **Yes, and it must be assumed to.** The frozen verifier sequence exists for this: apply masks → encode WebP q62 → decode → re-read by full-frame OCR at low threshold and higher resolution. Masking is **opaque fill**, not blur; boxes dilated 4 px, merged at IoU > 0.3; **a detector that errors or times out counts as a positive** |
| How is the clean/redacted pair made? | From **one** capture: the clean frame, then the redacted frame produced by the T2 union. Two captures would differ in content and the comparison would be meaningless. **T2 does not exist, so this pair is not producible today** |
| How do provenance and hashes work? | Every frame hashed at ingest; the hash in the manifest; `sealDataset` hashes the manifest; the evaluator refuses on drift |
| What does T2 contribute? | D1 (DOM semantics) and D2 (pattern + checksum) need **no model at all** and cover most structured Indian PII, so they can run before any T2 model is integrated. D3/D4 and the verifier are T2 proper |

### 9.2 Hard stop

**No real screen is captured until §11's privacy and licensing approvals are recorded.** A
collection run that starts before them cannot be made compliant afterwards — the frames
already exist.

---

## 10. PASS / FAIL / INCONCLUSIVE

Structural, because the numeric bar does not exist yet and **inventing one here is exactly
what the governance rules forbid**. All of this is pre-registered **before** the test read.

**INCONCLUSIVE — decided without any threshold:**

- the dataset fails its own validity checks, or the split guard detects page/origin straddling;
- inter-annotator agreement falls below the level approved in §11-D6;
- the DOM-empty subset is too small to report separately, per §11-D4;
- the clipped ceiling on real data is so low that recall is dominated by the metric definition
  rather than the detector (§8);
- the selected threshold lands on a grid boundary and the grid was not extended;
- the test split was opened more than once, or opened before the rule was locked.

**FAIL — threshold-free conditions:**

- a metric **collapses toward zero** on real data, the way C3's off-grid cells did;
- the detector is **worse than the DOM-only floor** on the DOM-present subset, which would
  mean adopting it makes the product worse;
- it fails on the **DOM-empty subset**, where it is the only available source of elements.

**PASS requires the owner's definition of "acceptable" (§11-D2), recorded before sealing.**
A figure alone cannot pass a qualitative bar; a figure plus a pre-registered bar can.

**What would actually improve the gate:** a real-data grounding figure that survives its own
provenance — unread split, one read, rule-selected operating point, ceiling reported. **What
would leave it failing:** another synthetic number, or a real number obtained by sweeping the
test split. **What would indicate a new detector revision is needed:** real-data failure that
persists after the threshold is rule-selected, after duplicate false positives are accounted
for, and after the scale question (C4) is attributed — in that order, because each is cheaper
than the next.

---

## 11. Decisions required before anything starts

| id | decision |
|---|---|
| **D1** | May item 11 close on the **clean half alone**, with the redacted half deferred to T2 and recorded as deferred? |
| **D2** | **What does "acceptable detector metrics" mean numerically?** Must be fixed **before** sealing |
| **D3** | ScreenSpot-v2's role: re-label exhaustively **(a)**, report a separate point-grounding figure **(b)**, or scope it out with the reason recorded **(c)** |
| **D4** | The **DOM-empty / scanned** subset size |
| **D5** | **Legal / ToS**: may the named sources be captured at all? This design makes no legal claim |
| **D6** | The acceptable **inter-annotator agreement** level, and whether single-annotator labelling is permitted |
| **D7** | Whether `PROVISIONAL_THRESHOLDS.score` moves off **0.25** once a real rule-selected threshold exists — a **separate** decision from the evaluation |
| **D8** | Whether an **uncertainty interval** is reported, since the contract does not currently require one |
| **D9** | Only if §8 triggers it: a **versioned evaluator change** for CLIPPED, with its own gate, never inside this run |
| **D10** | Who collects, who labels, who adjudicates, and where frames are stored |

---

## 12. Sequence — and nothing in it has started

1. **Approvals** — D1–D10 recorded. **Gate: no capture before this.**
2. **Collection protocol** frozen: sources, viewport / DPR / zoom matrix, PNG-only capture,
   exclusion rules, ingest redaction, storage location.
3. **Annotation guidelines** frozen, with worked examples per §4.2.
4. **Split assignment from a recorded seed, before labelling**; page/origin guard; **test
   sealed, hash committed, frames outside Git.**
5. **Collect and label.** Agreement measured on the overlap subset; adjudication recorded.
6. **DEV only**: apply the frozen rule. Record the selected threshold and the sweep.
7. **TEST once**: one evaluation, at that threshold, recorded as a dated read.
8. **Report** per §7 — clean, plus redacted if T2 exists by then.
9. **Gate update** against D2's bar; then the adoption review (items 9 and 14 move with it).

**Current status: step 0.** Nothing in this list has been performed.
