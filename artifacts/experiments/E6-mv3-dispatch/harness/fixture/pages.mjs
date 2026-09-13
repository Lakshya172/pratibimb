/**
 * E6 fixtures, served from 127.0.0.1 by the harness. Every page installs the same main-world event
 * logger, so what the PAGE observed is recorded independently of what the extension reports.
 */
const LOGGER = `<script>
  window.__events = [];
  for (const t of ["beforeinput", "input", "change", "pointerdown", "mousedown", "mouseup", "click"]) {
    document.addEventListener(t, (e) => window.__events.push({ type: e.type, target: e.target && e.target.id, isTrusted: e.isTrusted, inputType: e.inputType || null }), true);
  }
</script>`;

const page = (body, head = "") => `<!DOCTYPE html><html><head><meta charset="utf-8">${head}
<style>body{font:15px system-ui;margin:40px} input{width:260px;height:30px;font:inherit} button{height:34px;padding:0 16px;font:inherit}
.wrap{position:relative;width:200px;height:40px} #overlay{position:absolute;inset:0;background:transparent}</style>
</head><body>${LOGGER}${body}</body></html>`;

export const PAGES = {
  F1_plain_tel: page(`<label for="t">Mobile number</label> <input id="t" type="tel">`),

  F2_react_controlled: page(
    `<div id="root"></div>
<script src="/vendor/react.production.min.js"></script>
<script src="/vendor/react-dom.production.min.js"></script>
<script>
  const h = React.createElement;
  function App() {
    const [v, setV] = React.useState("");
    const [, setTick] = React.useState(0);
    window.__reactValue = v;
    window.__forceRerender = () => setTick((t) => t + 1);
    return h("div", null,
      h("label", { htmlFor: "t" }, "Mobile number "),
      h("input", { id: "t", type: "tel", value: v, onChange: (e) => setV(e.target.value) }),
      h("span", { id: "mirror" }, v));
  }
  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
</script>`
  ),

  F3_maxlength_5: page(`<label for="t">PIN (5)</label> <input id="t" type="text" maxlength="5">`),

  F5_hostile_monkeypatch: page(
    `<label for="t">Mobile number</label> <input id="t" type="tel">
<script>
  // A hostile page tries to observe values as they are set, through the prototypes it controls.
  window.__stolen = [];
  window.__seenAfterInput = [];
  const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  Object.defineProperty(HTMLInputElement.prototype, "value", {
    configurable: true,
    get() { return d.get.call(this); },
    set(v) { window.__stolen.push({ via: "value-setter", len: String(v).length }); d.set.call(this, v); },
  });
  const ec = Document.prototype.execCommand;
  Document.prototype.execCommand = function (...a) { window.__stolen.push({ via: "execCommand", len: String(a[2] || "").length }); return ec.apply(this, a); };
  const sr = HTMLInputElement.prototype.setRangeText;
  HTMLInputElement.prototype.setRangeText = function (...a) { window.__stolen.push({ via: "setRangeText", len: String(a[0] || "").length }); return sr.apply(this, a); };
  // What any page can always do: read the field after something was typed into it.
  document.getElementById("t").addEventListener("input", (e) => window.__seenAfterInput.push(e.target.value.length));
</script>`
  ),

  K1_plain_button: page(`<button id="t">Next</button><script>window.__effect = 0; document.getElementById("t").addEventListener("click", () => { window.__effect++; });</script>`),

  F4_trusted_only_button: page(`<button id="t">Next</button><script>window.__effect = 0; document.getElementById("t").addEventListener("click", (e) => { if (e.isTrusted) window.__effect++; });</script>`),

  K2_transparent_overlay: page(
    `<div class="wrap"><button id="t">Next</button><div id="overlay"></div></div>
<script>window.__effect = 0; window.__overlay = 0;
document.getElementById("t").addEventListener("click", () => { window.__effect++; });
document.getElementById("overlay").addEventListener("click", () => { window.__overlay++; });</script>`
  ),
};
