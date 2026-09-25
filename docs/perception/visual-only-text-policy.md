# Visual-only text — the v1 redaction policy

> **Status: v1 POLICY, owner-directed 2026-09-25 (Ronit Saha).** Recorded in M7.3.
>
> **ARCHITECTURALLY APPROVED** as a direction · **NOT YET VERIFIED** end to end — no text-region
> detector is adopted, and no frame leaves the client today, so nothing in the product applies this
> policy yet. Nothing here claims a recall figure.

## The policy, in one line

**A text region the detector finds inside a visual-only area is fully redacted, unread.**

"Visual-only area" means pixels the DOM cannot describe — a `<canvas>`, an image, a scanned
document — as distinct from text the DOM already holds, which the existing DOM path handles.

## What the detector must supply, and what it must not

| supplies | never supplies |
|---|---|
| a box (rectangle or quadrilateral) in CSS viewport pixels | the recognised text |
| a confidence score | a character sequence of any kind |
| the visual-only region the box belongs to | anything that would need a vault entry |

**OCR is not required and is not used.** The product is not trying to read the secret; it is trying
to keep the secret from becoming model-visible. A region detector achieves that without the string
ever existing, so nothing has to cross from the perception realm, which owns the pixels, to the
content realm, which owns the vault. The rejected recognition model (`PP-OCRv5_mobile_rec`) stays
rejected for this role, for exactly that reason.

## How a region is classified — fail-closed, because nothing is read

Nothing in v1 can tell a sensitive string from a heading without reading it. So:

> **Every detected text region in a visual-only area is classified sensitive**, and is redacted.

That is the frozen union's own rule applied to a channel that cannot see content: *"over-masking is
free and under-masking is fatal"* (`security-invariants.md`, FROZEN). It also matches INV-23: a
detector that errors or times out counts as a positive, and the **whole** visual-only region is then
redacted (`failClosedMask`). A finer classifier that did not read text would be a separate decision;
none is proposed here.

## How it is redacted — the canonical geometry, and nothing else

```
detector boxes ─► redactionMask(boxes, visualOnlyRegion)          packages/privacy/src/redactionGeometry.ts
                    axis-align → dilate 4 px → merge at IoU > 0.3 → clip to the region
               ─► constant-colour opaque fill over every mask rectangle   (frozen method; never blur)
```

`redactionMask` is the one implementation of the frozen union in the repository. The RE-1 scorer
imports it; a test fails if a second implementation of dilation or merging appears in product
source; and `redaction-geometry.golden.json` pins it to the geometry the scorer produced when RE-1 was
pre-registered.

## The limitation, stated plainly

**A region the detector fails to find is not protected by this mechanism.** Region redaction is only
as good as the detector's recall on the text actually present, and:

- there is **no verifier backstop for canvas text** today — the frozen verifier's safety net is a
  full-frame OCR re-read and a value check, and PratiBimb has no OCR;
- **no recall figure is claimed.** RE-1 measures exposure on a small synthetic held-out set; a pass
  there bounds the per-glyph miss rate at about 1 % with 95 % confidence *on that set*, and says
  nothing about fonts, scripts, rotations or photographs it does not contain;
- the fail-closed failure path (INV-23) protects against a detector that **errors**. It does not
  protect against a detector that runs cleanly and **misses**.

## Open before any producer is wired — the `TextFinding` seam

`apps/extension/host-lib/text-perception.ts` defines `TextFinding` as `{ box, length, piiClass, ref }`.
It was written for a producer that **reads**:

- `length` is *"how many characters were recognised"* — a region detector recognises none;
- `piiClass: null` means *"not sensitive by its rules"*.

**A region-only producer must never report `piiClass: null`.** Under this policy that would declare
unread text **not sensitive**, the exact opposite of fail-closed. Before any region detector is wired
to the seam, it needs a way to say "unread, therefore sensitive" that cannot be confused with "read,
and found harmless". That change belongs with the integration of an accepted candidate and its own
review. It is **not** made here: no producer exists, and changing the interface now would be
changing it for a model that has not been chosen (blocking rule 4). The seam still has no field for
characters, and that must not change.

## What stays true

One vault · one classifier · one redaction path · one egress authority · one click authority · no
storage · no OCR · no plaintext visual text crossing any realm · no raw pixels crossing any realm.
