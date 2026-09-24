# Capture policy — explicit and fail-closed

> **Status: in force.** Derived from [ADR-0009](../adr/ADR-0009-gesture-authorised-capture.md),
> approved by the owner on 2026-09-24, and from `constitution.md` §5 as amended by it.
>
> **Approval of the architecture is not a readiness claim**, and nothing in this file should be read
> as one. What is EXPERIMENTALLY VERIFIED is separately recorded in `artifacts/experiments/`.

## The policy in one line

**A frame is taken only when a person has just asked for one, and never otherwise.**

## What may trigger a capture

| trigger | status |
|---|---|
| A human invoking the extension on a tab (toolbar action) | **in force** |
| An explicit human refresh after re-authorisation | **in force** — it is the same trigger |
| A navigation that revoked the grant | **requires a new invocation**; it is not itself a trigger |
| A change-driven refresh | **not implemented, and would need its own approval** |

## What is forbidden

These are not omissions to be filled in later. Each is a decision.

- **No periodic polling.** Nothing wakes up to look at a page.
- **No autonomous repeated capture.** One authorisation is not a standing licence.
- **No retry after a quota refusal.** The adapter classifies a browser quota error and reports it;
  it never retries into one. A scheduler that decides *when* to capture does not exist, and the
  current answer to "how often" is "when a person asks".
- **No silent substitution of worker capture.** `captureVisibleTab` is absent from a product bundle,
  not merely unreached — the adapter property that would call it is supplied only under
  `M3_WORKER_FRAME`, which no product build sets.
- **No widening of host permissions to avoid the gesture.** The product manifest is
  `["http://127.0.0.1/*"]`.

## Fail-closed, concretely

When the authority cannot honour a request it **refuses and stops**. It does not degrade, retry, or
find another route. The refusals a caller can see:

| refusal | means |
|---|---|
| `NO_ACTIVE_TAB_GRANT` | nobody has invoked the extension on this tab, or the grant is gone |
| `DOCUMENT_CHANGED` | the grant is bound to a different page than the one now asking |
| `MINT_FAILED` | Chrome refused to issue a handle — reported as itself, never as an absent grant |
| `HANDLE_ALREADY_ISSUED` | defensive: a handle came back that had already been handed out |
| `CAPTURE_FAILED` | the stream could not be turned into a frame |

A refused capture **does not stop the loop**. The DOM is the actionable substrate and vision is
evidence added to it, so a run with no frame perceives structurally and the client then declares the
tier that actually fired — `["T0","T2"]` rather than `["T0","T1","T2"]`. A client that saw nothing
says so.

## The lifecycle

```
NO_GRANT ──(person invokes)──▶ GRANTED ──(first frame)──▶ STREAM_AVAILABLE
    ▲                                                            │
    │                                            (page changes)  │
    └──(navigation / tab close)── REVOKED ◀───── DOCUMENT_CHANGED ┘
                                     │                    │
                                     └────── both require a new invocation
```

`REQUIRES_REAUTH` is `NO_GRANT`, `DOCUMENT_CHANGED` or `REVOKED`. It is reported as a field, not
inferred, and the side panel renders it in one sentence.

**A grant is bound to a page, not to a tab number.** Chrome revokes `activeTab` on navigation and the
authority mirrors that; binding on first use means a frame for a different document is refused by
the authority's own bookkeeping even if the revocation listener never fired.

## The cost, stated

On a multi-step task across navigations this is **one invocation per document**, not one per
session. The owner accepted that explicitly in ADR-0009 §0: *"a deliberate fail-closed behavior, not
a defect to be hidden."*

It is a real limit on autonomy and it is the most likely reason a future milestone reopens ADR-0009.
If it is ever reopened, the honest alternative is to revert to `captureVisibleTab` **and record that
pixels transit the service worker as an accepted limitation** — not to keep the stream route and
describe it as free.

## The degraded test route

`M3_WORKER_FRAME=1` compiles in a `captureVisibleTab` path, because **no automated harness can
produce the invocation `activeTab` requires** — measured: `<all_urls>` does not substitute, a real
click inside an extension page does not, and a CDP keyboard command never reaches Chrome's
accelerator table.

It is regression infrastructure and nothing else. Evidence taken on it carries
`routeCategory: DEGRADED_TEST_ROUTE` and **may not be used to claim product-route verification**.
