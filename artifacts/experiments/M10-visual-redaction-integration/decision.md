# M10 — decision record (in progress)

**No M10 verdict is recorded yet.** M10 closes only when the full chain has been demonstrated end to
end: raw capture frame → TR-01 → fail-closed policy → canonical geometry → pixel mask → WebP → test
loopback sink.

## Owner decisions in force

- **D1.** TR-01 (`PP-OCRv4_mobile_det`) is the first integration candidate. TR-02 is not integrated.
- **D2.** An end-to-end masking proof with a test-only loopback sink. No real external image egress.
- **D3.** Engineering gates, each changed only by an owner decision:
  - a 2,000 ms detector deadline per frame, excluding initialization;
  - a 200 MB peak WASM memory budget.
- **REFUSED is approved and terminal.** A visual-only region without a trustworthy rectangle gives
  `REFUSED`, and that frame must not leave the privacy boundary. REFUSED is never an empty mask, zero
  detections, a sanitized success, an encode or an egress. It is distinct from detector failure,
  which masks the whole region and may continue as a sanitized frame.

## M10.3 decisions (region enumeration)

| question | decision |
|---|---|
| element kinds | `canvas` and `img` only. Not enumerated, and recorded as gaps: `video`, inline `svg`, CSS background images, `object`/`embed`, cross-origin iframe content, shadow-DOM content |
| visibility | left out exactly when the element graph's `cssHidden` is true: `display:none`, `visibility:hidden`, zero width or height. Off-screen and partly visible elements keep their **full** CSS rectangle; clipping is the coordinate stage's job |
| unmeasurable rectangle | kept as measured, never dropped; the strict parser then refuses the whole observation |
| id | `<kind>:<n>`, the index among all elements of that tag (hidden ones included), in document order. Positional only: never the page's `id` attribute, a URL or content. The parser refuses any other form |
| document / frame | a region belongs to the browser-attested document of the observation that carried it; the page cannot claim one |
| malformed list | the whole observation is refused (`parsePageReply` → `null`), as for a malformed measurement |
