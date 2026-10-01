/**
 * THE INDEPENDENT WITNESS to what actually happened at a button.
 *
 * WHY IT EXISTS. The fixture keeps its own list of the raw events that reached `#submit`, and that
 * list is the right thing for the demo to assert on: it is what stops the host quietly using
 * `el.click()` instead of a real pointer sequence. But a count of entries in that list cannot tell
 * five different things apart, and M2 ran into exactly that — ten entries where five were expected,
 * with no way to say which of these had happened:
 *
 *   A. two logical dispatches       the core realm asked twice
 *   B. two transport deliveries     the worker carried one ask twice
 *   C. two browser actions          the isolated world fired twice
 *   D. two observations of one      the page recorded a single event twice
 *   E. an event from outside        a real user click, or another extension
 *
 * WHAT THIS ADDS, and it is only the last two — A, B and C are answered in the extension, by the
 * cycle report, the worker's port recording and the page agent's own fire counter:
 *
 * - `trusted`, which **no dispatched event can set**. A `true` here is an event no extension caused.
 * - Event OBJECT identity, in a `WeakSet`. Two entries for one object is a duplicated observation;
 *   two entries for two objects is two events. This is the distinction M2 could not make.
 * - `at`, absolute on the page's own clock, so an event can be matched against the window the
 *   isolated world says it fired in — or shown to belong to no window at all.
 * - `listenersOnSubmit`, which is how "the page's own script ran twice" would look.
 *
 * IT CHANGES NOTHING. Capture-phase listeners on `window`, no `stopPropagation`, no
 * `preventDefault`, no `stopImmediatePropagation`, and `addEventListener` is patched only to count
 * before delegating. It reads no field values and carries none.
 */

/** The five events of E6 mechanism B, in the order the host dispatches them. */
export const SEQUENCE = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];

/** One sequence is five raw events. */
export const SEQUENCE_LENGTH = SEQUENCE.length;

/**
 * Installed with `page.addInitScript`, so it runs before any script the page has.
 *
 * Serialized and evaluated in the page's main world: it must not close over anything here.
 */
export const installProbe = () => {
  const w = window;
  w.__probeInstalls = (w.__probeInstalls ?? 0) + 1;
  w.__probe = { events: [], objectSeenTwice: 0, listenersOnSubmit: 0, timeOrigin: performance.timeOrigin };
  const seen = new WeakSet();

  const nativeAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    try {
      if (this instanceof Element && this.id === "submit") w.__probe.listenersOnSubmit += 1;
    } catch {
      /* counting must never break the page */
    }
    return nativeAdd.call(this, type, listener, options);
  };

  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    nativeAdd.call(
      w,
      type,
      (event) => {
        const target = event.target;
        if (!target || target.id !== "submit") return;
        if (seen.has(event)) w.__probe.objectSeenTwice += 1;
        else seen.add(event);
        w.__probe.events.push({
          type: event.type,
          trusted: event.isTrusted === true,
          at: performance.timeOrigin + event.timeStamp,
          x: event.clientX,
          y: event.clientY,
          detail: event.detail,
        });
      },
      true
    );
  }
};

/**
 * Clock coarsening between the page's main world and the content script's isolated world.
 *
 * Deliberately small. It has to be far narrower than the gap between two real sequences, or
 * attribution would absorb the very thing it exists to detect.
 */
export const ATTRIBUTION_EPSILON_MS = 2;

/**
 * Match what the page saw against what the isolated world says it did.
 *
 * The window opens at `preparedAt`, not at `at`: a `MouseEvent`'s `timeStamp` is fixed when the
 * event is CONSTRUCTED, so all five carry a time from before the first `dispatchEvent`. The first
 * fifty-run sweep found this the hard way — one run in fifty spent long enough between constructing
 * the events and dispatching them that a window anchored at dispatch called the extension's own
 * click an event the extension did not cause.
 */
export function attribute(probe, fires) {
  const events = probe?.events ?? [];
  const untrusted = events.filter((event) => !event.trusted);
  const trusted = events.filter((event) => event.trusted);
  const within = (event, fire) =>
    event.at >= fire.preparedAt - ATTRIBUTION_EPSILON_MS &&
    event.at <= (fire.doneAt ?? fire.at) + ATTRIBUTION_EPSILON_MS;
  const unattributed = untrusted.filter((event) => !fires.some((fire) => within(event, fire)));
  return {
    total: events.length,
    untrusted: untrusted.length,
    trusted: trusted.length,
    unattributed: unattributed.length,
    objectSeenTwice: probe?.objectSeenTwice ?? 0,
    listenersOnSubmit: probe?.listenersOnSubmit ?? 0,
    /** Milliseconds after the first fire began. Negative is before the extension constructed them. */
    offsets: untrusted.map((event) => ({
      type: event.type,
      ms: fires.length === 0 ? null : Math.round((event.at - fires[0].preparedAt) * 1000) / 1000,
    })),
  };
}
